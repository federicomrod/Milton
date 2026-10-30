import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "accept-language": "de-DE,de;q=0.9" }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import KitchenInviteLanding from "@/app/k/[secret]/page";

const CODE = "Abcdefghijklmnop_qrstuvwxyz-0123456789ABCDEFG";

describe("/k/<code> landing", () => {
  it("shows the code big with the instruction, in the browser language, without touching data", async () => {
    const html = renderToString(
      await KitchenInviteLanding({ params: Promise.resolve({ secret: CODE }) })
    ).replace(/<!-- -->/g, "");
    expect(html).toContain(CODE);
    expect(html).toContain("Öffnen Sie die Milton-Küchen-App");
  });

  it("is a 404 for something that is not a code", async () => {
    await expect(
      KitchenInviteLanding({ params: Promise.resolve({ secret: "x" }) })
    ).rejects.toThrow("NOT_FOUND");
  });
});
