// lib/utils/pipeline-utils.ts
export interface PhaseColors {
  [key: string]: string;
}

export interface ColorPalette {
  name: string;
  colors: PhaseColors;
}

export type FormatStyle = "short" | "swiss" | "mio";

// Stage normalization helper - converts normalized stage to display name
export const stageToDisplayName: { [key: string]: string } = {
  lead_generation: "Lead Generation",
  first_contact: "First Contact",
  need_qualification: "Need Qualification",
  negotiation: "Negotiation",
  deal: "Deal",
  no_deal: "No Deal",
};

// Reverse mapping: display name to normalized key
const displayNameToKey: { [key: string]: string } = {
  "Lead Generation": "lead_generation",
  "First Contact": "first_contact",
  "Need Qualification": "need_qualification",
  Negotiation: "negotiation",
  Deal: "deal",
  "No Deal": "no_deal",
};

// Normalize any stage value to the standard display name
export const normalizeStage = (value: string): string => {
  if (!value) return "Lead Generation";

  const normalized = value.toLowerCase().trim();

  // If it's already a normalized key (e.g., "lead_generation"), convert to display name
  if (stageToDisplayName[normalized]) {
    return stageToDisplayName[normalized];
  }

  // If it's already a display name (e.g., "Lead Generation"), return as-is
  if (displayNameToKey[value]) {
    return value;
  }

  // Try to match by partial string matching
  if (normalized.includes("lead") || normalized.includes("generation")) {
    return "Lead Generation";
  }
  if (normalized.includes("first") && normalized.includes("contact")) {
    return "First Contact";
  }
  if (normalized.includes("qualification") || normalized.includes("qualify")) {
    return "Need Qualification";
  }
  if (normalized.includes("negotiation") || normalized.includes("negotiate")) {
    return "Negotiation";
  }
  if (normalized.includes("deal") && !normalized.includes("no")) {
    return "Deal";
  }
  if (normalized.includes("no deal") || normalized.includes("lost")) {
    return "No Deal";
  }

  // Default fallback
  return "Lead Generation";
};

export const PHASE_ORDER = [
  "Lead Generation",
  "First Contact",
  "Need Qualification",
  "Negotiation",
  "Deal",
  "No Deal",
] as const;

// Phase weights for weighted pipeline
export const PHASE_WEIGHTS: { [key: string]: number } = {
  "Lead Generation": 0.1,
  "First Contact": 0.2,
  "Need Qualification": 0.4,
  Negotiation: 0.8,
  Deal: 1.0,
  "No Deal": 0,
};

// Default individual colors for each phase
export const DEFAULT_PHASE_COLORS: PhaseColors = {
  "Lead Generation": "#e0f2fe",
  "First Contact": "#93c5fd",
  "Need Qualification": "#3b82f6",
  Negotiation: "#1e40af",
  Deal: "#10b981",
  "No Deal": "#ef4444",
};

// Predefined color palettes
export const COLOR_PALETTES: ColorPalette[] = [
  {
    name: "Default Blues",
    colors: {
      "Lead Generation": "#e0f2fe",
      "First Contact": "#93c5fd",
      "Need Qualification": "#3b82f6",
      Negotiation: "#1e40af",
      Deal: "#10b981",
      "No Deal": "#ef4444",
    },
  },
  {
    name: "Green Gradient",
    colors: {
      "Lead Generation": "#dcfce7",
      "First Contact": "#86efac",
      "Need Qualification": "#22c55e",
      Negotiation: "#16a34a",
      Deal: "#15803d",
      "No Deal": "#ef4444",
    },
  },
  {
    name: "Purple Gradient",
    colors: {
      "Lead Generation": "#f3e8ff",
      "First Contact": "#c084fc",
      "Need Qualification": "#a855f7",
      Negotiation: "#9333ea",
      Deal: "#7c3aed",
      "No Deal": "#ef4444",
    },
  },
  {
    name: "Warm Gradient",
    colors: {
      "Lead Generation": "#fef3c7",
      "First Contact": "#fbbf24",
      "Need Qualification": "#f59e0b",
      Negotiation: "#d97706",
      Deal: "#92400e",
      "No Deal": "#ef4444",
    },
  },
];

// Corporate color palettes
export const CORPORATE_COLOR_PALETTES = [
  { name: "Blue", color: "#3b82f6" },
  { name: "Green", color: "#10b981" },
  { name: "Purple", color: "#8b5cf6" },
  { name: "Orange", color: "#f59e0b" },
  { name: "Red", color: "#ef4444" },
  { name: "Teal", color: "#14b8a6" },
  { name: "Pink", color: "#ec4899" },
  { name: "Indigo", color: "#6366f1" },
];

// Color conversion utilities
export const hexToHsl = (hex: string) => {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
};

export const hslToHex = (h: number, s: number, l: number) => {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

// Generate corporate color shades
export const generateCorporateColors = (baseColor: string): PhaseColors => {
  const hslColor = hexToHsl(baseColor);

  return {
    "Lead Generation": hslToHex(
      hslColor.h,
      hslColor.s,
      Math.min(95, hslColor.l + 40)
    ),
    "First Contact": hslToHex(
      hslColor.h,
      hslColor.s,
      Math.min(85, hslColor.l + 20)
    ),
    "Need Qualification": baseColor,
    Negotiation: hslToHex(
      hslColor.h,
      hslColor.s,
      Math.max(15, hslColor.l - 15)
    ),
    Deal: hslToHex(hslColor.h, hslColor.s, Math.max(10, hslColor.l - 25)),
    "No Deal": "#ef4444", // Always red for failed deals
  };
};

// Format currency helper
export const formatCurrency = (
  value: number,
  currency: string,
  formatStyle: FormatStyle = "short"
): string => {
  const currencySymbol =
    currency === "EUR"
      ? "€"
      : currency === "USD"
        ? "$"
        : currency === "GBP"
          ? "£"
          : "CHF";

  if (formatStyle === "swiss") {
    return `${currencySymbol}${Math.round(value / 1000).toLocaleString("de-CH")}'000`;
  }
  if (formatStyle === "mio") {
    return `${currencySymbol}${(value / 1_000_000).toFixed(1)} Mio`;
  }
  return `${currencySymbol}${(value / 1000).toFixed(0)}k`;
};
