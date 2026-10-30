"use client";

// The price of an ingredient, in a small popover opened from the table:
// ONE field («Precio por <unidad>») and one blue «Guardar». It saves through
// /api/restaurant/kitchen/ingredient-price, a thin wrapper over the ONE pricing
// path (a dated price entry every dish reads). Under the field, in small gray
// text, how many dishes use the ingredient. Clicking outside (or Esc) closes it.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "@/lib/i18n/client";
import { t } from "@/lib/restaurant/language";
import {
  KITCHEN_UNITS,
  kitchenUnitLabel,
  mapKitchenUnit,
} from "@/lib/restaurant/kitchen-units";
import { sentenceCase } from "@/lib/restaurant/sentence-case";
import { userErrorMessage } from "@/lib/restaurant/user-error";

export interface PriceEditable {
  id: string;
  name: string;
  default_unit: string | null;
}

export function PricePopover({
  ingredient,
  initialPrice,
  initialUnit,
  triggerClassName,
  triggerLabel,
  children,
  draftId,
  onSaved,
}: {
  ingredient: PriceEditable;
  initialPrice?: number | null;
  initialUnit?: string | null;
  triggerClassName?: string;
  /** Accessible name of the button that opens the popover. */
  triggerLabel: string;
  /** What the button shows ($0.11, «Sin precio», …). */
  children: ReactNode;
  /** The draft being reviewed: the server checks it belongs to this company. */
  draftId?: string;
  onSaved: () => void;
}) {
  const { lang } = useT();
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [unit, setUnit] = useState("kg");
  const [dishes, setDishes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLSpanElement>(null);

  const openIt = () => {
    setPrice(
      initialPrice !== null && initialPrice !== undefined
        ? String(initialPrice)
        : ""
    );
    setUnit(
      mapKitchenUnit(initialUnit) ??
        mapKitchenUnit(ingredient.default_unit) ??
        "kg"
    );
    setError(null);
    setOpen(true);
  };

  // Click outside / Esc closes.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // How many dishes use it (read when the popover opens).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(
      `/api/restaurant/kitchen/ingredients/${encodeURIComponent(ingredient.id)}/usage`
    )
      .then(async (res) =>
        res.ok ? ((await res.json()) as { dishes?: number }) : null
      )
      .then((json) => {
        if (!cancelled)
          setDishes(typeof json?.dishes === "number" ? json.dishes : 0);
      })
      .catch(() => {
        if (!cancelled) setDishes(0);
      });
    return () => {
      cancelled = true;
    };
  }, [open, ingredient.id]);

  const parsed = price.trim() === "" ? null : Number(price);
  const valid = parsed !== null && Number.isFinite(parsed) && parsed >= 0;

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/restaurant/kitchen/ingredient-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingredient_id: ingredient.id,
          unit,
          unit_cost: parsed,
          ...(draftId ? { draft_id: draftId } : {}),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(
          userErrorMessage(
            json,
            t(
              lang,
              "I could not save the price.",
              "No pude guardar el precio.",
              "Ich konnte den Preis nicht speichern."
            )
          )
        );
        return;
      }
      setOpen(false);
      onSaved();
    } catch {
      setError(
        t(
          lang,
          "I could not save the price. Try again.",
          "No pude guardar el precio. Inténtalo de nuevo.",
          "Ich konnte den Preis nicht speichern. Bitte versuchen Sie es erneut."
        )
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <span ref={box} className="relative inline-block">
      <button
        type="button"
        aria-label={triggerLabel}
        aria-expanded={open}
        className={triggerClassName}
        onClick={() => (open ? setOpen(false) : openIt())}
      >
        {children}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label={t(
            lang,
            `Price of ${sentenceCase(ingredient.name)}`,
            `Precio de ${sentenceCase(ingredient.name)}`,
            `Preis von ${sentenceCase(ingredient.name)}`
          )}
          data-testid="price-popover"
          className="absolute right-0 z-50 mt-1 w-64 space-y-2 rounded-md border border-[#dfe3ea] bg-white p-3 text-left text-[13px] shadow-lg"
        >
          <div className="flex items-end gap-2">
            <label className="flex-1 text-[12px] text-[#4a5a85]">
              {t(lang, "Price per", "Precio por", "Preis pro")}
              <select
                aria-label={t(
                  lang,
                  `Price unit of ${sentenceCase(ingredient.name)}`,
                  `Unidad del precio de ${sentenceCase(ingredient.name)}`,
                  `Preiseinheit von ${sentenceCase(ingredient.name)}`
                )}
                className="ml-1 h-8 rounded-md border border-[#e3e7ee] bg-white px-1 text-[13px] text-[#151c2c] focus:border-[#1B40C8] focus:outline-none"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              >
                {KITCHEN_UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {kitchenUnitLabel(u, lang)}
                  </option>
                ))}
              </select>
            </label>
            <input
              type="number"
              min="0"
              step="0.0001"
              autoFocus
              aria-label={t(
                lang,
                `Price of ${sentenceCase(ingredient.name)}`,
                `Precio de ${sentenceCase(ingredient.name)}`,
                `Preis von ${sentenceCase(ingredient.name)}`
              )}
              className="h-8 w-24 rounded-md border border-[#e3e7ee] bg-white px-2 text-[13px] focus:border-[#1B40C8] focus:outline-none"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
              }}
            />
          </div>
          <button
            type="button"
            disabled={!valid || busy}
            onClick={() => void save()}
            className="h-8 w-full rounded-md bg-[#1B40C8] text-[13px] font-semibold text-white hover:bg-[#1535a6] disabled:cursor-not-allowed disabled:bg-[#b9c7f0]"
          >
            {busy
              ? t(lang, "Saving…", "Guardando…", "Wird gespeichert …")
              : t(lang, "Save", "Guardar", "Speichern")}
          </button>
          {dishes !== null && dishes > 0 ? (
            <p className="text-[12px] text-[#8a92a3]">
              {dishes === 1
                ? t(
                    lang,
                    "Updates in the dish that uses this ingredient.",
                    "Se actualiza en el plato que usa este ingrediente.",
                    "Wird im Gericht aktualisiert, das diese Zutat verwendet."
                  )
                : t(
                    lang,
                    `Updates in the ${dishes} dishes that use this ingredient.`,
                    `Se actualiza en los ${dishes} platos que usan este ingrediente.`,
                    `Wird in den ${dishes} Gerichten aktualisiert, die diese Zutat verwenden.`
                  )}
            </p>
          ) : null}
          {error ? (
            <p className="text-[12px] text-[#c03535]" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
