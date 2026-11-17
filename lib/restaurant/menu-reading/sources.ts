// Where a menu comes from. Every reader returns plain menu text; the rest
// of the flow (AI reading, matching, drafts) only ever sees that text. A
// PDF or photo reader plugs in here later as one more `kind`.

import { fetchMenuPage, MenuFetchError } from "./safe-fetch";
import { htmlToText } from "./html-text";
import { menuMsg } from "./messages";
import type { PreferredLanguage } from "@/lib/restaurant/language";

/** Longest menu text read (a long menu is ~30k characters). */
export const MAX_MENU_TEXT = 120_000;
/** Less than this is not a menu (a page that loads its menu with JavaScript). */
export const MIN_MENU_TEXT = 80;

export type MenuSource =
  | { kind: "url"; url: string }
  | { kind: "urls"; urls: string[] }
  | { kind: "text"; text: string };
// Later: | { kind: "pdf"; file: … } | { kind: "photo"; file: … }

export interface MenuText {
  kind: MenuSource["kind"];
  /** The URL actually read (after redirects); null for pasted text. */
  source_ref: string | null;
  text: string;
  /** True when the text was cut at MAX_MENU_TEXT. */
  truncated: boolean;
}

export { MenuFetchError };

function finish(
  kind: MenuSource["kind"],
  sourceRef: string | null,
  raw: string,
  lang: PreferredLanguage = "es"
): MenuText {
  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (text.length < MIN_MENU_TEXT) {
    throw new MenuFetchError(
      kind === "url"
        ? menuMsg(lang, "menuNotFoundOnPage")
        : menuMsg(lang, "textTooShort")
    );
  }
  return {
    kind,
    source_ref: sourceRef,
    text: text.slice(0, MAX_MENU_TEXT),
    truncated: text.length > MAX_MENU_TEXT,
  };
}

export async function readMenuSource(
  source: MenuSource,
  deps: { fetchPage?: typeof fetchMenuPage; lang?: PreferredLanguage } = {}
): Promise<MenuText> {
  const lang = deps.lang ?? "es";
  if (source.kind === "text") return finish("text", null, source.text, lang);
  if (source.kind === "urls") {
    const results = await Promise.allSettled(
      source.urls.map(async (url) => {
        const page = await (deps.fetchPage ?? fetchMenuPage)(url, lang);
        const text =
          page.contentType === "text/plain"
            ? page.body
            : htmlToText(page.body, page.url);
        return { url, text };
      })
    );

    const succeeded = results.filter(
      (r): r is PromiseFulfilledResult<{ url: string; text: string }> =>
        r.status === "fulfilled"
    );

    if (succeeded.length === 0) {
      const firstError = results.find((r) => r.status === "rejected");
      if (firstError && firstError.status === "rejected") {
        throw firstError.reason;
      }
      throw new MenuFetchError(menuMsg(lang, "menuNotFoundOnPage"));
    }

    const combined = succeeded.map((r) => r.value.text).join("\n\n");
    const successUrls = succeeded.map((r) => r.value.url);
    return finish("url", successUrls.join(", "), combined, lang);
  }
  const page = await (deps.fetchPage ?? fetchMenuPage)(source.url, lang);
  const text =
    page.contentType === "text/plain"
      ? page.body
      : htmlToText(page.body, page.url);
  return finish("url", page.url, text, lang);
}
