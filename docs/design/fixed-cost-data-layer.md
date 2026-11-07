# Fixed costs data layer — design and review package

Branch `claude/fixed-cost-data-layer`, base `origin/r1-staging` at `2c9e08a` (the audit baseline; fetched
2026-11-07, nothing newer on `r1-staging`, so there were no intervening changes to reconcile).

**Status.** Code and migration files only. **No hosted migration, no hosted write, no deploy, no merge, no
push.** Migrations `079` and `080` are authored and proven on a disposable local Postgres. Hosted application
needs Fede's approval (section 9).

Direction: B (canonical items + transactional commands) + C (explicit recurrence) + D (one financial engine).
Evidence it answers: `docs/audits/fixed-costs-data-integrity-audit.md` (kept out of git).

---

## 1. What changed for the monthly workflow

- An upload shows **where every line will be saved** (month and restaurant/group) before approval and lets the
  person change that month. The month on screen is only where they are looking. Approving October while viewing
  November says «Se guardó en octubre de 2026. noviembre de 2026 no cambió.»
- Approval is **one transaction**: items, aggregate, history, draft status and the idempotency result commit
  together or not at all. The screen says «Recalculando…» until the server answers; nothing is shown ahead of
  the commit.
- **Opening a month never writes.** The render-time «repeat» is gone. Copying a month is a button
  («Copiar de septiembre») that opens a preview and writes only on «Copiar». A copy is a snapshot; editing the
  source later does not move it, and the preview says when the source changed since the copy.
- Cards list the **real items** (they survive reload, edits, re-uploads and copies). A legacy total shows its
  honest amount and «Desglose no disponible para este registro.»; it is never shown empty.
- Counts: `Categorías confirmadas: n de 5` (several Servicios lines are one category) and
  `{n} líneas aprobadas · {m} ya estaban aprobadas` for an upload.
- One break-even function everywhere. Incomplete results are labelled «Punto de equilibrio parcial» with what is
  missing (categories, tax rate, sales, open days). Tax shows its source: this restaurant's, inherited from the
  group (with the month), or not set.
- History says what happened; an old copy row that never stored a source says «copiado de un mes anterior
  (origen no registrado)» and is not relabelled.

## 2. Architecture and invariant map

