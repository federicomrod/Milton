"use client";

// R1-15d (mocks 3, 4, 8): the drill view of one menu dish. Pick a dimension
// (Tamaño / Acompañante / Punto / Canal), narrow it with chips on the others,
// cross it with a second one (heatmap), and group values ("Papas" = Papas
// fritas + Puré + Papa al horno). All of it is a client-side group-by over the
// dish's variant rows already loaded: no spinner, no request. The grouping
// itself saves like every other group (optimistic, with «Deshacer»).

import { useMemo, useState } from "react";
import {
  DRILL_DIMENSIONS,
  applyFilters,
  crossTab,
  dimensionValues,
  drillRows,
  valueGroupsFor,
  type DrillDimension,
  type DrillFilters,
  type DrillRow,
  type ValueGroup,
} from "@/lib/restaurant/menu-dishes/drill";
import type { MenuDishVariant } from "@/lib/restaurant/menu-dishes/menu-dishes";
import {
  addToGroup,
  createGroup,
  removeFromGroups,
  renameGroup,
  ungroupGroup,
  type ItemRef,
} from "@/lib/restaurant/groups/group-ops";
import { marginLabel, costPctLabel } from "@/lib/restaurant/costing/rollup";
import { GroupToastView } from "@/components/restaurant/groups/GroupingControls";
import type { useItemGroups } from "@/components/restaurant/groups/use-item-groups";

const COLORS = [
  "#1b40c8",
  "#151c2c",
  "#8a92a3",
  "#e8b98a",
  "#4a5a7a",
  "#c9704a",
];
const uuid = () => crypto.randomUUID();

const dimLabel = (d: DrillDimension) =>
  DRILL_DIMENSIONS.find((x) => x.id === d)!.label;
const pct = (n: number) =>
  n > 0 && n < 1 ? "<1%" : `${Math.round(n * 10) / 10}%`.replace(".0%", "%");

interface FilterChoice {
  label: string;
  values: readonly string[];
}

