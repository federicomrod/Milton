// @vitest-environment jsdom
// The import flow end to end in the browser, with the network mocked: one
// review, one confirmation, the selected month never moves by itself, a failure
// writes nothing, and loading the page performs no write. Synthetic data only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { FixedCostImport } from "@/components/restaurant/costs/FixedCostImport";
import { buildOverview } from "@/lib/restaurant/fixed-cost-overview";
import type { PreviewKey } from "@/lib/restaurant/fixed-cost-commands";
import { NOV, OCT, acceptance } from "./fixtures/fixed-cost-redesign";

type Call = { url: string; method: string; body?: unknown };
let calls: Call[];
let approveStatus = 200;
let openDraft: unknown = null;

const k = (
  category: PreviewKey["category"],
  cents: number,
  extra: Partial<PreviewKey> = {}
): PreviewKey => ({
  key: `loc-1|${OCT}|${category}`,
  loc: "loc-1",
  month: OCT,
  category,
  kind: "new",
  version: 0,
  old_cents: null,
  detail_state: null,
  existing_items: [],
  incoming_cents: cents,
  add_total_cents: cents,
  duplicate_line_ids: [],
  lines: [{ id: `l-${category}`, raw: `${category} · x`, cents }],
  ...extra,
});

const draft = (extraLines: unknown[] = []) => ({
  id: "d1",
  version: 1007,
  fileName: "octubre.xlsx",
  status: "draft",
  lines: [
    ...["planilla", "alquiler"].map((c) => ({
      id: `l-${c}`,
      raw: `${c} · x`,
      category: c,
      amount: 1,
      month: OCT,
      scope: { kind: "restaurant", locationId: "loc-1" },
      from: "file",
      status: "pending",
    })),
    ...extraLines,
  ],
});

let keys: PreviewKey[] = [];
const preview = () => ({
  draft_id: "d1",
  draft_version: 1007,
  file_name: "octubre.xlsx",
  same_file_seen_before: false,
  keys,
});

beforeEach(() => {
  calls = [];
  approveStatus = 200;
  openDraft = null;
  keys = [k("planilla", 2140000), k("alquiler", 650000)];
  vi.stubGlobal("crypto", { randomUUID: () => "uuid-1" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      let body: unknown;
      if (typeof init?.body === "string") body = JSON.parse(init.body);
      calls.push({ url, method, body });
      const json = (data: unknown, status = 200) =>
        new Response(JSON.stringify(data), { status });
      if (url.endsWith("/upload") && method === "GET")
        return json(openDraft ? { draft: openDraft, preview: preview() } : {});
      if (url.endsWith("/upload") && method === "POST")
        return json({ draft: draft(), preview: preview() });
      if (url.endsWith("/approve")) {
        if (approveStatus !== 200)
          return json({ error: "No se guardó nada." }, approveStatus);
        return json({
          status: "applied",
          command_id: "cmd-1",
          lines_approved: 2,
          draft: { ...draft(), status: "approved" },
          categories: [
            {
              key: "a",
              category: "planilla",
              month: OCT,
              location_id: "loc-1",
              outcome: "created",
            },
            {
              key: "b",
              category: "alquiler",
              month: OCT,
              location_id: "loc-1",
              outcome: "created",
            },
          ],
        });
      }
      if (url.endsWith("/undo")) return json({ status: "applied" });
      return json({});
    })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(over: Partial<Parameters<typeof FixedCostImport>[0]> = {}) {
  const { sep, oct, nov } = acceptance();
  const props = {
    month: NOV,
    locationId: "loc-1",
    restaurants: [{ id: "loc-1", name: "Cantina Demo" }],
    currency: "USD",
    overview: buildOverview([sep, oct, nov]),
    windowMonths: ["2026-09-01", OCT, NOV],
    onApplied: vi.fn(),
    onViewMonths: vi.fn(),
    onUndone: vi.fn(),
    canWrite: true,
    ...over,
  };
  render(<FixedCostImport {...props} />);
  return props;
}

async function pickFile() {
  const file = new File(["x"], "octubre.xlsx");
  fireEvent.change(screen.getByTestId("import-input"), {
    target: { files: [file] },
  });
  await screen.findByTestId("import-review");
}

describe("loading", () => {
  it("performs no write: only a read of the open draft", async () => {
    mount();
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });
});

describe("one review, one confirmation", () => {
  it("shows the destination once, the month group and before → after", async () => {
    mount();
    await pickFile();
    expect(screen.getAllByTestId("review-destination")).toHaveLength(1);
    expect(screen.getByTestId("review-destination").textContent).toContain(
      "Cantina Demo"
    );
    expect(screen.getByTestId(`review-month-${OCT}`)).toBeTruthy();
    const row = screen.getByTestId(`review-row-${OCT}-planilla`);
    expect(row.textContent).toContain("Nada registrado");
    expect(row.textContent).toMatch(/21[.,\s]?400/);
    // There is exactly one confirm control and no per-line approve.
    expect(
      screen.getAllByRole("button", { name: /^guardar en/i })
    ).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /^aprobar/i })).toBeNull();
  });

  it("an October file keeps November selected and explains it only when proven", async () => {
    const p = mount();
    await pickFile();
    fireEvent.click(screen.getByTestId("review-confirm"));
    const done = await screen.findByTestId("import-result");
    expect(done.textContent).toMatch(/octubre 2026 actualizado/i);
    expect(done.textContent).toMatch(/noviembre 2026 no cambió/i);
    expect(done.textContent).toMatch(/Sigues viendo noviembre 2026/i);
    // October is inside the window: no jump is offered, and nothing moved.
    expect(screen.queryByTestId("view-updated")).toBeNull();
    expect(p.onViewMonths).not.toHaveBeenCalled();
    expect(p.onApplied).toHaveBeenCalledWith(
      expect.objectContaining({
        changed: [`${OCT}|planilla`, `${OCT}|alquiler`],
      })
    );
  });

  it("sends ONE approval carrying every line and the reviewed versions", async () => {
    mount();
    await pickFile();
    fireEvent.click(screen.getByTestId("review-confirm"));
    await screen.findByTestId("import-result");
    const posts = calls.filter((c) => c.url.endsWith("/approve"));
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toMatchObject({
      draftId: "d1",
      draftVersion: 1007,
      commandKey: "uuid-1",
      lineIds: ["l-planilla", "l-alquiler"],
    });
  });

  it("offers «Ver meses actualizados» only for a month outside the window", async () => {
    const p = mount({ windowMonths: ["2026-09-01", "2026-10-01"].slice(0, 1) });
    await pickFile();
    fireEvent.click(screen.getByTestId("review-confirm"));
    await screen.findByTestId("import-result");
    fireEvent.click(screen.getByTestId("view-updated"));
    expect(p.onViewMonths).toHaveBeenCalledWith([OCT]);
  });
});

