"use client";

// app/auth/forgot-password/page.tsx
//
// Self-serve password recovery, step 1 (issue #46): asks for an email and
// triggers Supabase's recovery email. The response is ALWAYS the same
// neutral message, whether or not an account exists, so this page can't be
// used to check which emails are registered. No password is ever emailed;
// only Supabase's one-time recovery link.

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export default function ForgotPasswordPage() {
  const { d } = useT();
  const a = d.auth.forgot;
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const supabase = createClient();
      await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      });
    } catch {
      // Deliberately ignored: the user always sees the same message.
    }
    setSent(true);
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{a.title}</CardTitle>
          <CardDescription>{a.description}</CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent className="space-y-4">
            {sent && (
              <Alert>
                <AlertDescription>{a.sentNote}</AlertDescription>
              </Alert>
            )}
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
          </CardContent>
          <CardFooter className="flex flex-col space-y-4 pt-6">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? a.sending : sent ? a.sendAgain : a.send}
            </Button>
            <Link
              href="/auth/login"
              className="text-sm text-primary hover:underline"
            >
              {a.back}
            </Link>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
