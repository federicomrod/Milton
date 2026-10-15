# R1-15 Agrupaciones: migration 048 and checks

No client data in this file.

## Apply 048 (needed for the group features; nothing else depends on it)

Paste `supabase/migrations/048_item_groups.sql` into the Supabase SQL editor. It is idempotent and additive:
two tables (`item_groups`, `group_members`, both company-scoped with RLS through `is_company_member`,
closed to anon), three small triggers and one function (`item_groups_sync_menu_dishes`, insert-only,
member check raising 42501, closed to anon/PUBLIC). Needs PostgreSQL 15+. Until it is applied the app shows no
group features and every number is what it was (the loader reads "no groups").

## Read-only check after applying

```sql
select table_name from information_schema.tables
where table_schema = 'public' and table_name in ('item_groups', 'group_members');   -- both

select tablename, policyname from pg_policies
where tablename in ('item_groups', 'group_members');                                  -- item_groups_member, group_members_member

select proname from pg_proc where proname = 'item_groups_sync_menu_dishes';          -- 1 row
```

Create the Plato del menú level (impersonate a member; insert-only; the second call returns 0):

```sql
begin;
select set_config('request.jwt.claims', '{"sub":"<a member user uuid>","role":"authenticated"}', true);
set local role authenticated;
select public.item_groups_sync_menu_dishes('<company uuid>');   -- = number of menu dishes that are not excluded
select public.item_groups_sync_menu_dishes('<company uuid>');   -- 0
commit;
```

Counts, duplicates and orphans (all read-only; each integrity count must be 0):

```sql
select scope, source, status, count(*) from item_groups where company_id = '<company uuid>' group by 1, 2, 3;

-- members in two groups of the same hierarchy (must be 0; the unique index also forbids it)
select count(*) from (
  select hierarchy_key, member_type, member_ref, coalesce(restaurant_id::text, '')
  from group_members where company_id = '<company uuid>'
  group by 1, 2, 3, 4 having count(*) > 1) d;

-- auto groups whose menu dish is gone (ignored by the app, never deleted)
select count(*) from item_groups
where company_id = '<company uuid>' and source = 'auto' and menu_dish_id is null;

-- product members that point at a product with no POS link (orphans)
select count(*) from group_members m
where m.company_id = '<company uuid>' and m.member_type = 'pos_product'
  and not exists (select 1 from pos_product_links l
                  where l.company_id = m.company_id and l.odoo_product_id::text = m.member_ref);
```

## How membership works

- A product of a menu dish is a member of that dish's group through `pos_product_links.menu_dish_id`
  (one source of truth, PR D). `group_members` holds only a person's explicit choices, and an explicit
  choice wins over the dish.
- One group per member per hierarchy (scope, dimension, menu dish) and restaurant scope: the unique
  index `group_members_one_group_uniq`; `hierarchy_key` and `restaurant_id` are copied from the group by a
  trigger, so a client cannot forge them.
- A restaurant-only group never takes another restaurant's sales: a row that holds both restaurants' sales
  stays outside it. A restaurant's own group comes before a shared one for that restaurant's sales.
- Suggestions (`status = suggested`) never count as grouped until confirmed.

## F2 — grouping on screen (migration 049)

**Migration `049_item_groups_apply.sql` (needs 048).** Additive: one function,
`item_groups_apply(p_company_id, p_ops jsonb)`, SECURITY INVOKER (RLS of 048 still decides), execute granted
to `authenticated` and `service_role` only. Applies a whole grouping action (delete members, upsert groups,
upsert members, delete groups) in one transaction; raises `42501` for a non-member and `22023` over 2,000
changes. Until it is applied the screens still show the groups; saving answers "falta aplicar las
migraciones 048 y 049" and nothing changes.

Read-only checks (after applying):

```sql
-- the function exists and anon cannot run it (second must be false)
select count(*) from pg_proc where proname = 'item_groups_apply';
select has_function_privilege('anon', 'public.item_groups_apply(uuid, jsonb)', 'execute');

-- no member points at a missing group (must be 0)
select count(*) from group_members m
left join item_groups g on g.id = m.group_id where g.id is null;
```

What the screens do:

- **Platos › Productos**: every POS product under its groups and Plato del menú; filter
  Todos / Agrupados / Sin agrupar (counts by product; drinks and other excluded products count as Sin agrupar);
  select rows → dark bar: Añadir a «sugerido» (when all share one), Añadir a grupo existente, Agrupar como…,
  Desagrupar. Adding to a *dish* is the same "mover variante" as before (so Platos and Resumen do not move).
