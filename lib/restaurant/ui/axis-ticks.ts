// Axis label picking for the hand-drawn (SVG / CSS) charts. Pure: no React, no
// DOM. One place decides WHICH labels show and WHERE they sit, so two labels
// can never print on top of each other and none is cut by the card edge.

export interface TickInput {
  count: number;
  /** x px of point i (slot centre). */
  positionOf: (i: number) => number;
  labelOf: (i: number) => string;
  /** Real drawable px. */
  width: number;
  fontSize: number;
  /** Minimum free px between two labels. Default 8. */
  minGap?: number;
  /** Average glyph width in em. Default 0.6. */
  avgCharWidth?: number;
}

export interface Tick {
  index: number;
  x: number;
  anchor: "start" | "middle" | "end";
  label: string;
}

export function estimateLabelWidth(
  label: string,
  fontSize: number,
  avgCharWidth = 0.6
): number {
  return label.length * fontSize * avgCharWidth;
}

/** Largest font size (1px steps) from `start` down to `min` whose estimated width fits `maxWidth`. */
export function fitFontSize(
  text: string,
  maxWidth: number,
  start: number,
  min: number,
  avgCharWidth = 0.6
): number {
  let size = start;
  while (
    size > min &&
    estimateLabelWidth(text, size, avgCharWidth) > maxWidth
  ) {
    size -= 1;
  }
  return Math.max(size, Math.min(min, start));
}

interface Placed extends Tick {
  left: number;
  right: number;
}

function place(input: TickInput, index: number, avg: number): Placed {
  const label = input.labelOf(index);
  const w = estimateLabelWidth(label, input.fontSize, avg);
  const cx = input.positionOf(index);
  if (cx - w / 2 < 0) {
    return { index, x: 0, anchor: "start", label, left: 0, right: w };
  }
  if (cx + w / 2 > input.width) {
    return {
      index,
      x: input.width,
      anchor: "end",
      label,
      left: input.width - w,
      right: input.width,
    };
  }
  return {
    index,
    x: cx,
    anchor: "middle",
    label,
    left: cx - w / 2,
    right: cx + w / 2,
  };
}

export function selectTicks(input: TickInput): Tick[] {
  const { count } = input;
  if (count <= 0) return [];
  const gap = input.minGap ?? 8;
  const avg = input.avgCharWidth ?? 0.6;
  const last = count - 1;
  const strip = (p: Placed): Tick => ({
    index: p.index,
    x: p.x,
    anchor: p.anchor,
    label: p.label,
  });
  if (count === 1) return [strip(place(input, 0, avg))];
  const clash = (a: Placed, b: Placed) => b.left - a.right < gap;

  for (let k = 1; k < count; k++) {
    const picked: Placed[] = [];
    for (let i = 0; i < count; i += k) picked.push(place(input, i, avg));
    if (picked[picked.length - 1].index !== last) {
      const lastP = place(input, last, avg);
      // The last day matters more than the tick before it.
      while (picked.length >= 1 && clash(picked[picked.length - 1], lastP)) {
        picked.pop();
      }
      picked.push(lastP);
    }
    if (picked[0].index !== 0) continue; // the first point had to go: widen the step
    let ok = true;
    for (let j = 1; j < picked.length; j++) {
      if (clash(picked[j - 1], picked[j])) {
        ok = false;
        break;
      }
    }
    if (ok) return picked.map(strip);
  }
  return [strip(place(input, last, avg))];
}
