"use client";

import { useState } from "react";
import { menuReadSummary } from "@/lib/restaurant/menu-reading/summary";
import { Card, GhostBtn } from "./ui";

interface MenuReadResponse {
  error?: string;
  dishes_read: number;
  drafted: number;
  new_components: number;
  not_found: string[];
  skipped: Array<{ odoo_name: string; reason: string }>;
  truncated?: boolean;
}

/**
 * "Leer menú (opcional)": the restaurant's menu (web page or pasted text)
 * becomes Sugerido drafts in Plato por plato for dishes with no recipe.
 * The Excel always wins; quantities stay pending for the person.
 */
export function MenuReaderPanel({
  canEdit,
  busyExternal,
  locationId,
  onDone,
}: {
  canEdit: boolean;
  busyExternal: boolean;
  locationId: string | null;
  /** After a reading that prepared drafts: reload the workspace. */
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MenuReadResponse | null>(null);
  const [showNotFound, setShowNotFound] = useState(false);

  const value = mode === "url" ? url.trim() : text.trim();

  async function read() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/restaurant/recipes/menu", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(mode === "url" ? { url: value } : { text: value }),
          location_id: locationId ?? undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as MenuReadResponse;
      if (!res.ok) {
        throw new Error(json.error ?? "No pude leer el menú.");
      }
      setResult(json);
      if (json.drafted > 0) onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pude leer el menú.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold">Leer menú (opcional)</h2>
        <span className="text-[11.5px] text-[#8a92a3]">
          Para los platos que tu Excel no trae
        </span>
      </div>
      <p className="text-xs text-[#5b6476]">
        Milton lee qué lleva cada plato de tu menú y deja un borrador en Plato
        por plato. Tú escribes las cantidades y confirmas cada componente. Si tu
        Excel ya tiene la receta, se queda la del Excel.
      </p>

      {canEdit ? (
        <>
          <div className="flex gap-3 text-[11.5px] font-semibold">
            <button
              type="button"
              className={mode === "url" ? "text-[#1b2333]" : "text-[#3557c9]"}
              onClick={() => setMode("url")}
            >
              Dirección del menú
            </button>
            <button
              type="button"
              className={mode === "text" ? "text-[#1b2333]" : "text-[#3557c9]"}
              onClick={() => setMode("text")}
            >
              Pega el texto del menú
            </button>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            {mode === "url" ? (
              <input
                value={url}
                disabled={busy}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://turestaurante.com/menu"
                className="min-w-0 flex-1 rounded-md border border-[#d5dae3] px-2 py-1.5 text-sm"
              />
            ) : (
              <textarea
                value={text}
                disabled={busy}
                onChange={(event) => setText(event.target.value)}
                placeholder="Copia el menú (de tu página o de un PDF) y pégalo aquí: nombre del plato, precio y descripción."
                rows={5}
                className="min-w-0 flex-1 rounded-md border border-[#d5dae3] px-2 py-1.5 text-sm"
              />
            )}
            <GhostBtn
              disabled={busy || busyExternal || !value}
              onClick={() => void read()}
            >
              {busy ? "Leyendo tu menú…" : "Leer menú"}
            </GhostBtn>
          </div>
        </>
      ) : null}

      {error ? (
        <div className="rounded-md border border-[#f1c0c0] bg-[#fdecec] px-3 py-2 text-xs text-[#c03535]">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="rounded-md border border-[#cfe0ff] bg-[#f3f7ff] px-3 py-2 text-xs text-[#1b2333]">
          {menuReadSummary(result)}
          {result.not_found.length > 0 ? (
            <div className="mt-1">
              <button
                type="button"
                className="font-semibold text-[#3557c9]"
                onClick={() => setShowNotFound((v) => !v)}
              >
                {showNotFound
                  ? "Ocultar"
                  : "Ver los platos no encontrados en el menú"}
              </button>
              {showNotFound ? (
                <ul className="mt-1 list-disc pl-4 text-[11px] text-[#5b6476]">
                  {result.not_found.map((name) => (
                    <li key={name}>{name}: No encontrado en el menú</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
