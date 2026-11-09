// What to make of a voice recording in Preguntar a Milton — pure, so it is
// tested without a device. Two silent-recording problems are handled here:
// a tap that records almost nothing (Cocina already ignores those) and the
// stock phrases speech-to-text makes up when it hears only silence.

/** Recordings shorter than this are treated as accidental taps. */
export const MIN_RECORDING_MS = 1_000;

export function isTooShort(ms: number): boolean {
  return !Number.isFinite(ms) || ms < MIN_RECORDING_MS;
}

// Known phrases Whisper-style models return for silence or noise, as seen in
// the wild. Compared after normalisation (case, accents, punctuation, spaces).
const HALLUCINATIONS = new Set(
  [
    "Subtítulos realizados por la comunidad de Amara.org",
    "Subtítulos por la comunidad de Amara.org",
    "Subtitulado por la comunidad de Amara.org",
    "Subtitles by the Amara.org community",
    "Untertitel der Amara.org-Community",
    "Gracias por ver el video",
    "Gracias por ver el vídeo",
    "Gracias por ver",
    "Suscríbete",
    "Suscríbete al canal",
    "Thanks for watching",
    "Thank you for watching",
    "Vielen Dank fürs Zuschauen",
  ].map(normalise)
);

function normalise(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.\s-]/gu, " ")
    .replace(/[.\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the text is a known made-up transcript of silence. */
export function isSilenceHallucination(text: string): boolean {
  const n = normalise(text);
  if (n === "") return false;
  // Any mention of the subtitle community is never a restaurant question.
  return HALLUCINATIONS.has(n) || n.includes("amara.org");
}

/** The transcript to put in the question box, or null when there is none to
 *  trust (empty, or a known hallucination) and "no pude entender" applies. */
export function usableTranscript(text: string): string | null {
  const t = text.trim();
  if (t === "" || isSilenceHallucination(t)) return null;
  return t;
}
