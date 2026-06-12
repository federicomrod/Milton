// components/restaurant/MenuRecipesPage.tsx
//
// Menu & Recipes foundation — interactive page wrapping the server DTO
// returned by lib/restaurant/menu-recipes-server.
//
// Sections:
//   1. Page header (title + Import POS button)
//   2. Status summary cards
//   3. Unmatched POS items — with "Create menu item" / "Match existing"
//      inline actions
//   4. Menu items list — name, mapping count, recipe status, edit link
//   5. Prepared components — list + simple create form
//
// All mutations go through /api/restaurant/* endpoints. After a successful
// mutation we call router.refresh() so the server page re-runs and
// re-hydrates the DTO.

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  BookOpen,
  Upload,
  Plus,
  Link2,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type {
  MenuRecipesData,
  UnmatchedPosItem,
  MenuItemListRow,
  PreparedComponentListRow,
} from "@/lib/restaurant/menu-recipes-server";
import type { CostStatus } from "@/types/restaurant-costing";

// ---------------------------------------------------------------------------
// Page entry
// ---------------------------------------------------------------------------

export function MenuRecipesPage({ data }: { data: MenuRecipesData }) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const fmts = useMemo(() => makeFmts(data.currency), [data.currency]);

  return (
    <div className="w-full py-8 px-6 lg:px-10">
      <div className="space-y-8 max-w-screen-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <BookOpen className="h-6 w-6 text-orange-500" />
            <h1 className="text-2xl font-bold tracking-tight">
              Menu & Recipes
            </h1>
            <Badge className="text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-0">
              Foundation
            </Badge>
          </div>
          <Button asChild size="sm" variant="outline" className="gap-2">
            <Link href="/dashboard/restaurant/upload">
              <Upload className="h-4 w-4" />
              Import POS Sales
            </Link>
          </Button>
        </div>

        <p className="text-sm text-muted-foreground -mt-4 max-w-3xl">
          Map uploaded POS items to canonical menu items, build recipes from
          ingredients and prepared components, and prepare the data for costing.
          No margin math runs yet — that comes after supplier invoices are wired
          in.
        </p>

        <SummaryGrid summary={data.summary} />

        <UnmatchedSection
          rows={data.unmatched}
          menuItems={data.menuItems}
          fmts={fmts}
          onChange={refresh}
        />

        <MenuItemsSection rows={data.menuItems} fmts={fmts} />

        <ComponentsSection components={data.components} onChange={refresh} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function makeFmts(currency: string) {
  const safe = /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  const locale = safe === "MXN" ? "es-MX" : "en-US";
  return {
    code: safe,
    locale,
    int: new Intl.NumberFormat(locale, {
      style: "currency",
      currency: safe,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }),
    dec2: new Intl.NumberFormat(locale, {
      style: "currency",
      currency: safe,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
  };
}

// ---------------------------------------------------------------------------
// Summary cards
// ---------------------------------------------------------------------------

function SummaryGrid({ summary }: { summary: MenuRecipesData["summary"] }) {
  const tiles: {
    label: string;
    value: number;
    tone: "warn" | "neutral" | "ok";
  }[] = [
    {
      label: "Unmatched POS items",
      value: summary.unmatched_pos_count,
      tone: "warn",
    },
    {
      label: "Menu items without recipe",
      value: summary.menu_items_without_recipe,
      tone: "warn",
    },
    { label: "Draft recipes", value: summary.draft_recipes, tone: "neutral" },
    { label: "Active recipes", value: summary.active_recipes, tone: "ok" },
    {
      label: "Prepared components",
      value: summary.prepared_components_count,
      tone: "neutral",
    },
    {
      label: "Fully costed items",
      value: summary.menu_items_fully_costed,
      tone: "ok",
    },
    {
      label: "Items with cost issues",
      value: summary.menu_items_with_cost_issues,
      tone: "warn",
    },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
      {tiles.map((t) => (
        <Card key={t.label}>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {t.label}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={
                "text-2xl font-bold tabular-nums " +
                (t.tone === "warn" && t.value > 0
                  ? "text-amber-700 dark:text-amber-300"
                  : t.tone === "ok" && t.value > 0
                    ? "text-green-700 dark:text-green-300"
                    : "")
              }
            >
              {t.value.toLocaleString()}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unmatched POS section
// ---------------------------------------------------------------------------

function UnmatchedSection({
  rows,
  menuItems,
  fmts,
  onChange,
}: {
  rows: UnmatchedPosItem[];
  menuItems: MenuItemListRow[];
  fmts: ReturnType<typeof makeFmts>;
  onChange: () => void;
}) {
  return (
    <section>
      <div className="flex items-center justify-between gap-4 mb-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Link2 className="h-4 w-4 text-amber-600" />
          Unmatched POS items
          <span className="text-sm font-normal text-muted-foreground">
            ({rows.length})
          </span>
        </h2>
      </div>
      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              All POS item names are mapped to a menu item.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/40">
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Raw POS item name</th>
                    <th className="px-4 py-3 font-medium text-right">Units</th>
                    <th className="px-4 py-3 font-medium text-right">
                      Revenue
                    </th>
                    <th className="px-4 py-3 font-medium text-right">Orders</th>
                    <th className="px-4 py-3 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <UnmatchedRow
                      key={r.raw_pos_item_name + i}
                      row={r}
                      menuItems={menuItems}
                      striped={i % 2 === 1}
                      fmts={fmts}
                      onChange={onChange}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function UnmatchedRow({
  row,
  menuItems,
  striped,
  fmts,
  onChange,
}: {
  row: UnmatchedPosItem;
  menuItems: MenuItemListRow[];
  striped: boolean;
  fmts: ReturnType<typeof makeFmts>;
  onChange: () => void;
}) {
  const [mode, setMode] = useState<"idle" | "create" | "match">("idle");
  return (
    <>
      <tr
        className={
          (striped ? "bg-muted/20" : "bg-background") +
          " border-b border-border hover:bg-muted/30"
        }
      >
        <td className="px-4 py-3 font-medium">{row.raw_pos_item_name}</td>
        <td className="px-4 py-3 text-right tabular-nums">
          {row.units_sold.toLocaleString(fmts.locale)}
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          {fmts.dec2.format(row.revenue)}
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          {row.order_count.toLocaleString(fmts.locale)}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant={mode === "create" ? "default" : "outline"}
              size="sm"
              className="gap-1.5"
              onClick={() => setMode(mode === "create" ? "idle" : "create")}
            >
              <Plus className="h-3.5 w-3.5" />
              Create menu item
            </Button>
            <Button
              variant={mode === "match" ? "default" : "outline"}
              size="sm"
              className="gap-1.5"
              onClick={() => setMode(mode === "match" ? "idle" : "match")}
              disabled={menuItems.length === 0}
              title={
                menuItems.length === 0
                  ? "No existing menu items yet"
                  : "Pick an existing menu item"
              }
            >
              <Link2 className="h-3.5 w-3.5" />
              Match existing
            </Button>
          </div>
        </td>
      </tr>
      {mode === "create" && (
        <tr className={striped ? "bg-muted/10" : "bg-muted/5"}>
          <td colSpan={5} className="px-4 py-3 border-b border-border">
            <CreateMenuItemForm
              defaultName={row.raw_pos_item_name}
              rawPosItemName={row.raw_pos_item_name}
              onDone={() => {
                setMode("idle");
                onChange();
              }}
            />
          </td>
        </tr>
      )}
      {mode === "match" && (
        <tr className={striped ? "bg-muted/10" : "bg-muted/5"}>
          <td colSpan={5} className="px-4 py-3 border-b border-border">
            <MatchExistingForm
              rawPosItemName={row.raw_pos_item_name}
              menuItems={menuItems}
              onDone={() => {
                setMode("idle");
                onChange();
              }}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function CreateMenuItemForm({
  defaultName,
  rawPosItemName,
  onDone,
}: {
  defaultName: string;
  rawPosItemName: string;
  onDone: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/restaurant/menu-items", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            category: category.trim() || null,
            selling_price: price.trim() === "" ? null : Number(price),
            raw_pos_item_name: rawPosItemName,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(
            typeof body?.error === "string" ? body.error : `HTTP ${res.status}`
          );
          return;
        }
        onDone();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      }
    });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
      <FieldLabel label="Name" className="md:col-span-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-9"
        />
      </FieldLabel>
      <FieldLabel label="Category">
        <Input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="e.g. BBQ"
          className="h-9"
        />
      </FieldLabel>
      <FieldLabel label="Selling price">
        <Input
          type="number"
          min={0}
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="—"
          className="h-9"
        />
      </FieldLabel>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={submit} disabled={pending || !name.trim()}>
          {pending ? "Saving…" : "Create & map"}
        </Button>
        {error && (
          <span className="text-xs text-red-700 dark:text-red-300">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

function MatchExistingForm({
  rawPosItemName,
  menuItems,
  onDone,
}: {
  rawPosItemName: string;
  menuItems: MenuItemListRow[];
  onDone: () => void;
}) {
  const [menuItemId, setMenuItemId] = useState(menuItems[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!menuItemId) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/restaurant/pos-mappings", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            raw_pos_item_name: rawPosItemName,
            menu_item_id: menuItemId,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(
            typeof body?.error === "string" ? body.error : `HTTP ${res.status}`
          );
          return;
        }
        onDone();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      }
    });
  };

  return (
    <div className="flex items-end gap-3 flex-wrap">
      <FieldLabel label="Map to menu item">
        <select
          value={menuItemId}
          onChange={(e) => setMenuItemId(e.target.value)}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm min-w-[240px]"
        >
          {menuItems.map((mi) => (
            <option key={mi.id} value={mi.id}>
              {mi.name}
              {mi.category ? ` — ${mi.category}` : ""}
            </option>
          ))}
        </select>
      </FieldLabel>
      <Button size="sm" onClick={submit} disabled={pending || !menuItemId}>
        {pending ? "Saving…" : "Save mapping"}
      </Button>
      {error && (
        <span className="text-xs text-red-700 dark:text-red-300">{error}</span>
      )}
    </div>
  );
}

function FieldLabel({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={"flex flex-col gap-1 " + (className ?? "")}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Menu items section
// ---------------------------------------------------------------------------

function MenuItemsSection({
  rows,
  fmts,
}: {
  rows: MenuItemListRow[];
  fmts: ReturnType<typeof makeFmts>;
}) {
  // Reads only — mutations live on the row-level "edit recipe" link, which
  // navigates to the detail page. router.refresh() is owned by the parent.
  return (
    <section>
      <div className="flex items-center justify-between gap-4 mb-3">
        <h2 className="text-lg font-semibold">
          Menu items{" "}
          <span className="text-sm font-normal text-muted-foreground">
            ({rows.length})
          </span>
        </h2>
      </div>
      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-muted-foreground">
              No menu items yet. Create one from an unmatched POS row above, or{" "}
              <Link
                href="/dashboard/restaurant/upload"
                className="underline hover:no-underline"
              >
                upload POS sales
              </Link>{" "}
              to populate the unmatched list.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/40">
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Item</th>
                    <th className="px-4 py-3 font-medium">Category</th>
                    <th className="px-4 py-3 font-medium text-right">Price</th>
                    <th className="px-4 py-3 font-medium text-right">
                      Est. cost
                    </th>
                    <th className="px-4 py-3 font-medium text-right">Margin</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">
                      POS mappings
                    </th>
                    <th className="px-4 py-3 font-medium">Recipe</th>
                    <th className="px-4 py-3 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={r.id}
                      className={
                        (i % 2 === 0 ? "bg-background" : "bg-muted/20") +
                        " border-b border-border hover:bg-muted/30"
                      }
                    >
                      <td className="px-4 py-3 font-medium">{r.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {r.category ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {typeof r.selling_price === "number"
                          ? fmts.dec2.format(r.selling_price)
                          : "—"}
                      </td>
                      <td
                        className="px-4 py-3 text-right tabular-nums"
                        title={
                          r.cost.issues.length > 0
                            ? r.cost.issues.map((i) => i.message).join("\n")
                            : undefined
                        }
                      >
                        {r.cost.status === "complete" &&
                        r.cost.cost !== null ? (
                          fmts.dec2.format(r.cost.cost)
                        ) : (
                          <CostStatusChip status={r.cost.status} />
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {r.cost.status === "complete" &&
                        r.cost.gross_margin_pct !== null ? (
                          <MarginPct pct={r.cost.gross_margin_pct} />
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {r.status ? (
                          <Badge variant="outline" className="text-xs">
                            {r.status}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {r.pos_mapping_count}
                      </td>
                      <td className="px-4 py-3">
                        <RecipeStatusBadge status={r.recipe_status} />
                        {r.recipe_input_count > 0 && (
                          <span className="text-xs text-muted-foreground ml-2">
                            {r.recipe_input_count} input
                            {r.recipe_input_count === 1 ? "" : "s"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          asChild
                          size="sm"
                          variant="ghost"
                          className="gap-1"
                        >
                          <Link
                            href={`/dashboard/restaurant/menu/${r.id}`}
                            aria-label={`View recipe for ${r.name}`}
                          >
                            {r.recipe_status === "none"
                              ? "Add recipe"
                              : "Edit recipe"}
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function RecipeStatusBadge({
  status,
}: {
  status: MenuItemListRow["recipe_status"];
}) {
  if (status === "none") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
        <AlertTriangle className="h-3 w-3" />
        missing
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-300">
        <CheckCircle2 className="h-3 w-3" />
        active
      </span>
    );
  }
  if (status === "archived") {
    return <span className="text-xs text-muted-foreground">archived</span>;
  }
  return <span className="text-xs">draft</span>;
}

/**
 * Renders a short, human-readable label for a non-complete cost status.
 * The status itself is enough to colour-code (we never show a numeric
 * cost when status !== "complete"); the title attribute carries the
 * actual issue messages for tooltip on hover.
 */
function CostStatusChip({ status }: { status: CostStatus }) {
  const label = (() => {
    switch (status) {
      case "missing_recipe":
        return "no recipe";
      case "missing_component_recipe":
        // Distinguished from "no recipe" — this item HAS a recipe, but a
        // component it uses doesn't have one of its own yet.
        return "component recipe missing";
      case "missing_input_cost":
      case "no_cost_entries":
        return "missing cost";
      case "missing_unit_conversion":
        return "unit mismatch";
      case "circular_component_reference":
        return "circular ref";
      case "inactive_recipe":
        return "recipe archived";
      default:
        return "—";
    }
  })();
  return (
    <span className="text-xs text-amber-700 dark:text-amber-300">{label}</span>
  );
}

function MarginPct({ pct }: { pct: number }) {
  const tone =
    pct >= 60
      ? "text-green-700 dark:text-green-300"
      : pct >= 40
        ? "text-foreground"
        : "text-red-700 dark:text-red-300";
  return <span className={tone}>{pct.toFixed(1)}%</span>;
}

// ---------------------------------------------------------------------------
// Prepared components section
// ---------------------------------------------------------------------------

function ComponentsSection({
  components,
  onChange,
}: {
  components: PreparedComponentListRow[];
  onChange: () => void;
}) {
  return (
    <section>
      <div className="flex items-center justify-between gap-4 mb-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-orange-500" />
          Prepared components
          <span className="text-sm font-normal text-muted-foreground">
            ({components.length})
          </span>
        </h2>
      </div>
      <p className="text-sm text-muted-foreground mb-3 max-w-3xl">
        Sub-products produced in-house — smoked brisket, BBQ sauce, coleslaw
        batch — that menu items consume in known quantities. Define them here so
        recipes can reference the component instead of the raw ingredient.
      </p>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Add component</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateComponentForm existing={components} onDone={onChange} />
        </CardContent>
      </Card>

      <div className="mt-4">
        {components.length === 0 ? (
          <Card>
            <CardContent className="py-6">
              <p className="text-sm text-muted-foreground">
                No prepared components yet. Add one above to start modelling
                your in-house preparations.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/40">
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Component</th>
                      <th className="px-4 py-3 font-medium">Category</th>
                      <th className="px-4 py-3 font-medium">Output unit</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium text-right">
                        Recipe inputs
                      </th>
                      <th className="px-4 py-3 font-medium text-right">
                        Cost / output unit
                      </th>
                      <th className="px-4 py-3 font-medium text-right">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {components.map((c, i) => (
                      <ComponentRow
                        key={c.id}
                        component={c}
                        striped={i % 2 === 1}
                        onChange={onChange}
                        currency={
                          c.cost.status === "complete" &&
                          c.cost.cost_per_output_unit !== null
                            ? "MXN" // we don't track per-component currency yet
                            : null
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </section>
  );
}

function CreateComponentForm({
  existing,
  onDone,
}: {
  existing: PreparedComponentListRow[];
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [outputUnit, setOutputUnit] = useState("kg");
  const [status, setStatus] = useState<"draft" | "active" | "archived">(
    "draft"
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Case-insensitive duplicate check against the loaded set. Server still
  // enforces uniqueness via the DB constraint (or returns 409 if the row
  // exists but isn't in our loaded snapshot), but the inline warning gives
  // immediate feedback before the user even clicks save.
  const trimmedName = name.trim();
  const duplicate = useMemo(() => {
    if (!trimmedName) return null;
    const norm = trimmedName.toLowerCase();
    return existing.find((c) => c.name.trim().toLowerCase() === norm) ?? null;
  }, [trimmedName, existing]);

  const submit = () => {
    setError(null);
    if (duplicate) {
      setError(
        `“${duplicate.name}” already exists (status: ${duplicate.status}). Rename it or archive the existing one.`
      );
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/restaurant/prepared-components", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: trimmedName,
            category: category.trim() || null,
            output_unit: outputUnit.trim(),
            status,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          // 409 = duplicate already in DB. Surface the server's nicer copy
          // when present; fall back to the generic error.
          const top =
            typeof body?.error === "string" ? body.error : `HTTP ${res.status}`;
          const details =
            typeof body?.details === "string" ? ` — ${body.details}` : "";
          setError(top + details);
          return;
        }
        setName("");
        setCategory("");
        setOutputUnit("kg");
        setStatus("draft");
        onDone();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      }
    });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
      <FieldLabel label="Name" className="md:col-span-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Smoked Brisket"
          className="h-9"
        />
      </FieldLabel>
      <FieldLabel label="Category">
        <Input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Protein, Sauce, …"
          className="h-9"
        />
      </FieldLabel>
      <FieldLabel label="Output unit">
        <Input
          value={outputUnit}
          onChange={(e) => setOutputUnit(e.target.value)}
          placeholder="kg, l, portion…"
          className="h-9"
        />
      </FieldLabel>
      <FieldLabel label="Status">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="draft">draft</option>
          <option value="active">active</option>
          <option value="archived">archived</option>
        </select>
      </FieldLabel>
      <div className="flex items-center gap-2 md:col-span-5 flex-wrap">
        <Button
          size="sm"
          onClick={submit}
          disabled={pending || !name.trim() || !!duplicate}
        >
          {pending ? "Saving…" : "Add component"}
        </Button>
        {duplicate && !error && (
          <span className="text-xs text-amber-700 dark:text-amber-300">
            “{duplicate.name}” already exists (status: {duplicate.status}).
          </span>
        )}
        {error && (
          <span className="text-xs text-red-700 dark:text-red-300">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * One row in the prepared-components table with per-row archive/unarchive
 * and a guarded hard-delete. Archived rows render dimmer and the recipe
 * builder hides them from its source dropdown (see RecipeBuilder server
 * page, which already filters `.neq('status', 'archived')`).
 *
 * We treat the row's own status as the source of truth, and call
 * onChange() after every successful mutation so the server page reloads
 * with the canonical state — avoids drift if a mutation races a refresh.
 */
function ComponentRow({
  component,
  striped,
  onChange,
  currency,
}: {
  component: PreparedComponentListRow;
  striped: boolean;
  onChange: () => void;
  /** Display currency for the cost column. Null hides the formatter. */
  currency: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isArchived = component.status === "archived";

  const setStatus = (next: "active" | "archived") => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/restaurant/prepared-components/${component.id}`,
          {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: next }),
          }
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(
            (typeof body?.error === "string"
              ? body.error
              : `HTTP ${res.status}`) +
              (typeof body?.details === "string" ? ` — ${body.details}` : "")
          );
          return;
        }
        onChange();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      }
    });
  };

  const hardDelete = () => {
    if (
      !confirm(
        `Permanently delete component “${component.name}”?\n\nArchiving is usually safer — recipes that reference this component will block the delete.`
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/restaurant/prepared-components/${component.id}`,
          { method: "DELETE", credentials: "include" }
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(
            (typeof body?.error === "string"
              ? body.error
              : `HTTP ${res.status}`) +
              (typeof body?.details === "string" ? ` — ${body.details}` : "")
          );
          return;
        }
        onChange();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      }
    });
  };

  return (
    <tr
      className={
        (striped ? "bg-muted/20" : "bg-background") +
        " border-b border-border hover:bg-muted/30 " +
        (isArchived ? "opacity-70" : "")
      }
    >
      <td className="px-4 py-3 font-medium">{component.name}</td>
      <td className="px-4 py-3 text-muted-foreground">
        {component.category ?? "—"}
      </td>
      <td className="px-4 py-3">{component.output_unit}</td>
      <td className="px-4 py-3">
        <Badge
          variant={isArchived ? "secondary" : "outline"}
          className="text-xs capitalize"
        >
          {component.status}
        </Badge>
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {component.recipe_input_count}
      </td>
      <td
        className="px-4 py-3 text-right tabular-nums"
        title={
          component.cost.issues.length > 0
            ? component.cost.issues.map((i) => i.message).join("\n")
            : undefined
        }
      >
        {component.cost.status === "complete" &&
        component.cost.cost_per_output_unit !== null ? (
          <span>
            {formatComponentCost(
              component.cost.cost_per_output_unit,
              currency ?? "MXN"
            )}{" "}
            <span className="text-xs text-muted-foreground">
              / {component.cost.output_unit ?? component.output_unit}
            </span>
          </span>
        ) : (
          <CostStatusChip status={component.cost.status} />
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Button asChild size="sm" variant="ghost">
            <Link
              href={`/dashboard/restaurant/components/${component.id}`}
              aria-label={`Edit recipe for ${component.name}`}
            >
              {component.recipe_input_count > 0 ? "Edit recipe" : "Add recipe"}
            </Link>
          </Button>
          {isArchived ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setStatus("active")}
              disabled={pending}
            >
              Unarchive
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setStatus("archived")}
              disabled={pending}
            >
              Archive
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={hardDelete}
            disabled={pending}
            className="text-muted-foreground hover:text-red-700"
            title={
              component.recipe_input_count > 0
                ? "This component is used by a recipe — archive is safer"
                : "Delete permanently"
            }
          >
            Delete
          </Button>
          {error && (
            <span className="text-xs text-red-700 dark:text-red-300">
              {error}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

function formatComponentCost(value: number, currency: string): string {
  const safe = /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  const locale = safe === "MXN" ? "es-MX" : "en-US";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: safe,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}