| Invariant | Database | Application | Tests |
| --- | --- | --- | --- |
| Aggregate = Σ active items, exactly (itemized keys) | deferred constraint triggers `fixed_cost_items_invariant`, `restaurant_fixed_costs_invariant` → `fc_check_key` (SQLSTATE `FC500` at COMMIT, for every writer incl. the table owner) | none needed | `security.test.ts` "can NOT break an itemized key"; `concurrency.test.ts` last case |
| Legacy aggregate-only is explicit, never fabricated | `detail_state='legacy_total'` (default of every pre-079 row); no items allowed for such a key | card says «Desglose no disponible…» | `approve.test.ts` legacy group; `commands.test.ts` legacy copy |
| Unknown legacy part next to known items | one flagged item `kind='legacy_base'` (unique per key), keeps Σ exact | shown as the unavailable row | `approve.test.ts` "add on a legacy total" |
| Exact money | `amount_cents bigint`; `numeric(14,2)` aggregate; `numeric(5,2)` rates; scale 2 = the existing column scale | `toCents`, no float arithmetic crosses the boundary | `fixed-cost-commands.test.ts`, PG tests |
| Tax rate is not a cash item | `fixed_cost_items.category` CHECK excludes `impuestos`; rate stays on the aggregate (`pct_of_sales`) | engine subtracts it once inside the margin | engine tests |
| One row per company/scope/month/category | existing unique index (NULL = group, via COALESCE) + advisory-lock keys | — | `concurrency.test.ts` missing-category race |
| All mutations are commands | 7 `SECURITY DEFINER` functions; 080 revokes direct DML | `fixed-cost-commands.ts` is the only writer | `fixed-cost-writer-inventory.test.ts`, `security.test.ts` (080 case) |
| Items + aggregate + history + draft + idempotency together | one plpgsql function = one transaction | — | `commands.test.ts` "atomic failure" (3 injection points + undo) |
| Idempotency | unique `(company_id, actor, command_key)` + payload SHA-256; same key/other payload → `FC409 idempotency_key_reuse`; replay returns the stored result | browser sends a fresh `commandKey` per intent | `approve.test.ts` idempotency (lost response, key reuse, 3 concurrent) |
| No lost update / stale review | expected draft version + expected aggregate version per key, checked **under the locks**; versions come from one sequence (no ABA after delete/recreate) | review sends the versions it read | `approve.test.ts` stale; `concurrency.test.ts` |
| Real domain locks | `pg_advisory_xact_lock(hash(company|scope|month|category))`, all keys of a command, sorted, **before** validation; draft row `FOR UPDATE` only afterwards; `lock_timeout` 5 s | busy → 503, safe to retry | `concurrency.test.ts` (two different drafts, manual vs upload, copy vs source change, 24 opposite-order runs, 0 deadlocks) |
| Authorization | `fc_assert_writer`: `auth.uid()` + `has_company_role(owner/admin/manager)` or Milton admin member; cross-tenant ids answer `FC404`; location must belong to the company; anon and service_role cannot execute | session client only; no service key | `security.test.ts` |
| Undo is server-derived | undo takes only a command id; before-state stored by the command; refused (`FC409 changed_since`) if any key's version moved; once only | route forwards `{commandId, commandKey}` | `commands.test.ts` undo; `fixed-cost-command-routes.test.ts` |
| Reads never write | no function called by a loader writes | page has no writer; scan test | `fixed-cost-read-and-allocation.test.ts` |
| Preview has no side effects | `fixed_cost_preview_upload`, `fixed_cost_preview_copy` are `STABLE` | GET routes call only previews | PG count-before/after; route tests |

### Rounding and currency

Item amounts are integer cents (scale 2, same as `numeric(14,2)`). The group split is unchanged (largest
remainder in cents, computed at read time). The currency is resolved on the server (it can depend on Odoo POS
data) and the database only checks that it is a 3-letter code consistent with the company's existing rows.
Zero-decimal or three-decimal currencies are not supported by this scale; the app only offers USD/MXN/EUR.

### Locking, deadlocks, contention

