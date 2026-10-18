"use client";

// Error boundary of every /dashboard/restaurant/* page: it renders inside the
// restaurant layout, so the sidebar stays and the person gets «Reintentar».
import { RouteError } from "@/components/restaurant/shell/RouteError";

export default function RestaurantRouteError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} />;
}
