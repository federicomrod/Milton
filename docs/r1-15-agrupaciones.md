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
