"use client";

import { useState } from "react";
import type { UploadRestaurantScope } from "@/lib/restaurant/cost-workbook/scope";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import type { RestaurantLocationOption } from "@/lib/restaurant/restaurant-context-server";
import { CostImportCleanup } from "./import-history";
import { CostUploadForm } from "./upload-form";

export function CostUploadPageClient({
  lang,
  locations,
  scope,
  companyName,
  canManageReset,
}: {
  lang: PreferredLanguage;
  locations: RestaurantLocationOption[];
  scope: UploadRestaurantScope;
  companyName: string | null;
  canManageReset: boolean;
}) {
  const [version, setVersion] = useState(0);
  return (
    <>
      <CostUploadForm
        lang={lang}
        locations={locations}
        scope={scope}
        onCatalogChange={() => setVersion((value) => value + 1)}
      />
      <CostImportCleanup
        lang={lang}
        locations={locations}
        scope={scope}
        companyName={companyName}
        canManageReset={canManageReset}
        version={version}
      />
    </>
  );
}
