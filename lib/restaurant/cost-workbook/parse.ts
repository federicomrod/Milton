// Plain-code parsing + validation. AI never invents these numbers.

const MATH_ABS_TOL = 0.05;
const MATH_REL_TOL = 0.02;

export function totalsMatch(
  quantity: number,
  unitPrice: number,
  total: number
): boolean {
  const expected = quantity * unitPrice;
  const abs = Math.abs(expected - total);
  if (abs <= MATH_ABS_TOL) return true;
  const denom = Math.max(Math.abs(total), Math.abs(expected), 1e-9);
  return abs / denom <= MATH_REL_TOL;
}
