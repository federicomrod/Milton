import { beforeEach, describe, expect, it, vi } from "vitest";

const inserts: Array<Record<string, unknown>> = [];

function makeInsertChain() {
  const chain: Record<string, unknown> = {};
  const self = chain as {
    insert: (row: Record<string, unknown>) => typeof self;
    select: () => typeof self;
    single: () => Promise<{ data: { id: string }; error: null }>;
    then: (
      resolve: (v: { data: null; error: null }) => unknown,
      reject: (e: unknown) => unknown
    ) => Promise<unknown>;
  };
  self.insert = (row) => {
    inserts.push(row);
    return self;
  };
  self.select = () => self;
  self.single = async () => ({ data: { id: "draft-fallback" }, error: null });
  self.then = (resolve, reject) =>
    Promise.resolve({ data: null, error: null }).then(resolve, reject);
  return self;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => makeInsertChain(),
  }),
}));

import { extractAndCreateRecipeDraft } from "@/lib/restaurant/telegram/kitchen-recipe-drafts";

describe("no OpenAI key fallback", () => {
  beforeEach(() => {
    inserts.length = 0;
    delete process.env.OPENAI_API_KEY;
  });

  it("creates a low-confidence fallback draft when OpenAI is not configured", async () => {
    const result = await extractAndCreateRecipeDraft(
      {
        companyId: "company-1",
        locationId: "loc-1",
        staffId: "staff-1",
        kitchenReportId: null,
        chatId: 1,
        messageId: 2,
        mediaKind: null,
        telegramFileId: null,
        text: "receta de pollo",
        currency: "MXN",
      },
      [],
      new Map()
    );

    expect(result).toEqual({ ok: true, draftId: "draft-fallback" });
    expect(inserts[0]).toMatchObject({
      dish_name: "pollo",
      confidence: "low",
      company_id: "company-1",
    });
  });
});
