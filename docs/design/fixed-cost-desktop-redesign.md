# Fixed costs, desktop/web redesign: scope, status, backend gaps

Branch `claude/fixed-cost-desktop-redesign`. **HOLD FOR FEDE REVIEW.** No migration was applied, nothing was
merged or deployed. The native phone app is untouched.

## What this PR contains

It is built on top of **PR #496** (`claude/fixed-cost-data-layer`, head `371662e`, still OPEN and unmerged when
this branch was cut) with current `r1-staging` (`92b7cd1`) merged in. PR #496's commits are included unchanged;
review this PR's own diff by comparing with `claude/fixed-cost-data-layer`. If #496 merges first, this PR's diff
shrinks to the redesign only. **Migrations 079/080 are PR #496's and are still unapplied everywhere except Milton
Staging (079 installed and verified there, per the last report).**

## Requirement → status

| # | Requirement | Status |
| --- | --- | --- |
| 1 | Three months ending in the selected month, window navigation | Done (`FixedCostOverview`, `monthWindow`) |
| 1 | Cash categories as rows, expandable positions, amount opens detail/source, not editable | Done |
| 1 | Restaurant selector persistent | The shell's existing selector is unchanged; the workspace names the restaurant |
| 1 | Shared allocations separate, read-only, once | Done: separate rows; combined = engine total |
| 1 | Tax rate separate from money | Done: own row, shown as a rate, never summed |
| 1 | Recorded / recurring reference / missing / confirmed zero / draft | Done (five visibly different states) |
| 1 | Missing never `$0`; no invented breakdown for legacy aggregates | Done (dash + «Falta»; one flagged «sin detalle» row) |
| 1 | Partial totals with what is missing; no final-looking daily target when incomplete | Done: target shown only when the engine says `complete` |
| 1 | Reuse shared definitions | Done: every figure comes from `computeFixedFigures` via `loadFixedCostsView` |
| 2 | One import review, one confirmation; destination shown once; grouped by month | Done (`FixedCostImport`, `buildReview`) |
| 2 | Before/after, resulting sums, unresolved items inline | Done |
| 2 | October file while viewing November keeps November; «Noviembre no cambió» only when verified | Done: said only when the database's own answer proves no category of that month/scope changed |
| 2 | «Ver meses actualizados» for off-window destinations; never silent selection change | Done |
| 2 | Atomic apply through canonical commands, no hidden partial success | Done: one `approve` command (079); lines that cannot be saved are listed before confirming |
| 3 | Stable item identity; update vs additional contribution | **Blocked: needs database support** (gap 1) |
| 3 | Breakdown replacing a summary never counts both | Works at category level (tested); not at item level |
| 3 | Retain omitted existing items unless removal is reviewed | **Blocked** (gap 2) |
| 3 | Exact re-upload no effect | Done (tested on Postgres). File hash alone is not used for this |
| 3 | Revised upload reconciles its previous contribution | **Blocked** (gap 1, 2) |
| 3 | Recurring: one explicit review, detail preserved, protect existing amounts, no writes on read | Partly done (category level, `FixedCostRecurring`); one-offs: gap 3 |
| 4 | Activity grouped by operation, collapsed, before/after, distinct approve/undo/re-approve labels | Done (`FixedCostActivity`, `buildActivity`) |
| 5 | Acceptance fixtures | Done as synthetic fixtures (unit + Postgres) |

## Backend gaps (documented, NOT executed, NOT faked)

1. **No stable item identity.** `fixed_cost_items` has `label` but no stable key. 079 already folds labels to
   detect an exact duplicate inside one approval, but nothing links "Luz in a revised file" to "Luz already recorded".
   Proposed (new migration, needs review): `item_key text` (normalized label, unique per active item within
   `company/scope/month/category`), written on insert, plus `fixed_cost_preview_upload` returning, per incoming line,
   `match: 'same' | 'changed' | 'new'` against the active item with the same key.
2. **A reviewed per-item changeset command.** Today an overlap offers only `replace` (drops existing items the file
   did not mention) or `add` (counts a revised item twice). Both are executable in
   `tests/pg/redesign.test.ts` as the two `GAP:` tests. Proposed: `decisions` per item (`update | add | keep |
   remove`) with `keep` as the default for omitted items, applied in the same transaction and recorded in
   `fixed_cost_commands.before_state/after_state` so undo stays server-derived.
3. **No per-item recurrence flag.** `repeats` lives on the aggregate, so «accept recurring» is category-level and
   cannot exclude one-off items inside a category. Proposed: `recurring boolean` on `fixed_cost_items` and a copy
   mode that copies only those.
4. **Idempotency beyond file bytes.** `file_sha256` exists, and the exact-reupload no-op already comes from the
   financial comparison (kind `noop`), not from the hash. No change needed; recorded here because the brief asks.

Until 1-3 exist the UI offers only what is true today and says what each option does to the amount.

## Cross-surface notes (flagged, not changed)

- The phone payload keeps `breakEvenPerDay` complete-only; the desktop overview follows the same rule. The two agree.
- `latestOpenDraft` is still company-wide (pre-existing, noted in #496): an open draft of another restaurant can be
  resumed in this review.
- The old `FixedCostsTab` / `FixedCostUpload` components and their tests remain in the tree, unused by the page.
  They can be deleted once this review is accepted; deleting them here would remove five legacy test files.
- Rentabilidad's own screen was not re-verified in a browser in this PR.

## Verification limits

Screenshots (`docs/qa/fixed-cost-desktop-redesign/`) are of the real components in a desktop browser with
**synthetic fixtures and a mocked network**. They were NOT taken against a hosted preview, and a real
workbook was not uploaded. No hosted database was read or written.

## Round 2 (review feedback): mapping, wording, destination, saved-result check

- **Unclear lines are mapped inline again** (same review screen). Category picker (Planilla, Alquiler, Servicios,
  Otros) with a suggestion (insurance/utilities → Servicios, unknown → Otros) that still takes one click; a
  restaurant picker for an unknown branch; «No incluir» for any line (reversible until confirmed). Assignments are
  draft edits (`PATCH /upload`, no money) and the database re-previews, so before/after totals update live.
  Confirmation needs every line assigned or explicitly excluded; excluded lines are discarded first, then ONE approval.
  A line with no amount, no month or a repeated tax rate cannot be fixed here: only «No incluir».
- **Overlap wording** states the outcome («Usar el monto del archivo: Planilla de octubre pasa de … a …» /
  «Es un gasto extra: sumar … a los … actuales = …» / «Cambiar la tasa de 15% a 13%»). «Use the file's amount» is
  recommended for a full monthly statement (≥3 monthly categories) but never pre-selected.
- **Destination**: in the group view the upload asks «¿A dónde van estos costos?» (a restaurant, or the shared group
  costs) BEFORE reading the file; shared is never a default. The review heading and the confirm button both name it
  («Guardar en Cantina Demo · Octubre 2026»).
- **Issue 4 (table vs approval)**: see the PR description. The saved result is now taken from the command's own
  answer; the result card lists it, checks it against the table on screen, and a cell is highlighted only while it
  shows the saved value. A save into another destination is said to be elsewhere, with a button to open it.
- **Activity**: an empty list reads «Todavía no hay operaciones» (not «0 operaciones recientes»); operations that touched
  another restaurant or the group are counted in a note instead of silently missing.

Screenshots: `docs/qa/fixed-cost-redesign-r2/` (same synthetic-fixture, mocked-network harness as round 1).
