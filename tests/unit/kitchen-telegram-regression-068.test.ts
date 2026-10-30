import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// A tiny table that honours UNIQUE (telegram_chat_id, telegram_message_id) the
// way kitchen_reports does, including the NULLs migration 068 now allows.
const h = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  upserts: [] as {
    row: Record<string, unknown>;
    opts: Record<string, unknown>;
  }[],
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      upsert: (row: Record<string, unknown>, opts: Record<string, unknown>) => {
        h.upserts.push({ row, opts });
        return {
          select: async () => {
            const key = [row.telegram_chat_id, row.telegram_message_id];
            const clash =
              key.every((k) => k != null) &&
              h.rows.some(
                (r) =>
                  r.telegram_chat_id === key[0] &&
                  r.telegram_message_id === key[1]
              );
            if (clash && opts.ignoreDuplicates)
              return { data: [], error: null };
            h.rows.push(row);
            return { data: [{ id: "new" }], error: null };
          },
        };
      },
    }),
  }),
}));

import {
  extractReportFromMessage,
  recordKitchenReport,
} from "@/lib/restaurant/telegram/kitchen-reports";

describe("Telegram cook reports after migration 068", () => {
  const report = extractReportFromMessage({
    message_id: 77,
    text: "se acabó el limón",
  })!;
  const input = {
    companyId: "co",
    locationId: "loc",
    staffId: "staff",
    chatId: 1234,
    report,
  };

  it("still dedupes by (telegram_chat_id, telegram_message_id)", async () => {
    h.rows.length = 0;
    h.upserts.length = 0;
    expect(await recordKitchenReport(input)).toBe(true);
    expect(await recordKitchenReport(input)).toBe(false);
    expect(h.rows).toHaveLength(1);
    expect(h.upserts[0].opts).toEqual({
      onConflict: "telegram_chat_id,telegram_message_id",
      ignoreDuplicates: true,
    });
  });

  it("writes the same columns as before: the new channel/client_ref defaults apply to Telegram rows", async () => {
    h.rows.length = 0;
    h.upserts.length = 0;
    await recordKitchenReport(input);
    const row = h.upserts[0].row;
    expect(row.telegram_chat_id).toBe(1234);
    expect(row.telegram_message_id).toBe(77);
    expect(row).not.toHaveProperty("channel");
    expect(row).not.toHaveProperty("client_ref");
  });

  it("migration 068 leaves every Telegram unique key in place", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/068_kitchen_app_identity.sql"),
      "utf8"
    );
    const code = sql
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(code).not.toMatch(/DROP\s+(CONSTRAINT|INDEX)/i);
    expect(code).not.toMatch(/telegram_user_id,\s*location_id/);
    const original = readFileSync(
      join(process.cwd(), "supabase/migrations/021_kitchen_telegram.sql"),
      "utf8"
    );
    expect(original).toContain(
      "UNIQUE (telegram_chat_id, telegram_message_id)"
    );
  });
});
