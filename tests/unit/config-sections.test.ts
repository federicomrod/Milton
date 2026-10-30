import { describe, expect, it } from "vitest";
import {
  CONFIG_SECTION_IDS,
  sectionForLegacyTab,
} from "@/lib/restaurant/config-sections";
import { CONFIG_TABS } from "@/lib/restaurant/config-tabs";
import { es } from "@/lib/i18n/es";
import { en } from "@/lib/i18n/en";
import { de } from "@/lib/i18n/de";

describe("Configuración is one page with seven sections in order", () => {
  it("lists them in the agreed order", () => {
    expect([...CONFIG_SECTION_IDS]).toEqual([
      "ajustes",
      "restaurantes",
      "conexiones",
      "objetivos",
      "turnos",
      "equipo",
      "cuenta",
    ]);
  });

  it("every old ?tab= value scrolls to a section", () => {
    for (const tab of CONFIG_TABS) {
      expect(sectionForLegacyTab(tab)).not.toBeNull();
    }
    expect(sectionForLegacyTab("cuenta")).toBe("cuenta");
    expect(sectionForLegacyTab("restaurante")).toBe("restaurantes");
    expect(sectionForLegacyTab("CONEXIONES")).toBe("conexiones");
    expect(sectionForLegacyTab("nope")).toBeNull();
    expect(sectionForLegacyTab(null)).toBeNull();
  });

  it("each section has an index label in es, en and de", () => {
    for (const dict of [es, en, de]) {
      for (const id of CONFIG_SECTION_IDS) {
        expect(dict.config.shared.nav[id].trim()).not.toBe("");
      }
    }
    expect(de.config.shared.nav.equipo).toBe("Team und Zugang");
    expect(es.config.shared.nav.cuenta).toBe("Mi cuenta");
  });
});
