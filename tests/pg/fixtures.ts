// Synthetic fixtures for the real-Postgres tests. Nothing here is client data.
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { asUser } from "./harness";

export const uuid = () => randomUUID();

export interface World {
  A: string; // company A
  B: string; // company B (another tenant)
  L1: string; // A's restaurant 1
  L2: string; // A's restaurant 2
  LB: string; // B's restaurant
  owner: string;
  admin: string;
  manager: string;
  member: string; // read-only member of A
  stranger: string; // no membership at all
  bOwner: string; // owner of B only
  milton: string; // Milton admin who is a member of A
}

export async function seedWorld(admin: Client): Promise<World> {
  const w: World = {
    A: uuid(),
    B: uuid(),
    L1: uuid(),
    L2: uuid(),
    LB: uuid(),
    owner: uuid(),
    admin: uuid(),
    manager: uuid(),
    member: uuid(),
    stranger: uuid(),
    bOwner: uuid(),
    milton: uuid(),
  };
  for (const u of [
    w.owner,
    w.admin,
    w.manager,
    w.member,
    w.stranger,
    w.bOwner,
    w.milton,
  ])
    await admin.query("insert into auth.users (id, email) values ($1, $2)", [
      u,
      `${u}@fixture.test`,
    ]);
  await admin.query(
    "insert into public.companies (id, name) values ($1,'Fixture A'),($2,'Fixture B')",
    [w.A, w.B]
  );
  const mem = (c: string, u: string, r: string) =>
    admin.query(
      "insert into public.company_memberships (company_id, user_id, role) values ($1,$2,$3)",
      [c, u, r]
    );
  await mem(w.A, w.owner, "owner");
  await mem(w.A, w.admin, "admin");
  await mem(w.A, w.manager, "manager");
  await mem(w.A, w.member, "member");
  await mem(w.A, w.milton, "member");
  await mem(w.B, w.bOwner, "owner");
  await admin.query("insert into public.milton_admins (user_id) values ($1)", [
    w.milton,
  ]);
  await admin.query(
    "insert into public.restaurant_locations (id, company_id, name) values ($1,$2,'R1'),($3,$2,'R2'),($4,$5,'RB')",
    [w.L1, w.A, w.L2, w.LB, w.B]
  );
  return w;
}

export interface Line {
  id: string;
  raw: string;
  category: string | null;
  amount: number | null;
  month: string | null;
  scope: { kind: "group" } | { kind: "restaurant"; locationId: string } | null;
  from?: "file";
  status?: "pending" | "approved" | "discarded";
  oneTime?: boolean;
}

export const line = (
  id: string,
  raw: string,
  category: string,
  amount: number | null,
  month: string,
  scope: Line["scope"],
  extra: Partial<Line> = {}
): Line => ({
  id,
  raw,
  category,
  amount,
  month,
  scope,
  from: "file",
  status: "pending",
  ...extra,
});

export async function makeDraft(
  admin: Client,
  company: string,
  lines: Line[],
  opts: { file?: string; sha?: string; by?: string } = {}
): Promise<string> {
  const id = uuid();
  await admin.query(
    "insert into public.fixed_cost_upload_drafts (id, company_id, file_name, parsed_lines, status, created_by, file_sha256) values ($1,$2,$3,$4::jsonb,'draft',$5,$6)",
    [
      id,
      company,
      opts.file ?? "synthetic.xlsx",
      JSON.stringify(lines),
      opts.by ?? null,
      opts.sha ?? null,
    ]
  );
  return id;
}

type Json = unknown;
const j = (v: Json) => JSON.stringify(v);

export async function call<T = any>(
  c: Client,
  uid: string | null,
  sql: string,
  args: unknown[]
): Promise<T> {
  return asUser(
    c,
    uid,
    async (cl) => (await cl.query(`select ${sql} as r`, args)).rows[0].r as T
  );
}

