import { describe, expect, it } from "vitest";
import {
  MIN_RECORDING_MS,
  isSilenceHallucination,
  isTooShort,
  usableTranscript,
} from "./voice-core";

describe("isTooShort", () => {
  it("ignores taps under one second, keeps one second and longer", () => {
    expect(isTooShort(0)).toBe(true);
    expect(isTooShort(MIN_RECORDING_MS - 1)).toBe(true);
    expect(isTooShort(MIN_RECORDING_MS)).toBe(false);
    expect(isTooShort(4_000)).toBe(false);
  });
  it("treats a missing or broken duration as too short", () => {
    expect(isTooShort(Number.NaN)).toBe(true);
    expect(isTooShort(-5)).toBe(true);
  });
});

describe("isSilenceHallucination", () => {
  it("catches the stock Whisper phrases, however they are cased or punctuated", () => {
    for (const t of [
      "Subtítulos realizados por la comunidad de Amara.org",
      "subtitulos realizados por la comunidad de amara.org",
      "  Subtítulos realizados por la comunidad de Amara.org. ",
      "Subtitles by the Amara.org community",
      "Untertitel der Amara.org-Community",
      "¡Suscríbete!",
      "Thanks for watching!",
      "Gracias por ver el video.",
    ]) {
      expect(isSilenceHallucination(t), t).toBe(true);
    }
  });
  it("catches any line that credits the subtitle community", () => {
    expect(isSilenceHallucination("Subtitulado por Amara.org")).toBe(true);
  });
  it("keeps real questions, including ones that share words", () => {
    for (const t of [
      "¿Cómo van las ventas de esta semana?",
      "¿Qué platos dejan menos margen?",
      "Gracias, ¿y las ventas de ayer?",
      "Suscripciones del mes",
      "How are sales this week?",
    ]) {
      expect(isSilenceHallucination(t), t).toBe(false);
    }
  });
  it("does not flag empty text (that is handled as no transcript)", () => {
    expect(isSilenceHallucination("")).toBe(false);
  });
});

describe("usableTranscript", () => {
  it("returns the trimmed text for a real question", () => {
    expect(usableTranscript("  ¿Cuánto vendimos ayer? ")).toBe(
      "¿Cuánto vendimos ayer?"
    );
  });
  it("returns null for empty, blank and hallucinated text", () => {
    expect(usableTranscript("")).toBeNull();
    expect(usableTranscript("   ")).toBeNull();
    expect(
      usableTranscript("Subtítulos realizados por la comunidad de Amara.org")
    ).toBeNull();
  });
});
