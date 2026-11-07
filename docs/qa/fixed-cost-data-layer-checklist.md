# QA — fixed costs data layer (staging only, after approval)

Use the **synthetic** file first, then Fede's real file (kept outside the repo). Demo Resto on staging only.
Record the **served build** first: Vercel deployment id of the staging alias and its commit; do not assume it.

## 0. Before anything

- [ ] `079` applied to staging only (not production). Totals per month before/after identical.
- [ ] `secdef_guard.sql` returns 0 rows.
- [ ] Served staging build = this branch's head (deployment record).
- [ ] `080` NOT yet applied (applied only after section 6).

## 1. The reported case (October file, November screen)

1. [ ] Open **Costos fijos › noviembre**. Note November's lines, history rows and daily target. Reload twice: nothing new appears (no auto-copy).
2. [ ] Upload the October-dated file from the November screen.
3. [ ] Review shows **«{n} líneas → {restaurante} · octubre de 2026»** and «Estás viendo noviembre…; noviembre no cambia.»
4. [ ] Approve. Toast: «Se guardó en octubre de 2026. noviembre de 2026 no cambió.» plus the counts.
5. [ ] November: still no new costs, no new history, same target. Open October: the lines are there.
6. [ ] Repeat with **Cambiar mes → noviembre** on the review: the lines land in November this time (persisted, not a badge).
7. [ ] Counts: «Categorías confirmadas: n de 5». Several Servicios lines are one category. Upload toast says «{n} líneas aprobadas».

## 2. Items, reload, re-upload

- [ ] October Servicios lists its four items; the card total is their exact sum; reload keeps them.
- [ ] Upload the **same file again**: every group is «ya aprobado»; toast «Nada nuevo…»; History has **no** new row.
- [ ] Upload a changed file (one amount different): an overlap panel names old → new; **Reemplazar** and **Sumar** each leave the amount the label promised.
- [ ] A missing price (e.g. Seguro blank) stays «Sin precio» until a value is typed or the line is skipped; it is never $0.
- [ ] Type a total over a card with a breakdown: the app asks before replacing it.

## 3. Explicit copy

- [ ] «Copiar de octubre» opens a preview; closing it writes nothing (History unchanged).
- [ ] Copy Servicios: November gets the snapshot, source named in the card («copiado de octubre de 2026»), repeat switch **off**.
- [ ] Edit October afterwards: November does not move; the copy panel says «octubre cambió desde que se copió».
- [ ] A conflicting November value is kept unless «Reemplazar» is chosen.
- [ ] Copying a legacy (pre-079) total gives a total with «Desglose no disponible…», no invented items.

## 4. Numbers agree

- [ ] Costos and Rentabilidad show the **same** break-even for the same restaurant and month, immediately and after reload, without changing month.
- [ ] Missing categories: «Punto de equilibrio parcial», «Falta: …», never $0. A typed 0 counts as a figure.
- [ ] Tax line says «propia» or «heredada del grupo» with the month; a restaurant without its own rate shows the group's, labelled.
- [ ] After an approval the break-even shows «Recalculando…» then the new value (no stale final-looking number).
- [ ] Group total reconciles: restaurant totals + (no double count of the group share).

## 5. Undo and history

- [ ] «Deshacer» right after an approval restores the previous amounts and returns the lines to the review.
- [ ] Edit the category after approving, then try «Deshacer»: refused («Ese valor cambió después…»), your edit survives.
- [ ] History: copies name the source month; old unnamed copies say «origen no registrado»; no raw ids shown.

## 6. Permissions and enforcement

- [ ] A read-only member sees the numbers, no write controls; a forged call gets 403.
- [ ] Only after sections 1–5 pass: apply `080`, then repeat sections 1 and 3 once, and check that a direct `UPDATE` of `restaurant_fixed_costs` as an authenticated user is refused (permission denied).

## Abort criteria

Any total that moves without a command in History; a November change after an October approval; Costos ≠ Rentabilidad
for identical inputs; any write caused only by opening a page.
