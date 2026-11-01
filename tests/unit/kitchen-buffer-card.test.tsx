// «Merma de cocina» on Costos: «5 % (predeterminado)», the saved % without the
// tag, «Cambiar» only for managers, es/en/de, 390 px one column.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { I18nProvider } from "@/lib/i18n/client";
import { KitchenBufferCard } from "@/components/restaurant/costs/KitchenBufferCard";
import type { PreferredLanguage } from "@/lib/restaurant/language";

const render = (
  lines: Parameters<typeof KitchenBufferCard>[0]["lines"],
  canEdit: boolean,
  lang: PreferredLanguage = "es"
) =>
  renderToStaticMarkup(
    <I18nProvider lang={lang}>
      <KitchenBufferCard lines={lines} canEdit={canEdit} />
    </I18nProvider>
  );
const one = [
  { locationId: "a", name: "Sucursal Demo", bufferPct: 5, isDefault: true },
];

describe("KitchenBufferCard", () => {
  it("default: «Merma de cocina: 5 % (predeterminado)»", () => {
    const html = render(one, true);
    expect(html).toContain("Merma de cocina: 5 %");
    expect(html).toContain("(predeterminado)");
    expect(html).toContain(">Cambiar<");
  });
  it("a saved value has no «predeterminado»", () => {
    const html = render([{ ...one[0], bufferPct: 8, isDefault: false }], true);
    expect(html).toContain("Merma de cocina: 8 %");
    expect(html).not.toContain("predeterminado");
  });
  it("read-only for everyone else: no change button, no form", () => {
    const html = render(one, false);
    expect(html).toContain("Merma de cocina: 5 %");
    expect(html).not.toContain("Cambiar");
    expect(html).not.toContain("<input");
    expect(html).toContain(
      "Solo el propietario, un administrador o un gerente"
    );
  });
  it("one line per restaurant, with its name when there are several", () => {
    const html = render(
      [
        one[0],
        {
          locationId: "b",
          name: "Sucursal Demo Dos",
          bufferPct: 0,
          isDefault: true,
        },
      ],
      true
    );
    expect(html).toContain("Sucursal Demo");
    expect(html).toContain("Sucursal Demo Dos");
    expect(html.match(/Merma de cocina:/g)).toHaveLength(2);
  });
  it("en and de", () => {
    expect(render(one, true, "en")).toContain("Kitchen buffer: 5%");
    expect(render(one, true, "en")).toContain("(default)");
    const de = render([{ ...one[0], bufferPct: 7.5 }], true, "de");
    expect(de).toContain("Küchenpuffer: 7,5 %");
    expect(de).toContain("(Standard)");
  });
  it("390 px: no fixed widths, no red/green/orange", () => {
    const html = render(one, true);
    expect(html).not.toMatch(/\bw-\[\d+px\]|overflow-x|whitespace-nowrap/);
    expect(html).not.toMatch(
      /(?:text|bg|border)-(?:red|green|orange|amber)|#(?:DC2626|16A34A|F97316|C53A3A)/i
    );
  });
});
