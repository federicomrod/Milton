export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function shareToPct(share: number): number {
  return round1(share * 100);
}

export function formatMoneyEs(
  amount: number,
  currency = "USD",
  opts?: { decimals?: number }
): string {
  const decimals = opts?.decimals ?? 2;
  const safe = /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: safe,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(amount);
  } catch {
    return `${safe} ${amount.toFixed(decimals)}`;
  }
}

export function formatPctLabel(pct: number): string {
  const rounded = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
  return `${rounded}%`;
}

export function pendingCostLabel(): "Pendiente" {
  return "Pendiente";
}

/** A line that HAS a price, but in a unit the line's unit cannot be read in. */
export const UNIT_MISMATCH_LABEL = "Unidad distinta";
export function unitMismatchHint(priceUnit: string, lineUnit: string): string {
  return `El precio es por ${priceUnit} y la línea usa ${lineUnit}. Cambia una de las dos.`;
}

export function lineCostDisplay(input: {
  pending?: boolean;
  unit_cost?: number | null;
  currency?: string;
}): { label: string; amount: number | null } {
  // A confirmed $0 (water) is a price; only a missing one is Pendiente.
  if (input.pending || input.unit_cost == null || input.unit_cost < 0) {
    return { label: pendingCostLabel(), amount: null };
  }
  return {
    label: formatMoneyEs(input.unit_cost, input.currency),
    amount: input.unit_cost,
  };
}
