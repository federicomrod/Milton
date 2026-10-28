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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useCan } from "@/components/restaurant/shell/shell-chrome-context";
import { CAPABILITY_MESSAGES } from "@/lib/auth/capabilities";
import { OperatingPageHeader } from "@/components/restaurant/shell/OperatingPageHeader";
import {
  browserTimeZone,
  CompanySaveError,
  getUserProfile,
  saveUserPreferences,
  getUserCompany,
  updateCompany,
} from "@/lib/profile-service";
import { useUserPreferences } from "@/lib/context/UserPreferencesContext";
import { Palette, Building2 } from "lucide-react";

// Zona horaria, formato de fecha and formato de número are still loaded and
// saved back unchanged (Auth user metadata) but hidden: nothing in the app
// uses them yet. Bring the fields back once something reads them.
const READ_ONLY_BOX =
  "flex h-9 w-fit min-w-[8rem] items-center rounded-md border border-input bg-muted/40 px-3 text-sm";

const themes = ["light", "dark", "system"];

export default function SettingsPage() {
  const { setPrefs, refreshPrefs } = useUserPreferences();
  const canEditCompany = useCan("company.edit");
  const [form, setForm] = useState({
    timezone: browserTimeZone(),
    date_format: "DD/MM/YYYY",
    number_format: "1,000.00",
    theme: "light",
  });
  const [companyForm, setCompanyForm] = useState({
    name: "",
    industry: "",
  });
  // Read-only: money is shown in the company's currency (from its data).
  const [companyCurrency, setCompanyCurrency] = useState<string | null>(null);
  const [savedCompanyName, setSavedCompanyName] = useState("");
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
            timezone: profile.timezone || browserTimeZone(),
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
          setSavedCompanyName(company.name || "");
          setCompanyCurrency(company.currency || null);
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
      const nameChanged =
        canEditCompany &&
        companyForm.name.trim() !== "" &&
        companyForm.name.trim() !== savedCompanyName.trim();
      await Promise.all([
        saveUserPreferences(form),
        // Only rename when the name actually changed (and this role may).
        nameChanged ? updateCompany(companyForm) : Promise.resolve(),
      ]);
      if (nameChanged) setSavedCompanyName(companyForm.name.trim());

      // Apply right away (theme) and re-read what was saved.
      setPrefs(form);
      await refreshPrefs();

      setMessage("¡Listo! Guardamos tus cambios.");
      setTimeout(() => setMessage(""), 3000);
    } catch (error) {
      setMessage(
        error instanceof CompanySaveError
          ? error.message
          : "No pudimos guardar tus cambios. Inténtalo de nuevo."
      );
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
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Información de la empresa */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Información de la empresa
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="company_name">Nombre de la empresa</Label>
              <Input
                id="company_name"
                name="company_name"
                placeholder="Escribe el nombre de la empresa"
                disabled={!canEditCompany}
                value={companyForm.name || ""}
                onChange={(e) =>
                  setCompanyForm({ ...companyForm, name: e.target.value })
                }
              />
            </div>

            {/* Read-only: the company API only renames; industry is not saved. */}
            <div className="space-y-2">
              <Label htmlFor="industry">Industria</Label>
              <div id="industry" aria-readonly="true" className={READ_ONLY_BOX}>
                {companyForm.industry || "Sin definir"}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="currency">Moneda</Label>
              <div id="currency" aria-readonly="true" className={READ_ONLY_BOX}>
                {companyCurrency
                  ? `${companyCurrency} - ${getCurrencySymbol(companyCurrency)}`
                  : "Sin definir"}
              </div>
              <p className="text-xs text-gray-500">
                Sale de los datos de tu restaurante.
              </p>
            </div>

            {!canEditCompany && (
              <p className="text-[13px] text-[#6b7280]">
                {CAPABILITY_MESSAGES["company.edit"]}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Appearance */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="h-5 w-5" />
              Apariencia
            </CardTitle>
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
