"use client";

// «Merma de cocina» (kitchen buffer) per restaurant, on Costos. Shows the %
// in force today («5 % (predeterminado)» when no saved row applies) and, for
// owner / admin / manager only, one tap to change it (0–30) with the choice
// «Solo desde hoy» / «Aplicar a semanas anteriores» (confirmed first) and the
// history under it. Everyone else reads it only. Configuración shows the same
// value and links here (#merma-cocina).

import { useT } from "@/lib/i18n/client";
import type { HistoryLine } from "@/lib/restaurant/kitchen-buffer-server";
import { MermaField } from "@/components/restaurant/costs/MermaField";
import { BUFFER_ANCHOR, pctText } from "@/lib/restaurant/merma-format";

export interface BufferLine {
  locationId: string;
  name: string;
  bufferPct: number;
  isDefault: boolean;
  history?: HistoryLine[];
}

function Row({
  line,
  showName,
  canEdit,
}: {
  line: BufferLine;
  showName: boolean;
  canEdit: boolean;
}) {
  const { d, lang, fmt } = useT();
  const b = d.costs.buffer;
  return (
    <li className="min-w-0 py-1.5">
      <MermaField
        endpoint="/api/restaurant/kitchen-buffer"
        buildBody={(pct, scope) => ({
          locationId: line.locationId,
          bufferPct: pct,
          scope,
        })}
        currentPct={line.bufferPct}
        max={30}
        canEdit={canEdit}
        history={line.history ?? []}
        idPrefix={`buffer-${line.locationId}`}
        strings={{
          change: b.change,
          pctLabel: b.pctLabel,
          invalid: b.invalid,
          saveFailed: b.saveFailed,
        }}
        valueNode={
          <>
            {showName ? (
              <span className="text-[13px] font-semibold text-[#0F172A]">
                {line.name}
              </span>
            ) : null}
            <span className="text-[14px] text-[#0F172A]">
              {fmt(b.line, { pct: pctText(line.bufferPct, lang) })}
              {line.isDefault ? (
                <span className="ml-1.5 text-[12px] text-[#6b7385]">
                  {b.defaultTag}
                </span>
              ) : null}
            </span>
          </>
        }
      />
    </li>
  );
}

export function KitchenBufferCard({
  lines,
  canEdit,
}: {
  lines: BufferLine[];
  canEdit: boolean;
}) {
  const { d } = useT();
  const b = d.costs.buffer;
  if (lines.length === 0) return null;
  return (
    <section
      id={BUFFER_ANCHOR}
      aria-label={b.pctLabel}
      data-testid="kitchen-buffer"
      className="min-w-0 scroll-mt-4 rounded-[14px] border border-[#dbe3f7] bg-white px-4 py-3"
    >
      <ul className="divide-y divide-[#eef1f8]">
        {lines.map((l) => (
          <Row
            key={l.locationId}
            line={l}
            showName={lines.length > 1}
            canEdit={canEdit}
          />
        ))}
      </ul>
      <p className="mt-1 text-[12px] text-[#8a92a3]">
        {b.help}
        {canEdit ? "" : ` ${b.readOnly}`}
      </p>
    </section>
  );
}
