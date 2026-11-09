// @vitest-environment jsdom
// Inline mapping of unclear lines, the destination question, the wording of the
// replace/add choice, and — issue 4 — that the table, the highlight, the
// confirmation and the activity all show exactly what was saved. A stateful
// in-memory server stands in for the API; synthetic data only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
  usePathname: () => "/dashboard/restaurant/costs",
  useSearchParams: () => new URLSearchParams(),
}));

import { FixedCostImport } from "@/components/restaurant/costs/FixedCostImport";
import { FixedCostsWorkspace } from "@/components/restaurant/costs/FixedCostsWorkspace";
import { buildOverview } from "@/lib/restaurant/fixed-cost-overview";
import {
  isFullStatement,
  suggestCategory,
} from "@/lib/restaurant/fixed-cost-import-review";
import { buildReview } from "@/lib/restaurant/fixed-cost-import-review";
import type { PreviewKey } from "@/lib/restaurant/fixed-cost-commands";
import {
  NOV,
  OCT,
  SEP,
  line,
  monthInput,
} from "./fixtures/fixed-cost-redesign";

type DL = {
  id: string;
  raw: string;
  category: string | null;
  amount: number | null;
  month: string | null;
  scope: { kind: "group" } | { kind: "restaurant"; locationId: string } | null;
  from: "file";
  status: "pending" | "approved" | "discarded";
};
type Call = { url: string; method: string; body?: any; form?: FormData };

let calls: Call[];
let lines: DL[];
/** What is already recorded, in cents, by `loc|month|category`. */
let existing: Record<string, number>;

const RESTAURANTS = [
  { id: "loc-1", name: "Cantina Demo" },
  { id: "loc-2", name: "Sucursal Norte" },
];
const dl = (
  id: string,
  raw: string,
  category: string | null,
  amount: number | null,
  scope: DL["scope"]
): DL => ({
  id,
  raw,
  category,
  amount,
  month: OCT,
  scope,
  from: "file",
  status: "pending",
});

function previewOf(): { keys: PreviewKey[] } {
  const by = new Map<string, PreviewKey>();
  for (const l of lines) {
    if (
      l.status !== "pending" ||
      !l.category ||
      !l.amount ||
      !l.month ||
      !l.scope
    )
      continue;
    const loc = l.scope.kind === "restaurant" ? l.scope.locationId : null;
    const key = `${loc ?? "group"}|${l.month}|${l.category}`;
    const cents = Math.round(l.amount * 100);
    const old = existing[key] ?? null;
    const cur = by.get(key);
    if (cur) {
      cur.incoming_cents += cents;
      cur.add_total_cents = (old ?? 0) + cur.incoming_cents;
      cur.lines.push({ id: l.id, raw: l.raw, cents });
    } else
      by.set(key, {
        key,
        loc,
        month: l.month,
        category: l.category as PreviewKey["category"],
        kind: old === null ? "new" : "overlap",
        version: old === null ? 0 : 3,
        old_cents: old,
        detail_state: old === null ? null : "legacy_total",
        existing_items: [],
        incoming_cents: cents,
        add_total_cents: (old ?? 0) + cents,
        duplicate_line_ids: [],
        lines: [{ id: l.id, raw: l.raw, cents }],
      });
  }
  return { keys: [...by.values()] };
}
const draftBody = () => ({
  id: "d1",
  version: 7,
  fileName: "octubre.xlsx",
  status: "draft",
  lines,
});
const previewBody = () => ({
  draft_id: "d1",
  draft_version: 7,
  file_name: "octubre.xlsx",
  same_file_seen_before: false,
  ...previewOf(),
});

