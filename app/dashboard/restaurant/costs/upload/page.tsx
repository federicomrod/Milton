// Server wrapper so the upload form knows which restaurant is selected.
// The switcher lives in the restaurant shell; we refuse "Todos los
// restaurantes" when the company has more than one location.

import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";
import { resolveUploadRestaurantScope } from "@/lib/restaurant/cost-workbook";
import { CostUploadForm } from "./upload-form";

export default async function CostUploadPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string }>;
}) {
  const params = await searchParams;
  const chrome = await loadRestaurantShellChrome();
  const scope = resolveUploadRestaurantScope({
    locations: chrome.locations,
    requestedLocationId: params.location ?? null,
  });

  return (
    <CostUploadForm
      lang={chrome.lang}
      locations={chrome.locations}
      scope={scope}
    />
  );
}