describe("failure is atomic and visible", () => {
  it("a failed save stays in the review with the message and shows no success", async () => {
    const p = mount();
    await pickFile();
    approveStatus = 500;
    fireEvent.click(screen.getByTestId("review-confirm"));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain(
      "No se guardó nada"
    );
    expect(screen.queryByTestId("import-result")).toBeNull();
    expect(screen.getByTestId("import-review")).toBeTruthy();
    expect(p.onApplied).not.toHaveBeenCalled();
  });

  it("a stale review (409) reloads the review and writes nothing", async () => {
    const p = mount();
    await pickFile();
    approveStatus = 409;
    fireEvent.click(screen.getByTestId("review-confirm"));
    await screen.findByRole("alert");
    expect(p.onApplied).not.toHaveBeenCalled();
    expect(screen.queryByTestId("import-result")).toBeNull();
  });
});

describe("overlap and unresolved lines", () => {
  it("an overlap blocks the confirmation until the person chooses, inline", async () => {
    keys = [
      k("planilla", 2140000),
      k("alquiler", 700000, {
        kind: "overlap",
        old_cents: 650000,
        add_total_cents: 1350000,
        version: 1003,
      }),
    ];
    mount();
    await pickFile();
    const confirm = screen.getByTestId("review-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(screen.getByText(/Elige una opción para/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Es un gasto extra/));
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await screen.findByTestId("import-result");
    const body = calls.find((c) => c.url.endsWith("/approve"))?.body as {
      decisions: Record<string, string>;
    };
    expect(body.decisions).toEqual({ "l-alquiler": "add" });
  });

  it("a line that cannot be completed here is named, offered only «No incluir», and blocks confirmation until decided", async () => {
    keys = [k("planilla", 100), k("alquiler", 200)];
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        calls.push({ url, method });
        if (url.endsWith("/upload") && method === "POST")
          return new Response(
            JSON.stringify({
              draft: draft([
                {
                  id: "bad",
                  raw: "Línea rara · ?",
                  category: null,
                  amount: null,
                  month: OCT,
                  scope: null,
                  from: "file",
                  status: "pending",
                },
              ]),
              preview: preview(),
            })
          );
        return new Response("{}");
      }
    );
    mount();
    await pickFile();
    const box = screen.getByTestId("review-unresolved");
    expect(box.textContent).toContain("Línea rara");
    expect(box.textContent).toMatch(/falta el monto/);
    expect(screen.queryByTestId("pick-bad-otros")).toBeNull();
    expect(
      (screen.getByTestId("review-confirm") as HTMLButtonElement).disabled
    ).toBe(true);
    fireEvent.click(screen.getByTestId("exclude-bad"));
    expect(
      (screen.getByTestId("review-confirm") as HTMLButtonElement).disabled
    ).toBe(false);
    expect(screen.getByTestId("excluded-note").textContent).toMatch(
      /1 líneas no incluidas/
    );
  });
});

describe("undo", () => {
  it("is a separate, clearly labelled action after the result", async () => {
    const p = mount();
    await pickFile();
    fireEvent.click(screen.getByTestId("review-confirm"));
    await screen.findByTestId("import-result");
    fireEvent.click(
      screen.getByRole("button", { name: /Deshacer esta aprobación/ })
    );
    await waitFor(() => expect(p.onUndone).toHaveBeenCalled());
    expect(calls.some((c) => c.url.endsWith("/undo"))).toBe(true);
  });
});

describe("closing the result", () => {
  it("tells the page so the temporary highlight can go", async () => {
    const onDismiss = vi.fn();
    mount({ onDismiss });
    await pickFile();
    fireEvent.click(screen.getByTestId("review-confirm"));
    await screen.findByTestId("import-result");
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onDismiss).toHaveBeenCalled();
    expect(screen.queryByTestId("import-result")).toBeNull();
  });
});
