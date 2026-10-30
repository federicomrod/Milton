"use client";

// Configuración › Objetivos: the targets read-only on load (0 clicks), with the
// default/reference value when a target is unset; «Editar» opens the existing
// ObjetivosForm in place. «Aplica a» stays on the page.

import {
  COMPARISON_LABEL,
  type Comparison,
} from "@/lib/restaurant/cockpit-comparison";
import { pickTargetRow } from "@/lib/restaurant/objetivos";
import { formatMoneyEs } from "@/lib/restaurant/recipe-costing/format";
import { formatTypedNumber } from "@/lib/restaurant/locale-number";
import { fmt } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import { ConfigValue } from "../ConfigSection";
import { InlineEditCard } from "../InlineEditCard";
import { AppliesTo } from "@/components/restaurant/settings/AppliesTo";
import {
  ObjetivosForm,
  type ObjetivosFormProps,
} from "@/components/restaurant/settings/ObjetivosForm";

export function ObjetivosCard(props: ObjetivosFormProps) {
  const { d, lang } = useT();
  const s = d.config.shared;
  const g = d.config.goals;
  const money = (n: number, decimals = 0) =>
    formatMoneyEs(n, props.currency, { decimals }, lang);
  const pct = (n: number) =>
    `${formatTypedNumber(Math.round(n * 10) / 10, lang)} %`;

  const rowOf = (metric: Parameters<typeof pickTargetRow>[1]) =>
    pickTargetRow(props.rows, metric, props.today, props.applyTo);
  const revenue = rowOf("revenue");
  const monthly = revenue?.target_period === "monthly" ? revenue : null;

  /** The value, or the company-wide one marked as such, or the default, or «Falta». */
  const show = (
    own: number | null,
    inherited: number | null,
    fallback: number | null,
    format: (n: number) => string
  ): React.ReactNode => {
    if (own !== null) return format(own);
    if (inherited !== null)
      return fmt(g.inheritedAll, { value: format(inherited) });
    if (fallback !== null)
      return (
        <span className="font-normal text-[#64748B]">
          {fmt(g.defaultValue, { value: format(fallback) })}
        </span>
      );
    return null;
  };
  const level = (m: "food_cost_pct" | "gross_margin_pct" | "avg_ticket") => {
    const r = rowOf(m);
    return {
      own: r && r.location_id === props.applyTo ? r.target_value : null,
      inherited: r && r.location_id !== props.applyTo ? r.target_value : null,
    };
  };
  const food = level("food_cost_pct");
  const margin = level("gross_margin_pct");
  const ticket = level("avg_ticket");

  const summary = (
    <>
      <ConfigValue
        label={g.monthlySales}
        missing={s.missing}
        value={show(
          monthly ? monthly.target_value : null,
          null,
          props.refs.avgMonthly6,
          (n) => money(n)
        )}
      />
      <ConfigValue
        label={g.foodCost}
        missing={s.missing}
        value={show(
          food.own,
          food.inherited,
          props.cost30?.food_cost_pct ?? null,
          pct
        )}
      />
      <ConfigValue
        label={g.grossMargin}
        missing={s.missing}
        value={show(
          margin.own,
          margin.inherited,
          props.cost30?.gross_margin_pct ?? null,
          pct
        )}
      />
      <ConfigValue
        label={g.avgTicket}
        missing={s.missing}
        value={show(ticket.own, ticket.inherited, props.refs.ticket30, (n) =>
          money(n, 2)
        )}
      />
      <ConfigValue
        label={g.comparison}
        missing={s.missing}
        value={COMPARISON_LABEL[props.defaultComparison as Comparison]}
      />
    </>
  );

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <AppliesTo restaurants={props.restaurants} value={props.applyTo} />
      </div>
      <InlineEditCard
        // A different restaurant is a different form: start it from its own targets.
        key={props.applyTo ?? "todos"}
        summary={summary}
        canEdit={props.canEdit}
        readOnlyNote={s.readOnly}
      >
        <ObjetivosForm {...props} />
      </InlineEditCard>
    </div>
  );
}
