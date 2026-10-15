// app/auth/confirmed/page.tsx
//
// The confirmation link was opened where there is no session to start (another
// device or browser): the email IS confirmed, they just need to log in.

import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function EmailConfirmedPage() {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Correo confirmado</CardTitle>
          <CardDescription>
            Correo confirmado, ya puedes entrar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/auth/login">Iniciar sesión</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