Every command builds the full set of keys it can touch (an upload: every destination; a copy: source **and**
destination; an undo: the original command's keys), sorts them with `COLLATE "C"`, and locks them in that order
before reading state for validation. One global order means fixed-cost commands cannot deadlock each other; the
24-iteration opposite-order test saw zero `40P01`. A held lock longer than 5 s fails with `55P03`, mapped to a
retryable 503. After the locks, state is re-read and versions compared, so a replace that raced another replace
sees the other's committed state or a stale-version refusal, never an overwrite. A copy holds the source key, so
its snapshot is one committed state.

## 3. Writers and readers

**Writers (all cut over).**

| Was | Now |
| --- | --- |
| `PUT /api/restaurant/fixed-costs` → `saveFixedCosts` (insert/update/delete + log) | → `fixed_cost_save_totals` (needs `commandKey`, `expectedVersion`) |
| `POST …/upload/approve` → `approveDraft` | → `fixed_cost_approve_upload` |
| `POST …/upload/undo` → `undoApproval` (trusted `applied`/`previous` from the body) | → `fixed_cost_undo` (command id only) |
| `repeatFixedCosts` on every costs page render + `POST …/repeat` | **removed**; `GET/POST …/fixed-costs/copy` → `fixed_cost_preview_copy` / `fixed_cost_copy` |
| (new) item add/edit/delete | `fixed_cost_item_command` (command + wrapper; no UI control yet, see 8) |
| Draft create/edit/discard (`fixed_cost_upload_drafts`) | still direct, by design: a draft is a work area. A trigger moves its `version` on every content change, so an approval that reviewed an older draft is rejected whichever writer changed it |

No other writer exists: ingredient-yield and kitchen-buffer routes only reuse the auth helper; the mobile
`costos`/`rentabilidad` routes read; there is no trigger, import or Odoo path that writes these tables. This is
asserted by `fixed-cost-writer-inventory.test.ts` over `app`, `lib`, `components`, `scripts` and `apps`.

**Readers.** Costos view (`loadFixedCostsView`), Rentabilidad web (`loadRentabilidad*`), group page, mobile
manager `costos` and `rentabilidad`, home, what-if. They all read the **aggregate** (the compatibility
projection) plus, for Costos, the active items. The aggregate is the only amount source: summing aggregates
already contains every item exactly once (`security.test.ts` "readers cannot double count"). Reading items on top
of aggregates is the double-count mistake and nothing does it.

## 4. One financial engine

`lib/restaurant/fixed-cost-engine.ts` (`computeFixedFigures`), pure, used by the Costos server view, the Costos
live preview in the browser (`figuresOf` delegates), and `computeRentabilidad`. The approved formula is
unchanged. Result contract:

- `complete` — four amount categories have a figure (a confirmed 0 counts) and margin, open days and a tax rate
  exist.
- `partial` — a number for the known categories plus `missing[]` (categories, tax, margin, open days).
- `unavailable` — `breakEven: null` and the reason; never 0, never a divide by zero.
- `RentabilidadMonth.breakEvenPerDay` stays the **complete** figure (null while anything is missing) so findings,
  group summaries and older mobile builds never use an understated target; the labelled partial value is
  `figures.breakEven` and the mobile payload adds `partialPerDay`, `status`, `missing` (additive fields).
- Both screens now read **confirmed** lines only (Costos used to include draft/estimate lines).

## 5. Allocation checkpoint (preserved, not invented)

Group costs are split at read time among the company's active restaurants (`groupSharesFor`, unchanged): `equal`
or largest-remainder by sales. For the current unclosed month this is dynamic and uses the live sales of the
month; refreshing it creates no rows. Verified in this repo: **no period-close or per-restaurant
eligibility/exclusion exists**, so none was added. A single-location company gets 100% of the group (the audited
case), several locations get shares that add to the group total to the cent
(`fixed-cost-read-and-allocation.test.ts`). Open for product: month-close freezing and exclusion of closed or
inactive restaurants (section 10).

## 6. Legacy data and migrations

- `079` (additive) and `080` (**not additive**, separate approval). Next free number was 079 (078 is the latest;
  074 has never existed in the repo).
- Existing totals are untouched; no backfill; no reconstruction of items from drafts or sums. A same-sum draft
  is an *overlap that needs a decision*, never an automatic backfill.
- «Sumar» on a legacy total keeps the old total as a single flagged `legacy_base`; «Reemplazar» establishes a
  reviewed known set.
- Optional legacy reconciliation (turning old drafts into items) is not part of this change. If wanted, it
  starts as a read-only report with confidence and ambiguity per key and needs Fede's approval.

## 7. Cutover, rollout and rollback

**Activation order (staging only, after approval).**
1. Apply `079` (additive). Verify: existing totals unchanged (row count and `sum(amount)` per month before/after),
   `secdef_guard.sql` returns 0 rows, `psql` check that every pre-existing aggregate has `detail_state='legacy_total'`.
2. Deploy this branch's application to the staging alias. Until `080`, an **older build** can still write the
   aggregate directly (it cannot break an itemized key, but it can skip versions, events and idempotency): keep
   staging write traffic on the new build only; check the served build id from the Vercel deployment record.
3. Run the QA checklist (`docs/qa/fixed-cost-data-layer-checklist.md`) with the synthetic file, then Fede's real file.
4. Apply `080` only after (2)–(3) pass. It revokes direct `INSERT/UPDATE/DELETE` on `restaurant_fixed_costs` and
   `restaurant_fixed_costs_log` from `authenticated`.
Abort if: totals differ after step 1; the guard returns rows; any step-3 result differs from the checklist.

**Release gate (written down, not accepted debt).** Between a new application build and `080`, any old build or
direct client can still write the **aggregate of a legacy key** without a version, event or idempotency key. The
new tables and itemized keys are protected by triggers regardless. Production must not take the new build
without `080` applied in the same release. Preview deployments and stale clients: the old routes are gone
(`/repeat` returns 404; `PUT` and `approve` now reject bodies without `commandKey`/versions), and after `080` the
database refuses their direct writes.

**Rollback by phase.**
- *Before hosted schema application:* abandon the branch. No hosted effect.
- *After `079`, before new writes:* the schema is additive with defaulted columns; the previous app build keeps
  working (verified: an old-style direct insert/update succeeds on the migrated schema, `security.test.ts`
  "cutover"). Nothing needs repair. Do not drop the new tables as routine rollback.
- *After canonical writes exist:* do **not** roll the app back to an old direct writer. Itemized keys are guarded
  by the triggers, but legacy keys could again be written without events. Prefer a write stop (revoke already
  in `080`) or a forward fix; if an old build must run, first run the read-only reconciliation (aggregate vs items
  vs history) and keep the `fixed_cost_items` / `fixed_cost_commands` data. If `080` was applied, restoring direct
  writes is a `GRANT` (stated in the file) and is a separate decision.
- Reverting only `080` is a one-line `GRANT` and is data-safe. Anything beyond that is not claimed as tested.

## 8. Known limits (honest)

- No UI control yet for adding/editing/deleting a single item on a card; the commands, wrapper and tests exist.
  Cards edit the category total (which asks before replacing a breakdown) and uploads add/replace lines.
- Source-difference **update** is the copy panel's «Reemplazar con lo de {mes}» (a reviewed command, guarded by
  the destination version); the difference itself is shown (`source changed since copy`) but there is no
  per-item diff view.
