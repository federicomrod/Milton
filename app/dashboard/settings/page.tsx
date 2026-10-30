"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
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
import { useT } from "@/lib/i18n/client";
import { getDictionary } from "@/lib/i18n";
import { setLanguageCookie } from "@/lib/i18n/cookie";
import {
  LANGUAGE_OPTIONS,
  normalizePreferredLanguage,
  type PreferredLanguage,
} from "@/lib/restaurant/language";
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
import { Palette, Building2, Languages } from "lucide-react";

// Zona horaria, formato de fecha and formato de número are still loaded and
// saved back unchanged (Auth user metadata) but hidden: nothing in the app
// uses them yet. Bring the fields back once something reads them.
const READ_ONLY_BOX =
  "flex h-9 w-fit min-w-[8rem] items-center rounded-md border border-input bg-muted/40 px-3 text-sm";

const themes = ["light", "dark", "system"];

export default function SettingsPage() {
  const { setPrefs, refreshPrefs } = useUserPreferences();
  const { d, lang } = useT();
  const router = useRouter();
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
  const [messageOk, setMessageOk] = useState(false);
  const [langSaving, setLangSaving] = useState(false);
  const [langNote, setLangNote] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

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

  // Saves the company language, remembers it in the browser (so signed-out
  // pages follow it) and refreshes the server tree: no full page reload.
  const handleLanguage = async (next: PreferredLanguage) => {
    if (next === lang || langSaving || !canEditCompany) return;
    setLangSaving(true);
    setLangNote(null);
    try {
      const res = await fetch("/api/restaurant/company", {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preferred_language: next }),
      });
      const json = (await res.json().catch(() => null)) as {
        error?: string;
        company?: { preferred_language?: unknown };
      } | null;
      if (!res.ok) {
        setLangNote({
          ok: false,
          text: json?.error || d.settings.language.saveFailed,
        });
        return;
      }
      const saved =
        normalizePreferredLanguage(json?.company?.preferred_language) ?? next;
      setLanguageCookie(saved);
      setLangNote({
        ok: true,
        text: getDictionary(saved).settings.language.saved,
      });
      router.refresh();
    } catch {
      setLangNote({ ok: false, text: d.settings.language.saveFailed });
    } finally {
      setLangSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    setMessageOk(false);
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

      setMessage(d.settings.page.saved);
      setMessageOk(true);
      setTimeout(() => setMessage(""), 3000);
    } catch (error) {
      setMessage(
        error instanceof CompanySaveError
          ? error.message
          : d.settings.page.saveFailed
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
        <OperatingPageHeader
          title={d.settings.title}
          lang={lang}
          showDateRange={false}
        />
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Company information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              {d.settings.page.companyInfo}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="company_name">
                {d.settings.page.companyName}
              </Label>
              <Input
                id="company_name"
                name="company_name"
                placeholder={d.settings.page.companyNamePlaceholder}
                disabled={!canEditCompany}
                value={companyForm.name || ""}
                onChange={(e) =>
                  setCompanyForm({ ...companyForm, name: e.target.value })
                }
              />
            </div>

            {/* Read-only: the company API only renames; industry is not saved. */}
            <div className="space-y-2">
              <Label htmlFor="industry">{d.settings.page.industry}</Label>
              <div id="industry" aria-readonly="true" className={READ_ONLY_BOX}>
                {companyForm.industry || d.settings.page.notSet}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="currency">{d.settings.page.currency}</Label>
              <div id="currency" aria-readonly="true" className={READ_ONLY_BOX}>
                {companyCurrency
                  ? `${companyCurrency} - ${getCurrencySymbol(companyCurrency)}`
                  : d.settings.page.notSet}
              </div>
              <p className="text-xs text-gray-500">
                {d.settings.page.currencyHint}
              </p>
            </div>

            {!canEditCompany && (
              <p className="text-[13px] text-[#6b7280]">
                {d.settings.noEditCompany}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Language */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Languages className="h-5 w-5" />
              {d.settings.language.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div
              role="radiogroup"
              aria-label={d.settings.language.label}
              data-testid="language-switcher"
              className="inline-flex flex-wrap gap-2"
            >
              {LANGUAGE_OPTIONS.map((opt) => {
                const selected = opt.value === lang;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={langSaving || !canEditCompany}
                    onClick={() => void handleLanguage(opt.value)}
                    className={
                      "rounded-md border px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8] disabled:opacity-60 " +
                      (selected
                        ? "border-[#1B40C8] bg-[#1B40C8] text-white"
                        : "border-input bg-white hover:bg-muted")
                    }
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-gray-500">{d.settings.language.hint}</p>
            {langNote && (
              <p
                role={langNote.ok ? "status" : "alert"}
                className={
                  "text-sm " + (langNote.ok ? "text-green-700" : "text-red-700")
                }
              >
                {langNote.text}
              </p>
            )}
            {!canEditCompany && (
              <p className="text-[13px] text-[#6b7280]">
                {d.settings.noEditCompany}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Appearance */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="h-5 w-5" />
              {d.settings.page.appearance}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="theme">{d.settings.page.theme}</Label>
              <Select
                value={form.theme}
                onValueChange={(v) => handleChange("theme", v)}
              >
                <SelectTrigger id="theme">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {themes.map((theme) => (
                    <SelectItem key={theme} value={theme}>
                      {theme === "light"
                        ? d.settings.page.themeLight
                        : theme === "dark"
                          ? d.settings.page.themeDark
                          : d.settings.page.themeSystem}
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
            className={`p-4 rounded-lg ${messageOk ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"}`}
          >
            {message}
          </div>
        )}

        {/* Submit Button */}
        <Button type="submit" disabled={saving} className="w-full" size="lg">
          {saving ? d.common.saving : d.common.save}
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
