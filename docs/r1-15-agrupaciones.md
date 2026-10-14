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
