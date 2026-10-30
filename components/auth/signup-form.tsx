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
import { useT } from "@/lib/i18n/client";
import { PasswordInput } from "@/components/auth/password-input";
import { CheckEmail } from "@/components/auth/check-email";
import { authCallbackUrl } from "@/lib/auth/email-confirmation";

export function SignupForm() {
  const { d } = useT();
  const a = d.auth.signup;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** Email confirmation is required: no session came back. */
  const [checkEmail, setCheckEmail] = useState(false);
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
        options: { emailRedirectTo: authCallbackUrl() },
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
        throw new Error(a.createFailed);
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
        if (errorData.error === "pending_invite") {
          throw new Error(errorData.message || a.pendingInvite);
        }
        throw new Error(errorData.error || a.profileFailed);
      }

      // The profile and company exist now (signup-complete needs no session).
      // No session = the email must be confirmed first: say so, instead of
      // bouncing an unconfirmed user to the login page without a word.
      if (!authData.session) {
        setCheckEmail(true);
        setLoading(false);
        return;
      }
      // Confirmation is off: new signups go through the restaurant onboarding.
      router.push("/onboarding/restaurant");
      router.refresh();
    } catch (err: unknown) {
      console.error("Signup error:", err);
      const errorMessage = err instanceof Error ? err.message : a.genericFailed;
      setError(errorMessage);
      setLoading(false);
    }
  };

  if (checkEmail) return <CheckEmail email={email} />;

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{a.title}</CardTitle>
        <CardDescription>{a.description}</CardDescription>
      </CardHeader>
      <form onSubmit={handleSignup}>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="company">{a.restaurantName}</Label>
            <Input
              id="company"
              type="text"
              placeholder={a.restaurantPlaceholder}
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">{a.email}</Label>
            <Input
              id="email"
              type="email"
              placeholder={a.emailPlaceholder}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{a.password}</Label>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
            <p className="text-xs text-muted-foreground">{a.minChars}</p>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col space-y-4 pt-6">
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? a.submitting : a.submit}
          </Button>
          <p className="text-sm text-center text-muted-foreground">
            {a.haveAccount}{" "}
            <Link href="/auth/login" className="text-primary hover:underline">
              {a.signIn}
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
