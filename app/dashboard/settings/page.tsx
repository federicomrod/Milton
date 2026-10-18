"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { OperatingPageHeader } from "@/components/restaurant/shell/OperatingPageHeader";
import {
  getUserProfile,
  upsertUserProfile,
  getUserCompany,
  updateCompany,
} from "@/lib/profile-service";
import { useUserPreferences } from "@/lib/context/UserPreferencesContext";
import {
  Globe,
  DollarSign,
  Calendar,
  Hash,
  Palette,
  Building2,
} from "lucide-react";

const currencies = ["EUR", "USD", "GBP", "CHF", "MXN"];
const dateFormats = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"];
const numberFormats = ["1,000.00", "1.000,00"];
const themes = ["light", "dark", "system"];

export default function SettingsPage() {
  const { setPrefs, refreshPrefs } = useUserPreferences();
  const [form, setForm] = useState({
    timezone: "Europe/Berlin",
    currency: "EUR",
    date_format: "DD/MM/YYYY",
    number_format: "1,000.00",
    theme: "light",
  });
  const [companyForm, setCompanyForm] = useState({
    name: "",
    industry: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const loadData = async () => {
      try {
        const [profile, company] = await Promise.all([
          getUserProfile(),
          getUserCompany(),
        ]);

        if (profile) {
          setForm({
            timezone: profile.timezone || "Europe/Berlin",
            currency: profile.currency || "EUR",
            date_format: profile.date_format || "DD/MM/YYYY",
            number_format: profile.number_format || "1,000.00",
            theme: profile.theme || "light",
          });
        }

        if (company) {
          setCompanyForm({
            name: company.name || "",
            industry: company.industry || "",
          });
        }
      } catch (error) {
        console.error("Failed to load data:", error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const handleChange = (key: string, value: string) => {
    setForm({ ...form, [key]: value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      // Update profile and company separately
      await Promise.all([upsertUserProfile(form), updateCompany(companyForm)]);

      // ✅ Refresh preferences from Supabase - triggers live update across all components
      await refreshPrefs();

      setMessage("¡Listo! Guardamos tus cambios.");
      setTimeout(() => setMessage(""), 3000);
    } catch (error) {
      setMessage("No pudimos guardar tus cambios. Inténtalo de nuevo.");
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="w-full max-w-3xl px-[26px] pb-10 pt-4">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl px-[26px] pb-10 pt-4">
      <div className="mb-5">
        <OperatingPageHeader title="Ajustes" lang="es" showDateRange={false} />
        <p className="mt-0.5 text-[13px] text-[#6b7385]">
          El nombre de tu empresa y cómo se muestran fechas, números y tema
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Información de la empresa */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Información de la empresa
            </CardTitle>
            <CardDescription>Datos básicos de tu empresa</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="company_name">Nombre de la empresa</Label>
              <Input
                id="company_name"
                name="company_name"
                placeholder="Escribe el nombre de la empresa"
                value={companyForm.name || ""}
                onChange={(e) =>
                  setCompanyForm({ ...companyForm, name: e.target.value })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="industry">Industria</Label>
              <Input
                id="industry"
                name="industry"
                placeholder="Ej.: restaurante, café, bar"
                value={companyForm.industry || ""}
                onChange={(e) =>
                  setCompanyForm({ ...companyForm, industry: e.target.value })
                }
              />
            </div>
          </CardContent>
        </Card>

        {/* Preferencias regionales y de formato */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Preferencias regionales y de formato
            </CardTitle>
            <CardDescription>Cómo se muestran tus datos</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="timezone" className="flex items-center gap-2">
                <Globe className="h-4 w-4" />
                Zona horaria
              </Label>
              <Select
                value={form.timezone}
                onValueChange={(v) => handleChange("timezone", v)}
              >
                <SelectTrigger id="timezone">
                  <SelectValue placeholder="Elige una zona horaria" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {Intl.supportedValuesOf("timeZone").map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="currency" className="flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Moneda
              </Label>
              <Select
                value={form.currency}
                onValueChange={(v) => handleChange("currency", v)}
              >
                <SelectTrigger id="currency">
                  <SelectValue placeholder="Elige una moneda" />
                </SelectTrigger>
                <SelectContent>
                  {currencies.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c} - {getCurrencySymbol(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="date_format" className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Formato de fecha
              </Label>
              <Select
                value={form.date_format}
                onValueChange={(v) => handleChange("date_format", v)}
              >
                <SelectTrigger id="date_format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {dateFormats.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f}{" "}
                      <span className="text-gray-400 ml-2">
                        ({formatDateExample(f)})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="number_format"
                className="flex items-center gap-2"
              >
                <Hash className="h-4 w-4" />
                Formato de número
              </Label>
              <Select
                value={form.number_format}
                onValueChange={(v) => handleChange("number_format", v)}
              >
                <SelectTrigger id="number_format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {numberFormats.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Appearance */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="h-5 w-5" />
              Apariencia
            </CardTitle>
            <CardDescription>Cómo se ve la app</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="theme">Tema</Label>
              <Select
                value={form.theme}
                onValueChange={(v) => handleChange("theme", v)}
              >
                <SelectTrigger id="theme">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {themes.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t === "light"
                        ? "Claro"
                        : t === "dark"
                          ? "Oscuro"
                          : "Sistema"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">
                {form.theme === "system" &&
                  "Cambia entre claro y oscuro según tu sistema"}
                {form.theme === "light" && "Usar el tema claro en toda la app"}
                {form.theme === "dark" && "Usar el tema oscuro en toda la app"}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Success/Error Message */}
        {message && (
          <div
            className={`p-4 rounded-lg ${message.startsWith("¡Listo") ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"}`}
          >
            {message}
          </div>
        )}

        {/* Submit Button */}
        <Button type="submit" disabled={saving} className="w-full" size="lg">
          {saving ? "Guardando…" : "Guardar"}
        </Button>
      </form>
    </div>
  );
}

// Helper functions
function getCurrencySymbol(currency: string): string {
  const symbols: Record<string, string> = {
    EUR: "€",
    USD: "$",
    GBP: "£",
    CHF: "CHF",
    MXN: "MX$",
  };
  return symbols[currency] || currency;
}

function formatDateExample(format: string): string {
  const date = new Date(2024, 0, 15); // January 15, 2024
  switch (format) {
    case "DD/MM/YYYY":
      return "15/01/2024";
    case "MM/DD/YYYY":
      return "01/15/2024";
    case "YYYY-MM-DD":
      return "2024-01-15";
    default:
      return "";
  }
}
