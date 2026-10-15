# R1-17a — Turnos, business day (migration 054)

**Apply:** `supabase/migrations/054_restaurant_shifts.sql` (Supabase SQL Editor; additive, idempotent).

## What it does
- **Table `restaurant_shifts`** (per restaurant: name, start/end `time`, weekdays 1–7, active, sort order), RLS through `is_company_member`, anon revoked.
- **`restaurant_shifts_save(company, restaurant, shifts)`**: SECURITY DEFINER, pinned `search_path`, one transaction. Non-member → `42501`; overlapping active shifts on a weekday, bad times, empty names → `22023` with a Spanish message. Closed to anon/PUBLIC.
- **Seed**: every existing restaurant gets today's split (Almuerzo 00:00–17:00, Cena 17:00–24:00), so shift totals do not change until someone edits them.
- **Business day**: `business date = (local timestamp − cutoff)::date`; cutoff = end of the restaurant's last active shift that crosses midnight (never after 09:00, otherwise "unclear"), else **04:00** (`restaurant_business_day_cutoff`). Sales after midnight belong to the previous business day. The clock **hour** stays the real hour; the **weekday** is the business weekday.
- **Rollups, new versions** (same names/signatures, the old files are untouched): `cockpit_pos_rollup`, `sales_period_rollup` (also returns `shifts`, assigned at query time, plus «Otro horario»), `cockpit_product_day_rollup`.
- **053 fix**: 053 compared `sale_date` as text; it is a `date`, so on the real schema the function failed when called and the app silently used its row walk. The 054 version uses the right type, so the Cockpit's cost-per-day now really comes from SQL.

## One definition, two implementations
`lib/restaurant/business-day.ts` mirrors the SQL (cutoff, business moment, shift assignment, overlap rules and messages). Every row walk reads each line's cutoff from `fetchCompanyPosSalesRows` (`business_cutoff_min`), so the SQL path and the row path give the same days; a pglite test proves it on the same fixtures.

## Before 054 is applied
Everything keeps today's behaviour: calendar day, the 17:00 split (no cutoff is applied anywhere, so the SQL path and the row path stay consistent). Configuración › Turnos says «falta aplicar la migración 054».

## Notes / decisions
- Timezone: the POS connection's timezone (as today). `restaurant_locations.timezone` defaults to `America/Mexico_City` and is not reliable (on staging it differs from the POS one).
- Orders after the cutoff but outside every shift are «Otro horario» (shown only when > 0). A restaurant with no shifts has no shift split.
- Not applied: Ask Milton's own date logic reads the same rows and picks the cutoff up automatically; `kitchen_attention_feed` (034) is unchanged.
- Not done here: the "setup checklist item" for new restaurants without shifts (the Turnos page itself says what no shifts means).
