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
        request.cookies.set({
          name,
          value,
          ...options,
        });
        response = NextResponse.next({
          request: {
            headers: request.headers,
          },
        });
        response.cookies.set({
          name,
          value,
          ...options,
        });
      },
      remove(name: string, options: CookieOptions) {
        request.cookies.set({
          name,
          value: "",
          ...options,
        });
        response = NextResponse.next({
          request: {
            headers: request.headers,
          },
        });
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
  if (
    pathname !== "/onboarding-required" &&
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
        `[Proxy] User ${user.id} accessing ${pathname}, onboarding_status: ${company?.onboarding_status}`
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
