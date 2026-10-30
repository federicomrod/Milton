"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/client";
// R1-15g (F4): "✦ Milton sugiere: Refrescos · 4, Cervezas · 9…" as dashed
// chips. A click previews (the list narrows to those items), then Aplicar.

import type { SuggestedCluster } from "./use-milton-suggestions";

const MAX_CHIPS = 8;

export function MiltonSuggestions({
  clusters,
  preview,
  onPreview,
  onApply,
  onDismiss,
  onEndPreview,
  onAskAi,
  aiBusy,
  canAskAi,
  itemWord,
}: {
  clusters: readonly SuggestedCluster[];
  preview: SuggestedCluster | null;
  onPreview: (c: SuggestedCluster) => void;
  /** The name is the person's to change before accepting. */
  onApply: (c: SuggestedCluster, name: string) => void;
  onDismiss: (c: SuggestedCluster) => void;
  onEndPreview: () => void;
  onAskAi: () => void;
  aiBusy: boolean;
  canAskAi: boolean;
  itemWord?: string;
}) {
  const { d, fmt } = useT();
  const g = d.menu.groups.suggestions;
  if (clusters.length === 0 && !canAskAi && !preview) return null;
  return (
    <div
      className="space-y-2 rounded-xl border border-[#dbe3f7] bg-[#f6f8fe] px-3 py-2"
      data-testid="milton-suggestions"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-bold text-[#1b40c8]">
          ✦ {g.title}
        </span>
        {clusters.slice(0, MAX_CHIPS).map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => onPreview(c)}
            aria-pressed={preview?.key === c.key}
            title={
              c.reason === "nombre"
                ? g.reasonName
                : c.reason === "categoria"
                  ? g.reasonCategory
                  : g.reasonDefault
            }
            className={
              "rounded-full border border-dashed px-3 py-1 text-[12px] font-semibold " +
              (preview?.key === c.key
                ? "border-[#1b40c8] bg-[#1b40c8] text-white"
                : "border-[#1b40c8] bg-white text-[#1b40c8] hover:bg-[#e6ecfb]")
            }
          >
            {c.name} · {c.refs.length}
          </button>
        ))}
        {clusters.length > MAX_CHIPS ? (
          <span className="text-[12px] text-[#6b7a9e]">
            {fmt(g.more, { n: clusters.length - MAX_CHIPS })}
          </span>
        ) : null}
        {canAskAi ? (
          <button
            type="button"
            onClick={onAskAi}
            disabled={aiBusy}
            className="ml-auto rounded-lg border border-[#1b40c8] bg-white px-3 py-1 text-[12px] font-semibold text-[#1b40c8] hover:bg-[#e6ecfb] disabled:opacity-60"
          >
            {aiBusy ? g.thinking : `✦ ${g.askMore}`}
          </button>
        ) : null}
      </div>
      {preview ? (
        <PreviewBanner
          key={preview.key}
          preview={preview}
          itemWord={itemWord ?? g.itemProducts}
          onApply={onApply}
          onDismiss={onDismiss}
          onEndPreview={onEndPreview}
        />
      ) : null}
    </div>
  );
}

/** The mark on a group that Milton suggested and a person accepted. */
export function MiltonMark() {
  const { d } = useT();
  return (
    <span className="rounded-md bg-[#e6ecfb] px-1.5 py-0.5 text-[11px] font-semibold text-[#1b40c8]">
      ✦ {d.menu.groups.suggestions.mark}
    </span>
  );
}

function PreviewBanner({
  preview,
  itemWord,
  onApply,
  onDismiss,
  onEndPreview,
}: {
  preview: SuggestedCluster;
  itemWord: string;
  onApply: (c: SuggestedCluster, name: string) => void;
  onDismiss: (c: SuggestedCluster) => void;
  onEndPreview: () => void;
}) {
  const { d, fmt } = useT();
  const g = d.menu.groups.suggestions;
  const [name, setName] = useState(preview.name);
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-3 py-2 text-[13px]"
      role="status"
    >
      <span>{fmt(g.preview, { n: preview.refs.length, items: itemWord })}</span>
      <label className="flex items-center gap-1.5">
        <span className="text-[#6b7a9e]">{g.nameLabel}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) onApply(preview, name);
          }}
          aria-label={g.nameAria}
          className="w-52 rounded-md border border-[#a9bcf0] px-2 py-1 font-semibold text-[#151c2c] outline-none focus:border-[#1b40c8]"
        />
      </label>
      <span className="ml-auto flex gap-2">
        <button
          type="button"
          disabled={!name.trim()}
          onClick={() => onApply(preview, name)}
          className="rounded-lg bg-[#2f5be0] px-3 py-1 font-semibold text-white hover:bg-[#1b40c8] disabled:opacity-50"
        >
          {g.apply}
        </button>
        <button
          type="button"
          onClick={() => onDismiss(preview)}
          className="rounded-lg border border-[#c6d3f5] px-3 py-1 font-semibold text-[#4a5a85]"
        >
          {g.dismiss}
        </button>
        <button
          type="button"
          onClick={onEndPreview}
          className="px-1 text-[#6b7a9e]"
          aria-label={g.closePreview}
        >
          ×
        </button>
      </span>
    </div>
  );
}
