// Brand palette. These are the ONLY colours in the app (a test fails if any
// other hex value shows up in the source): blue for actions, Ink for text,
// white background, grey borders, mint = sent, rosa = needs retry, amarillo =
// alerts only. No green, red or orange anywhere. Lavender is for AI only and
// nothing here is AI.
export const colors = {
  blue: "#1B40C8",
  ink: "#0F172A",
  white: "#FFFFFF",
  border: "#E5E7EB",
  mint: "#A7F3D0",
  rosa: "#FBCFE8",
  amarillo: "#FDE68A",
} as const;

export const MIN_TOUCH = 48;

export const space = { xs: 4, s: 8, m: 16, l: 24, xl: 32 } as const;
export const radius = { s: 8, m: 12, pill: 999 } as const;

export const font = {
  body: 17,
  small: 14,
  title: 24,
  big: 20,
} as const;

/** Ink at lower strength, for secondary text (opacity, not another colour). */
export const MUTED_OPACITY = 0.62;

/** Placeholder text: Ink at lower strength (rgba, not another palette colour). */
export const PLACEHOLDER = "rgba(15, 23, 42, 0.45)";
