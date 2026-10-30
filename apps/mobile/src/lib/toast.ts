// The short «Enviado · pan» confirmation shown after a send (pure store, so the
// text rules are tested; the pill itself is components/ToastHost.tsx).

import type { ItemKind } from "../api/types";

export const TOAST_MS = 2_800;

/**
 * «Enviado · pan» when what was typed is just a short product name, otherwise
 * plain «Enviado». `sent` is the dictionary word (es/en/de).
 */
export function sentToastText(
  sent: string,
  input: { kind: ItemKind; text?: string | null; name?: string | null }
): string {
  const name = (input.name ?? shortName(input)).trim();
  return name ? `${sent} · ${name}` : sent;
}

function shortName(input: { kind: ItemKind; text?: string | null }): string {
  if (input.kind !== "text") return "";
  const text = (input.text ?? "").trim();
  if (!text || text.length > 20 || /\d/.test(text)) return "";
  return text.split(/\s+/).length <= 2 ? text : "";
}

let message: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

export function currentToast(): string | null {
  return message;
}

export function subscribeToast(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Shows the message and hides it by itself after a moment. */
export function showToast(text: string, ms = TOAST_MS): void {
  message = text;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    message = null;
    timer = null;
    emit();
  }, ms);
  emit();
}