- `latestOpenDraft` is still company-wide with no age filter (pre-existing audit finding F-draft). Not changed.
- Real-file QA on the served staging build is pending approval. Local tests prove the data layer, not the staged
  real-file scenario.
- Hosted-only behaviour not provable locally: PostgREST error mapping of custom SQLSTATEs (`FC4xx`) and Supabase
  default privileges. The local harness replays the default-privilege grants and the guard passes, but the first
  staging call should be checked against `/rest/v1/rpc`.

## 9. Approval requested

> The code and migration files are ready for review; no hosted migration has run. Please approve applying
> `079_fixed_cost_items_and_commands.sql` to **staging only**, then (separately) `080_fixed_cost_enforce_command_boundary.sql`
> after the QA checklist passes. 079 adds two tables, six columns and the command functions; it changes no
> existing row or policy. 080 revokes direct writes to two existing tables (not additive; the exception to the
> additive rule is stated and needs your explicit yes). Existing totals will be preserved; no backfill or Demo
> reset is included. Production will not change. After approval we will verify the served build and your
> October-dated Excel from the November screen, then test explicit copying and matching Costos/Rentabilidad
> results.

## 10. Questions for Sofia / Fede

1. Missing tax rate: today's formula calculates with 0 %. This change labels that result **partial** and says the
   rate is not set instead of treating it as final. OK, or should a missing rate make the result unavailable?
2. Rentabilidad shows the labelled partial break-even inside its "faltan costos" card. Is that the right place?
3. Month close: should the group split freeze when a month closes? And should a closed/inactive restaurant stop
   receiving a share? (Nothing exists today; not implemented.)
4. After a copy, the destination keeps «Se repite cada mes» **off** (we never enable it silently). Should the
   preview pre-select only categories whose source had it on?
5. The same file uploaded twice is a clear no-op; a file with the same bytes but another month is a new
   destination. Is a "same file seen before" hint enough, or should it ask?
