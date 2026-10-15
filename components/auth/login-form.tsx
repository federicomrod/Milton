"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getPostLoginRedirect } from "@/lib/restaurant/post-login";
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
import { PasswordInput } from "@/components/auth/password-input";
import { ResendConfirmation } from "@/components/auth/resend-confirmation";
import {
  loginProblem,
  loginUrlProblem,
  type LoginProblem,
} from "@/lib/auth/email-confirmation";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const notice =
    searchParams.get("notice") === "password_updated"
      ? "Cambiaste tu contraseña. Inicia sesión con la nueva."
      : null;
  const urlError = searchParams.get("error");
  const [problem, setProblem] = useState<LoginProblem | null>(
    loginUrlProblem(urlError)
  );
  const error = problem?.message ?? null;
  const setError = (message: string | null) =>
    setProblem(message ? { kind: "other", message } : null);
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
                setError(setSessionError.message || "No pudimos autenticarte");
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
                setError("No pudimos autenticarte. Inténtalo de nuevo.");
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
                setError(sessionError.message || "No pudimos autenticarte");
                setLoading(false);
                window.history.replaceState(null, "", window.location.pathname);
                return;
              }

              if (session) {
                window.history.replaceState(null, "", window.location.pathname);
                router.push(await getPostLoginRedirect(supabase));
                router.refresh();
              } else {
                setError("No pudimos autenticarte. Inténtalo de nuevo.");
                setLoading(false);
                window.history.replaceState(null, "", window.location.pathname);
              }
            }
          } catch (err) {
            console.error("Magic link authentication error:", err);
            const errorMessage =
              err instanceof Error
                ? err.message
                : "No pudimos autenticarte with magic link";
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
      // Spanish, and for an unconfirmed email the way to get a new link.
      setProblem(loginProblem(error));
      setLoading(false);
    } else {
      router.refresh();
      router.push(await getPostLoginRedirect(supabase));
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Bienvenido de vuelta</CardTitle>
        <CardDescription>
          Entra a tu espacio de rentabilidad del restaurante
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleLogin}>
        <CardContent className="space-y-4">
          {notice && !error && (
            <Alert>
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {problem?.kind === "unconfirmed" ? (
            <ResendConfirmation
              email={email}
              label="Reenviar correo de confirmación"
            />
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="email">Correo</Label>
            <Input
              id="email"
              type="email"
              placeholder="tu@correo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Contraseña</Label>
              <Link
                href="/auth/forgot-password"
                className="text-sm text-primary hover:underline"
              >
                ¿Olvidaste tu contraseña?
              </Link>
            </div>
            <PasswordInput
              id="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
        </CardContent>
        <CardFooter className="flex flex-col space-y-4 pt-6">
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Entrando…" : "Entrar"}
          </Button>
          <p className="text-sm text-center text-muted-foreground">
            ¿No tienes cuenta?{" "}
            <Link href="/auth/signup" className="text-primary hover:underline">
              Crea una
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
