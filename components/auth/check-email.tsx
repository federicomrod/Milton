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
import { ResendConfirmation } from "@/components/auth/resend-confirmation";

export function CheckEmail({ email }: { email: string }) {
  return (
    <Card className="w-full max-w-md" data-testid="check-email">
      <CardHeader>
        <CardTitle>Revisa tu correo</CardTitle>
        <CardDescription>
          Te enviamos un correo a <b>{email}</b>. Confírmalo y luego vuelve a
          entrar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Si no lo ves en unos minutos, revisa tu carpeta de spam.
        </p>
        <ResendConfirmation email={email} startCooldown />
      </CardContent>
      <CardFooter>
        <Link
          href="/auth/login"
          className="text-sm text-primary hover:underline"
        >
          Ir a iniciar sesión
        </Link>
      </CardFooter>
    </Card>
  );
}
