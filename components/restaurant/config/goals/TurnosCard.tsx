"use client";

// Configuración › Turnos: one compact table per restaurant, read-only on load;
// «Editar turnos» opens the existing TurnosForm for that restaurant in place.

import {
  cutoffMinutes,
  crossingCutoff,
  minutesToTime,
  type Shift,
} from "@/lib/restaurant/business-day";
import { useT } from "@/lib/i18n/client";
import { InlineEditCard } from "../InlineEditCard";
import {
  TurnosForm,
  weekdaysLabel,
} from "@/components/restaurant/settings/TurnosForm";

const hhmm = (t: string) => t.slice(0, 5);

function ShiftsTable({ shifts }: { shifts: Shift[] }) {
  const { d, lang } = useT();
  const g = d.config.goals.shifts;
  const ds = d.settings.shifts;
  if (shifts.length === 0) {
    return <p className="text-sm text-[#64748B]">{g.none}</p>;
  }
  const cutoff = minutesToTime(cutoffMinutes(shifts));
  return (
    <div className="space-y-2">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-[#E5E7EB] text-[12px] font-medium text-[#64748B]">
            <th className="py-1.5 pr-2 font-medium">{g.colShift}</th>
            <th className="py-1.5 pr-2 font-medium">{g.colHours}</th>
            <th className="py-1.5 pr-2 font-medium">{g.colDays}</th>
            <th className="py-1.5 font-medium">{g.colActive}</th>
          </tr>
        </thead>
        <tbody>
          {shifts.map((s, i) => (
            <tr key={i} className="border-b border-[#E5E7EB] last:border-0">
              <td className="break-words py-2 pr-2 font-medium">{s.name}</td>
              <td className="py-2 pr-2">
                {hhmm(s.start_time)}–{hhmm(s.end_time)}
              </td>
              <td className="py-2 pr-2">{weekdaysLabel(s.weekdays, lang)}</td>
              <td className="py-2">
                {s.active ? (
                  <span className="rounded-full bg-[#A7F3D0] px-2 py-0.5 text-[12px] font-medium">
                    {g.yes}
                  </span>
                ) : (
                  <span className="text-[#64748B]">{g.no}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[13px] text-[#64748B]" data-testid="turnos-cutoff-ro">
        {ds.cutoffPrefix}
        <b className="text-[#0F172A]">{cutoff}</b>
        {crossingCutoff(shifts) !== null ? ds.cutoffCrossing : ds.cutoffDefault}
        {ds.cutoffSuffix}
      </p>
    </div>
  );
}

export function TurnosCard({
  restaurants,
  shiftsByRestaurant,
  available,
  canEdit,
}: {
  restaurants: Array<{ id: string; name: string }>;
  shiftsByRestaurant: Record<string, Shift[]>;
  available: boolean;
  canEdit: boolean;
}) {
  const { d } = useT();
  const s = d.config.shared;
  const g = d.config.goals.shifts;
  if (restaurants.length === 0) {
    return <p className="text-sm text-[#64748B]">{g.noRestaurants}</p>;
  }
  return (
    <div className="space-y-5">
      {restaurants.map((r) => (
        <div key={r.id} className="space-y-2" data-testid={`turnos-${r.id}`}>
          <h3 className="break-words text-sm font-semibold">{r.name}</h3>
          <InlineEditCard
            summary={<ShiftsTable shifts={shiftsByRestaurant[r.id] ?? []} />}
            canEdit={canEdit}
            readOnlyNote={s.readOnly}
            editLabel={g.edit}
          >
            <TurnosForm
              restaurants={[r]}
              shiftsByRestaurant={{ [r.id]: shiftsByRestaurant[r.id] ?? [] }}
              available={available}
              canEdit={canEdit}
            />
          </InlineEditCard>
        </div>
      ))}
    </div>
  );
}
