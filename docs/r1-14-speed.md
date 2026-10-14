# R1-14 — App-wide speed + Ventas heatmap

No client data in this file.

## 1. Migration 047 (optional for correctness, needed for Ventas speed)

`supabase/migrations/047_sales_period_rollup.sql` adds `sales_period_rollup(company,
restaurant, timezone, currency, from, to)`: the Cockpit rollup (033) restricted to a
local-date period plus the per-day / per-weekday / per-slot figures Ventas computed in
Node. One jsonb value. Member check raises 42501 for a non-member (the app then falls
back to reading rows); EXECUTE revoked from PUBLIC and anon. If it is not applied,
Ventas keeps reading the raw rows (slow, same numbers).

### Check after applying (impersonate a member in the SQL editor)

```sql
begin;
select set_config('request.jwt.claims',
  '{"sub":"<a member user uuid>","role":"authenticated"}', true);
set local role authenticated;
select jsonb_array_length(r->'stat_days') as days,
       (r->>'row_count')::int            as lines,
       (r->'revenue'->>'net_sales')::numeric as net
from (select public.sales_period_rollup(
        '<company uuid>', null, 'America/El_Salvador', 'USD',
        '2026-07-01', '2026-07-31') as r) q;
rollback;
```

`lines` and `net` must equal `count(*)` and the net of the same local dates computed from
`pos_sales_items` (the app's own check against the row walk is in the PR).

## 2. Is the Cockpit rollup (031/033) applied on staging?

The Cockpit and the first call of Ventas use `cockpit_pos_rollup`. If it is missing the
app silently falls back to paging every row (the "takes ages" case) and logs
`[cockpit-timing] rpc ... source=missing`. Check:

```sql
select proname from pg_proc
where proname in ('cockpit_pos_rollup','cockpit_pos_product_rollup',
                  'pos_line_is_tip','pos_product_sales_groups','sales_period_rollup');
```

All five should be listed. If `cockpit_pos_rollup` or `pos_line_is_tip` is missing, apply
031 → 033 first.

Note: 031/032/033 return an EMPTY payload (not an error) for a non-member, which the
Cockpit reads as "no sales". 046 and 047 raise 42501 instead. Aligning 031-033 is a
separate, small follow-up.

## 3. Where the time goes now

Vercel runs the app in its default region (`vercel.json` is `{}`; not touched here) and the
database is in Frankfurt, so every sequential database round trip costs about a
transatlantic round trip (~90-120 ms measured). A section needs 3-5 sequential trips
(sign-in check, company, the data wave, the rollup), so ~0.4-0.6 s of every server render
is latency, not work. The only fix for that is running the functions near the database
(a region setting): a deployment decision for the owner, not changed by this PR.
