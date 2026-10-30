/// <reference types="vite/client" />
// Company, restaurants, agents, Telegram, sales upload and Odoo write routes
// follow the shared permissions table: company.edit (owner + admin),
// imports.run (owner, admin, manager), odoo.diagnostics (owner + admin).
// Milton staff pass all three. Synthetic data only.
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeDb } from "./helpers/fake-db";

type Row = Record<string, unknown>;

const A = "company-a";
const USER = "user-1";
const COMPANY_EDIT = "Tu rol no puede cambiar los datos de la empresa.";
const UPLOAD = "Tu rol no puede cargar ventas.";
const ODOO = "No tienes permiso para cambiar esto.";

const state = vi.hoisted(() => ({
  store: {} as Record<string, Row[]>,
  staff: false,
  writes: [] as string[],
  external: 0,
}));

function userClient() {
  const db = makeFakeDb(state.store);
  return {
    from: (table: string) => {
      const q = db.from(table) as Record<string, unknown>;
      return new Proxy(q, {
        get(target, prop: string) {
          if (["insert", "update", "upsert", "delete"].includes(prop)) {
            state.writes.push(`${table}.${prop}`);
          }
          return target[prop];
        },
      });
    },
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
  };
}

vi.mock("@/lib/profile-service-server", () => ({
  isUserAdminServer: async () => state.staff,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => userClient(),
}));
vi.mock("@/lib/supabase/admin", async () => {
  const { makeFakeDb: make } = await import("./helpers/fake-db");
  return { createAdminClient: () => make(state.store) };
});
vi.mock("@/lib/restaurant/api-auth", () => ({
  authAndCompany: async () => ({
    ok: true,
    supabase: userClient(),
    companyId: "company-a",
    userId: "user-1",
  }),
}));
vi.mock("@/lib/restaurant/telegram/pairing", () => ({
  createPairingCode: async () => {
    state.external++;
    return { ok: false };
  },
}));
vi.mock("@/lib/restaurant/telegram/send", () => ({
  sendTelegramMessage: async () => {
    state.external++;
    return { ok: true };
  },
}));
vi.mock("@/lib/restaurant/odoo/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/restaurant/odoo/client")>();
  return {
    ...actual,
    authenticate: async () => {
      state.external++;
      return 1;
    },
  };
});
vi.mock("@/lib/restaurant/odoo/load-connection", () => ({
  loadOdooSession: async () => {
    state.external++;
    return {
      ok: false,
      response: NextResponse.json({ error: "x" }, { status: 404 }),
    };
  },
}));
vi.mock("@/lib/restaurant/cache-tags", () => ({
  revalidateSales: () => {},
}));

type Call = (req?: NextRequest) => Promise<Response>;
interface Case {
  name: string;
  load: () => Promise<Call>;
  cap: "company.edit" | "imports.run" | "odoo.diagnostics";
  body?: unknown;
  form?: boolean;
}

function post(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const CASES: Case[] = [
  {
    name: "company PATCH",
    cap: "company.edit",
    body: {},
    load: async () =>
      (await import("@/app/api/restaurant/company/route")).PATCH as Call,
  },
  {
    name: "add-restaurant POST",
    cap: "company.edit",
    body: {},
    load: async () =>
      (await import("@/app/api/restaurant/add-restaurant/route")).POST as Call,
  },
  {
    name: "telegram pairing-code POST",
    cap: "company.edit",
    load: async () =>
      (await import("@/app/api/restaurant/telegram/pairing-code/route"))
        .POST as Call,
  },
  {
    name: "telegram send-briefing POST",
    cap: "company.edit",
    load: async () =>
      (await import("@/app/api/restaurant/telegram/send-briefing/route"))
        .POST as Call,
  },
  {
    name: "pos/upload POST",
    cap: "imports.run",
    form: true,
    load: async () =>
      (await import("@/app/api/restaurant/pos/upload/route")).POST as Call,
  },
  {
    name: "pos/odoo-connection POST",
    cap: "odoo.diagnostics",
    body: {},
    load: async () =>
      (await import("@/app/api/restaurant/pos/odoo-connection/route"))
        .POST as Call,
  },
  {
    name: "pos/odoo-companies POST",
    cap: "odoo.diagnostics",
    body: {},
    load: async () =>
      (await import("@/app/api/restaurant/pos/odoo-companies/route"))
        .POST as Call,
  },
];

const ALLOWED: Record<Case["cap"], string[]> = {
  "company.edit": ["owner", "admin"],
  "imports.run": ["owner", "admin", "manager"],
  "odoo.diagnostics": ["owner", "admin"],
};
const MESSAGE: Record<Case["cap"], string> = {
  "company.edit": COMPANY_EDIT,
  "imports.run": UPLOAD,
  "odoo.diagnostics": ODOO,
};
const ROLES = ["owner", "admin", "manager", "member", "viewer"];

function setRole(role: string | null, staff = false) {
  state.staff = staff;
  state.store = {
    company_memberships: role ? [{ company_id: A, user_id: USER, role }] : [],
    companies: [{ id: A, created_by: USER }],
  };
}

async function run(c: Case) {
  const fn = await c.load();
  const formDataSpy = vi.fn(async () => new FormData());
  let req: NextRequest | undefined;
  if (c.form) {
    req = post("/api/restaurant/pos/upload", "POST");
    (req as unknown as { formData: unknown }).formData = formDataSpy;
  } else if (c.body !== undefined) {
    req = post("/x", "POST", c.body);
  } else {
    req = post("/x", "POST");
  }
  const res = await fn(req);
  return { res, formDataSpy };
}

beforeEach(() => {
  state.writes = [];
  state.external = 0;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe.each(CASES)("$name", (c) => {
  for (const role of ROLES) {
    const allowed = ALLOWED[c.cap].includes(role);
    it(`${role}: ${allowed ? "is not blocked" : "gets 403 and nothing happens"}`, async () => {
      setRole(role);
      const { res, formDataSpy } = await run(c);
      if (allowed) {
        expect(res.status).not.toBe(403);
      } else {
        expect(res.status).toBe(403);
        expect((await res.json()).error).toBe(MESSAGE[c.cap]);
        expect(state.writes).toEqual([]);
        expect(state.external).toBe(0);
        expect(formDataSpy).not.toHaveBeenCalled();
      }
    });
  }

  it("Milton staff without a membership is not blocked", async () => {
    setRole(null, true);
    const { res } = await run(c);
    expect(res.status).not.toBe(403);
  });

  it("a person with no membership and no staff gets 403", async () => {
    setRole(null, false);
    const { res } = await run(c);
    expect(res.status).toBe(403);
  });
});

describe("client gating reads the server answer", () => {
  it("the controls use useCan, not role names", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of [
      "components/restaurant/TelegramConnectionCard.tsx",
      "components/restaurant/settings/PosSalesUploadPanel.tsx",
      "components/restaurant/RestaurantShell.tsx",
    ]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toMatch(/useCan\(/);
      expect(src, f).not.toMatch(/role\s*===|"owner"|"admin"/);
    }
    // Ajustes: the server answers can(actor, "company.edit"); the client
    // control only receives that answer.
    const ajustes = readFileSync(
      "components/restaurant/config/sections/AjustesSection.tsx",
      "utf8"
    );
    expect(ajustes).toMatch(/can\(actor, "company\.edit"\)/);
    expect(ajustes).not.toMatch(/role\s*===|"owner"|"admin"/);
  });
});
