"use client";

import { useState } from "react";
import { CONFIRMED_HOW_OPTIONS } from "@/lib/restaurant/recipe-costing/copy";
import { DarkBtn, GhostBtn } from "./ui";

export function ConfirmHowDialog({
  open,
  title,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  onCancel: () => void;
  onConfirm: (how: string) => void;
}) {
  const [how, setHow] = useState("en_persona");
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-slate-600">
          Si lo haces en nombre del cliente, indica cómo te lo confirmó.
        </p>
        <label className="mt-3 block text-xs font-semibold text-slate-500">
          Cómo lo confirmó
          <select
            className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-900"
            value={how}
            onChange={(event) => setHow(event.target.value)}
          >
            {CONFIRMED_HOW_OPTIONS.filter(
              (option) => option.value !== "en_pantalla"
            ).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <GhostBtn onClick={onCancel}>Cancelar</GhostBtn>
          <DarkBtn onClick={() => onConfirm(how)}>
            Registrar y continuar
          </DarkBtn>
        </div>
      </div>
    </div>
  );
}
