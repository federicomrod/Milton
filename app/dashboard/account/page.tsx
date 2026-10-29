"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useUserProfile } from "@/lib/hooks/useUserProfile";
import { createClient } from "@/lib/supabase/client";
import { OperatingPageHeader } from "@/components/restaurant/shell/OperatingPageHeader";
import { TelegramConnectionCard } from "@/components/restaurant/TelegramConnectionCard";
import { EmailBriefingCard } from "@/components/restaurant/EmailBriefingCard";
import { CreditCard, Mail, Calendar, Edit } from "lucide-react";

export default function AccountPage() {
  const { profile, loading, error } = useUserProfile();
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // Get email from auth.users (not from profiles)
  useEffect(() => {
    const fetchEmail = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUserEmail(user?.email || null);
    };
    fetchEmail();
  }, []);

  if (loading) {
    return (
      <div className="container mx-auto p-6 max-w-4xl">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6 max-w-4xl">
        <Card>
          <CardHeader>
            <CardTitle>No se pudo cargar la cuenta</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="p-3 rounded bg-destructive/10 text-destructive border border-destructive/20">
              No se pudo cargar la información de tu cuenta. Recarga la página.
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl px-[26px] pb-10 pt-4">
      {/* Header */}
      <div className="mb-5">
        <OperatingPageHeader
          title="Cuenta"
          lang="es"
          showDateRange={false}
          titleAction={
            <Link href="/dashboard/settings">
              <Button size="sm" className="gap-2">
                <Edit className="h-4 w-4" />
                Editar perfil
              </Button>
            </Link>
          }
        />
      </div>

      {/* Profile Overview */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Account Status */}
        <Card>
          <CardHeader>
            <CardTitle>Estado de la cuenta</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3">
              <CreditCard className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Plan
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="default">
                    {profile?.billing_status || "Prueba gratis"}
                  </Badge>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Mail className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Email
                </p>
                <p className="text-base text-foreground">
                  {userEmail || "No disponible"}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Calendar className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Miembro desde
                </p>
                <p className="text-base text-foreground">
                  {profile?.created_at
                    ? new Date(profile.created_at).toLocaleDateString("es-MX", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })
                    : "N/D"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Currency, theme and formats live on Ajustes only (no duplicate here). */}

        {/* Telegram Briefing (Telegram Connection UI v1) */}
        <TelegramConnectionCard />

        {/* Briefing Delivery by email (Email Briefing Extension v1) */}
        <EmailBriefingCard />
      </div>
    </div>
  );
}
