// The automatic briefing end to end, with the REAL generateBriefing /
// buildBriefingContext / renderBriefingEmail: only the database, the Odoo
// sync and the mail provider are faked. The database answers like production
// does to the service role: the member-gated rollup RPCs say "no sales".
// Fake ids and names only.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeDb, type FakeStore, type Row } from "./helpers/fake-db";

const CO = "co-demo-1";
const OTHER = "co-demo-2";
const TZ = "America/El_Salvador";
const SECRET = "test-cron-secret";

const { state, sent, syncResult } = vi.hoisted(() => ({
  state: { store: {} as Record<string, Row[]> },
  sent: [] as Array<{
    to: string;
    subject: string;
    html: string;
    text: string;
  }>,
  syncResult: {
    current: { company: "abc12345", ok: true } as {
      company: string;
      ok: boolean;
      skipped?: boolean;
      error_kind?: string;
    },
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const db = makeFakeDb(state.store as FakeStore);
    return {
      from: db.from,
      rpc: async (name: string) => {
        if (name === "cockpit_pos_rollup")
          return {
            data: {
              row_count: 0,
              daily: [],
              revenue: {},
              tickets: 0,
              units: 0,
            },
            error: null,
          };
        if (name === "cockpit_pos_product_rollup")
          return { data: { row_count: 0, products: [] }, error: null };
        if (name === "pos_product_sales_groups")
          return {
            data: null,
            error: { code: "42501", message: "not a member" },
          };
        return {
          data: null,
          error: { code: "PGRST202", message: `no function ${name}` },
        };
      },
    };
  },
}));
vi.mock("@/lib/restaurant/odoo/auto-sync", () => ({
  autoSyncOdooCompany: async () => syncResult.current,
}));
vi.mock("@/lib/restaurant/email/send", () => ({
  sendBriefingEmail: async (msg: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }) => {
    sent.push(msg);
    return { ok: true };
  },
}));

import { GET } from "@/app/api/cron/briefing-email/route";

function sale(
  company: string,
  location: string,
  day: string,
  net: number,
  check: string,
  placedAt?: string
): Row {
  return {
    id: `${company}-${location}-${day}-${check}`,
    company_id: company,
    location_id: location,
    sale_date: day,
    order_id: check,
    check_id: check,
    raw_item_name: "Plato demo",
    quantity: 1,
    gross_revenue: net,
    net_revenue: net,
    discount_amount: 0,
    currency: "USD",
    sales_channel: null,
    payment_type: null,
    category: null,
    sub_category: null,
    order_placed_at: placedAt ?? `${day}T18:00:00Z`,
    is_tip: false,
    source_metadata: null,
    menu_item_id: null,
  };
}

function seed() {
  const rows: Row[] = [];
  for (let d = 18; d <= 24; d++) {
    rows.push(sale(CO, "loc-a", `2026-10-${d}`, 100, `a-${d}`));
    rows.push(sale(CO, "loc-b", `2026-10-${d}`, 50, `b-${d}`));
  }
  rows.push(
    sale(CO, "loc-a", "2026-10-24", 30, "late-24", "2026-10-25T05:30:00Z")
  );
  for (let d = 18; d <= 24; d++)
    rows.push(sale(OTHER, "loc-x", `2026-10-${d}`, 9999, `x-${d}`));
  state.store = {
    companies: [
      {
        id: CO,
        name: "Restaurante Demo",
        briefing_email_cadence: "daily",
        briefing_email_recipient: "dueno@example.test",
        briefing_email_weekday: 1,
        briefing_email_timezone: TZ,
        briefing_email_last_sent_at: null,
        preferred_language: "es",
      },
    ],
    pos_sales_items: rows,
    restaurant_locations: [],
  };
}

const req = (secret: string | null = SECRET) =>
  new NextRequest("http://localhost/api/cron/briefing-email", {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-25T13:23:00Z"));
  process.env.CRON_SECRET = SECRET;
  delete process.env.OPENAI_API_KEY;
  sent.length = 0;
  syncResult.current = { company: "abc12345", ok: true };
  seed();
});
afterEach(() => {
  vi.useRealTimers();
});

const flat = (s: string) => s.replace(/\u00a0/g, " ");
const WARNING =
  "No pudimos actualizar las ventas de Odoo antes de este correo; las cifras pueden estar incompletas.";

describe("automatic briefing (real generateBriefing)", () => {
  it("the email carries yesterday's and the last 7 days' sales, not «No hay ventas sincronizadas»", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    const { html, text } = sent[0];
    const h = flat(html);
    // 24 Oct: 100 + 50 + the 23:30-local row (30) of the second location
    expect(h).toContain("Ayer, sáb 24 oct");
    expect(h).toContain("USD 180");
    // 18–24 Oct: 6 × 150 + 180
    expect(h).toContain("18–24 oct");
    expect(h).toContain("USD 1,080");
    expect(h).not.toContain("No hay ventas sincronizadas");
    expect(h).not.toContain("9999");
    expect(flat(text)).toContain("USD 180");
    // the margin period names its end, not a start taken from the bounded read
    expect(flat(text)).toContain("hasta sáb 24 oct");
    expect(flat(text)).not.toContain("dom 18 oct a");
    expect(flat(text)).not.toContain("No hay ventas sincronizadas");
  });

  it("a day with nothing synced still says so; no $0 is invented", async () => {
    state.store.pos_sales_items = (state.store.pos_sales_items as Row[]).filter(
      (r) => !(r.company_id === CO && String(r.sale_date) === "2026-10-24")
    );
    await GET(req());
    const h = flat(sent[0].html);
    expect(h).toContain("No hay ventas sincronizadas para ayer");
    expect(h).not.toMatch(/Ayer[^<]*<[^>]*>\s*\$0\b/);
  });

  it("rejects a request without the secret", async () => {
    const res = await GET(req(null));
    expect(res.status).toBe(401);
    expect(sent).toHaveLength(0);
  });
});

describe("the Odoo sync before the send", () => {
  it("a failed sync still sends, with one plain warning line", async () => {
    syncResult.current = {
      company: "abc12345",
      ok: false,
      error_kind: "upstream",
    };
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(flat(sent[0].html)).toContain(WARNING);
    expect(flat(sent[0].text)).toContain(WARNING);
    // never invents numbers: the data that exists is still shown, the rest is «—»
    expect(flat(sent[0].html)).toContain("USD 180");
  });

  it("a skipped sync (no Odoo) shows nothing extra", async () => {
    syncResult.current = { company: "abc12345", ok: true, skipped: true };
    await GET(req());
    expect(flat(sent[0].html)).not.toContain("No pudimos actualizar");
    expect(flat(sent[0].text)).not.toContain("No pudimos actualizar");
  });

  it("a successful sync shows nothing extra", async () => {
    await GET(req());
    expect(flat(sent[0].html)).not.toContain("No pudimos actualizar");
  });
});
