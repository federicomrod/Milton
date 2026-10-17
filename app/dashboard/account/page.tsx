"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useUserProfile } from "@/lib/hooks/useUserProfile";
import { getUserCompany } from "@/lib/profile-service";
import { createClient } from "@/lib/supabase/client";
import { OperatingPageHeader } from "@/components/restaurant/shell/OperatingPageHeader";
import { TelegramConnectionCard } from "@/components/restaurant/TelegramConnectionCard";
import { EmailBriefingCard } from "@/components/restaurant/EmailBriefingCard";
import {
  Building2,
  MapPin,
  Globe,
  CreditCard,
  Mail,
  Calendar,
  Edit,
  DollarSign,
  Hash,
  Palette,
} from "lucide-react";
import { Company } from "@/lib/profile-service";

export default function AccountPage() {
  const { profile, loading, error } = useUserProfile();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [companyLoading, setCompanyLoading] = useState(true);

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

  // Get company data from companies table (not from profiles)
  useEffect(() => {
    const fetchCompany = async () => {
      try {
        const companyData = await getUserCompany();
        setCompany(companyData);
      } catch (err) {
        console.error("Failed to load company:", err);
      } finally {
        setCompanyLoading(false);
      }
    };
    fetchCompany();
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
        <p className="mt-0.5 text-[13px] text-[#6b7385]">
          Tu empresa, tu cuenta y cómo recibes el briefing
        </p>
      </div>

      {/* Profile Overview */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Company Information */}
        <Card>
          <CardHeader>
            <CardTitle>Información de la empresa</CardTitle>
            <CardDescription>Datos del perfil de tu empresa</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3">
              <Building2 className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Nombre de la empresa
                </p>
                <p className="text-base text-foreground">
                  {companyLoading
                    ? "Cargando..."
                    : company?.name || "Sin definir"}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <MapPin className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Industria
                </p>
                <p className="text-base text-foreground">
                  {companyLoading
                    ? "Cargando..."
                    : company?.industry || "Sin definir"}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Globe className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Zona horaria
                </p>
                <p className="text-base text-foreground">
                  {profile?.timezone || "Sin definir"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Account Status */}
        <Card>
          <CardHeader>
            <CardTitle>Estado de la cuenta</CardTitle>
            <CardDescription>
              Tu suscripción y datos de facturación
            </CardDescription>
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

        {/* User Preferences */}
        <Card>
          <CardHeader>
            <CardTitle>Preferencias</CardTitle>
            <CardDescription>Cómo se muestran fechas y números</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3">
              <DollarSign className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Moneda
                </p>
                <p className="text-base text-foreground">
                  {profile?.currency || "EUR"}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Calendar className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Formato de fecha
                </p>
                <p className="text-base text-foreground">
                  {profile?.date_format || "DD/MM/YYYY"}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Hash className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Formato de número
                </p>
                <p className="text-base text-foreground">
                  {profile?.number_format || "1,000.00"}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Palette className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Tema
                </p>
                <p className="text-base text-foreground capitalize">
                  {profile?.theme === "dark"
                    ? "Oscuro"
                    : profile?.theme === "light"
                      ? "Claro"
                      : profile?.theme || "Claro"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Telegram Briefing (Telegram Connection UI v1) */}
        <TelegramConnectionCard />

        {/* Briefing Delivery by email (Email Briefing Extension v1) */}
        <EmailBriefingCard />
      </div>

      {/* Quick Actions */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Acciones rápidas</CardTitle>
          <CardDescription>Tareas frecuentes de tu cuenta</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Link href="/dashboard/settings">
              <Button variant="outline">Actualizar perfil</Button>
            </Link>
            <Link href="/dashboard/restaurant">
              <Button variant="outline">Ver el Cockpit</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
