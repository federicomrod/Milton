// «BACON», «bacon», «Patties De Hamburguesa» → «Bacon», «Patties de hamburguesa».
// Used to SHOW ingredient names (and to save a new one); existing names in the
// database are never renamed.

export function sentenceCase(name: string | null | undefined): string {
  const text = (name ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const lower = text.toLocaleLowerCase("es");
  return lower.charAt(0).toLocaleUpperCase("es") + lower.slice(1);
}
