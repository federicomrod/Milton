"use client";

// Menú › Platos / Preparaciones: a small secondary link to Cocina › Explorar ›
// «Recetas en borrador», where files are uploaded. Shown only with the
// manage-drafts flag the server already sent (no role rules here).

import Link from "next/link";

export function uploadRecipesHref(locationId?: string | null): string {
  const params = new URLSearchParams({ tab: "drafts" });
  if (locationId) params.set("location", locationId);
  return `/dashboard/restaurant/kitchen?${params.toString()}#explorar`;
}

export function UploadRecipesLink({
  actor,
  locationId,
  className = "",
}: {
  actor: {
    can_submit?: boolean;
    capabilities?: Record<string, boolean> | null;
  };
  locationId?: string | null;
  className?: string;
}) {
  const allowed = actor.capabilities?.["kitchen.drafts"] ?? actor.can_submit;
  if (!allowed) return null;
  return (
    <Link
      href={uploadRecipesHref(locationId)}
      data-testid="upload-recipes-link"
      className={
        "inline-flex items-center rounded-md border border-[#1B40C8] bg-white px-2.5 py-1 text-[12px] font-semibold text-[#1B40C8] hover:bg-[#f6f8fe] " +
        className
      }
    >
      Subir recetas
    </Link>
  );
}
