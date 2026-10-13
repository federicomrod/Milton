// Where a menu comes from. Every reader returns plain menu text; the rest
// of the flow (AI reading, matching, drafts) only ever sees that text. A
// PDF or photo reader plugs in here later as one more `kind`.

import { fetchMenuPage, MenuFetchError } from "./safe-fetch";
import { htmlToText } from "./html-text";

/** Longest menu text read (a long menu is ~30k characters). */
export const MAX_MENU_TEXT = 120_000;
/** Less than this is not a menu (a page that loads its menu with JavaScript). */
export const MIN_MENU_TEXT = 80;

export type MenuSource =
  | { kind: "url"; url: string }
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
  raw: string
): MenuText {
  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (text.length < MIN_MENU_TEXT) {
    throw new MenuFetchError(
      kind === "url"
        ? "No encontré el menú en esa página (puede que cargue con JavaScript). Pega el texto del menú."
        : "Ese texto es muy corto para ser un menú."
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
  deps: { fetchPage?: typeof fetchMenuPage } = {}
): Promise<MenuText> {
  if (source.kind === "text") return finish("text", null, source.text);
  const page = await (deps.fetchPage ?? fetchMenuPage)(source.url);
  const text =
    page.contentType === "text/plain" ? page.body : htmlToText(page.body);
  return finish("url", page.url, text);
}