- A product that already has a dish is grouped by nesting its dish's group, never by an explicit member
  (a leaf always lands in its own dish).
- Groups: double-click to rename, ⋯ → Mover dentro de…, Combinar con…, Desagrupar. Dish groups can be renamed
  and nested, never combined or dissolved. Open/closed state is remembered in the browser.
- Preparaciones and Ingredientes use the same filter, bar and group list (`GroupedItemList`); on
  Ingredientes the counts follow the list as filtered by search and "Falta precio".
- Every action shows at once, is saved in the background, rolls back with a message if the save fails, and
  offers «Deshacer» for 8 seconds.
- Suggestions use heuristics only (same dish → group words in the name → same base name as a member);
  "Sin sugerencia" otherwise. No AI yet (F4).

## F3 — drill view (no migration)

Double-click a dish in Platos (or ⋯ › Ver desglose) opens its drill view: dimension Tamaño / Acompañante /
Punto / Canal, chips that narrow on the others, "Cruzar con" heatmap (click a cell to filter), a stacked bar
and a table with the total. Grouped values (a `dimension_value` group of this dish) show as one line with a ▾
caret to its members; "✎ Editar agrupación" moves values between groups and saves like every other group
(needs 048 + 049 and a saved dish). All client-side over the loaded variant rows (`lib/restaurant/menu-dishes/drill.ts`);
sums come from `costing/rollup.ts`, shares add up to exactly 100 (a group's share = sum of its members').

## F4 — Milton suggests (no migration)

Above Productos, Preparaciones and Ingredientes: «✦ Milton sugiere: Cervezas · 23, Vinos · 16…» as dashed chips,
for the items in no group.

1. **Name / category (client only):** 3+ items that start with the same significant word, or share a
   (non-generic) category. Names are plural only when safe (ends in a vowel); never the same name twice;
   a name that already exists (group or dish) is never suggested.
2. **AI for what is left** (button «✦ Pedir más a Milton», `POST /api/restaurant/item-groups/suggest`): the
   existing OpenAI setup (gpt-4o-mini, `OPENAI_API_KEY`). Only item **names and categories** are sent; the
   reply is validated against what was sent (unknown ids, repeats, one-item groups and clashing names are
   dropped). Without the key the button says AI is not configured and the heuristics keep working.
3. Click a chip = preview (the list narrows to those items; they do not count as grouped yet) → **Aplicar**
   (becomes a normal group marked «✦ Agrupado por Milton»), **Descartar** (a stored suggestion is deleted; a
   name/category one is remembered as dismissed in this browser) or close.
4. AI answers are stored as `source = ai_suggested`, `status = suggested` groups (saved with
   `item_groups_apply`, one «Deshacer»), so they survive a reload without asking the AI again. A suggested
   group is ignored by the tree and by every count until accepted; grouping an item by hand takes it out of
   a suggestion (one group per item).

## R1-15h — Todos los restaurantes, sticky panel, group Desglose (no migration)

- **Todos los restaurantes:** the payload is the same as for one restaurant (verified on staging); what changes is
  now explicit. Each product row carries its restaurant tag (R1, R2 — order of the restaurant names; the legend
  is above the table). Milton's suggestions are made **inside each restaurant** (products sold in both, or
  unknown, form their own shared bucket) and the group they create is that restaurant's own
  (`restaurant_id`), so a suggestion never mixes restaurants. A manual group over a mixed selection is shared
  and says so; adding a product of another restaurant to a restaurant's own group is refused with a message.
  With one restaurant selected, another restaurant's own groups are not shown or offered.
- **Where it needs one restaurant:** nothing is hidden; the legend says suggestions and new groups are per restaurant.
  Preparaciones and Ingredientes are company-wide (same under Todos); value groups in the Desglose are per dish.
- **¿Parecen duplicados?:** among the selected products of the same restaurant with the same/near-same name the
  bar offers «Agrupar como «…»». Grouping only; never a POS merge, never across restaurants.
- **Renames** reach search, the picker, the strip and the Desglose at once; a server copy read before the save
  (cached tab) is replayed under this session's changes, so the old name cannot come back.
