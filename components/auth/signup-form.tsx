"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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

export function SignupForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Sign up the user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
      });

      // Temporary diagnostics — safe to keep in production (no secrets logged).
      console.log("[signup] signUp result:", {
        userPresent: !!authData?.user,
        userId: authData?.user?.id ? "present" : "missing",
        sessionPresent: !!authData?.session,
        authErrorMessage: authError?.message ?? null,
      });

      if (authError) {
        // authError here means supabase.auth.signUp() itself failed — most
        // commonly because a Supabase DB trigger on auth.users raised an
        // exception (e.g. profile insert missing `id`). Fix: apply migration 011.
        throw authError;
      }

      if (!authData.user) {
        throw new Error(
          "Signup did not return a user id. Check email confirmation settings."
        );
      }

      // Create profile and company via API endpoint (uses admin client to bypass RLS)
      const response = await fetch("/api/auth/signup-complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: authData.user.id,
          companyName: companyName,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error ||
            "Failed to create company profile. Please try again."
        );
      }

      // Restaurant MVP: go directly to the restaurant dashboard.
      // The legacy onboarding model-builder is not part of the restaurant flow.
      router.push("/dashboard/restaurant");
      router.refresh();
    } catch (err: unknown) {
      console.error("Signup error:", err);
      const errorMessage =
        err instanceof Error ? err.message : "An error occurred during signup";
      setError(errorMessage);
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Create an account</CardTitle>
        <CardDescription>
          Start your financial analytics journey
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSignup}>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="company">Company Name</Label>
            <Input
              id="company"
              type="text"
              placeholder="Acme Inc."
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              required
            />
          </div>
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
              minLength={6}
            />
            <p className="text-xs text-muted-foreground">
              Minimum 6 characters
            </p>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col space-y-4 pt-6">
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Creating account..." : "Create account"}
          </Button>
          <p className="text-sm text-center text-muted-foreground">
            Already have an account?{" "}
            <Link href="/auth/login" className="text-primary hover:underline">
              Log in
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
