// Shapes of the manager API (/api/mobile/v1: auth, me, home, ventas,
// rentabilidad, costos, invoices). Copied by hand from lib/restaurant/
// mobile-manager/* (web repo, same repository). The numbers are computed on the
// server by the web's own libraries; the app only draws them, and a null is
// drawn as a missing value («Sin precio»), never as 0.

export interface ManagerUser {
  id: string;
  email: string | null;
  name: string | null;
}

export interface ManagerTokens {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds when the access token stops working. */
  expiresAt: number | null;
  user: ManagerUser;
}

export interface ManagerCompany {
  id: string;
  name: string;
  role: string | null;
  capabilities: string[];
  /** The company language («es», «en», «de»). */
  language?: string;
}

export interface ManagerMe {
  user: { id: string; email: string | null };
  companies: ManagerCompany[];
}

export interface LocationRef {
  id: string;
  name: string;
}

export interface HomeData {
  currency: string;
  locationId: string | null;
  locations: LocationRef[];
  yesterday: {
    date: string;
    net: number | null;
    delta: number | null;
    compareLabel: string;
    tickets: number | null;
    /** Net sales of the last days, oldest first. */
    trend: number[];
  } | null;
  month: {
    month: string;
    hasData: boolean;
    basis: "real" | "estimada";
    profit: number | null;
    /** 0–1 */
    profitPct: number | null;
    isCurrentMonth: boolean;
  } | null;
  needsRestaurant: boolean;
  highlights: {
    id: string;
    text: string;
    kind: string;
    link: "rentabilidad";
  }[];
  pending: {
    count: number;
    firstInvoiceId: string | null;
    suppliers: string[];
  };
}

export type VentasPeriod = "day" | "week" | "month" | "year";

export interface VentasData {
  period: VentasPeriod;
  currency: string;
  locationId: string | null;
  empty: boolean;
  range: { from: string; to: string } | null;
  clipped: boolean;
  compareLabel: string | null;
  total: { value: number | null; delta: number | null };
  tickets: { value: number | null; delta: number | null };
  avgTicket: { value: number | null; delta: number | null };
  daily: { date: string; net: number; previousNet: number | null }[];
  channels: { label: string; net: number; share: number }[];
  dishes: { name: string; units: number; net: number }[] | null;
}

export interface RentabilidadData {
  currency: string;
  locationId: string;
  month: string;
  isCurrentMonth: boolean;
  hasData: boolean;
  basis: "real" | "estimada";
  sales: number | null;
  profit: number | null;
  /** 0–1 */
  profitPct: number | null;
  breakEven: {
    perDay: number | null;
    monthSales: number | null;
    avgSalesPerDay: number | null;
    day: number | null;
    daysInMonth: number;
    actualDays: number;
  };
  cada100: { key: string; pct: number }[] | null;
  cada100Loss: boolean;
  fixedTotal: number | null;
  foodCostPct: number | null;
  findings: string[];
  findingKinds: string[];
}

export interface InvoiceLine {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  unitCost: number | null;
  lineTotal: number | null;
  missing: ("quantity" | "unit")[];
  incomplete: boolean;
  matched: boolean;
}

export interface PendingInvoice {
  id: string;
  supplier: string | null;
  number: string | null;
  date: string;
  status: string;
  source: string;
  total: number | null;
  priced: boolean;
  lineCount: number;
  noPriceCount: number;
  lines: InvoiceLine[];
}

export interface CostosData {
  currency: string;
  pendingCount: number;
  invoices: PendingInvoice[];
  canApprove: boolean;
  needsRestaurant: boolean;
  kpis: {
    month: string;
    hasData: boolean;
    basis: "real" | "estimada";
    sales: number | null;
    foodCostPct: number | null;
    fixedTotal: number | null;
  } | null;
}

export interface ApproveResult {
  posted_lines?: number;
  skipped_lines?: { line_id: string; description: string; reason: string }[];
}

export interface KitchenInvite {
  inviteUrl: string;
}
