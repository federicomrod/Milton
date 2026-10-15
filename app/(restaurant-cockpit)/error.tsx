"use client";

// Error boundary of the Cockpit group: inside the group's layout (sidebar stays).
import { RouteError } from "@/components/restaurant/shell/RouteError";

export default function CockpitRouteError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} />;
}
