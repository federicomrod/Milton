import { legacyRedirectTarget } from "@/lib/restaurant/legacy-redirects";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { safeNextPath } from "@/lib/auth/safe-next";
import { NextResponse, type NextRequest } from "next/server";

// Routes that don't require authentication
const publicRoutes = [
  "/auth/login",
  "/auth/signup",
  "/auth/callback",
  "/auth/confirmed",
  "/auth/invite",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/",
];

// Routes that start with these prefixes are public
const publicPrefixes = [
  "/api/", // API routes handle their own auth
  "/_next/", // Next.js internals
  "/favicon.ico",
  "/public/",
  "/onboarding", // Onboarding pages
];

function isPublicRoute(pathname: string): boolean {
  // Check exact matches
  if (publicRoutes.includes(pathname)) {
    return true;
  }

  // Check prefixes
  for (const prefix of publicPrefixes) {
    if (pathname.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public routes without auth check
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  // TODO(restaurant-pivot): dev-only bypass for the mock restaurant cockpit.
  // proxy.ts is the active middleware (compiled from the former middleware.ts).
  // process.env.NODE_ENV is "production" in prod builds, so this branch is
  // provably dead in production — no weakening of prod auth.
  // Remove this block once real Supabase integration is wired up for this route.
  if (
    process.env.NODE_ENV === "development" &&
    pathname.startsWith("/dashboard/restaurant")
  ) {
    return NextResponse.next();
  }

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error(
      "[Proxy] Missing Supabase environment variables. Auth check skipped."
    );
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        // Only set cookies on response if this is a redirect or final response
        response.cookies.set({
          name,
          value,
          ...options,
        });
      },
      remove(name: string, options: CookieOptions) {
        response.cookies.set({
          name,
          value: "",
          ...options,
        });
      },
    },
  });

  // Check if user is authenticated. R1-09c: getClaims() verifies the JWT
  // locally when the project signs with an asymmetric key (no Auth round
  // trip); otherwise it asks Auth, exactly like getUser() did. It also
  // refreshes an expired session through the cookies, like before.
  const authStarted = Date.now();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId =
    typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;
  const user = userId ? { id: userId } : null;
  const authMs = Date.now() - authStarted;

  // If user is not authenticated, redirect to login
  if (!user) {
    console.log(
      `[Proxy] Unauthenticated user trying to access ${pathname}, redirecting to login`
    );
    const redirectUrl = new URL("/auth/login", request.url);
    // Come back to where the person was going (only a safe same-origin path).
    const next = safeNextPath(`${pathname}${request.nextUrl.search}`);
    if (next && next !== "/") redirectUrl.searchParams.set("next", next);
    return NextResponse.redirect(redirectUrl);
  }

  // Restaurant pivot: send authenticated users away from the legacy CFO
  // pages (home, model builder, analytics, reporting, scenarios, data and
  // upload — the ones with the old top navigation) to their restaurant
  // equivalent. Placed BEFORE the onboarding gate so pilot users (who never
  // completed the old onboarding) don't bounce through /onboarding-required.
  const legacyTarget = legacyRedirectTarget(pathname);
  if (legacyTarget) {
    console.log(
      `[Proxy] Restaurant pivot: redirecting legacy ${pathname} -> ${legacyTarget}`
    );
    return NextResponse.redirect(new URL(legacyTarget, request.url));
  }

  // Check onboarding status for protected routes (dashboard, analytics, etc.)
  // Skip this check if user is already on onboarding-required page
  // Also skip for management routes (admin-only) and for admin users
  const isRestaurantPivotRoute =
    pathname.startsWith("/dashboard/restaurant") ||
    pathname.startsWith("/dashboard/settings") ||
    pathname.startsWith("/dashboard/account");
  // Only the onboarding gate below needs this; restaurant routes skip it.
  const needsOnboardingGate =
    pathname !== "/onboarding-required" &&
    !pathname.startsWith("/management") &&
    !isRestaurantPivotRoute &&
    (pathname.startsWith("/dashboard") ||
      pathname.startsWith("/analytics") ||
      pathname.startsWith("/reporting"));
  const isAdmin = !needsOnboardingGate
    ? false
    : await (async () => {
        try {
          const { data, error } = await supabase.rpc("is_milton_admin");
          if (error) {
            console.error("[Proxy] is_milton_admin RPC error:", error.message);
            return false;
          }
          return data === true;
        } catch {
          return false;
        }
      })();

  // Restaurant pivot: these routes skip the legacy onboarding-completion gate.
  //
  // WHY the exemption is broader than just /dashboard/restaurant:
  //   - /dashboard/settings and /dashboard/account are linked from the
  //     restaurant sidebar (RestaurantShell). Without the exemption they hit
  //     the onboarding gate and bounce to /onboarding-required.
  //   - The gate queries companies.created_by = user.id. bootstrap_restaurant_user
  //     creates companies WITHOUT created_by (confirmed: that column doesn't exist
  //     in the restaurant schema — ownership is via company_memberships). So the
  //     query always returns null → onboarding_status undefined → gate fires for
  //     EVERY non-restaurant route, including account and settings.
  //
  // Authentication is still enforced for all these routes — the
  // `if (!user) redirect to /auth/login` check above still applies.
  if (isRestaurantPivotRoute) {
    const existing = response.headers.get("Server-Timing");
    const proxyTiming = `proxy;dur=${Date.now() - authStarted}, auth;dur=${authMs}`;
    response.headers.set(
      "Server-Timing",
      existing ? `${existing}, ${proxyTiming}` : proxyTiming
    );
  }

  if (
    needsOnboardingGate &&
    !isAdmin // Skip onboarding check for admin users
  ) {
    try {
      // Get company for user and check onboarding_status
      const { data: company } = await supabase
        .from("companies")
        .select("onboarding_status")
        .eq("created_by", user.id)
        .single();

      // If onboarding is not complete, redirect to onboarding-required page
      if (company?.onboarding_status !== "completed") {
        const url = request.nextUrl.clone();
        url.pathname = "/onboarding-required";
        return NextResponse.redirect(url);
      }
    } catch (error) {
      // If there's an error checking onboarding, allow the request through
      // (better to show the page than block users)
      console.error("Error checking onboarding in proxy:", error);
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
