"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { getDictionary } from "@/lib/i18n";
import { setLanguageCookie } from "@/lib/i18n/cookie";
import {
  LANGUAGE_OPTIONS,
  normalizePreferredLanguage,
  type PreferredLanguage,
} from "@/lib/restaurant/language";
import {
  browserTimeZone,
  pickPreferences,
  saveUserPreferences,
  type DisplayPreferences,
} from "@/lib/profile-service";
import { persistTheme } from "@/lib/theme";
import { useConfig } from "@/components/restaurant/config/ConfigProvider";
import { CompanyCard, type CompanyDetails } from "./CompanyCard";

export const DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"] as const;
export const DATE_EXAMPLES: Record<string, string> = {
  "DD/MM/YYYY": "31/12/2026",
  "MM/DD/YYYY": "12/31/2026",
  "YYYY-MM-DD": "2026-12-31",
};
export const NUMBER_FORMATS = ["1,000.00", "1.000,00"] as const;
export const NUMBER_EXAMPLES: Record<string, string> = {
  "1,000.00": "1,234.50",
  "1.000,00": "1.234,50",
};
const THEMES = ["light", "dark", "system"] as const;

const FIELD =
  "h-9 w-full min-w-0 rounded-lg border border-[#E5E7EB] bg-white px-2 text-sm text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8] disabled:opacity-60";

function timeZones(current: string): string[] {
  let list: string[] = [];
  try {
    const sv = (
      Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
    ).supportedValuesOf;
    list = sv ? sv("timeZone") : [];
  } catch {
    list = [];
  }
  if (list.length === 0) list = ["UTC"];
  if (current && !list.includes(current)) list = [current, ...list];
  return list;
}

function currencySymbol(code: string, locale: string): string {
  try {
    const part = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
    })
      .formatToParts(0)
      .find((p) => p.type === "currency");
    return part?.value ?? code;
  } catch {
    return code;
  }
}

function Row({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <label
        htmlFor={htmlFor}
        className="w-44 shrink-0 text-[13px] text-[#64748B]"
      >
        {label}
      </label>
      <div className="min-w-0 flex-1 sm:max-w-sm">{children}</div>
    </div>
  );
}

