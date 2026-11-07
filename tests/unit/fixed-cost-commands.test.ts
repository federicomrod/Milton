import { describe, expect, it } from "vitest";
import {
  classifyCommandError,
  toCents,
} from "@/lib/restaurant/fixed-cost-commands";

describe("how a database refusal is understood (raw text never leaves the server)", () => {
  it.each([
    [{ code: "FC401", message: "not_authenticated" }, "forbidden"],
    [{ code: "FC403", message: "forbidden" }, "forbidden"],
    [{ code: "42501", message: "permission denied for function" }, "forbidden"],
    [{ code: "FC404", message: "not_found" }, "not_found"],
    [{ code: "FC422", message: "invalid_scope" }, "invalid"],
    [{ code: "FC409", message: "stale_version" }, "stale"],
    [{ code: "FC409", message: "stale_draft" }, "stale"],
    [{ code: "FC409", message: "idempotency_key_reuse" }, "stale"],
    [{ code: "FC409", message: "changed_since" }, "conflict"],
    [{ code: "FC409", message: "already_undone" }, "conflict"],
    [{ code: "55P03", message: "lock timeout" }, "busy"],
    [{ code: "40P01", message: "deadlock detected" }, "busy"],
    [
      { code: "XX000", message: 'relation "restaurant_fixed_costs" secret' },
      "failed",
    ],
  ])("%j → %s", (err, kind) => {
    const c = classifyCommandError(err);
    expect(c.failure).toBe(kind);
    if (kind === "failed") expect(c.reason).toBe("failed");
  });

  it("money crosses the boundary as integer cents (no binary float drift)", () => {
    expect(toCents(4800)).toBe(480000);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(1234.565)).toBe(123457);
  });
});
