"use client";

// Configuración › Restaurantes: one row per location, read-only on load.
// «Editar» opens the name field in place and saves through the existing
// PATCH /api/restaurant/locations/:id (name only; that route has no address).
// Archive / restore stays a visible button. After any save the server tree
// refreshes so the top-left switcher shows the new name.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfigValue } from "../ConfigSection";
import { useConfig } from "../ConfigProvider";
import {
  EditorButtons,
  InlineEditCard,
  useInlineEditor,
} from "../InlineEditCard";
import { useT } from "@/lib/i18n/client";
import { useCan } from "@/components/restaurant/shell/shell-chrome-context";
import {
  MAX_RESTAURANT_NAME,
  validateRestaurantName,
} from "@/lib/restaurant/restaurant-name";
import { userErrorMessage } from "@/lib/restaurant/user-error";

export interface SiteRow {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  odooCompanyId: number | null;
  archived: boolean;
}

async function patchLocation(
  id: string,
  body: Record<string, unknown>,
  fallback: string
): Promise<void> {
  const res = await fetch(`/api/restaurant/locations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(userErrorMessage(json, fallback));
}

export function RestaurantRows({
  rows,
  archiveAvailable,
  currentId,
}: {
  rows: SiteRow[];
  archiveAvailable: boolean;
  currentId: string | null;
}) {
  const { d } = useT();
  const activeCount = rows.filter((r) => !r.archived).length;
  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {rows.map((r) => (
          <SiteItem
            key={`${r.id}:${r.name}`}
            row={r}
            others={rows.filter((o) => o.id !== r.id).map((o) => o.name)}
            current={r.id === currentId}
            archiveAvailable={archiveAvailable}
            isLastActive={!r.archived && activeCount <= 1}
          />
        ))}
      </ul>
      {!archiveAvailable ? (
        <p className="text-[13px] text-[#64748B]">
          {d.config.sites.restaurants.notAvailable}
        </p>
      ) : null}
    </div>
  );
}

function SiteItem({
  row,
  others,
  current,
  archiveAvailable,
  isLastActive,
}: {
  row: SiteRow;
  others: string[];
  current: boolean;
  archiveAvailable: boolean;
  isLastActive: boolean;
}) {
  const { d, fmt } = useT();
  const s = d.config.shared;
  const t = d.config.sites.restaurants;
  const router = useRouter();
  const config = useConfig();
  const canArchive = useCan("locations.archive");
  const [busy, setBusy] = useState(false);
  const place = [row.address, row.city].filter((p) => p && p.trim()).join(", ");

  async function archive(archived: boolean) {
    setBusy(true);
    try {
      await patchLocation(row.id, { archived }, t.saveFailed);
      config.notify(archived ? t.archivedDone : t.restored, "ok");
      router.refresh();
    } catch (e) {
      config.notify(e instanceof Error ? e.message : t.saveFailed, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      data-testid={`site-${row.id}`}
      data-current={current ? "true" : "false"}
      className={
        "min-w-0 rounded-lg border p-3 " +
        (current ? "border-[#1B40C8] bg-[#F5F8FF]" : "border-[#E5E7EB]")
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="min-w-0 break-words text-sm font-semibold">
          {row.name}
        </span>
        {current ? (
          <span className="rounded-md bg-[#EEF2FD] px-2 py-0.5 text-[12px] font-semibold text-[#1B40C8]">
            {t.selected}
          </span>
        ) : null}
        {row.archived ? (
          <span className="rounded-md bg-[#F1F5F9] px-2 py-0.5 text-[12px] font-semibold text-[#64748B]">
            {t.archived}
          </span>
        ) : null}
      </div>
      <InlineEditCard
        canEdit={!row.archived}
        summary={
          <>
            <ConfigValue label={t.name} value={row.name} missing={s.missing} />
            <ConfigValue label={t.address} value={place} missing={s.missing} />
            <ConfigValue
              label={t.odoo}
              value={
                row.odooCompanyId != null
                  ? fmt(t.odooCompany, { id: row.odooCompanyId })
                  : null
              }
              missing={s.missing}
            />
          </>
        }
      >
        <NameForm row={row} others={others} />
      </InlineEditCard>
      {archiveAvailable && canArchive ? (
        <div className="mt-2">
          {row.archived ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void archive(false)}
              className="inline-flex h-9 items-center rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm font-medium hover:bg-[#F8FAFC] disabled:opacity-50"
            >
              {t.restore}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || isLastActive}
              title={isLastActive ? t.cannotArchiveLast : t.archiveHint}
              onClick={() => void archive(true)}
              className="inline-flex h-9 items-center rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm font-medium hover:bg-[#F8FAFC] disabled:opacity-50"
            >
              {t.archive}
            </button>
          )}
        </div>
      ) : null}
    </li>
  );
}

function NameForm({ row, others }: { row: SiteRow; others: string[] }) {
  const { d, fmt } = useT();
  const t = d.config.sites.restaurants;
  const ed = useInlineEditor();
  const router = useRouter();
  const [name, setName] = useState(row.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = validateRestaurantName(name, others);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!check.ok) {
      setError(check.message);
      ed.failed(check.message);
      return;
    }
    if (check.name === row.name) {
      ed.close();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await patchLocation(row.id, { name: check.name }, t.saveFailed);
      ed.saved(t.nameSaved);
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t.saveFailed;
      setError(msg);
      ed.failed(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2" noValidate>
      <label className="block text-[13px] text-[#64748B]">
        {t.name}
        <input
          aria-label={fmt(t.nameOf, { name: row.name })}
          value={name}
          maxLength={MAX_RESTAURANT_NAME}
          autoFocus
          disabled={saving}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
            ed.setDirty(e.target.value.trim() !== row.name);
          }}
          className={
            "mt-1 block h-10 w-full max-w-sm rounded-lg border bg-white px-3 text-sm text-[#0F172A] outline-none focus:ring-2 focus:ring-[#1B40C8]/30 " +
            (error ? "border-[#0F172A]" : "border-[#E5E7EB]")
          }
        />
      </label>
      {error ? (
        <p role="alert" className="text-[13px] text-[#0F172A]">
          ⚑ {error}
        </p>
      ) : null}
      <p className="text-[13px] text-[#64748B]">{t.addressNote}</p>
      <EditorButtons saving={saving} onCancel={ed.close} />
    </form>
  );
}