export function AjustesClient({
  canEdit,
  company,
  legalAvailable,
  currency,
  preferences,
}: {
  canEdit: boolean;
  company: CompanyDetails;
  legalAvailable: boolean;
  currency: string | null;
  /** Raw Auth metadata preferences (picked and defaulted here). */
  preferences: unknown;
}) {
  const { d, lang, locale } = useT();
  const a = d.config.ajustes;
  const s = d.config.shared;
  const router = useRouter();
  const { notify } = useConfig();

  // ---- Idioma (saves on change) ----
  const [selected, setSelected] = useState<PreferredLanguage>(lang);
  const [langBusy, setLangBusy] = useState(false);
  const [langError, setLangError] = useState("");
  useEffect(() => setSelected(lang), [lang]);

  async function changeLanguage(next: PreferredLanguage) {
    if (next === selected || langBusy || !canEdit) return;
    const previous = selected;
    setSelected(next);
    setLangBusy(true);
    setLangError("");
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
        setSelected(previous);
        const text = json?.error || a.language.saveFailed;
        setLangError(text);
        notify(text, "error");
        return;
      }
      const saved =
        normalizePreferredLanguage(json?.company?.preferred_language) ?? next;
      setSelected(saved);
      setLanguageCookie(saved);
      notify(getDictionary(saved).config.ajustes.language.saved);
      router.refresh();
    } catch {
      setSelected(previous);
      setLangError(a.language.saveFailed);
      notify(a.language.saveFailed, "error");
    } finally {
      setLangBusy(false);
    }
  }

  // ---- Preferences (per person; save on change, whole object) ----
  const [prefs, setPrefs] = useState<DisplayPreferences>(() => {
    const saved = pickPreferences(preferences);
    return {
      timezone: saved.timezone ?? "UTC",
      date_format: saved.date_format ?? "DD/MM/YYYY",
      number_format: saved.number_format ?? "1,000.00",
      theme: saved.theme ?? "light",
      ...saved,
    };
  });
  useEffect(() => {
    // No saved zone: show the device's (not stored until the person picks).
    if (!pickPreferences(preferences).timezone) {
      setPrefs((p) => ({ ...p, timezone: browserTimeZone() }));
    }
  }, [preferences]);
  const [prefBusy, setPrefBusy] = useState(false);
  const zones = useMemo(
    () => timeZones(prefs.timezone ?? ""),
    [prefs.timezone]
  );

  async function changePref(key: keyof DisplayPreferences, value: string) {
    if (prefBusy || prefs[key] === value) return;
    const previous = prefs;
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    setPrefBusy(true);
    try {
      await saveUserPreferences(next);
      if (key === "theme") persistTheme(value);
      notify(a.prefs.saved);
    } catch {
      setPrefs(previous);
      notify(a.prefs.saveFailed, "error");
    } finally {
      setPrefBusy(false);
    }
  }

  const themeLabel: Record<string, string> = {
    light: a.prefs.themeLight,
    dark: a.prefs.themeDark,
    system: a.prefs.themeSystem,
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div
          role="radiogroup"
          aria-label={a.language.aria}
          data-testid="language-switcher"
          className="inline-flex max-w-full flex-wrap gap-2"
        >
          {LANGUAGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={opt.value === selected}
              disabled={langBusy || !canEdit}
              onClick={() => void changeLanguage(opt.value)}
              className={
                "h-9 rounded-lg border px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8] disabled:opacity-60 " +
                (opt.value === selected
                  ? "border-[#1B40C8] bg-[#1B40C8] text-white"
                  : "border-[#E5E7EB] bg-white text-[#0F172A] hover:bg-[#F8FAFC]")
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-[13px] text-[#64748B]">{a.language.hint}</p>
        {langError ? (
          <p
            role="alert"
            className="rounded-lg border border-[#0F172A] px-3 py-2 text-sm"
          >
            ⚑ {langError}
          </p>
        ) : null}
        {!canEdit ? (
          <p className="text-[13px] text-[#64748B]">{s.readOnly}</p>
        ) : null}
      </div>

      <div className="space-y-3 border-t border-[#E5E7EB] pt-4">
        <Row label={a.prefs.timezone} htmlFor="ajustes-timezone">
          <select
            id="ajustes-timezone"
            className={FIELD}
            value={prefs.timezone}
            disabled={prefBusy}
            onChange={(e) => void changePref("timezone", e.target.value)}
          >
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </Row>
        <Row label={a.prefs.currency}>
          <p className="text-sm font-medium" data-testid="ajustes-currency">
            {currency ? (
              `${currency} · ${currencySymbol(currency, locale)}`
            ) : (
              <span className="font-normal text-[#64748B]">{s.missing}</span>
            )}
          </p>
          <p className="text-[13px] text-[#64748B]">{a.prefs.currencyHint}</p>
        </Row>
        <Row
          label={`${a.prefs.format} · ${a.prefs.dateFormat}`}
          htmlFor="ajustes-date"
        >
          <select
            id="ajustes-date"
            className={FIELD}
            value={prefs.date_format}
            disabled={prefBusy}
            onChange={(e) => void changePref("date_format", e.target.value)}
          >
            {DATE_FORMATS.map((f) => (
              <option key={f} value={f}>
                {DATE_EXAMPLES[f]}
              </option>
            ))}
          </select>
        </Row>
        <Row
          label={`${a.prefs.format} · ${a.prefs.numberFormat}`}
          htmlFor="ajustes-number"
        >
          <select
            id="ajustes-number"
            className={FIELD}
            value={prefs.number_format}
            disabled={prefBusy}
            onChange={(e) => void changePref("number_format", e.target.value)}
          >
            {NUMBER_FORMATS.map((f) => (
              <option key={f} value={f}>
                {NUMBER_EXAMPLES[f]}
              </option>
            ))}
          </select>
        </Row>
        <Row label={a.prefs.theme}>
          <div
            role="radiogroup"
            aria-label={a.prefs.theme}
            className="inline-flex max-w-full flex-wrap gap-2"
          >
            {THEMES.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={prefs.theme === t}
                disabled={prefBusy}
                onClick={() => void changePref("theme", t)}
                className={
                  "h-9 rounded-lg border px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8] disabled:opacity-60 " +
                  (prefs.theme === t
                    ? "border-[#1B40C8] bg-[#1B40C8] text-white"
                    : "border-[#E5E7EB] bg-white text-[#0F172A] hover:bg-[#F8FAFC]")
                }
              >
                {themeLabel[t]}
              </button>
            ))}
          </div>
        </Row>
      </div>

      <div className="border-t border-[#E5E7EB] pt-4">
        <CompanyCard
          canEdit={canEdit}
          company={company}
          legalAvailable={legalAvailable}
        />
      </div>
    </div>
  );
}
