// Turn a menu web page into plain text the AI can read. Plain code: drop
// scripts, styles and markup, keep one line per block, decode entities.

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  Aacute: "Á",
  Eacute: "É",
  Iacute: "Í",
  Oacute: "Ó",
  Uacute: "Ú",
  ntilde: "ñ",
  Ntilde: "Ñ",
  uuml: "ü",
  Uuml: "Ü",
  iexcl: "¡",
  iquest: "¿",
  ordf: "ª",
  ordm: "º",
  deg: "°",
  middot: "·",
  bull: "•",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

export function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (whole, code: string) => {
      if (code[0] === "#") {
        const n =
          code[1] === "x" || code[1] === "X"
            ? parseInt(code.slice(2), 16)
            : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000
          ? String.fromCodePoint(n)
          : whole;
      }
      return NAMED[code] ?? whole;
    }
  );
}

const BLOCK_TAGS =
  "p|div|section|article|header|footer|li|ul|ol|tr|td|th|table|h[1-6]|br|hr|dd|dt|dl|figcaption|figure|main|aside|nav|option|label";

/** At most this many dish photos are kept per page. */
export const MAX_MENU_IMAGES = 60;
const MAX_IMAGE_URL_CHARS = 500;
const SKIP_IMAGE_NAME = /pixel|track|beacon|spacer/i;
const SKIP_IMAGE_KIND = /logo|icon|favicon|sprite|avatar|badge/i;

function attr(tag: string, name: string): string | null {
  const m = new RegExp(
    `[\\s"'/]${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
    "i"
  ).exec(tag);
  if (!m) return null;
  return decodeEntities(m[1] ?? m[2] ?? m[3] ?? "").trim();
}

/** The photo line for one <img> tag, or null when it is not a dish photo. */
function imageLine(tag: string, baseUrl: string | null): string | null {
  let src = attr(tag, "src");
  if (!src || /^data:/i.test(src)) {
    src = attr(tag, "data-src") ?? attr(tag, "data-lazy-src") ?? null;
  }
  if (!src || /^data:/i.test(src) || /^javascript:/i.test(src)) return null;
  let url: URL;
  try {
    url = baseUrl ? new URL(src, baseUrl) : new URL(src);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (/\.svg$/i.test(url.pathname)) return null;
  const href = url.toString();
  if (href.length > MAX_IMAGE_URL_CHARS) return null;
  const alt = (attr(tag, "alt") ?? "").replace(/[\s|]+/g, " ").trim();
  const w = Number(attr(tag, "width"));
  const h = Number(attr(tag, "height"));
  if ((Number.isFinite(w) && w > 0 && w <= 2) || (h > 0 && h <= 2)) {
    return null;
  }
  const file = decodeURIComponent(url.pathname.split("/").pop() ?? "").replace(
    /%/g,
    ""
  );
  if (SKIP_IMAGE_NAME.test(file) || SKIP_IMAGE_NAME.test(url.hostname)) {
    return null;
  }
  if (SKIP_IMAGE_KIND.test(href) || SKIP_IMAGE_KIND.test(alt)) return null;
  return `[imagen: ${href} | ${alt.slice(0, 120)}]`;
}

/**
 * Plain text for the AI. With `baseUrl`, each dish photo stays as its own
 * line `[imagen: <https url> | <alt>]` so the reader can tie it to a dish.
 */
export function htmlToText(html: string, baseUrl?: string | null): string {
  let kept = 0;
  const lines = decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(
        /<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1\s*>/gi,
        " "
      )
      .replace(/<img\b[^>]*>/gi, (tag) => {
        if (kept >= MAX_MENU_IMAGES) return " ";
        const line = imageLine(tag, baseUrl ?? null);
        if (!line) return " ";
        kept += 1;
        return `\n${line.replace(/[<>]/g, "")}\n`;
      })
      .replace(new RegExp(`<\\/?(?:${BLOCK_TAGS})\\b[^>]*>`, "gi"), "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter(Boolean);
  return lines.join("\n");
}
