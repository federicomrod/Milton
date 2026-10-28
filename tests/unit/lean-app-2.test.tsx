// Lean copy pass 2: Menú and Cocina say each thing once. Synthetic data only.
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  INGREDIENT_UNUSED,
  KITCHEN_TELEGRAM_INTRO,
  NEW_PRICE_KEEPS_HISTORY,
  NOT_AVAILABLE_YET,
  RECIPE_UPLOAD_INTRO,
} from "@/lib/restaurant/ui-copy";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const ROOT = process.cwd();

describe("Menú › Resumen", () => {
  const src = read("components/restaurant/recipes-costing/ResumenScreen.tsx");
  it("has no «clic para abrir el plato» caption and never prints $0", () => {
    expect(src).not.toContain("clic para abrir el plato");
    expect(src).toContain('title="Abrir el plato"');
    expect(src).not.toMatch(/nunca cuentan como \$0/);
  });
  it("says «solo ventas con costo» everywhere", () => {
    expect(src).not.toContain("sobre ventas con costo");
    expect(
      read("components/restaurant/menu/MenuDishesScreen.tsx")
    ).not.toContain("sobre ventas con costo");
  });
});

describe("Cocina", () => {
  it("has no kitchen legend and no English QR title", () => {
    expect(
      read("components/restaurant/kitchen/KitchenPageLive.tsx")
    ).not.toContain("kitchen-legend");
    const qr = read("components/restaurant/kitchen/KitchenQrResult.tsx");
    expect(qr).not.toContain("QR for");
    expect(qr).toContain("QR de {locationName}");
  });
  it("«Rotar QR» no longer carries the warning (the confirm dialog does)", () => {
    const src = read("components/restaurant/kitchen/KitchenQrCard.tsx");
    expect(src).not.toContain("la hoja vieja deja de servir)");
    expect(src).not.toContain("QR activo desde");
  });
});

describe("repeated sentences are one constant", () => {
  it("the shared strings", () => {
    expect(NOT_AVAILABLE_YET).toBe("Esto aún no está disponible en tu cuenta.");
    expect(INGREDIENT_UNUSED).toContain("Ninguna receta activa lo usa");
    expect(NEW_PRICE_KEEPS_HISTORY).toContain("el anterior no se borra");
    expect(KITCHEN_TELEGRAM_INTRO).toContain("Telegram");
    expect(RECIPE_UPLOAD_INTRO).toContain("Excel, Word, PDF o foto");
  });
  it("each constant's sentence is written once in the components", () => {
    const files = [
      "components/restaurant/kitchen/KitchenConnectCard.tsx",
      "components/restaurant/kitchen/KitchenRecipesSection.tsx",
      "components/restaurant/kitchen/RecipeUploadCard.tsx",
      "components/restaurant/menu/IngredientConversions.tsx",
      "components/restaurant/recipes-costing/RecipeLinesEditor.tsx",
      "components/restaurant/menu/IngredientesScreen.tsx",
    ].map(read);
    for (const f of files) {
      expect(f).not.toContain("el anterior no se borra");
      expect(f).not.toContain("Tu equipo escanea este código");
      expect(f).not.toContain("Milton prepara los");
      expect(f).not.toContain("Ninguna receta activa lo usa");
    }
  });
});

function walk(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? walk(`${dir}/${e.name}`)
      : /\.tsx?$/.test(e.name)
        ? [`${dir}/${e.name}`]
        : []
  );
}

describe("no developer messages in Menú and Cocina", () => {
  it("no component renders «migración NNN»", () => {
    const dirs = [
      "components/restaurant/menu",
      "components/restaurant/kitchen",
      "components/restaurant/recipes-costing",
      "components/restaurant/groups",
    ].filter((d) => existsSync(join(ROOT, d)));
    for (const file of dirs.flatMap(walk)) {
      const code = read(file)
        .split("\n")
        .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
        .join("\n");
      expect(code, file).not.toMatch(/migraci[óo]n(es)? \d{3}/);
    }
  });
  it("the listed components do not say «en este ambiente»", () => {
    for (const file of [
      "components/restaurant/menu/MenuDishesScreen.tsx",
      "components/restaurant/menu/IngredientesScreen.tsx",
      "components/restaurant/menu/IngredientDuplicates.tsx",
      "components/restaurant/menu/DrillView.tsx",
      "components/restaurant/groups/GroupedItemList.tsx",
      "components/restaurant/groups/ProductosView.tsx",
      "components/restaurant/recipes-costing/UnitConversionForm.tsx",
    ])
      expect(read(file), file).not.toContain("en este ambiente");
  });
});

describe("Ventas without «Lo que destaca»", () => {
  it("the component and its render are gone", () => {
    expect(
      existsSync(
        join(ROOT, "components/restaurant/sales/detail/Highlights.tsx")
      )
    ).toBe(false);
    const page = read("components/restaurant/sales/detail/SalesDetailV2.tsx");
    expect(page).not.toContain("Highlights");
    expect(page).not.toContain("salesFacts");
  });
});

describe("Cuenta and break-even naming", () => {
  it("Cuenta has no company card; Ajustes keeps it", () => {
    expect(read("app/dashboard/account/page.tsx")).not.toContain(
      "Información de la empresa"
    );
    expect(read("app/dashboard/settings/page.tsx")).toContain(
      "Información de la empresa"
    );
  });
  it("break-even is «Punto de equilibrio» in the UI", () => {
    expect(
      read("components/restaurant/rentabilidad/RentabilidadPage.tsx")
    ).toContain("Punto de equilibrio por día");
    expect(read("lib/restaurant/rentabilidad-copy.ts")).not.toMatch(
      /venta de equilibrio/i
    );
  });
});
