"use client";

// «Usar la receta de otro plato» (shared link: both products use ONE recipe)
// and «Copiar receta de…» (an independent copy as a new draft). Both are
// visible buttons on the recipe page; one searchable picker serves both.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { GhostBtn } from "./ui";
import { userErrorMessage } from "@/lib/restaurant/user-error";

export const USE_RECIPE_LABEL = "Usar la receta de otro plato";
export const COPY_RECIPE_LABEL = "Copiar receta de…";
export const RECIPE_SOURCE_HELP =
  "Usar la receta de otro plato: ambos comparten la misma receta (un cambio afecta a los dos). Copiar receta: crea una copia independiente como borrador para que la ajustes y la apruebes.";
export const COPY_URL = "/api/restaurant/recipes/copy";

interface Candidate {
  menu_item_id: string;
  name: string;
  status: "aprobada" | "borrador";
  line_count: number;
}

type Mode = "use" | "copy";

export interface RecipeSourceActionsProps {
  odooProductId: number;
  odooName: string;
  locationId?: string | null;
  /** Every plato of the company (for the shared-link picker). */
  menuItems: ReadonlyArray<{ id: string; name: string }>;
  /** This product's own recipe, never offered as a source. */
  currentMenuItemId?: string | null;
  disabled?: boolean;
  /** Link this product to the chosen plato's recipe (shared recipe). */
  onUse: (menuItemId: string) => void;
  /** A copy was saved as a draft: reload the recipe. */
  onCopied: () => void;
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** The two buttons, the helper line and the picker panel, to place apart. */
export function useRecipeSourceActions(props: RecipeSourceActionsProps): {
  buttons: ReactNode;
  helper: ReactNode;
  panel: ReactNode;
} {
  const {
    odooProductId,
    odooName,
    locationId,
    menuItems,
    currentMenuItemId,
    disabled,
    onUse,
    onCopied,
  } = props;
  const [mode, setMode] = useState<Mode | null>(null);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The draft already has lines: ask before touching it.
  const [choice, setChoice] = useState<{
    sourceId: string;
    sourceName: string;
    lines: number;
  } | null>(null);

  useEffect(() => {
    if (mode !== "copy" || candidates) return;
    let alive = true;
    const url = currentMenuItemId
      ? `${COPY_URL}?exclude_menu_item_id=${encodeURIComponent(currentMenuItemId)}`
      : COPY_URL;
    fetch(url)
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as {
          candidates?: Candidate[];
          error?: string;
        };
        if (!alive) return;
        if (!res.ok) {
          setError(
            userErrorMessage(body, "No pude cargar las recetas para copiar.")
          );
          setCandidates([]);
          return;
        }
        setCandidates(body.candidates ?? []);
      })
      .catch(() => {
        if (!alive) return;
        setError("No pude cargar las recetas para copiar.");
        setCandidates([]);
      });
    return () => {
      alive = false;
    };
  }, [mode, candidates, currentMenuItemId]);

  const close = () => {
    setMode(null);
    setQuery("");
    setChoice(null);
    setError(null);
  };
  const open = (next: Mode) => {
    setMode(next);
    setQuery("");
    setChoice(null);
    setError(null);
  };

  const options = useMemo(() => {
    const q = fold(query.trim());
    const base: Array<{ id: string; name: string; note?: string }> =
      mode === "copy"
        ? (candidates ?? []).map((c) => ({
            id: c.menu_item_id,
            name: c.name,
            note: c.status === "aprobada" ? "Aprobada" : "Borrador",
          }))
        : menuItems
            .filter((item) => item.id !== currentMenuItemId)
            .map((item) => ({ id: item.id, name: item.name }));
    return base.filter((item) => !q || fold(item.name).includes(q));
  }, [mode, candidates, menuItems, currentMenuItemId, query]);

  async function copyFrom(
    sourceId: string,
    sourceName: string,
    copyMode?: "replace" | "append"
  ) {
    setWorking(true);
    setError(null);
    try {
      const res = await fetch(COPY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          odoo_product_id: odooProductId,
          odoo_name: odooName,
          location_id: locationId ?? null,
          source_menu_item_id: sourceId,
          ...(copyMode ? { mode: copyMode } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        needs_mode?: boolean;
        draft_line_count?: number;
      };
      if (res.status === 409 && body.needs_mode) {
        setChoice({
          sourceId,
          sourceName,
          lines: body.draft_line_count ?? 0,
        });
        return;
      }
      if (!res.ok) {
        setError(userErrorMessage(body, "No pude copiar la receta."));
        return;
      }
      close();
      onCopied();
    } catch {
      setError("No pude copiar la receta. Intenta otra vez.");
    } finally {
      setWorking(false);
    }
  }

  const buttons = (
    <>
      <GhostBtn disabled={disabled} onClick={() => open("use")}>
        {USE_RECIPE_LABEL}
      </GhostBtn>
      <GhostBtn disabled={disabled} onClick={() => open("copy")}>
        {COPY_RECIPE_LABEL}
      </GhostBtn>
    </>
  );

  const helper = (
    <p className="text-[12px] text-[#6b7385]" data-testid="recipe-source-help">
      {RECIPE_SOURCE_HELP}
    </p>
  );

  const panel = mode ? (
    <div
      className="space-y-2 rounded-lg border border-[#d5dae3] bg-white p-3"
      data-testid="recipe-source-panel"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold text-[#1b2333]">
          {mode === "copy" ? "Copiar la receta de" : "Usar la receta de"}
        </span>
        <input
          type="search"
          autoFocus
          aria-label="Buscar plato"
          placeholder="Buscar plato…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-[200px] flex-1 rounded-md border border-[#d5dae3] px-2 py-1 text-[13px]"
        />
        <GhostBtn onClick={close} disabled={working}>
          Cancelar
        </GhostBtn>
      </div>
      {choice ? (
        <div
          className="space-y-2 rounded-md bg-[#E7EDFD] p-2.5 text-[13px] text-[#1b2333]"
          data-testid="copy-choice"
        >
          <p>
            El borrador de este plato ya tiene {choice.lines}{" "}
            {choice.lines === 1 ? "línea" : "líneas"}. ¿Qué hacemos con las
            líneas de «{choice.sourceName}»?
          </p>
          <div className="flex flex-wrap gap-2">
            <GhostBtn
              disabled={working}
              onClick={() =>
                void copyFrom(choice.sourceId, choice.sourceName, "replace")
              }
            >
              Reemplazar las líneas del borrador
            </GhostBtn>
            <GhostBtn
              disabled={working}
              onClick={() =>
                void copyFrom(choice.sourceId, choice.sourceName, "append")
              }
            >
              Agregar al final
            </GhostBtn>
            <GhostBtn disabled={working} onClick={close}>
              Cancelar
            </GhostBtn>
          </div>
        </div>
      ) : mode === "copy" && candidates === null ? (
        <p className="text-[13px] text-[#5b6476]">Cargando recetas…</p>
      ) : options.length === 0 ? (
        <p className="text-[13px] text-[#5b6476]">
          {mode === "copy"
            ? "No encontré platos con receta que coincidan."
            : "No encontré platos que coincidan."}
        </p>
      ) : (
        <ul className="max-h-56 space-y-1 overflow-auto" role="listbox">
          {options.slice(0, 60).map((item) => (
            <li key={item.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                disabled={working || disabled}
                onClick={() => {
                  if (mode === "use") {
                    close();
                    onUse(item.id);
                  } else {
                    void copyFrom(item.id, item.name);
                  }
                }}
                className="flex w-full items-center justify-between gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-[13px] hover:border-[#1B40C8] hover:bg-[#E7EDFD] disabled:opacity-45"
              >
                <span>{item.name}</span>
                {item.note ? (
                  <span className="text-[11px] text-[#6b7385]">
                    {item.note}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p className="text-[12px] text-[#c03535]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  ) : null;

  return { buttons, helper, panel };
}