export function DrillView({
  title,
  variants: allVariants,
  scopeId,
  menuSales,
  grouping,
  canEdit,
  money,
  onBack,
  onOpenRecipe,
}: {
  /** A dish's name, or a group's. */
  title: string;
  /** The variant rows to break down (a dish's, or every member of a group). */
  variants: MenuDishVariant[];
  /** The stored menu dish whose value groups apply; null = a product group (global value groups only). */
  scopeId: string | null;
  /** Sales of every dish in view, for "x% del menú". */
  menuSales: number;
  grouping: ReturnType<typeof useItemGroups>;
  canEdit: boolean;
  money: (n: number) => string;
  onBack: () => void;
  onOpenRecipe?: () => void;
}) {
  const [dim, setDim] = useState<DrillDimension>("side");
  const [cross, setCross] = useState<DrillDimension | null>(null);
  const [choices, setChoices] = useState<
    Partial<Record<DrillDimension, FilterChoice>>
  >({});
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(false);

  const filters: DrillFilters = Object.fromEntries(
    Object.entries(choices).map(([d, c]) => [d, c.values])
  );
  const groupsOf = (d: DrillDimension): ValueGroup[] =>
    valueGroupsFor(
      grouping.state.groups,
      grouping.state.members,
      d,
      scopeId ?? "__global__"
    );
  const dimGroups = useMemo(
    () => groupsOf(dim),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grouping.state, dim, scopeId]
  );
  const crossGroups = useMemo(
    () => (cross ? groupsOf(cross) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grouping.state, cross, scopeId]
  );

  // A filter on the dimension being shown would leave one row: it narrows the others.
  const variants = useMemo(
    () => applyFilters(allVariants, filters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allVariants, choices]
  );
  const { rows, total } = useMemo(
    () => drillRows(variants, dim, dimGroups),
    [variants, dim, dimGroups]
  );
  const table = useMemo(
    () =>
      cross && cross !== dim
        ? crossTab(variants, cross, dim, crossGroups, dimGroups)
        : null,
    [variants, cross, dim, crossGroups, dimGroups]
  );

  const setChoice = (d: DrillDimension, choice: FilterChoice | null) =>
    setChoices((prev) => {
      const next = { ...prev };
      if (choice) next[d] = choice;
      else delete next[d];
      return next;
    });

  const pathText = [
    cross && cross !== dim
      ? `${dimLabel(cross).toLowerCase()} × ${dimLabel(dim).toLowerCase()}`
      : `por ${dimLabel(dim).toLowerCase()}`,
    Object.keys(choices).length === 0
      ? "todos los tamaños"
      : Object.values(choices)
          .map((c) => c.label)
          .join(" · "),
  ].join(" · ");

  const miltonGroups = dimGroups.filter((g) => g.byMilton);
  const share = menuSales > 0 ? (total.net_sales / menuSales) * 100 : null;

  return (
    <div className="space-y-[14px]" data-testid="drill-view">
      <nav className="text-[14px] text-[#6b7385]">
        <button
          type="button"
          onClick={onBack}
          className="font-semibold text-[#1b40c8] hover:underline"
        >
          Platos
        </button>{" "}
        ›{" "}
        <button
          type="button"
          onClick={onOpenRecipe}
          className="font-bold text-[#151c2c] hover:underline"
        >
          {title}
        </button>{" "}
        › {pathText}
        {Object.keys(choices).length > 0 ? (
          <button
            type="button"
            onClick={() => setChoices({})}
            className="ml-3 text-[12px] font-semibold text-[#3557c9]"
          >
            Quitar filtros
          </button>
        ) : null}
      </nav>

      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Dimensión"
          className="inline-flex rounded-[11px] bg-[#e1e8fa] p-[3px] text-[13px] font-semibold"
        >
          {DRILL_DIMENSIONS.map((d) => (
            <button
              key={d.id}
              type="button"
              aria-pressed={dim === d.id}
              onClick={() => {
                setDim(d.id);
                // The dimension on screen can't also filter itself.
                setChoice(d.id, null);
                if (cross === d.id) setCross(null);
              }}
              className={
                "rounded-[9px] px-3.5 py-1.5 " +
                (dim === d.id
                  ? "bg-[#1b40c8] text-white shadow-sm"
                  : "text-[#4a5a85] hover:text-[#1b40c8]")
              }
            >
              {d.label}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-1.5 rounded-lg border border-[#dfe3ea] bg-white px-3 py-1.5 text-[13px]">
          Cruzar con:
          <select
            value={cross ?? ""}
            onChange={(e) =>
              setCross((e.target.value || null) as DrillDimension | null)
            }
            className="bg-transparent font-bold outline-none"
            aria-label="Cruzar con"
          >
            <option value="">Ninguno</option>
            {DRILL_DIMENSIONS.filter((d) => d.id !== dim).map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1">
          {DRILL_DIMENSIONS.filter((d) => d.id !== dim).map((d) => (
            <FilterChips
              key={d.id}
              label={d.label}
              values={dimensionValues(allVariants, d.id)}
              groups={groupsOf(d.id)}
              choice={choices[d.id] ?? null}
              onChoose={(c) => setChoice(d.id, c)}
            />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Kpi
          label="Ventas"
          value={money(total.net_sales)}
          sub={share !== null ? `${pct(share)} del menú` : ""}
        />
        <Kpi
          label="Unidades"
          value={Math.round(total.units).toLocaleString("es")}
          sub=""
        />
        <Kpi
          label="Margen"
          value={marginLabel(total)}
          sub={total.margin !== null ? money(total.margin) : "Sin precio"}
        />
        <Kpi label="Costo %" value={costPctLabel(total)} sub="" />
      </div>

      <section className="rounded-[14px] border border-[#dbe3f7] bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-bold">
            Ventas por {dimLabel(dim).toLowerCase()}
          </h2>
          {miltonGroups.map((g) => (
            <span
              key={g.id}
              className="rounded-md bg-[#f1f3f7] px-2 py-0.5 text-[12px] font-semibold text-[#5b6476]"
            >
              ✦ {g.name} agrupado por Milton
            </span>
          ))}
          {canEdit ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="ml-auto rounded-lg border border-[#dfe3ea] px-3 py-1.5 text-[13px] font-semibold hover:border-[#1b40c8]"
            >
              ✎ Editar agrupación
            </button>
          ) : null}
        </div>

        {rows.length === 0 || total.net_sales <= 0 ? (
          <p className="py-4 text-[13px] text-[#5b6476]">
            No hay ventas con ese filtro.
          </p>
        ) : (
          <>
            <StackedBar rows={rows} />
            <table className="mt-3 w-full text-[13px]">
              <thead>
                <tr className="text-left text-[12px] font-semibold text-[#8a92a3]">
                  <th className="px-2 py-1.5">{dimLabel(dim)}</th>
                  <th className="px-2 py-1.5 text-right">Unidades</th>
                  <th className="px-2 py-1.5 text-right">Ventas</th>
                  <th className="px-2 py-1.5 text-right">% del plato</th>
                  <th className="px-2 py-1.5 text-right">Margen</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <Rows
                    key={row.id}
                    row={row}
                    color={COLORS[i % COLORS.length]}
                    open={openGroups.has(row.id)}
                    onToggle={() =>
                      setOpenGroups((prev) => {
                        const next = new Set(prev);
                        if (next.has(row.id)) next.delete(row.id);
                        else next.add(row.id);
                        return next;
                      })
                    }
                    money={money}
                  />
                ))}
                <tr className="border-t border-[#eef0f4] font-bold">
                  <td className="px-2 py-2">Total</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {Math.round(total.units).toLocaleString("es")}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {money(total.net_sales)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">100%</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {marginLabel(total)}
                  </td>
                </tr>
              </tbody>
            </table>
          </>
        )}
      </section>

      {table && cross ? (
        <Heatmap
          table={table}
          rowDim={cross}
          colDim={dim}
          onCell={(r, c) => {
            // A click on a cell filters to that row and that column.
            const pick = (
              label: string,
              groups: ValueGroup[]
            ): FilterChoice => {
              const g = groups.find((x) => x.name === label);
              return { label, values: g ? [...g.values] : [label] };
            };
            setChoices((prev) => ({
              ...prev,
              [cross]: pick(r, crossGroups),
              [dim]: pick(c, dimGroups),
            }));
            setCross(null);
          }}
        />
      ) : null}

      {editing ? (
        <EditGroupsPanel
          title={title}
          variants={allVariants}
          scopeId={scopeId}
          dim={dim}
          grouping={grouping}
          groups={dimGroups}
          onClose={() => setEditing(false)}
        />
      ) : null}
      <GroupToastView
        toast={grouping.toast}
        onDismiss={grouping.dismissToast}
      />
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-[14px] border border-[#dbe3f7] bg-white px-4 py-[14px]">
      <div className="text-[12px] text-[#6b7385]">{label}</div>
      <div className="mt-0.5 text-[28px] font-extrabold leading-tight tracking-[-0.5px] text-[#1b2333]">
        {value}
      </div>
      <div className="mt-0.5 text-[12px] text-[#8a92a3]">{sub || " "}</div>
    </div>
  );
}

function FilterChips({
  label,
  values,
  groups,
  choice,
  onChoose,
}: {
  label: string;
  values: string[];
  groups: ValueGroup[];
  choice: FilterChoice | null;
  onChoose: (c: FilterChoice | null) => void;
}) {
  if (values.length < 2) return null;
  const grouped = new Set(groups.flatMap((g) => [...g.values]));
  const options: FilterChoice[] = [
    ...groups
      .filter((g) => values.some((v) => g.values.has(v)))
      .map((g) => ({ label: g.name, values: [...g.values] })),
    ...values
      .filter((v) => !grouped.has(v))
      .map((v) => ({ label: v, values: [v] })),
  ];
  const chip = (active: boolean) =>
    "rounded-full border px-3 py-1 text-[12px] font-semibold " +
    (active
      ? "border-[#1b40c8] bg-[#1b40c8] text-white"
      : "border-[#dfe3ea] bg-white text-[#151c2c]");
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-[12px] text-[#8a92a3]">
      {label}
      <button
        type="button"
        aria-pressed={!choice}
        className={chip(!choice)}
        onClick={() => onChoose(null)}
      >
        Todos
      </button>
      {options.map((o) => (
        <button
          key={o.label}
          type="button"
          aria-pressed={choice?.label === o.label}
          className={chip(choice?.label === o.label)}
          onClick={() => onChoose(o)}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

function StackedBar({ rows }: { rows: DrillRow[] }) {
  return (
    <div
      className="flex h-14 overflow-hidden rounded-xl"
      role="img"
      aria-label="Reparto de ventas"
    >
      {rows
        .filter((r) => r.share_pct > 0)
        .map((r, i) => (
          <div
            key={r.id}
            style={{
              width: `${r.share_pct}%`,
              background: COLORS[i % COLORS.length],
            }}
            title={`${r.label} · ${pct(r.share_pct)}`}
            className="flex items-center justify-center overflow-hidden px-1 text-[13px] font-bold text-white"
          >
            {r.share_pct >= 14
              ? `${r.label} · ${pct(r.share_pct)}`
              : r.share_pct >= 5
                ? pct(r.share_pct)
                : ""}
          </div>
        ))}
    </div>
  );
}

function Rows({
  row,
  color,
  open,
  onToggle,
  money,
}: {
  row: DrillRow;
  color: string;
  open: boolean;
  onToggle: () => void;
  money: (n: number) => string;
}) {
  const isGroup = row.kind === "group";
  const cell = (r: DrillRow) => (
    <>
      <td className="px-2 py-2 text-right tabular-nums">
        {Math.round(r.rollup.units).toLocaleString("es")}
      </td>
      <td className="px-2 py-2 text-right tabular-nums">
        {money(r.rollup.net_sales)}
      </td>
      <td className="px-2 py-2 text-right tabular-nums">{pct(r.share_pct)}</td>
      <td className="px-2 py-2 text-right tabular-nums">
        {marginLabel(r.rollup)}
      </td>
    </>
  );
  return (
    <>
      <tr className="border-t border-[#f2f3f6] font-semibold">
        <td className="px-2 py-2">
          {isGroup ? (
            <button
              type="button"
              aria-label={open ? "Ocultar miembros" : "Ver miembros"}
              onClick={onToggle}
              className="mr-1 text-[#1b40c8]"
            >
              {open ? "▾" : "▸"}
            </button>
          ) : (
            <span className="mr-1 inline-block w-3" />
          )}
          <span
            className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle"
            style={{ background: color }}
          />
          {row.label}
          {isGroup ? (
            <span className="ml-2 rounded-md bg-[#f1f3f7] px-1.5 py-0.5 text-[12px] font-semibold text-[#5b6476]">
              {row.members.length}{" "}
              {row.members.length === 1 ? "valor" : "valores"}
            </span>
          ) : null}
        </td>
        {cell(row)}
      </tr>
      {isGroup && open
        ? row.members.map((m) => (
            <tr
              key={m.id}
              className="border-t border-[#f2f3f6] bg-[#fafbfc] text-[#4a5263]"
            >
              <td className="py-2 pl-10 pr-2 font-semibold">{m.label}</td>
              {cell(m)}
            </tr>
          ))
        : null}
    </>
  );
}

function Heatmap({
  table,
  rowDim,
  colDim,
  onCell,
}: {
  table: ReturnType<typeof crossTab>;
  rowDim: DrillDimension;
  colDim: DrillDimension;
  onCell: (row: string, col: string) => void;
}) {
  const max = Math.max(1, ...table.cells.flat());
  return (
    <section className="rounded-[14px] border border-[#dbe3f7] bg-white p-4">
      <div className="mb-3 flex items-center">
        <h2 className="text-[15px] font-bold">% de ventas del plato</h2>
        <span className="ml-auto text-[12px] text-[#8a92a3]">
          Clic en una celda para filtrar
        </span>
      </div>
      <div
        className="grid gap-1.5 text-[13px]"
        style={{
          gridTemplateColumns: `90px repeat(${table.colLabels.length}, minmax(0, 1fr)) 70px`,
        }}
      >
        <div className="text-[12px] text-[#8a92a3]">
          {dimLabel(rowDim)} ↓ · {dimLabel(colDim)} →
        </div>
        {table.colLabels.map((c) => (
          <div key={c} className="text-center text-[12px] text-[#8a92a3]">
            {c}
          </div>
        ))}
        <div className="text-center text-[12px] font-semibold text-[#8a92a3]">
          Total
        </div>
        {table.rowLabels.map((r, ri) => (
          <HeatRow
            key={r}
            label={r}
            cells={table.cells[ri]}
            total={table.rowTotals[ri]}
            max={max}
            cols={table.colLabels}
            onCell={(c) => onCell(r, c)}
          />
        ))}
        <div className="text-[12px] text-[#8a92a3]">Total</div>
        {table.colTotals.map((t, i) => (
          <div key={i} className="text-center font-bold">
            {pct(t)}
          </div>
        ))}
        <div className="text-center font-bold">100%</div>
      </div>
    </section>
  );
}

function HeatRow({
  label,
  cells,
  total,
  max,
  cols,
  onCell,
}: {
  label: string;
  cells: number[];
  total: number;
  max: number;
  cols: string[];
  onCell: (col: string) => void;
}) {
  return (
    <>
      <div className="flex items-center font-bold">{label}</div>
      {cells.map((v, i) => {
        const k = v / max;
        return (
          <button
            key={cols[i]}
            type="button"
            onClick={() => onCell(cols[i])}
            title={`${label} · ${cols[i]}`}
            style={{ background: `rgba(27,64,200,${0.08 + 0.92 * k})` }}
            className={
              "rounded-lg py-2 text-center font-bold " +
              (k > 0.45 ? "text-white" : "text-[#151c2c]")
            }
          >
            {pct(v)}
          </button>
        );
      })}
      <div className="flex items-center justify-center font-bold">
        {pct(total)}
      </div>
    </>
  );
}

/** ✎ Editar agrupación: move values between groups for this dimension. */
function EditGroupsPanel({
  title,
  variants,
  scopeId,
  dim,
  grouping,
  groups,
  onClose,
}: {
  title: string;
  variants: MenuDishVariant[];
  scopeId: string | null;
  dim: DrillDimension;
  grouping: ReturnType<typeof useItemGroups>;
  groups: ValueGroup[];
  onClose: () => void;
}) {
  const stored = DRILL_DIMENSIONS.find((d) => d.id === dim)!.stored;
  const values = useMemo(() => dimensionValues(variants, dim), [variants, dim]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const isSaved = scopeId === null || !scopeId.startsWith("auto:");
  const hierarchy = {
    scope: "dimension_value" as const,
    dimension: stored,
    menu_dish_id: scopeId,
  };
  const items = (list: Iterable<string>): ItemRef[] =>
    [...list].map((ref) => ({ type: "dimension_value", ref }));
  const groupOfValue = (v: string) => groups.find((g) => g.values.has(v));
  const ownGroups = groups.filter((g) =>
    grouping.state.groups.some(
      (s) => s.id === g.id && s.menu_dish_id === scopeId
    )
  );
  const chosen = [...picked];
  const done = () => setPicked(new Set());

  return (
    <aside
      role="dialog"
      aria-label="Editar agrupación"
      className="fixed inset-y-0 right-0 z-40 w-[360px] overflow-y-auto border-l border-[#dfe3ea] bg-white p-4 shadow-2xl"
    >
      <div className="flex items-center">
        <h3 className="text-[15px] font-bold">
          Agrupar {dimLabel(dim).toLowerCase()}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="ml-auto text-[18px] text-[#6b7385]"
        >
          ×
        </button>
      </div>
      <p className="mt-1 text-[12px] text-[#8a92a3]">
        {scopeId === null
          ? "Vale para todos los platos."
          : `Solo vale para ${title}.`}{" "}
        Nada se borra: los valores siguen en sus ventas.
      </p>
      {!isSaved || !grouping.available ? (
        <p className="mt-3 rounded-lg border border-[#f5c98b] bg-[#fff8ec] px-3 py-2 text-[13px]">
          {!grouping.available
            ? "Falta aplicar las migraciones 048 y 049 para guardar grupos."
            : "Primero guarda la agrupación de Milton (botón «Guardar agrupación» en Platos)."}
        </p>
      ) : null}

      <ul className="mt-3 divide-y divide-[#f2f3f6] text-[13px]">
        {values.map((v) => {
          const g = groupOfValue(v);
          return (
            <li key={v} className="flex items-center gap-2 py-2">
              <input
                type="checkbox"
                checked={picked.has(v)}
                disabled={!isSaved || !grouping.available}
                onChange={() =>
                  setPicked((prev) => {
                    const next = new Set(prev);
                    if (next.has(v)) next.delete(v);
                    else next.add(v);
                    return next;
                  })
                }
                aria-label={`Elegir ${v}`}
              />
              <span className="flex-1 font-semibold">{v}</span>
              {g ? (
                <span className="rounded-md bg-[#f1f3f7] px-1.5 py-0.5 text-[12px] text-[#5b6476]">
                  {g.name}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>

      {chosen.length > 0 ? (
        <div className="mt-3 space-y-2 rounded-[10px] bg-[#151c2c] p-3 text-white">
          <b className="text-[13px]">
            {chosen.length} {chosen.length === 1 ? "valor" : "valores"}
          </b>
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre del grupo, p. ej. Papas"
              aria-label="Nombre del grupo"
              className="min-w-0 flex-1 rounded-md px-2 py-1 text-[13px] text-[#151c2c]"
            />
            <button
              type="button"
              disabled={!name.trim()}
              onClick={() => {
                const n = name;
                setName("");
                done();
                void grouping.run((s) =>
                  createGroup(s, {
                    name: n,
                    hierarchy,
                    items: items(chosen),
                    uuid,
                  })
                );
              }}
              className="rounded-md bg-[#2f5be0] px-2.5 py-1 text-[13px] font-semibold disabled:opacity-50"
            >
              Crear grupo
            </button>
          </div>
          {ownGroups.length > 0 ? (
            <div className="flex gap-2">
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                aria-label="Añadir a grupo existente"
                className="min-w-0 flex-1 rounded-md px-2 py-1 text-[13px] text-[#151c2c]"
              >
                <option value="">Añadir a grupo existente…</option>
                {ownGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!target}
                onClick={() => {
                  const t = target;
                  setTarget("");
                  done();
                  void grouping.run((s) =>
                    addToGroup(s, { groupId: t, items: items(chosen), uuid })
                  );
                }}
                className="rounded-md border border-[#3a4660] px-2.5 py-1 text-[13px] font-semibold disabled:opacity-50"
              >
                Añadir
              </button>
            </div>
          ) : null}
          {chosen.some((v) => groupOfValue(v)) ? (
            <button
              type="button"
              onClick={() => {
                const list = chosen;
                done();
                void grouping.run((s) =>
                  removeFromGroups(s, { items: items(list) })
                );
              }}
              className="text-[13px] font-semibold underline"
            >
              Sacar del grupo
            </button>
          ) : null}
        </div>
      ) : null}

      {ownGroups.length > 0 ? (
        <div className="mt-4">
          <h4 className="text-[12px] font-semibold text-[#8a92a3]">
            Grupos de esta vista
          </h4>
          <ul className="mt-1 space-y-1 text-[13px]">
            {ownGroups.map((g) => (
              <li key={g.id} className="flex items-center gap-2">
                {renaming === g.id ? (
                  <input
                    autoFocus
                    defaultValue={g.name}
                    aria-label="Nombre del grupo"
                    className="min-w-0 flex-1 rounded border border-[#1b40c8] px-1.5 py-0.5"
                    onBlur={() => setRenaming(null)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setRenaming(null);
                      if (e.key === "Enter") {
                        const n = e.currentTarget.value;
                        setRenaming(null);
                        void grouping.run((s) => renameGroup(s, g.id, n));
                      }
                    }}
                  />
                ) : (
                  <span
                    className="flex-1 font-semibold"
                    onDoubleClick={() => setRenaming(g.id)}
                  >
                    {g.name}{" "}
                    <span className="font-normal text-[#8a92a3]">
                      · {g.values.size}
                    </span>
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setRenaming(g.id)}
                  className="text-[12px] text-[#3557c9]"
                >
                  Renombrar
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void grouping.run((s) => ungroupGroup(s, g.id))
                  }
                  className="text-[12px] text-[#3557c9]"
                >
                  Desagrupar
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}
