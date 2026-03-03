import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";

export async function createClient(
  cookieStore?: ReadonlyRequestCookies,
  accessToken?: string
) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing Supabase environment variables. Please check your .env.local file and ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set."
    );
  }

  // If no cookieStore is provided, try to get it from the current request context
  let store: ReadonlyRequestCookies;
  try {
    store = cookieStore || (await cookies());
  } catch (error) {
    // In some contexts (like during build), cookies() might not be available
    // Create a dummy cookie store that always returns undefined
    store = {
      get: () => undefined,
      getAll: () => [],
      has: () => false,
    } as any;
  }

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return store.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          if (store.set) {
            store.set({ name, value, ...options });
          }
        } catch (error) {
          // Handle error in Server Component or when cookies aren't available
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          if (store.set) {
            store.set({ name, value: "", ...options });
          }
        } catch (error) {
          // Handle error in Server Component or when cookies aren't available
        }
      },
    },
    global: {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    },
  });
}
