// What the person reads after "Leer menú". Plain copy, no imports, so
// the client can use it. Every number is a count of PLATOS taken from the
// result's own fields: the first line counts the dishes the MENU lists.

import { fmt, getDictionary } from "@/lib/i18n";
import type { PreferredLanguage } from "@/lib/restaurant/language";

export interface MenuReadSummaryInput {
  dishes_read: number;
  drafted: number;
  skipped_has_recipe?: number;
  skipped_no_ingredients?: number;
  skipped_draft_exists?: number;
  /** Menu dishes no POS product matched. */
  no_pos_match?: number;
  /** Platos with sales this month, sin receta, that the menu does not list. */
  not_on_menu?: number;
  failed?: number;
  new_components?: number;
  truncated?: boolean;
}

export type MenuReadLineKey =
  | "read"
  | "drafted"
  | "no_ingredients"
  | "not_on_menu"
  | "failed"
  | "new_components"
  | "truncated";

export interface MenuReadLine {
  key: MenuReadLineKey;
  text: string;
}

/**
 * One short line per non-zero count; the first two are always shown. The
 * first line splits the dishes the MENU lists, so its parts add up to N.
 */
export function menuReadSummaryLines(
  result: MenuReadSummaryInput,
  lang: PreferredLanguage = "es"
): MenuReadLine[] {
  const s = getDictionary(lang).menu.groups.menuReadSummary;
  const one = (n: number, singular: string, plural: string) =>
    n === 1 ? singular : plural;
  const lines: MenuReadLine[] = [];
  const n = result.dishes_read;
  const has = result.skipped_has_recipe ?? 0;
  const none = result.skipped_no_ingredients ?? 0;
  const exists = result.skipped_draft_exists ?? 0;
  const noPos = result.no_pos_match ?? 0;
  const failed = result.failed ?? 0;
  const d = result.drafted;
  const parts = [
    d > 0 && fmt(s.partDrafted, { n: d }),
    has > 0 &&
      fmt(one(has, s.partHasRecipeOne, s.partHasRecipeOther), { n: has }),
    exists > 0 &&
      fmt(one(exists, s.partDraftExistsOne, s.partDraftExistsOther), {
        n: exists,
      }),
    none > 0 && fmt(one(none, s.partNoneOne, s.partNoneOther), { n: none }),
    noPos > 0 && fmt(s.partNoPos, { n: noPos }),
    failed > 0 && fmt(s.partFailed, { n: failed }),
  ].filter((part): part is string => typeof part === "string");
  lines.push({
    key: "read",
    text: fmt(one(n, s.readOne, s.readOther), {
      n,
      parts: parts.length > 0 ? `: ${parts.join(", ")}` : "",
    }),
  });
  lines.push({
    key: "drafted",
    text:
      fmt(one(d, s.draftedOne, s.draftedOther), { n: d }) +
      (d > 0 ? ` ${s.draftedPending}` : ""),
  });
  if (none > 0) {
    lines.push({
      key: "no_ingredients",
      text: fmt(one(none, s.noIngredientsOne, s.noIngredientsOther), {
        n: none,
      }),
    });
  }
  const off = result.not_on_menu ?? 0;
  if (off > 0) {
    lines.push({
      key: "not_on_menu",
      text: fmt(one(off, s.notOnMenuOne, s.notOnMenuOther), { n: off }),
    });
  }
  if (failed > 0) {
    lines.push({
      key: "failed",
      text: fmt(one(failed, s.failedOne, s.failedOther), { n: failed }),
    });
  }
  const fresh = result.new_components ?? 0;
  if (fresh > 0) {
    lines.push({
      key: "new_components",
      text: fmt(one(fresh, s.newComponentsOne, s.newComponentsOther), {
        n: fresh,
      }),
    });
  }
  if (result.truncated) {
    lines.push({
      key: "truncated",
      text: s.truncated,
    });
  }
  return lines;
}

/** The same lines as one paragraph (for places that show plain text). */
export function menuReadSummary(
  result: MenuReadSummaryInput,
  lang: PreferredLanguage = "es"
): string {
  return menuReadSummaryLines(result, lang)
    .map((line) => line.text)
    .join(" ");
}
