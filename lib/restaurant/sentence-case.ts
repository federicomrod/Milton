// «BACON», «bacon», «Patties De Hamburguesa» → «Bacon», «Patties de hamburguesa».
// Used to SHOW ingredient names (and to save a new one); existing names in the
// database are never renamed.

export function sentenceCase(name: string | null | undefined): string {
  const text = (name ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const lower = text.toLocaleLowerCase("es");
  return lower.charAt(0).toLocaleUpperCase("es") + lower.slice(1);
}

/**
 * Display a name typed in capitals («QUESO FUNDIDO») like the rest of the
 * app («Queso fundido»). Names with any lowercase letter are kept as typed.
 * Display only — never used to match or store.
 */
export function displayName(name: string | null | undefined): string {
  const text = (name ?? "").replace(/\s+/g, " ").trim();
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (letters.length > 1 && letters === letters.toLocaleUpperCase("es")) {
    return sentenceCase(text);
  }
  return text;
}
