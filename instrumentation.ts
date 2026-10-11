export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { installCockpitServerTiming } =
    await import("@/lib/restaurant/cockpit-timing");
  installCockpitServerTiming();
}
