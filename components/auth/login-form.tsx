"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import Link from "next/link";

async function getPostLoginRedirect(
  supabase: ReturnType<typeof createClient>
): Promise<string> {
  // Restaurant pivot: non-admin users always land in the restaurant cockpit.
  // The legacy onboarding gate no longer applies to the restaurant pilot.
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return "/dashboard/restaurant";

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    if (profile?.role === "admin") return "/management/dashboard";

    return "/dashboard/restaurant";
  } catch {
    return "/dashboard/restaurant";
  }
}

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const urlError = searchParams.get("error");
  const [error, setError] = useState<string | null>(urlError || null);
  const [loading, setLoading] = useState(false);

  // Clear the error query param from the URL on mount (side-effect only, no setState)
  useEffect(() => {
    if (urlError) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  // Handle magic link authentication from URL hash
  useEffect(() => {
    const handleMagicLink = async () => {
      // Check if there's a hash in the URL (magic link tokens)
      if (typeof window !== "undefined" && window.location.hash) {
        const hash = window.location.hash;
        // Check if it contains authentication tokens
        if (hash.includes("access_token") || hash.includes("type=magiclink")) {
          setLoading(true);

          try {
            // Parse hash parameters manually to extract tokens
            const hashParams = new URLSearchParams(hash.substring(1));
            const accessToken = hashParams.get("access_token");
            const refreshToken = hashParams.get("refresh_token");
            const type = hashParams.get("type");

            if (accessToken && refreshToken && type === "magiclink") {
              // Set the session using the tokens from the hash
              const { data, error: setSessionError } =
                await supabase.auth.setSession({
                  access_token: accessToken,
                  refresh_token: refreshToken,
                });

              if (setSessionError) {
                setError(setSessionError.message || "Failed to authenticate");
                setLoading(false);
                window.history.replaceState(null, "", window.location.pathname);
                return;
              }

              if (data.session) {
                // Successfully authenticated via magic link
                // Clear the hash from URL
                window.history.replaceState(null, "", window.location.pathname);

                router.push(await getPostLoginRedirect(supabase));
              } else {
                setError("Authentication failed. Please try again.");
                setLoading(false);
                window.history.replaceState(null, "", window.location.pathname);
              }
            } else {
              // Fallback: try getSession() which should handle hash automatically
              await new Promise((resolve) => setTimeout(resolve, 100));

              const {
                data: { session },
                error: sessionError,
              } = await supabase.auth.getSession();

              if (sessionError) {
                setError(sessionError.message || "Failed to authenticate");
                setLoading(false);
                window.history.replaceState(null, "", window.location.pathname);
                return;
              }

              if (session) {
                window.history.replaceState(null, "", window.location.pathname);
                router.push(await getPostLoginRedirect(supabase));
                router.refresh();
              } else {
                setError("Authentication failed. Please try again.");
                setLoading(false);
                window.history.replaceState(null, "", window.location.pathname);
              }
            }
          } catch (err) {
            console.error("Magic link authentication error:", err);
            const errorMessage =
              err instanceof Error
                ? err.message
                : "Failed to authenticate with magic link";
            setError(errorMessage);
            setLoading(false);
            window.history.replaceState(null, "", window.location.pathname);
          }
        }
      }
    };

    handleMagicLink();
  }, [router, supabase]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.refresh();
      router.push(await getPostLoginRedirect(supabase));
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Welcome back</CardTitle>
        <CardDescription>
          Log in to your restaurant profitability workspace
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleLogin}>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
        </CardContent>
        <CardFooter className="flex flex-col space-y-4 pt-6">
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </Button>
          <p className="text-sm text-center text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link href="/auth/signup" className="text-primary hover:underline">
              Sign up
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
