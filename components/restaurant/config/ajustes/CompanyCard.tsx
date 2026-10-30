"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { ConfigValue } from "@/components/restaurant/config/ConfigSection";
import {
  EditorButtons,
  InlineEditCard,
  useInlineEditor,
} from "@/components/restaurant/config/InlineEditCard";

export interface CompanyDetails {
  name: string;
  legal_name: string;
  tax_id: string;
  address: string;
}
type Key = keyof CompanyDetails;

const KEYS: Key[] = ["name", "legal_name", "tax_id", "address"];
const MAX: Record<Key, number> = {
  name: 120,
  legal_name: 160,
  tax_id: 40,
  address: 240,
};

export function CompanyCard({
  canEdit,
  company,
  legalAvailable,
}: {
  canEdit: boolean;
  company: CompanyDetails;
  legalAvailable: boolean;
}) {
  const { d } = useT();
  const a = d.config.ajustes;
  const [saved, setSaved] = useState(company);
  const label: Record<Key, string> = {
    name: a.company.name,
    legal_name: a.company.legalName,
    tax_id: a.company.taxId,
    address: a.company.address,
  };
  return (
    <InlineEditCard
      canEdit={canEdit}
      readOnlyNote={d.config.shared.readOnly}
      summary={KEYS.map((k) => (
        <ConfigValue
          key={k}
          label={label[k]}
          value={saved[k]}
          missing={d.config.shared.missing}
        />
      ))}
    >
      <CompanyForm
        saved={saved}
        legalAvailable={legalAvailable}
        label={label}
        onSaved={setSaved}
      />
    </InlineEditCard>
  );
}

function CompanyForm({
  saved,
  legalAvailable,
  label,
  onSaved,
}: {
  saved: CompanyDetails;
  legalAvailable: boolean;
  label: Record<Key, string>;
  onSaved: (next: CompanyDetails) => void;
}) {
  const { d } = useT();
  const a = d.config.ajustes;
  const editor = useInlineEditor();
  const [values, setValues] = useState<CompanyDetails>(saved);
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [saving, setSaving] = useState(false);

  const tooLong: Record<Key, string> = {
    name: a.errors.nameRequired,
    legal_name: a.errors.legalNameTooLong,
    tax_id: a.errors.taxIdTooLong,
    address: a.errors.addressTooLong,
  };

  function change(k: Key, v: string) {
    const next = { ...values, [k]: v };
    setValues(next);
    setErrors((e) => ({ ...e, [k]: undefined }));
    editor.setDirty(KEYS.some((key) => next[key].trim() !== saved[key].trim()));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const found: Partial<Record<Key, string>> = {};
    for (const k of KEYS) {
      const v = values[k].trim();
      if (k === "name" && (!v || v.length > MAX.name)) found[k] = tooLong[k];
      else if (v.length > MAX[k]) found[k] = tooLong[k];
    }
    if (Object.keys(found).length > 0) {
      setErrors(found);
      editor.failed(Object.values(found)[0]);
      return;
    }
    // Only what changed goes out.
    const body: Record<string, string> = {};
    for (const k of KEYS) {
      if (values[k].trim() !== saved[k].trim()) body[k] = values[k].trim();
    }
    if (Object.keys(body).length === 0) {
      editor.close();
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/restaurant/company", {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as {
        error?: string;
        field?: string;
        company?: Partial<Record<Key, string | null>>;
      } | null;
      if (!res.ok) {
        const text = json?.error || d.config.shared.saveFailed;
        const field = KEYS.find((k) => k === json?.field);
        if (field) setErrors({ [field]: text });
        editor.failed(text);
        return;
      }
      const c = json?.company ?? {};
      const next = {} as CompanyDetails;
      for (const k of KEYS) next[k] = (c[k] ?? values[k] ?? "").trim();
      onSaved(next);
      editor.saved();
    } catch {
      editor.failed(d.config.shared.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      {KEYS.map((k) => {
        const locked = k !== "name" && !legalAvailable;
        const id = `ajustes-company-${k}`;
        return (
          <div key={k} className="space-y-1">
            <label htmlFor={id} className="text-[13px] text-[#64748B]">
              {label[k]}
            </label>
            <input
              id={id}
              value={values[k]}
              disabled={locked || saving}
              aria-invalid={errors[k] ? true : undefined}
              onChange={(e) => change(k, e.target.value)}
              className={
                "h-9 w-full min-w-0 rounded-lg border bg-white px-3 text-sm text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8] disabled:opacity-60 " +
                (errors[k] ? "border-[#0F172A]" : "border-[#E5E7EB]")
              }
            />
            {errors[k] ? (
              <p role="alert" className="text-sm">
                ⚑ {errors[k]}
              </p>
            ) : null}
          </div>
        );
      })}
      {!legalAvailable ? (
        <p className="text-[13px] text-[#64748B]">{a.company.unavailable}</p>
      ) : null}
      <EditorButtons saving={saving} onCancel={editor.close} />
    </form>
  );
}
