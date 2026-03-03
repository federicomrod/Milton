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

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  // Handle error from URL (e.g., from auth callback)
  useEffect(() => {
    const urlError = searchParams.get("error");
    if (urlError) {
      setError(urlError);
      // Clear the error from URL
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [searchParams]);

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

                // Check if onboarding is complete, redirect accordingly
                try {
                  const { isOnboardingComplete } =
                    await import("@/lib/onboarding-status");
                  const complete = await isOnboardingComplete();

                  if (complete) {
                    router.push("/dashboard");
                  } else {
                    router.push("/onboarding");
                  }
                } catch (err) {
                  console.error("Error checking onboarding status:", err);
                  // Fallback to dashboard on error
                  router.push("/dashboard");
                }
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
                try {
                  const { isOnboardingComplete } =
                    await import("@/lib/onboarding-status");
                  const complete = await isOnboardingComplete();

                  if (complete) {
                    router.push("/dashboard");
                  } else {
                    router.push("/onboarding");
                  }
                  router.refresh();
                } catch (err) {
                  console.error("Error checking onboarding status:", err);
                  router.push("/dashboard");
                  router.refresh();
                }
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
      // Check if onboarding is complete, redirect accordingly
      try {
        const { isOnboardingComplete } =
          await import("@/lib/onboarding-status");
        const complete = await isOnboardingComplete();

        if (complete) {
          router.push("/dashboard");
        } else {
          router.push("/onboarding");
        }
        // Removed router.refresh() as it may cause session issues
      } catch (err) {
        console.error("Error checking onboarding status:", err);
        // Fallback to dashboard on error
        router.push("/dashboard");
        router.refresh();
      }
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Welcome back</CardTitle>
        <CardDescription>Log in to your Startup CFO account</CardDescription>
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
