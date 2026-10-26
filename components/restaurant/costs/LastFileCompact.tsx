// components/restaurant/costs/LastFileCompact.tsx
//
// Compact version of «Último archivo» for the right column: one line with the
// file name (truncated with an ellipsis), then «· N líneas · M recetas» in
// small muted text and a «Ver» link.

"use client";

import { useState, useEffect } from "react";
import { ageLabel } from "@/lib/restaurant/costs-setup-client";

type Upload = {
  id: string;
  filename: string;
  created_at: string | null;
  has_candidate_blocks?: boolean;
};

export function LastFileCompact({
  upload,
  onView,
}: {
  upload: Upload | null;
  onView: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(interval);
  }, []);

  if (!upload) {
    return (
      <section className="rounded-lg border border-[#dfe3ea] bg-white p-3">
        <h2 className="text-[13px] font-bold text-[#151c2c] mb-2">
          Último archivo
        </h2>
        <p className="text-[12px] text-[#5B6570]">Aún no subes uno</p>
        <button
          type="button"
          onClick={onView}
          className="mt-2 w-full rounded-lg border border-[#1B40C8] bg-white px-3 py-2 text-center text-[13px] font-semibold text-[#1B40C8] hover:bg-[#E7EDFD]"
        >
          Subir archivo
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-[#dfe3ea] bg-white p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="text-[13px] font-bold text-[#151c2c]">Último archivo</h2>
        <button
          type="button"
          onClick={onView}
          className="text-[12px] font-semibold text-[#1B40C8] hover:underline"
        >
          Ver
        </button>
      </div>
      <p className="text-[12px] text-[#151c2c] truncate">{upload.filename}</p>
      <p className="text-[11px] text-[#5B6570] mt-0.5">
        {ageLabel(upload.created_at, now)}
      </p>
    </section>
  );
}
