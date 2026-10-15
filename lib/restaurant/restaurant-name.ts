// lib/restaurant/restaurant-name.ts
//
// Renaming a restaurant: the name is trimmed, 1–80 characters, and unique in
// the company (same name ignoring case and accents is a duplicate). Pure.

export const MAX_RESTAURANT_NAME = 80;

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export type NameCheck =
  | { ok: true; name: string }
  | { ok: false; message: string };

/** `others` = the names of the company's OTHER restaurants (the one being renamed excluded). */
export function validateRestaurantName(
  raw: unknown,
  others: readonly string[]
): NameCheck {
  if (typeof raw !== "string")
    return { ok: false, message: "Escribe el nombre del restaurante." };
  const name = raw.trim();
  if (name.length === 0)
    return { ok: false, message: "El nombre no puede estar vacío." };
  if (name.length > MAX_RESTAURANT_NAME)
    return {
      ok: false,
      message: `El nombre puede tener hasta ${MAX_RESTAURANT_NAME} letras.`,
    };
  const key = fold(name);
  if (others.some((o) => fold(o) === key))
    return { ok: false, message: "Ya tienes un restaurante con ese nombre." };
  return { ok: true, name };
}
