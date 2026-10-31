// Brand palette. These are the ONLY colours in the app (a test fails if any
// other hex value shows up in the source): blue for actions, Ink for text,
// white background, grey borders and chips, mint = done, rosa = needs retry,
// amarillo = alerts and questions only, lavender = AI only. No green, red or
// orange anywhere.
export const colors = {
  blue: "#1B40C8",
  ink: "#0F172A",
  white: "#FFFFFF",
  border: "#E5E7EB",
  mint: "#A7F3D0",
  rosa: "#FBCFE8",
  amarillo: "#FDE68A",
  // Lavender is for AI only: the «Esto entendí» chip.
  lavender: "#DDD6FE",
} as const;

/** Soft tints of the brand blue / Ink as rgba (so no other hex enters the palette). */
export const tint = {
  blue08: "rgba(27, 64, 200, 0.08)",
  blue14: "rgba(27, 64, 200, 0.14)",
  ink45: "rgba(15, 23, 42, 0.45)",
  ink20: "rgba(15, 23, 42, 0.2)",
  ink06: "rgba(15, 23, 42, 0.06)",
  blue30: "rgba(27, 64, 200, 0.3)",
  blue60: "rgba(27, 64, 200, 0.6)",
  white30: "rgba(255, 255, 255, 0.3)",
  white70: "rgba(255, 255, 255, 0.7)",
} as const;

/** Inter, loaded in the root layout (one family per weight on React Native). */
export const fonts = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
  extrabold: "Inter_800ExtraBold",
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
