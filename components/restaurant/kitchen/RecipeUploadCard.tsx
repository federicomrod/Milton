"use client";

// components/restaurant/kitchen/RecipeUploadCard.tsx
//
// «Sube tus recetas»: pick files, upload them ONE AT A TIME (one request per
// file), show a row per file and a summary at the end. Everything becomes a
// draft to review below; nothing is approved here. Shown only to people with
// the manage-drafts flag (the server computes it; no role rules here).

import { RECIPE_UPLOAD_INTRO } from "@/lib/restaurant/ui-copy";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { userErrorMessage } from "@/lib/restaurant/user-error";
import {
  FILE_TOO_BIG_MESSAGE_CLIENT,
  MAX_UPLOAD_BYTES_CLIENT,
  UPLOAD_ACCEPT,
  isImageFile,
  shrinkImage,
  summarizeUploads,
  type UploadResultLike,
} from "@/lib/restaurant/recipe-upload-client";

type RowState =
  | { status: "reading" }
  | { status: "waiting" }
  | { status: "ok"; recipes: number }
  | { status: "error"; message: string };

interface Row {
  key: string;
  name: string;
  state: RowState;
}

const GENERIC_ERROR = "No pude leer este archivo. Inténtalo de nuevo.";

export type RecipeUploadCardHandle = {
  openPicker: () => void;
  uploadFiles: (files: FileList | File[]) => void;
};

export const RecipeUploadCard = forwardRef<
  RecipeUploadCardHandle,
  {
    canManage: boolean;
    locations: { id: string; name: string }[];
    /** Called once all files finished, so the drafts list reloads. */
    onDone?: () => void;
    /** Section embed: no card chrome; the page header owns «Subir recetas». */
    embedded?: boolean;
  }
>(function RecipeUploadCard(
  { canManage, locations, onDone, embedded = false },
  ref
) {
  // The person's own pick; until then the restaurant selected in Cocina
  // (?location=…), else the first one. Derived, no effect.
  const searchParams = useSearchParams();
  const [picked, setPicked] = useState<string | null>(null);
  const wanted = searchParams?.get("location") ?? null;
  const locationId =
    picked && locations.some((l) => l.id === picked)
      ? picked
      : wanted && locations.some((l) => l.id === wanted)
        ? wanted
        : (locations[0]?.id ?? "");
  const setLocationId = setPicked;
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const setRow = (key: string, state: RowState) =>
    setRows((all) => all.map((r) => (r.key === key ? { ...r, state } : r)));

  const uploadOne = async (
    file: File,
    key: string
  ): Promise<UploadResultLike | null> => {
    setRow(key, { status: "reading" });
    if (!isImageFile(file) && file.size > MAX_UPLOAD_BYTES_CLIENT) {
      setRow(key, { status: "error", message: FILE_TOO_BIG_MESSAGE_CLIENT });
      return null;
    }
    try {
      const toSend = isImageFile(file) ? await shrinkImage(file) : file;
      if (toSend.size > MAX_UPLOAD_BYTES_CLIENT) {
        setRow(key, { status: "error", message: FILE_TOO_BIG_MESSAGE_CLIENT });
        return null;
      }
      const form = new FormData();
      form.append("file", toSend, toSend.name);
      if (locationId) form.append("location_id", locationId);
      const res = await fetch("/api/restaurant/kitchen/recipe-upload", {
        method: "POST",
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as UploadResultLike & {
        error?: string;
        errors?: string[];
      };
      if (!res.ok) {
        setRow(key, {
          status: "error",
          message: userErrorMessage(data, GENERIC_ERROR),
        });
        return null;
      }
      const found = data.recipes_found ?? 0;
      if (found === 0) {
        setRow(key, {
          status: "error",
          message: data.errors?.[0] || "No encontré recetas en este archivo.",
        });
        return data;
      }
      setRow(key, { status: "ok", recipes: found });
      return data;
    } catch {
      setRow(key, { status: "error", message: GENERIC_ERROR });
      return null;
    }
  };

  const onPick = async (list: FileList | File[] | null) => {
    const files = Array.from(list ?? []);
    if (inputRef.current) inputRef.current.value = "";
    if (files.length === 0 || busy) return;
    setBusy(true);
    setSummary(null);
    const batch = files.map((f, i) => ({
      file: f,
      key: `${Date.now()}-${i}`,
    }));
    setRows(
      batch.map((b) => ({
        key: b.key,
        name: b.file.name,
        state: { status: "waiting" },
      }))
    );
    const results: UploadResultLike[] = [];
    for (const b of batch) {
      const r = await uploadOne(b.file, b.key);
      if (r) results.push(r);
    }
    setSummary(summarizeUploads(results, batch.length));
    setBusy(false);
    onDone?.();
  };

  useImperativeHandle(ref, () => ({
    openPicker: () => inputRef.current?.click(),
    uploadFiles: (files) => void onPick(files),
  }));

  if (!canManage) return null;

  const picker = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {locations.length > 1 ? (
          <select
            aria-label="Local"
            value={locationId}
            disabled={busy}
            onChange={(e) => setLocationId(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          data-testid="recipe-upload-input"
          accept={UPLOAD_ACCEPT}
          onChange={(e) => void onPick(e.target.files)}
        />
        {embedded ? null : (
          <Button
            type="button"
            disabled={busy}
            className="bg-[#1B40C8] text-white hover:bg-[#1533A3]"
            onClick={() => inputRef.current?.click()}
          >
            Elegir archivos
          </Button>
        )}
      </div>

      {rows.length > 0 ? (
        <ul className="space-y-1 text-sm" data-testid="recipe-upload-rows">
          {rows.map((row) => (
            <li
              key={row.key}
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <span className="min-w-0 truncate">{row.name}</span>
              {row.state.status === "reading" ? (
                <span className="inline-flex items-center gap-1 text-[#6b7280]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Leyendo…
                </span>
              ) : row.state.status === "waiting" ? (
                <span className="text-[#6b7280]">En espera</span>
              ) : row.state.status === "ok" ? (
                <span className="text-[#1B40C8]">
                  ✓ {row.state.recipes}{" "}
                  {row.state.recipes === 1 ? "receta" : "recetas"}
                </span>
              ) : (
                <span className="text-red-600">✗ {row.state.message}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {summary ? (
        <div
          data-testid="recipe-upload-summary"
          className="space-y-1 rounded-md border border-[#dfe3ea] bg-[#f6f8fe] px-3 py-2 text-sm"
        >
          {summary.map((line, i) => (
            <p key={i} className={i === 0 ? "font-semibold" : ""}>
              {line}
            </p>
          ))}
        </div>
      ) : null}
    </>
  );

  if (embedded) {
    return (
      <div data-testid="recipe-upload-card" className="space-y-3">
        {picker}
      </div>
    );
  }

  return (
    <Card data-testid="recipe-upload-card">
      <CardHeader>
        <CardTitle>Sube tus recetas</CardTitle>
        <CardDescription>{RECIPE_UPLOAD_INTRO}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">{picker}</CardContent>
    </Card>
  );
});