- **Desglose of a group:** default dimension *Producto* (sales by member, stacked bar, table with sales, % of
  group, margin, Costo %), top/bottom 3 by margin marked «Más rentable» / «Menos rentable»; "Sin precio" is never
  ranked. Only dimensions with real data are offered (drinks show no Tamaño/Punto/Acompañante; Canal only with events).

## Limpieza de ingredientes, part 1 — En uso / Sin uso / Archivar (migration 050)

**Migration `050_ingredient_archive.sql` (needed only for Archivar).** One nullable column
`ingredients.archived_at` plus a partial index. Nothing dropped, renamed or backfilled; existing RLS already
covers the UPDATE. Until it is applied En uso / Sin uso work (computed from the recipes) and Archivar says the
migration is missing. Read-only check after applying:

```sql
select count(*) filter (where archived_at is not null) as archived, count(*) as total
from public.ingredients where company_id = '<company uuid>';
```

Rules (`lib/restaurant/ingredient-usage.ts`, pure, tested):
- **En uso** = an active recipe line references it: a dish's newest non-archived recipe version (approved or
  still in review), or a preparation that an active dish uses, directly or nested through other preparations.
  Superseded versions and preparations nobody uses do not count.
- Filter **En uso (default) / Sin uso / Todos**, independent of Todos / Agrupados / Sin agrupar (AND).
- **Falta precio** counts only ingredients that are in use; an unused ingredient shows «Sin uso» and never asks
  for a price. A confirmed $0 is a price; missing is never $0.
- **Archivar** (one, or «Archivar sin uso (N)») is a soft hide, never a delete; the server re-checks usage from
  the recipes and refuses an ingredient that is in use. An archived ingredient that a recipe uses again is simply
  in use (comes back by itself); «Restaurar» undoes it by hand.
- If the recipes cannot be read, nothing is hidden (everything counts as in use) and nothing is archived.

## Limpieza de ingredientes, part 2 — Posibles duplicados and Unir (migration 051)

**Migration `051_ingredient_duplicates_merge.sql` (needs 050).** Additive: three tables
(`ingredient_duplicate_suggestions`, `ingredient_not_duplicates`, `ingredient_merges`; company-scoped, RLS via
`is_company_member`) and three SECURITY INVOKER functions closed to anon/PUBLIC and raising `42501` for a
non-member: `ingredient_merge` (ONE transaction), `ingredient_merge_undo`, `ingredient_duplicate_decide`.
Reuses the existing `ingredient_aliases` (039) and `ingredients.chosen_cost_entry_id`. Read-only checks:

```sql
select status, count(*) from public.ingredient_duplicate_suggestions where company_id = '<company uuid>' group by 1;
select count(*) from public.ingredient_merges where company_id = '<company uuid>';
select has_function_privilege('anon', 'public.ingredient_merge(uuid,uuid,uuid[],uuid,jsonb,uuid)', 'execute'); -- false
```

- **Suggestions:** names with accents/case/fillers removed, one or two letters apart on a longer name, numbers
  must match (600 ml ≠ 350 ml), **same unit family only**; pairs or clusters (max 6). «✦ Pedir más a Milton»
  sends only names and units of what is left (≤250) to the existing OpenAI setup; the answer is validated like the
  heuristics and stored as pending.
- **Queue:** «✦ Posibles duplicados · N grupos», n de N with ‹ ›, «✦ duplicado?» on affected rows (clicking one
  jumps the banner to its suggestion; a row with none leaves it). **Unir**, **No son iguales** (every pair of the
  set is never suggested again, also after re-imports), **Ahora no** (end of the queue, still pending).
- **Unir:** survivor = sourced price and most recent date (card marked «Se conserva», click another to change);
  a price conflict is a picker (never averaged, never silent); every recipe line of dishes and preparations, price
  entry and invoice match of the losers moves to the survivor (lines keep their own unit and quantity); the losers'
  names become aliases (the importer reads them) and the losers are archived, never deleted. «Deshacer» toast + a
  merge history; the undo puts lines, prices, aliases and archive state back exactly (a line someone moved
  elsewhere since is left alone). Costs are computed when read, so dishes and preparations are recomputed by the
  next read; the app re-reads the page after a merge or an undo.
- **Not touched by a merge:** `supplier_ingredients`, kitchen recipe drafts and the legacy recipe tables.
- The Cockpit/briefing «ingredientes sin costo» counter now ignores ingredients no active recipe uses.
