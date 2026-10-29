"use client";

// Configuración › Restaurante: rename each restaurant (inline field + Guardar)
// and, when migration 055 is applied, archive / restore it. After a save the
// server tree refreshes (router.refresh), so the switcher and the shell header
// show the new name without a full page reload.

import { NOT_AVAILABLE_YET } from "@/lib/restaurant/ui-copy";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { userErrorMessage } from "@/lib/restaurant/user-error";
import {
  MAX_RESTAURANT_NAME,
  validateRestaurantName,
} from "@/lib/restaurant/restaurant-name";

export interface RestaurantRow {
  id: string;
  name: string;
  archived: boolean;
}

export function RestaurantNamesForm({
  restaurants,
  archiveAvailable,
  currentId,
}: {
  restaurants: RestaurantRow[];
  archiveAvailable: boolean;
  /** The restaurant in view (`?location=`), if any. */
  currentId: string | null;
}) {
  const router = useRouter();
  const activeCount = restaurants.filter((r) => !r.archived).length;
  return (
    <section
      className="rounded-[14px] border border-[#dbe3f7] bg-white p-4"
      data-testid="restaurant-names"
    >
      <h2 className="text-[14px] font-bold">Tus restaurantes</h2>
      <p className="mb-2 text-[12px] text-[#8a92a3]">
        Cambia el nombre que ves en el menú lateral y en los encabezados.
      </p>
      <ul>
        {restaurants.map((r) => (
          <Row
            key={`${r.id}:${r.name}`}
            row={r}
            others={restaurants.filter((o) => o.id !== r.id).map((o) => o.name)}
            current={r.id === currentId}
            canArchive={archiveAvailable}
            isLastActive={!r.archived && activeCount <= 1}
            onSaved={() => router.refresh()}
          />
        ))}
      </ul>
      {!archiveAvailable ? (
        <p className="mt-2 text-[12px] text-[#8a92a3]">{NOT_AVAILABLE_YET}</p>
      ) : null}
    </section>
  );
}

function Row({
  row,
  others,
  current,
  canArchive,
  isLastActive,
  onSaved,
}: {
  row: RestaurantRow;
  others: string[];
  current: boolean;
  canArchive: boolean;
  isLastActive: boolean;
  onSaved: () => void;
}) {
  const [name, setName] = useState(row.name);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const check = validateRestaurantName(name, others);
  const unchanged = name.trim() === row.name;

  async function call(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/restaurant/locations/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(userErrorMessage(json, "No pude guardar."));
      setNote({ ok: true, text: done });
      onSaved();
    } catch (e) {
      setNote({
        ok: false,
        text: e instanceof Error ? e.message : "No pude guardar.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!check.ok) return setNote({ ok: false, text: check.message });
    if (unchanged)
      return setNote({ ok: true, text: "No hay cambios que guardar." });
    await call({ name: check.name }, "Nombre guardado.");
  }

  return (
    <li className="flex flex-wrap items-center gap-2 border-t border-[#eef0f4] py-2.5 first:border-t-0">
      <input
        aria-label={`Nombre de ${row.name}`}
        value={name}
        maxLength={MAX_RESTAURANT_NAME}
        disabled={busy || row.archived}
        onChange={(e) => {
          setName(e.target.value);
          setNote(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
        }}
        className="h-9 w-72 rounded-lg border border-[#c6d3f5] bg-white px-2.5 text-[14px] outline-none focus:border-[#1b40c8] focus:ring-2 focus:ring-[#1b40c8]/20 disabled:bg-[#f4f6fb] disabled:text-[#8a92a3]"
      />
      {!row.archived ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="rounded-lg bg-[#1b40c8] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-[#1535a6] disabled:opacity-50"
        >
          {busy ? "Guardando…" : "Guardar"}
        </button>
      ) : (
        <span className="rounded-md bg-[#f1f3f7] px-2 py-0.5 text-[12px] font-semibold text-[#5b6476]">
          Archivado
        </span>
      )}
      {current ? (
        <span className="rounded-md bg-[#eef2fd] px-2 py-0.5 text-[12px] font-semibold text-[#1b40c8]">
          En pantalla
        </span>
      ) : null}
      {canArchive ? (
        row.archived ? (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void call({ archived: false }, "Restaurante restaurado.")
            }
            className="text-[12px] font-semibold text-[#1b40c8] hover:underline"
          >
            Restaurar
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || isLastActive}
            title={
              isLastActive
                ? "No puedes archivar tu único restaurante activo."
                : "Se oculta del menú; no se borra nada."
            }
            onClick={() =>
              void call({ archived: true }, "Restaurante archivado.")
            }
            className="text-[12px] font-semibold text-[#8a92a3] hover:text-[#c03535] disabled:opacity-50"
          >
            Archivar
          </button>
        )
      ) : null}
      {note ? (
        <span
          role={note.ok ? "status" : "alert"}
          className={
            "text-[12px] " +
            (note.ok ? "font-semibold text-[#15803d]" : "text-[#c03535]")
          }
        >
          {note.text}
        </span>
      ) : !check.ok && !unchanged ? (
        <span role="alert" className="text-[12px] text-[#c03535]">
          {check.message}
        </span>
      ) : null}
    </li>
  );
}
