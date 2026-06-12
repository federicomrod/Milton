import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Routes that don't require authentication
const publicRoutes = ["/auth/login", "/auth/signup", "/auth/callback", "/"];

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
    console.log(
      `[Proxy] DEV bypass for restaurant route, pathname=${pathname}`
    );
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

  // Check if user is authenticated
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If user is not authenticated, redirect to login
  if (!user) {
    console.log(
      `[Proxy] Unauthenticated user trying to access ${pathname}, redirecting to login`
    );
    const redirectUrl = new URL("/auth/login", request.url);
    return NextResponse.redirect(redirectUrl);
  }

  // Check onboarding status for protected routes (dashboard, analytics, etc.)
  // Skip this check if user is already on onboarding-required page
  // Also skip for management routes (admin-only) and for admin users
  const isAdmin = await (async () => {
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("user_id", user.id)
        .single();
      return profile?.role === "admin";
    } catch {
      return false;
    }
  })();

  // TODO(restaurant-pivot): /dashboard/restaurant/* is exempt from the legacy
  // onboarding-completion gate. The old onboarding flow (business-type dropdown,
  // generic data model) does not apply to the restaurant pilot — users land
  // directly in the restaurant cockpit and POS upload. Authentication is still
  // enforced for these routes (the `if (!user) redirect to /auth/login` check
  // earlier in this file). Remove this exemption once the restaurant onboarding
  // is wired in.
  const isRestaurantPivotRoute = pathname.startsWith("/dashboard/restaurant");
  if (isRestaurantPivotRoute) {
    console.log(
      `[Proxy] PROD bypass: restaurant pivot route pathname=${pathname} skips onboarding gate`
    );
  }

  if (
    pathname !== "/onboarding-required" &&
    !pathname.startsWith("/management") &&
    !isRestaurantPivotRoute &&
    !isAdmin && // Skip onboarding check for admin users
    (pathname.startsWith("/dashboard") ||
      pathname.startsWith("/analytics") ||
      pathname.startsWith("/reporting"))
  ) {
    try {
      // Get company for user and check onboarding_status
      const { data: company } = await supabase
        .from("companies")
        .select("onboarding_status")
        .eq("created_by", user.id)
        .single();

      console.log(
        `[Proxy] User ${user.id} accessing ${pathname}, onboarding_status: ${company?.onboarding_status}, is_admin: ${isAdmin}`
      );

      // If onboarding is not complete, redirect to onboarding-required page
      if (company?.onboarding_status !== "completed") {
        console.log(
          `[Proxy] Redirecting ${user.id} to /onboarding-required (status: ${company?.onboarding_status})`
        );
        const url = request.nextUrl.clone();
        url.pathname = "/onboarding-required";
        return NextResponse.redirect(url);
      }

      console.log(`[Proxy] Access granted to ${pathname}`);
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
