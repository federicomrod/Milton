import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // R1-14: a section prefetched in full (`<Link prefetch>`: Cockpit, Ventas,
    // Menú, Costos) is reused for a minute, so the click is instant. Pages
    // that are not prefetched in full keep the default (always fresh). A copy
    // never outlives a save: section links carry a save epoch (see
    // lib/restaurant/save-epoch.ts), so after a write the next click is a
    // different URL and renders fresh.
    staleTimes: { static: 60 },
  },
};

export default nextConfig;
