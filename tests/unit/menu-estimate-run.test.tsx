// @vitest-environment jsdom
// «Estimar con Milton»: the pure run loop, the bulk ranking and the summary
// list. Synthetic data only.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  EstimateChunkError,
  remainingNote,
  runEstimateChunks,
  type ChunkResponse,
} from "@/lib/restaurant/menu-reading/estimate-run";
import { rankEstimatePool } from "@/lib/restaurant/menu-reading/estimate-server";
import { EstimateRunList } from "@/components/restaurant/menu/EstimateWithMilton";

afterEach(cleanup);

function chunk(start: number, n: number, over: Partial<ChunkResponse> = {}) {
  return {
    done: n,
    remaining: 30,
    results: Array.from({ length: n }, (_, i) => ({
      menu_item_id: `m${start + i}`,
      name: `Plato Demo ${start + i}`,
      odoo_product_id: 100 + start + i,
      skipped_reason: null,
    })),
    ...over,
  } satisfies ChunkResponse;
}

describe("runEstimateChunks", () => {
  it("keeps going while done is a count: 5 + 5 + 5 + 5 reaches 20", async () => {
    let at = 0;
    const post = vi.fn(async () => {
      const res = chunk(at, 5, { remaining: 45 - (at + 5) });
      at += 5;
      return res;
    });
    const progress: number[] = [];
    const out = await runEstimateChunks({
      post,
      total: 20,
      onProgress: (n) => progress.push(n),
    });
    expect(post).toHaveBeenCalledTimes(4);
    expect(out.estimated).toBe(20);
    expect(out.results.map((r) => r.menu_item_id)[0]).toBe("m0");
    expect(out.results).toHaveLength(20);
    expect(out.remaining).toBe(25);
    expect(progress).toEqual([5, 10, 15, 20]);
    expect(remainingNote(out.remaining)).toBe(
      "Quedan 25 platos sin estimar. Vuelve a pulsar para estimar los siguientes."
    );
  });

  it("asks only for what is missing of the target", async () => {
    const limits: number[] = [];
    let at = 0;
    await runEstimateChunks({
      total: 12,
      post: async (limit) => {
        limits.push(limit);
        const res = chunk(at, Math.min(5, limit), { remaining: 9 });
        at += 5;
        return res;
      },
    });
    expect(limits).toEqual([12, 7, 2]);
  });

  it("stops when remaining is 0", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce(chunk(0, 5, { remaining: 3 }))
      .mockResolvedValueOnce(chunk(5, 3, { remaining: 0 }))
      .mockResolvedValue(chunk(8, 5));
    const out = await runEstimateChunks({ post, total: 20 });
    expect(post).toHaveBeenCalledTimes(2);
    expect(out.estimated).toBe(8);
    expect(out.remaining).toBe(0);
    expect(remainingNote(out.remaining)).toBeNull();
  });

  it("stops after 2 failures in a row, but one failure is retried", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce(chunk(0, 5))
      .mockRejectedValueOnce(new EstimateChunkError(500))
      .mockResolvedValueOnce(chunk(5, 5))
      .mockRejectedValueOnce(new EstimateChunkError(500))
      .mockRejectedValueOnce(new EstimateChunkError(500))
      .mockResolvedValue(chunk(10, 5));
    const out = await runEstimateChunks({ post, total: 20 });
    expect(post).toHaveBeenCalledTimes(5);
    expect(out.estimated).toBe(10);
  });

  it("stops when nothing new comes back (repeated or empty)", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce(chunk(0, 5))
      .mockResolvedValue(chunk(0, 5));
    const out = await runEstimateChunks({ post, total: 20 });
    expect(post).toHaveBeenCalledTimes(2);
    expect(out.estimated).toBe(5);
    const empty = await runEstimateChunks({
      post: async () => ({ done: 0, remaining: 7, results: [] }),
      total: 20,
    });
    expect(empty.estimated).toBe(0);
  });

  it("never reads done as a boolean: done 5 or 1 does not end the run", async () => {
    for (const done of [5, 1, 0]) {
      let at = 0;
      const post = vi.fn(async () => {
        const res = chunk(at, 5, { done, remaining: 40 });
        at += 5;
        return res;
      });
      await runEstimateChunks({ post, total: 15 });
      expect(post).toHaveBeenCalledTimes(3);
    }
  });

  it("a 503 stops with the note and counts skipped separately", async () => {
    const out = await runEstimateChunks({
      total: 20,
      missingTableNote: "Falta aplicar",
      post: async () => {
        throw new EstimateChunkError(503);
      },
    });
    expect(out.note).toBe("Falta aplicar");
    const mixed = await runEstimateChunks({
      total: 5,
      post: async () =>
        chunk(0, 5, {
          results: [
            { menu_item_id: "a", name: "A", skipped_reason: "error_ia" },
            { menu_item_id: "b", name: "B", skipped_reason: null },
          ],
        }),
    });
    expect(mixed.estimated).toBe(1);
    expect(mixed.skipped).toBe(1);
  });
});

describe("rankEstimatePool", () => {
  const cand = (key: string, month: number, all: number, name = key) => ({
    key,
    name,
    month_sales: month,
    all_sales: all,
    item: key,
  });

  it("an unlinked product with high month sales goes before a linked plato with low sales", () => {
    const ranked = rankEstimatePool([
      cand("m-linked-bajo", 10, 9000, "Plato Demo Bajo"),
      cand("p-sin-vincular", 500, 20, "Producto Demo Alto"),
    ]);
    expect(ranked.map((c) => c.key)).toEqual([
      "p-sin-vincular",
      "m-linked-bajo",
    ]);
  });

  it("all-history sales break a tie in the month, then name", () => {
    const ranked = rankEstimatePool([
      cand("a", 100, 1, "Plato Demo B"),
      cand("b", 100, 50, "Plato Demo C"),
      cand("c", 100, 1, "Plato Demo A"),
    ]);
    expect(ranked.map((c) => c.key)).toEqual(["b", "c", "a"]);
  });
});

describe("EstimateRunList", () => {
  const results = Array.from({ length: 7 }, (_, i) => ({
    menu_item_id: `m${i}`,
    name: `Plato Demo ${i}`,
    odoo_product_id: 200 + i,
    skipped_reason: null as string | null,
  }));

  it("lists the first 5 by name with links, then «Ver todos» shows the rest", () => {
    render(<EstimateRunList results={results} />);
    const first = screen.getByRole("link", { name: "Plato Demo 0" });
    expect(first.getAttribute("href")).toBe(
      "/dashboard/restaurant/menu/platos?producto=200"
    );
    expect(screen.queryByText("Plato Demo 5")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Ver todos/ }));
    expect(screen.getByRole("link", { name: "Plato Demo 6" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Ver todos/ })).toBeNull();
  });

  it("lists skipped platos with the Spanish reason, after the estimated ones", () => {
    render(
      <EstimateRunList
        results={[
          {
            menu_item_id: "s1",
            name: "Plato Demo Omitido",
            odoo_product_id: 300,
            skipped_reason: "has_recipe",
          },
          {
            menu_item_id: "e1",
            name: "Plato Demo Listo",
            odoo_product_id: 301,
            skipped_reason: null,
          },
        ]}
      />
    );
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toBe("Plato Demo Listo");
    expect(items[1]).toContain("Plato Demo Omitido");
    expect(items[1]).toContain(
      "Este plato ya tiene receta; Milton no la cambia."
    );
  });
});
