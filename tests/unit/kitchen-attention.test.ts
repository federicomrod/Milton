import { describe, it, expect } from "vitest";
import {
  emptyKitchenBundle,
  parseKitchenAttentionPayload,
} from "@/lib/restaurant/kitchen-attention";

describe("kitchen attention payload", () => {
  it("fails closed on empty or foreign-looking payloads", () => {
    expect(parseKitchenAttentionPayload(null, "UTC")).toEqual(
      emptyKitchenBundle()
    );
    expect(parseKitchenAttentionPayload({}, "UTC")).toEqual(
      emptyKitchenBundle()
    );
    expect(
      parseKitchenAttentionPayload(
        { reports: [{ id: "x" }], drafts: "nope", staff: null },
        "UTC"
      )
    ).toEqual(emptyKitchenBundle());
  });

  it("drops Telegram-only fields and keeps scoped events", () => {
    const bundle = parseKitchenAttentionPayload(
      {
        reports: [
          {
            id: "11111111-1111-1111-1111-111111111111",
            location_id: "22222222-2222-2222-2222-222222222222",
            staff_id: "33333333-3333-3333-3333-333333333333",
            staff_name: "Ana",
            report_type: "waste",
            text: "Merma de aguacate",
            media_kind: "photo",
            created_at: "2026-07-31T17:42:00.000Z",
            resolved_at: null,
            local_date: "2026-07-31",
            local_hour: 11,
            local_minute: 42,
            telegram_file_id: "should-not-be-copied",
          },
        ],
        drafts: [
          {
            id: "44444444-4444-4444-4444-444444444444",
            dish_name: "Salsa",
            portions: 24,
            status: "draft",
            staff_name: "Ana",
            created_at: "2026-07-31T15:30:00.000Z",
            local_date: "2026-07-31",
            local_hour: 9,
            local_minute: 30,
            has_photo: true,
          },
        ],
        staff: [
          { id: "33333333-3333-3333-3333-333333333333", display_name: "Ana" },
        ],
      },
      "America/El_Salvador"
    );
    expect(bundle.reports).toHaveLength(1);
    expect(bundle.reports[0]).not.toHaveProperty("telegram_file_id");
    expect(bundle.reports[0].text).toBe("Merma de aguacate");
    expect(bundle.drafts[0].dish_name).toBe("Salsa");
    expect(bundle.staff[0].display_name).toBe("Ana");
  });
});