export const api = {
  preview: (c: Client, uid: string | null, draft: string) =>
    call(c, uid, "public.fixed_cost_preview_upload($1::uuid)", [draft]),
  approve: (
    c: Client,
    uid: string | null,
    a: {
      key?: string;
      draft: string;
      dv: number;
      expected: Record<string, number>;
      lineIds?: string[] | null;
      decisions?: Record<string, string>;
      currency?: string;
    }
  ) =>
    call(
      c,
      uid,
      "public.fixed_cost_approve_upload($1::text,$2::uuid,$3::int,$4::jsonb,$5::text[],$6::jsonb,$7::text)",
      [
        a.key ?? uuid(),
        a.draft,
        a.dv,
        j(a.expected),
        a.lineIds ?? null,
        j(a.decisions ?? {}),
        a.currency ?? "USD",
      ]
    ),
  save: (
    c: Client,
    uid: string | null,
    a: {
      key?: string;
      company: string;
      month: string;
      loc: string | null;
      entries: Json[];
      currency?: string;
    }
  ) =>
    call(
      c,
      uid,
      "public.fixed_cost_save_totals($1::text,$2::uuid,$3::date,$4::uuid,$5::jsonb,$6::text)",
      [
        a.key ?? uuid(),
        a.company,
        a.month,
        a.loc,
        j(a.entries),
        a.currency ?? "USD",
      ]
    ),
  item: (
    c: Client,
    uid: string | null,
    a: {
      key?: string;
      company: string;
      op: "add" | "update" | "delete";
      loc: string | null;
      month: string;
      category: string;
      itemId?: string | null;
      label?: string | null;
      cents?: number | null;
      aggVersion: number;
      itemVersion?: number | null;
      currency?: string;
    }
  ) =>
    call(
      c,
      uid,
      "public.fixed_cost_item_command($1::text,$2::uuid,$3::text,$4::uuid,$5::date,$6::text,$7::uuid,$8::text,$9::bigint,$10::int,$11::int,$12::text)",
      [
        a.key ?? uuid(),
        a.company,
        a.op,
        a.loc,
        a.month,
        a.category,
        a.itemId ?? null,
        a.label ?? null,
        a.cents ?? null,
        a.aggVersion,
        a.itemVersion ?? null,
        a.currency ?? "USD",
      ]
    ),
  previewCopy: (
    c: Client,
    uid: string | null,
    company: string,
    loc: string | null,
    from: string,
    to: string
  ) =>
    call(
      c,
      uid,
      "public.fixed_cost_preview_copy($1::uuid,$2::uuid,$3::date,$4::date)",
      [company, loc, from, to]
    ),
  copy: (
    c: Client,
    uid: string | null,
    a: {
      key?: string;
      company: string;
      loc: string | null;
      from: string;
      to: string;
      categories: string[];
      decisions?: Record<string, string>;
      expected?: Record<string, number>;
      currency?: string;
    }
  ) =>
    call(
      c,
      uid,
      "public.fixed_cost_copy($1::text,$2::uuid,$3::uuid,$4::date,$5::date,$6::text[],$7::jsonb,$8::jsonb,$9::text)",
      [
        a.key ?? uuid(),
        a.company,
        a.loc,
        a.from,
        a.to,
        a.categories,
        j(a.decisions ?? {}),
        j(a.expected ?? {}),
        a.currency ?? "USD",
      ]
    ),
  undo: (c: Client, uid: string | null, target: string, key?: string) =>
    call(c, uid, "public.fixed_cost_undo($1::text,$2::uuid)", [
      key ?? uuid(),
      target,
    ]),
};

export const keyOf = (loc: string | null, month: string, cat: string) =>
  `${loc ?? "group"}|${month}|${cat}`;

export async function counts(admin: Client, company: string) {
  const q = async (t: string) =>
    Number(
      (
        await admin.query(
          `select count(*)::int n from public.${t} where company_id=$1`,
          [company]
        )
      ).rows[0].n
    );
  return {
    aggregates: await q("restaurant_fixed_costs"),
    items: await q("fixed_cost_items"),
    log: await q("restaurant_fixed_costs_log"),
    commands: await q("fixed_cost_commands"),
  };
}

export async function agg(
  admin: Client,
  company: string,
  loc: string | null,
  month: string,
  cat: string
) {
  const r = await admin.query(
    "select * from public.restaurant_fixed_costs where company_id=$1 and location_id is not distinct from $2 and month=$3 and category=$4",
    [company, loc, month, cat]
  );
  return r.rows[0] ?? null;
}

export async function activeItems(
  admin: Client,
  company: string,
  loc: string | null,
  month: string,
  cat: string
) {
  return (
    await admin.query(
      "select * from public.fixed_cost_items where company_id=$1 and location_id is not distinct from $2 and month=$3 and category=$4 and status='active' order by seq",
      [company, loc, month, cat]
    )
  ).rows;
}
