"use client";

// "Revisa tu correo": shown after signup when Supabase wants the email
// confirmed first (no session came back).

import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useT } from "@/lib/i18n/client";
import { ResendConfirmation } from "@/components/auth/resend-confirmation";

export function CheckEmail({ email }: { email: string }) {
  const { d } = useT();
  const a = d.auth.checkEmail;
  return (
    <Card className="w-full max-w-md" data-testid="check-email">
      <CardHeader>
        <CardTitle>{a.title}</CardTitle>
        <CardDescription>
          {a.bodyBefore}
          <b>{email}</b>
          {a.bodyAfter}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{a.spam}</p>
        <ResendConfirmation email={email} startCooldown />
      </CardContent>
      <CardFooter>
        <Link
          href="/auth/login"
          className="text-sm text-primary hover:underline"
        >
          {a.goToLogin}
        </Link>
      </CardFooter>
    </Card>
  );
}
