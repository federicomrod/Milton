"use client";

// app/auth/reset-password/page.tsx
//
// Self-serve password recovery, step 2 (issue #46). The recovery email
// link lands here. The recovery session is established from the link —
// PKCE `?code=` (same exchange the auth callback uses) or the implicit
// hash tokens the login form also handles. The user then sets a new
// password (updateUser), other sessions are signed out, and they are sent
// to /auth/login with a success notice. Expired / invalid links show a
// clear error with a "send a new link" button. Passwords are never logged.

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/auth/password-input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const MIN_PASSWORD = 8;

function ResetPasswordForm() {
  const { d } = useT();
  const a = d.auth.reset;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"checking" | "ready" | "invalid">(
    "checking"
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    const finish = (ok: boolean) => {
      if (!cancelled) setStatus(ok ? "ready" : "invalid");
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") finish(true);
    });

    (async () => {
      try {
        // The browser client may already have consumed the link itself;
        // getSession() waits for that initialization.
        const {
          data: { session: existing },
        } = await supabase.auth.getSession();
        if (existing) return finish(true);

        const code = searchParams.get("code");
        if (code) {
          const { error: exchangeError } =
            await supabase.auth.exchangeCodeForSession(code);
          return finish(!exchangeError);
        }

        const hash = window.location.hash.substring(1);
        if (hash) {
          const params = new URLSearchParams(hash);
          const accessToken = params.get("access_token");
          const refreshToken = params.get("refresh_token");
          if (
            accessToken &&
            refreshToken &&
            params.get("type") === "recovery"
          ) {
            const { error: setError2 } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            return finish(!setError2);
          }
        }
        finish(false);
      } catch {
        finish(false);
      }
    })();

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [searchParams]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD) {
      setError(a.tooShort);
      return;
    }
    if (password !== confirm) {
      setError(a.mismatch);
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(a.updateFailed);
      setLoading(false);
      return;
    }
    // Sign out every other session, then this recovery session too.
    await supabase.auth.signOut({ scope: "others" }).catch(() => undefined);
    await supabase.auth.signOut().catch(() => undefined);
    router.push("/auth/login?notice=password_updated");
  };

  if (status === "checking") {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{a.checking}</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  if (status === "invalid") {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{a.invalidTitle}</CardTitle>
          <CardDescription>{a.invalidDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription>{a.invalidAlert}</AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter>
          <Button asChild className="w-full">
            <Link href="/auth/forgot-password">{a.sendNew}</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{a.title}</CardTitle>
        <CardDescription>{a.description}</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="new-password">{a.newPassword}</Label>
            <PasswordInput
              id="new-password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">{a.confirm}</Label>
            <PasswordInput
              id="confirm-password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </div>
        </CardContent>
        <CardFooter className="pt-6">
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? a.updating : a.submit}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