beforeEach(() => {
  calls = [];
  existing = {};
  push.mockClear();
  refresh.mockClear();
  vi.stubGlobal("crypto", { randomUUID: () => "uuid-1" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const call: Call = { url, method };
      if (typeof init?.body === "string") call.body = JSON.parse(init.body);
      if (init?.body instanceof FormData) call.form = init.body;
      calls.push(call);
      const json = (data: unknown, status = 200) =>
        new Response(JSON.stringify(data), { status });
      if (url.endsWith("/upload") && method === "GET") return json({});
      if (url.endsWith("/upload") && method === "POST")
        return json({ draft: draftBody(), preview: previewBody() });
      if (url.endsWith("/upload") && method === "PATCH") {
        for (const e of call.body.edits as Array<Record<string, any>>) {
          const l = lines.find((x) => x.id === e.lineId);
          if (!l) continue;
          if (e.category !== undefined) l.category = e.category;
          if (e.scope !== undefined) l.scope = e.scope;
          if (e.discard) l.status = "discarded";
        }
        return json({ draft: draftBody(), preview: previewBody() });
      }
      if (url.endsWith("/approve")) {
        const p = previewOf();
        const ids = new Set<string>(call.body.lineIds);
        const cats = p.keys
          .filter((k) => k.lines.some((l) => ids.has(l.id)))
          .map((k) => {
            const choice = call.body.decisions[k.lines[0].id];
            const total =
              k.kind === "overlap" && choice === "add"
                ? k.add_total_cents
                : k.incoming_cents;
            return {
              key: k.key,
              category: k.category,
              month: k.month,
              location_id: k.loc,
              outcome: k.kind === "overlap" ? "replaced" : "created",
              total: total / 100,
              previous_total: k.old_cents === null ? null : k.old_cents / 100,
            };
          });
        return json({
          status: "applied",
          command_id: "cmd-1",
          lines_approved: ids.size,
          categories: cats,
          draft: { ...draftBody(), status: "approved" },
        });
      }
      return json({});
    })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const R1 = { kind: "restaurant", locationId: "loc-1" } as const;
/** The October acceptance file with the three unclear lines of the brief. */
function unclearFile() {
  lines = [
    dl("a1", "Planilla · 21400", "planilla", 21400, R1),
    dl("a2", "Renta · 6500", "alquiler", 6500, R1),
    dl("a3", "Luz · 1800", "servicios", 1800, R1),
    dl("a4", "Agua · 650", "servicios", 650, R1),
    dl("a5", "Internet · 1450", "servicios", 1450, R1),
    // The three unclear ones:
    dl("u1", "Cosa rara · 120", null, 120, R1),
    dl("u2", "Seguro · 100", null, 100, R1),
    dl("u3", "Gas · 900", "servicios", 900, null), // unknown branch
  ];
}

function mountImport(
  over: Partial<Parameters<typeof FixedCostImport>[0]> = {}
) {
  const oct = monthInput(OCT, []);
  const props = {
    month: NOV,
    locationId: "loc-1" as string | null,
    restaurants: RESTAURANTS,
    currency: "USD",
    overview: buildOverview([monthInput(SEP, []), oct, monthInput(NOV, [])]),
    windowMonths: [SEP, OCT, NOV],
    onApplied: vi.fn(),
    onViewMonths: vi.fn(),
    onUndone: vi.fn(),
    canWrite: true,
    ...over,
  };
  render(<FixedCostImport {...props} />);
  return props;
}
async function upload() {
  fireEvent.change(screen.getByTestId("import-input"), {
    target: { files: [new File(["x"], "octubre.xlsx")] },
  });
  await screen.findByTestId("import-review");
}
const confirmBtn = () =>
  screen.getByTestId("review-confirm") as HTMLButtonElement;

describe("pure helpers", () => {
  it("suggests Servicios for insurance and utilities and Otros for the unknown", () => {
    expect(suggestCategory("Seguro · 100")).toBe("servicios");
    expect(suggestCategory("Versicherung")).toBe("servicios");
    expect(suggestCategory("Cosa rara · 120")).toBe("otros");
    expect(suggestCategory("Sueldos")).toBe("planilla");
  });

  it("a file with three or more monthly categories reads as a full statement", () => {
    unclearFile();
    lines.forEach((l) => {
      if (!l.category) l.category = "otros";
      if (!l.scope) l.scope = R1;
    });
    const rv = buildReview(lines as never, previewOf() as never);
    expect(isFullStatement(rv.groups[0])).toBe(true);
  });
});

describe("1 · inline mapping of unclear lines", () => {
  it("each unclear line gets a category picker or a restaurant picker, with a suggestion that still needs one click", async () => {
    unclearFile();
    mountImport();
    await upload();
    const box = screen.getByTestId("review-unresolved");
    // Category pickers: Planilla, Alquiler, Servicios, Otros + «No incluir».
    for (const c of ["planilla", "alquiler", "servicios", "otros"])
      expect(screen.getByTestId(`pick-u2-${c}`)).toBeTruthy();
    expect(screen.getByTestId("pick-u2-servicios").textContent).toMatch(
      /Sugerido/
    );
    expect(screen.getByTestId("pick-u1-otros").textContent).toMatch(/Sugerido/);
    expect(within(box).getAllByText("No incluir")).toHaveLength(3);
    // The unknown branch gets a restaurant picker.
    expect(screen.getByTestId("restaurant-u3")).toBeTruthy();
    // Suggested is NOT applied: Seguro is in no category yet and confirm is blocked.
    expect(
      screen.getByTestId(`review-row-${OCT}-servicios`).textContent
    ).not.toMatch(/4[.,\s]?900/);
    expect(confirmBtn().disabled).toBe(true);
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("totals update live as lines are assigned; confirm opens only when all are assigned or excluded", async () => {
    unclearFile();
    const p = mountImport();
    await upload();
    // Seguro → Servicios (one click on the suggestion).
    fireEvent.click(screen.getByTestId("pick-u2-servicios"));
    await waitFor(() =>
      expect(screen.queryByTestId("pick-u2-servicios")).toBeNull()
    );
    // Cosa rara → Otros.
    fireEvent.click(screen.getByTestId("pick-u1-otros"));
    await waitFor(() =>
      expect(screen.queryByTestId("pick-u1-otros")).toBeNull()
    );
    expect(confirmBtn().disabled).toBe(true); // Gas still has no restaurant
    fireEvent.change(screen.getByTestId("restaurant-u3"), {
      target: { value: "loc-1" },
    });
    await waitFor(() =>
      expect(screen.queryByTestId("review-unresolved")).toBeNull()
    );

    // October local total 32 920, Seguro 100 inside Servicios exactly once.
    const row = screen.getByTestId(`review-row-${OCT}-servicios`);
    expect(row.textContent).toMatch(/4[.,\s]?900/);
    expect(row.textContent).toContain("Seguro");
    expect(row.textContent!.match(/Seguro/g)).toHaveLength(1);
    expect(screen.getByTestId(`review-total-${OCT}`).textContent).toMatch(
      /32[.,\s]?920/
    );
    expect(confirmBtn().disabled).toBe(false);
    expect(confirmBtn().textContent).toBe(
      "Guardar en Cantina Demo · Octubre 2026"
    );
    expect(screen.queryByTestId("excluded-note")).toBeNull();

    fireEvent.click(confirmBtn());
    await screen.findByTestId("import-result");
    const approve = calls.find((c) => c.url.endsWith("/approve"))!;
    expect(approve.body.lineIds.sort()).toEqual(
      ["a1", "a2", "a3", "a4", "a5", "u1", "u2", "u3"].sort()
    );
    expect(p.onApplied).toHaveBeenCalled();
    expect(screen.getByTestId("saved-in").textContent).toBe(
      "Guardado en Cantina Demo · Octubre 2026"
    );
  });

  it("«No incluir» is explicit, reversible, counted quietly, and discards exactly those lines", async () => {
    unclearFile();
    mountImport();
    await upload();
    fireEvent.click(screen.getByTestId("pick-u2-servicios"));
    await waitFor(() =>
      expect(screen.queryByTestId("pick-u2-servicios")).toBeNull()
    );
    fireEvent.change(screen.getByTestId("restaurant-u3"), {
      target: { value: "loc-1" },
    });
    await waitFor(() =>
      expect(screen.queryByTestId("restaurant-u3")).toBeNull()
    );
    expect(confirmBtn().disabled).toBe(true); // Cosa rara undecided
    expect(screen.queryByTestId("excluded-note")).toBeNull();
    fireEvent.click(screen.getByTestId("exclude-u1"));
    expect(confirmBtn().disabled).toBe(false);
    expect(screen.getByTestId("excluded-note").textContent).toBe(
      "1 líneas no incluidas"
    );
    // Reversible.
    fireEvent.click(screen.getByTestId("exclude-u1"));
    expect(confirmBtn().disabled).toBe(true);
    fireEvent.click(screen.getByTestId("exclude-u1"));

    fireEvent.click(confirmBtn());
    await screen.findByTestId("import-result");
    const discard = calls.filter(
      (c) => c.method === "PATCH" && c.body.edits.some((e: any) => e.discard)
    );
    expect(discard).toHaveLength(1);
    expect(discard[0].body.edits).toEqual([{ lineId: "u1", discard: true }]);
    const approve = calls.find((c) => c.url.endsWith("/approve"))!;
    expect(approve.body.lineIds).not.toContain("u1");
    expect(approve.body.lineIds).toContain("u2");
  });
});

describe("2 · replace versus add, in owner language", () => {
  beforeEach(() => {
    existing = { [`loc-1|${OCT}|planilla`]: 800000 };
    lines = [
      dl("p1", "Planilla · 21400", "planilla", 21400, R1),
      dl("p2", "Renta · 6500", "alquiler", 6500, R1),
      dl("p3", "Luz · 1800", "servicios", 1800, R1),
    ];
  });

  it("says what each option does to the amount; replace is recommended for a full statement but never pre-selected", async () => {
    mountImport();
    await upload();
    const row = screen.getByTestId(`review-row-${OCT}-planilla`);
    const text = row.textContent!;
    expect(text).toMatch(
      /Usar el monto del archivo: Planilla de octubre pasa de \$?\s?8[.,\s]?000.* a \$?\s?21[.,\s]?400/
    );
    expect(text).toMatch(
      /Es un gasto extra: sumar \$?\s?21[.,\s]?400 a los \$?\s?8[.,\s]?000.* actuales = \$?\s?29[.,\s]?400/
    );
    expect(text).toMatch(/Recomendado/);
    const [replace, add] = within(row).getAllByRole(
      "radio"
    ) as HTMLInputElement[];
    expect(replace.checked).toBe(false);
    expect(add.checked).toBe(false);
    expect(confirmBtn().disabled).toBe(true); // never approve with defaults
  });

  it("a rate says «Cambiar la tasa de 15% a 13%» and offers no add", async () => {
    existing = { [`loc-1|${OCT}|impuestos`]: 1500 };
    lines.push(dl("t1", "IVA · 13", "impuestos", 13, R1));
    mountImport();
    await upload();
    const row = screen.getByTestId(`review-row-${OCT}-impuestos`);
    expect(row.textContent).toMatch(/Cambiar la tasa de 15% a 13%/);
    expect(within(row).getAllByRole("radio")).toHaveLength(1);
  });
});

describe("3 · the destination is asked, shown, and never defaulted to shared", () => {
  it("in the group view the question comes first; the file picker stays closed until a destination is chosen", async () => {
    unclearFile();
    mountImport({ locationId: null });
    expect(screen.queryByTestId("scope-question")).toBeNull();
    fireEvent.click(screen.getByTestId("import-button"));
    const q = screen.getByTestId("scope-question");
    expect(q.textContent).toContain("¿A dónde van estos costos?");
    expect(within(q).getByLabelText(/Cantina Demo/)).toBeTruthy();
    expect(
      within(q).getByLabelText(/Costos compartidos del grupo/)
    ).toBeTruthy();
    expect(
      (screen.getByTestId("scope-pick-file") as HTMLButtonElement).disabled
    ).toBe(true);
    // Nothing nothing was sent.
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("choosing one restaurant uploads for that restaurant and says so at the top and on the button", async () => {
    unclearFile();
    mountImport({ locationId: null });
    fireEvent.click(screen.getByTestId("import-button"));
    fireEvent.click(screen.getByLabelText(/Sucursal Norte/));
    await upload();
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.form!.get("location_id")).toBe("loc-2");
    expect(screen.getByTestId("review-destination").textContent).toContain(
      "Cantina Demo"
    );
  });

  it("choosing the shared group costs sends an empty location only on that explicit choice, and names it", async () => {
    lines = [
      dl("g1", "Planilla · 21400", "planilla", 21400, { kind: "group" }),
      dl("g2", "Renta · 6500", "alquiler", 6500, { kind: "group" }),
      dl("g3", "Luz · 1800", "servicios", 1800, { kind: "group" }),
    ];
    mountImport({ locationId: null });
    fireEvent.click(screen.getByTestId("import-button"));
    fireEvent.click(screen.getByLabelText(/Costos compartidos del grupo/));
    await upload();
    expect(
      calls.find((c) => c.method === "POST")!.form!.get("location_id")
    ).toBe("");
    expect(screen.getByTestId("review-destination").textContent).toContain(
      "Costos compartidos del grupo · Octubre 2026"
    );
    expect(confirmBtn().textContent).toBe(
      "Guardar en Costos compartidos del grupo · Octubre 2026"
    );
  });

  it("in a restaurant view there is no question: that restaurant is the destination", async () => {
    unclearFile();
    mountImport({ locationId: "loc-1" });
    fireEvent.click(screen.getByTestId("import-button"));
    expect(screen.queryByTestId("scope-question")).toBeNull();
  });
});

describe("4 · the table, the highlight, the confirmation and the activity show exactly what was saved", () => {
  const groupLine = (cat: Parameters<typeof line>[1], amt: number) =>
    line(OCT, cat, amt, { location_id: null });
  const stale = () =>
    buildOverview([
      monthInput(SEP, []),
      monthInput(OCT, [
        groupLine("planilla", 8000),
        groupLine("alquiler", 10000),
        groupLine("servicios", 2500),
      ]),
      monthInput(NOV, []),
    ]);
  const fresh = () =>
    buildOverview([
      monthInput(SEP, []),
      monthInput(OCT, [
        groupLine("planilla", 21400),
        groupLine("alquiler", 6500),
        groupLine("servicios", 4900),
        groupLine("otros", 120),
      ]),
      monthInput(NOV, []),
    ]);
  const props = (overview: ReturnType<typeof stale>) => ({
    overview,
    itemsByMonth: {},
    activity: [],
    currency: "USD",
    selectedMonth: NOV,
    currentMonth: NOV,
    locationId: null,
    locationName: null,
    restaurants: RESTAURANTS,
    shellParams: {},
    canWrite: true,
  });

  function groupFile() {
    const G = { kind: "group" } as const;
    existing = {
      [`group|${OCT}|planilla`]: 800000,
      [`group|${OCT}|alquiler`]: 1000000,
      [`group|${OCT}|servicios`]: 250000,
    };
    lines = [
      dl("g1", "Planilla · 21400", "planilla", 21400, G),
      dl("g2", "Renta · 6500", "alquiler", 6500, G),
      dl("g3", "Luz · 1800", "servicios", 1800, G),
      dl("g4", "Agua · 650", "servicios", 650, G),
      dl("g5", "Internet · 1450", "servicios", 1450, G),
      dl("g6", "Seguro · 100", "servicios", 100, G),
      dl("g7", "Gas · 900", "servicios", 900, G),
      dl("g8", "Otros gastos · 120", "otros", 120, G),
    ];
  }

  async function reviewInGroup() {
    fireEvent.click(screen.getByTestId("import-button"));
    fireEvent.click(screen.getByLabelText(/Costos compartidos del grupo/));
    await upload();
  }

  it("no approval without an explicit choice per overlapping category", async () => {
    groupFile();
    render(<FixedCostsWorkspace {...props(stale())} />);
    await reviewInGroup();
    expect(confirmBtn().disabled).toBe(true);
    fireEvent.click(
      within(screen.getByTestId(`review-row-${OCT}-planilla`)).getAllByRole(
        "radio"
      )[0]
    );
    fireEvent.click(
      within(screen.getByTestId(`review-row-${OCT}-alquiler`)).getAllByRole(
        "radio"
      )[0]
    );
    expect(confirmBtn().disabled).toBe(true); // servicios still undecided
    expect(calls.filter((c) => c.url.endsWith("/approve"))).toHaveLength(0);
  });

  it("the saved values are the chosen ones; the stale table is reported, never highlighted; a fresh table is confirmed and highlighted", async () => {
    groupFile();
    const view = render(<FixedCostsWorkspace {...props(stale())} />);
    await reviewInGroup();
    for (const c of ["planilla", "alquiler", "servicios"])
      fireEvent.click(
        within(screen.getByTestId(`review-row-${OCT}-${c}`)).getAllByRole(
          "radio"
        )[0]
      );
    expect(confirmBtn().textContent).toBe(
      "Guardar en Costos compartidos del grupo · Octubre 2026"
    );
    fireEvent.click(confirmBtn());
    await screen.findByTestId("import-result");

    // The decisions sent are exactly the choices (replace on every line of each category).
    const approve = calls.find((c) => c.url.endsWith("/approve"))!;
    expect(approve.body.decisions).toMatchObject({
      g1: "replace",
      g2: "replace",
      g3: "replace",
      g7: "replace",
    });
    expect(
      Object.values(approve.body.decisions).every((v) => v === "replace")
    ).toBe(true);

    // The confirmation lists the exact saved result.
    const rows = screen.getByTestId("saved-rows").textContent!;
    expect(rows).toMatch(/Planilla: \$?\s?8[.,\s]?000.* → \$?\s?21[.,\s]?400/);
    expect(rows).toMatch(/Alquiler: \$?\s?10[.,\s]?000.* → \$?\s?6[.,\s]?500/);
    expect(rows).toMatch(/Servicios: \$?\s?2[.,\s]?500.* → \$?\s?4[.,\s]?900/);
    expect(rows).toMatch(/Otros: Nada registrado → \$?\s?120/);

    // The page was asked to re-read, and while it still shows the OLD numbers the
    // card says so and NO cell is highlighted on stale values.
    expect(refresh).toHaveBeenCalled();
    // (the transition spinner may show for a moment first)
    await waitFor(() =>
      expect(screen.getByTestId("table-status").textContent).toContain(
        "La tabla todavía no muestra lo guardado"
      )
    );
    const stalePlanilla = screen.getByTestId(
      "cell-2026-10-01-planilla"
    ).parentElement;
    expect(stalePlanilla?.className).not.toContain("bg-[#E7EDFD]");

    // The refreshed page arrives with the saved values: confirmed and highlighted.
    view.rerender(<FixedCostsWorkspace {...props(fresh())} />);
    expect(screen.getByTestId("table-status").textContent).toContain(
      "La tabla muestra lo guardado"
    );
    for (const c of ["planilla", "alquiler", "servicios", "otros"]) {
      const cellEl = screen.getByTestId(`cell-2026-10-01-${c}`);
      expect(cellEl.parentElement?.className).toContain("bg-[#E7EDFD]");
    }
    expect(screen.getByTestId("cell-2026-10-01-planilla").textContent).toMatch(
      /21[.,\s]?400/
    );
  });

  it("a save into ANOTHER destination is never presented as a change of the table on screen", async () => {
    groupFile();
    // The person picks one restaurant from the group view.
    lines.forEach((l) => (l.scope = R1));
    existing = {};
    render(<FixedCostsWorkspace {...props(stale())} />);
    fireEvent.click(screen.getByTestId("import-button"));
    fireEvent.click(screen.getByLabelText(/Cantina Demo/));
    await upload();
    fireEvent.click(confirmBtn());
    const done = await screen.findByTestId("import-result");
    expect(done.textContent).not.toMatch(/octubre 2026 actualizado/i);
    expect(screen.queryByTestId("table-status")).toBeNull();
    const note = screen.getByTestId("saved-elsewhere");
    expect(note.textContent).toContain("se guardaron en Cantina Demo");
    // The group table stays as it was and no cell is highlighted.
    expect(
      screen.getByTestId("cell-2026-10-01-planilla").parentElement?.className
    ).not.toContain("bg-[#E7EDFD]");
    fireEvent.click(
      within(note).getByRole("button", { name: /Ver Cantina Demo/ })
    );
    expect(push).toHaveBeenCalledWith(
      expect.stringContaining("location=loc-1")
    );
  });
});
