"use client";

// components/restaurant/kitchen/KitchenRecipesSection.tsx
//
// Always-visible Recetas block: upload + review list. Dropping a file on
// the section opens the existing upload. The file input is never inside a
// display:none ancestor.

import { RECIPE_UPLOAD_INTRO } from "@/lib/restaurant/ui-copy";
import { useRef, useState, type DragEvent } from "react";
import { useT } from "@/lib/i18n/client";
import { t } from "@/lib/restaurant/language";
import { KitchenRecipeDraftsCard } from "./KitchenRecipeDraftsCard";
import {
  RecipeUploadCard,
  type RecipeUploadCardHandle,
} from "./RecipeUploadCard";

export function KitchenRecipesSection({
  canManage,
  locations,
  focusDraftId,
  onFocusConsumed,
}: {
  canManage: boolean;
  locations: { id: string; name: string }[];
  focusDraftId?: string | null;
  onFocusConsumed?: () => void;
}) {
  const { lang } = useT();
  const uploadRef = useRef<RecipeUploadCardHandle>(null);
  const [uploadTick, setUploadTick] = useState(0);

  const onDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    if (!canManage) return;
    const files = e.dataTransfer.files;
    if (files.length > 0) uploadRef.current?.uploadFiles(files);
  };

  return (
    <section
      id="recetas"
      data-testid="kitchen-recipes"
      onDragOver={(e) => {
        if (canManage) e.preventDefault();
      }}
      onDrop={onDrop}
      className="rounded-md border border-border bg-background px-3 py-3 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[#0D1117]">
          {t(lang, "Recipes", "Recetas", "Rezepte")}
        </h2>
        {canManage ? (
          <button
            type="button"
            data-testid="kitchen-recipes-upload"
            className="inline-flex w-full items-center justify-center rounded-md bg-[#1B40C8] px-3 py-2 text-sm font-medium text-white hover:bg-[#1533A3] sm:w-auto"
            onClick={() => uploadRef.current?.openPicker()}
          >
            {t(lang, "Upload recipes", "Subir recetas", "Rezepte hochladen")}
          </button>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">
        {t(
          lang,
          "Upload your recipes as Excel, Word, PDF or a photo. Milton prepares the drafts and you approve them.",
          RECIPE_UPLOAD_INTRO,
          "Laden Sie Ihre Rezepte als Excel, Word, PDF oder Foto hoch. Milton erstellt die Entwürfe und Sie geben sie frei."
        )}
      </p>
      <RecipeUploadCard
        ref={uploadRef}
        embedded
        canManage={canManage}
        locations={locations}
        onDone={() => setUploadTick((n) => n + 1)}
      />
      <KitchenRecipeDraftsCard
        canManage={canManage}
        locations={locations}
        focusDraftId={focusDraftId}
        onFocusConsumed={onFocusConsumed}
        reloadSignal={uploadTick}
      />
    </section>
  );
}
