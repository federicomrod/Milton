-- 079_fixed_cost_items_and_commands.sql
--
-- Fixed costs data layer: canonical items, a transactional command boundary,
-- idempotency and an audit ledger. Follows docs/audits/fixed-costs-data-integrity-audit.md
-- (direction B + C + D) and docs/design/fixed-cost-data-layer.md.
--
-- STATUS: AUTHORED, NOT APPLIED to any hosted database. Needs Fede's approval
-- before it runs on staging. Production is a separate decision.
--
-- WHAT IS ADDITIVE (everything in this file)
--   * 2 new tables: fixed_cost_items, fixed_cost_commands (RLS on, SELECT for
--     company members only, NO insert/update/delete policy and no DML grant:
--     only the command functions below write them).
--   * New nullable / defaulted columns on the existing tables (metadata-only
--     in Postgres 11+, no rewrite, no data change):
--       restaurant_fixed_costs.version, .detail_state, .copy_source
--       restaurant_fixed_costs_log.command_id
--       fixed_cost_upload_drafts.version, .file_sha256
--   * Deferred constraint triggers that keep the aggregate row equal to the sum
--     of its active items. They never reject legacy rows (see "LEGACY" below).
--   * A private schema, fixed_cost_private, holding the seven SECURITY DEFINER command
--     implementations, the internal helpers and the version sequence; and seven
--     SECURITY INVOKER wrappers in public (the only API surface). Privileges on every
--     new function, sequence and table are stated explicitly (section 12), because
--     hosted default privileges would otherwise open them to the API roles.
--   Existing rows are not touched. No backfill. Existing totals stay exactly as
--   they are.
--
-- WHAT IS NOT IN THIS FILE
--   Revoking the old direct INSERT/UPDATE/DELETE on restaurant_fixed_costs,
--   restaurant_fixed_costs_log and fixed_cost_upload_drafts is NOT additive and
--   lives in 080_fixed_cost_enforce_command_boundary.sql, which needs its own
--   explicit approval. Until 080 is applied, an old build can still write the
--   aggregate directly (it cannot break an itemized key, because of the
--   constraint triggers, but it can skip versions, events and idempotency).
--   That is a RELEASE GATE, not an accepted state.
--
-- MONEY
--   Item amounts are integer minor units (amount_cents, scale 2), the same
--   scale as the existing numeric(14,2) column. Percentages stay numeric(5,2)
--   (exact decimal). The currency is resolved by the server (it can depend on
--   Odoo POS data) and is checked here only for consistency with the company's
--   existing rows. Group splits stay a read-time calculation (largest
--   remainder, cents), unchanged.
--
-- LEGACY
--   An existing aggregate row has detail_state = 'legacy_total': a known total
--   whose detail is NOT known. It has no items and none are invented. A reviewed
--   full replacement turns it into an itemized key. «Sumar» on a legacy total
--   keeps the old total as ONE separate item of kind 'legacy_base' (unknown
--   detail, flagged), so aggregate = sum(items) still holds and the UI can say
--   «Desglose no disponible» for exactly that part.
--
-- LOCKING (every writer, same protocol)
--   Keys are 'company|scope|month|category' (scope = location uuid or 'group').
--   Each command collects ALL keys it can touch, sorts them, and takes
--   pg_advisory_xact_lock on each in that order BEFORE reading state for
--   validation. Draft rows are locked FOR UPDATE only after the domain locks.
--   One global order => no deadlocks between fixed-cost commands. A lock wait is
--   bounded by lock_timeout (5 s) and surfaces as SQLSTATE 55P03 (retryable).
--
-- ERRORS (custom SQLSTATE class FC)
--   FC401 not signed in · FC403 not a writer of that company · FC404 not found
--   (also used for another company's ids, so nothing leaks) · FC409 stale
--   version / idempotency key reuse / later changes block an undo · FC422
--   invalid request · FC500 invariant violation (aggregate != sum of items).

-- ---------------------------------------------------------------------------
-- 0. Private schema for the privileged implementation
-- ---------------------------------------------------------------------------
-- Supabase guidance: SECURITY DEFINER code belongs in a schema the API does not
-- expose. Everything privileged (the seven command implementations, every fc_*
-- helper, the trigger functions and the version sequence) lives in
-- fixed_cost_private. The API surface in `public` is seven thin SECURITY INVOKER
-- wrappers (section 11) that call the implementations. Do NOT add
-- fixed_cost_private to the API's exposed schemas.

CREATE SCHEMA IF NOT EXISTS fixed_cost_private;
REVOKE ALL ON SCHEMA fixed_cost_private FROM PUBLIC, anon, service_role;
GRANT USAGE ON SCHEMA fixed_cost_private TO authenticated;

-- ---------------------------------------------------------------------------
-- 1. Additive columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.restaurant_fixed_costs
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS detail_state text NOT NULL DEFAULT 'legacy_total',
  ADD COLUMN IF NOT EXISTS copy_source jsonb NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_fixed_costs_detail_state_chk'
  ) THEN
    ALTER TABLE public.restaurant_fixed_costs
      ADD CONSTRAINT restaurant_fixed_costs_detail_state_chk
      CHECK (detail_state IN ('legacy_total', 'itemized'));
  END IF;
END
$$;

COMMENT ON COLUMN public.restaurant_fixed_costs.detail_state IS
  'legacy_total = a known total with NO known detail (every row that existed before 079; also impuestos, where it does not apply). itemized = amount equals the sum of the active fixed_cost_items of the same key (enforced at commit).';
COMMENT ON COLUMN public.restaurant_fixed_costs.version IS
  'Optimistic version of this aggregate row: +1 on every change made by a command.';
COMMENT ON COLUMN public.restaurant_fixed_costs.copy_source IS
  'Set only by an explicit copy: {month, aggregate_version, command_id}. Null = not a copy or provenance unknown.';

ALTER TABLE public.restaurant_fixed_costs_log
  ADD COLUMN IF NOT EXISTS command_id uuid NULL;

ALTER TABLE public.fixed_cost_upload_drafts
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS file_sha256 text NULL;

COMMENT ON COLUMN public.fixed_cost_upload_drafts.file_sha256 IS
  'Hash of the uploaded bytes: evidence of file identity only, never the sole financial identity.';

-- ---------------------------------------------------------------------------
-- 2. Command ledger (idempotency + audit event + server-derived undo snapshot)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.fixed_cost_commands (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  actor         uuid NOT NULL,
  command_key   text NOT NULL,
  kind          text NOT NULL,
  payload_hash  text NOT NULL,
  draft_id      uuid NULL,
  undo_of       uuid NULL REFERENCES public.fixed_cost_commands(id),
  -- [{location_id, month, category}] every key the command touched.
  affected      jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- {key: {aggregate, items}} committed state BEFORE the command (server-derived).
  before_state  jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- {key: {version}} aggregate version AFTER the command (the undo guard).
  after_state   jsonb NOT NULL DEFAULT '{}'::jsonb,
  result        jsonb NOT NULL DEFAULT '{}'::jsonb,
  finalized     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixed_cost_commands_kind_chk CHECK (kind IN (
    'approve_upload', 'save_totals', 'item_add', 'item_update', 'item_delete',
    'copy', 'undo')),
  CONSTRAINT fixed_cost_commands_key_chk CHECK (length(command_key) BETWEEN 8 AND 120)
);

-- The idempotency boundary: one result per (company, actor, key).
CREATE UNIQUE INDEX IF NOT EXISTS fixed_cost_commands_key_uniq
  ON public.fixed_cost_commands (company_id, actor, command_key);
-- A command can be undone at most once.
CREATE UNIQUE INDEX IF NOT EXISTS fixed_cost_commands_undo_once
  ON public.fixed_cost_commands (undo_of) WHERE undo_of IS NOT NULL;
CREATE INDEX IF NOT EXISTS fixed_cost_commands_company_created_idx
  ON public.fixed_cost_commands (company_id, created_at DESC);

COMMENT ON TABLE public.fixed_cost_commands IS
  'One row per committed fixed-cost command: idempotency key, payload fingerprint, the affected keys, the committed before-state (for a server-derived undo) and the result. Written only by the fc command functions.';

-- A finalized command is history: it cannot be edited.
CREATE OR REPLACE FUNCTION fixed_cost_private.fc_commands_immutable()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF OLD.finalized THEN
    RAISE EXCEPTION 'fixed_cost_commands rows are immutable once finalized'
      USING ERRCODE = 'FC500';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fixed_cost_commands_immutable ON public.fixed_cost_commands;
CREATE TRIGGER fixed_cost_commands_immutable
  BEFORE UPDATE ON public.fixed_cost_commands
  FOR EACH ROW EXECUTE FUNCTION fixed_cost_private.fc_commands_immutable();

-- ---------------------------------------------------------------------------
-- 3. Canonical items (cash categories only; a tax RATE is never an item)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.fixed_cost_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Insertion order, stable inside one transaction (created_at is the
  -- transaction time, so it ties).
  seq                bigint GENERATED ALWAYS AS IDENTITY,
  company_id         uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- NULL = group scope.
  location_id        uuid NULL,
  month              date NOT NULL,
  category           text NOT NULL,
  -- 'item' = a known cost line. 'legacy_base' = the old total of an aggregate
  -- whose detail is unknown, kept as ONE flagged item so the sum stays exact.
  kind               text NOT NULL DEFAULT 'item',
  label              text NULL,
  amount_cents       bigint NOT NULL,
  currency           text NOT NULL,
  status             text NOT NULL DEFAULT 'active',
  version            integer NOT NULL DEFAULT 1,
  -- Provenance that is actually known: {draft_id, line_id, file_name,
  -- file_sha256} for an upload; {source_item_id, source_month,
  -- source_aggregate_version} for a copy of an itemized source;
  -- {unknown_detail: true} for a legacy_base. Never guessed.
  origin             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_command uuid NOT NULL REFERENCES public.fixed_cost_commands(id),
  retired_by_command uuid NULL REFERENCES public.fixed_cost_commands(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixed_cost_items_category_chk
    CHECK (category IN ('planilla', 'alquiler', 'servicios', 'otros')),
  CONSTRAINT fixed_cost_items_kind_chk CHECK (kind IN ('item', 'legacy_base')),
  CONSTRAINT fixed_cost_items_status_chk CHECK (status IN ('active', 'retired')),
  CONSTRAINT fixed_cost_items_amount_chk CHECK (amount_cents >= 0),
  CONSTRAINT fixed_cost_items_month_chk CHECK (month = date_trunc('month', month)::date),
  CONSTRAINT fixed_cost_items_currency_chk CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT fixed_cost_items_retired_chk
    CHECK ((status = 'retired') = (retired_by_command IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS fixed_cost_items_key_idx
  ON public.fixed_cost_items (
    company_id,
    COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    month, category)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS fixed_cost_items_command_idx
  ON public.fixed_cost_items (created_by_command);

-- At most one legacy_base per key (the unknown part is a single clearly
-- separated amount, not a pile of imagined pieces).
CREATE UNIQUE INDEX IF NOT EXISTS fixed_cost_items_one_legacy_base
  ON public.fixed_cost_items (
    company_id,
    COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    month, category)
  WHERE status = 'active' AND kind = 'legacy_base';

COMMENT ON TABLE public.fixed_cost_items IS
  'Canonical monthly cost items (cash categories). The restaurant_fixed_costs row of an itemized key is a derived projection equal to the sum of its active items. Retired items stay for audit and undo.';

-- ---------------------------------------------------------------------------
-- 4. The invariant, enforced by the database at COMMIT
-- ---------------------------------------------------------------------------
-- itemized key  : aggregate exists, detail_state = 'itemized',
--                 round(amount*100) = sum(active item cents), >= 1 active item.
-- legacy key    : no active items (a known total with unknown detail).
-- Checked for the OLD and NEW key of every insert/update/delete on either
-- table, deferred to commit so a command may change both in any order.

CREATE OR REPLACE FUNCTION fixed_cost_private.fc_check_key(
  p_company uuid, p_loc uuid, p_month date, p_cat text)
RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  a public.restaurant_fixed_costs%ROWTYPE;
  n bigint;
  s bigint;
  have boolean;
BEGIN
  SELECT * INTO a FROM public.restaurant_fixed_costs f
   WHERE f.company_id = p_company
     AND f.location_id IS NOT DISTINCT FROM p_loc
     AND f.month = p_month AND f.category = p_cat;
  have := FOUND;
  SELECT count(*), COALESCE(sum(i.amount_cents), 0) INTO n, s
    FROM public.fixed_cost_items i
   WHERE i.company_id = p_company
     AND i.location_id IS NOT DISTINCT FROM p_loc
     AND i.month = p_month AND i.category = p_cat AND i.status = 'active';
  IF n > 0 THEN
    IF NOT have OR a.detail_state <> 'itemized'
       OR a.amount IS NULL OR round(a.amount * 100)::bigint <> s THEN
      RAISE EXCEPTION 'fixed cost aggregate does not equal the sum of its items (% / % / %)',
        p_month, p_cat, COALESCE(p_loc::text, 'group')
        USING ERRCODE = 'FC500';
    END IF;
  ELSIF have AND a.detail_state = 'itemized' THEN
    RAISE EXCEPTION 'itemized fixed cost aggregate has no active items (% / % / %)',
      p_month, p_cat, COALESCE(p_loc::text, 'group')
      USING ERRCODE = 'FC500';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION fixed_cost_private.fc_check_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM fixed_cost_private.fc_check_key(OLD.company_id, OLD.location_id, OLD.month, OLD.category);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM fixed_cost_private.fc_check_key(NEW.company_id, NEW.location_id, NEW.month, NEW.category);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS fixed_cost_items_invariant ON public.fixed_cost_items;
CREATE CONSTRAINT TRIGGER fixed_cost_items_invariant
  AFTER INSERT OR UPDATE OR DELETE ON public.fixed_cost_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fixed_cost_private.fc_check_trg();

DROP TRIGGER IF EXISTS restaurant_fixed_costs_invariant ON public.restaurant_fixed_costs;
CREATE CONSTRAINT TRIGGER restaurant_fixed_costs_invariant
  AFTER INSERT OR UPDATE OR DELETE ON public.restaurant_fixed_costs
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fixed_cost_private.fc_check_trg();

-- Versions come from ONE sequence, so a version number is never reused: a key
-- deleted and re-created cannot come back with a version a stale client holds
-- (no ABA). Gaps after a rollback are harmless. It starts at 1000 so a version it
-- hands out never equals the column default (1) that untouched rows carry.
CREATE SEQUENCE IF NOT EXISTS fixed_cost_private.fixed_cost_version_seq START WITH 1000;

-- A draft is a work area, not financial truth, so writers may keep editing it
-- directly. What matters is that every content change moves its version, so an
-- approval that reviewed an older draft is rejected (stale_draft) whichever
-- writer made the change.
CREATE OR REPLACE FUNCTION fixed_cost_private.fc_draft_version_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.parsed_lines IS DISTINCT FROM OLD.parsed_lines AND NEW.version = OLD.version THEN
    NEW.version := nextval('fixed_cost_private.fixed_cost_version_seq');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fixed_cost_upload_drafts_version ON public.fixed_cost_upload_drafts;
CREATE TRIGGER fixed_cost_upload_drafts_version
  BEFORE UPDATE ON public.fixed_cost_upload_drafts
  FOR EACH ROW EXECUTE FUNCTION fixed_cost_private.fc_draft_version_trg();

-- ---------------------------------------------------------------------------
-- 5. RLS: members read; nobody writes the new tables except the commands
-- ---------------------------------------------------------------------------

ALTER TABLE public.fixed_cost_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixed_cost_commands ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'fixed_cost_items' AND policyname = 'fixed_cost_items_member_select') THEN
    CREATE POLICY fixed_cost_items_member_select ON public.fixed_cost_items
      FOR SELECT USING (public.is_company_member(company_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'fixed_cost_commands' AND policyname = 'fixed_cost_commands_member_select') THEN
    CREATE POLICY fixed_cost_commands_member_select ON public.fixed_cost_commands
      FOR SELECT USING (public.is_company_member(company_id));
  END IF;
END
$$;

REVOKE ALL ON TABLE public.fixed_cost_items FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.fixed_cost_commands FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.fixed_cost_items TO authenticated;
GRANT SELECT ON TABLE public.fixed_cost_commands TO authenticated;
GRANT ALL ON TABLE public.fixed_cost_items TO service_role;
GRANT ALL ON TABLE public.fixed_cost_commands TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Internal helpers (not callable by API roles)
-- ---------------------------------------------------------------------------


CREATE OR REPLACE FUNCTION fixed_cost_private.fc_fail(p_code text, p_msg text, p_detail jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION '%', p_msg USING ERRCODE = p_code, DETAIL = COALESCE(p_detail::text, '');
END $$;

-- 'group|2026-10-01|servicios' or '<uuid>|2026-10-01|servicios'
CREATE OR REPLACE FUNCTION fixed_cost_private.fc_key(p_loc uuid, p_month date, p_cat text)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT COALESCE(p_loc::text, 'group') || '|' || p_month::text || '|' || p_cat
$$;

-- The caller must be a signed-in WRITER of the company (owner, admin, manager,
-- or a Milton admin who is also a member). Read membership is not enough.
CREATE OR REPLACE FUNCTION fixed_cost_private.fc_assert_writer(p_company uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    PERFORM fixed_cost_private.fc_fail('FC401', 'not_authenticated');
  END IF;
  IF p_company IS NULL OR NOT (
       public.has_company_role(p_company, ARRAY['owner', 'admin', 'manager'])
       OR (public.is_company_member(p_company) AND public.is_milton_admin())
     ) THEN
    PERFORM fixed_cost_private.fc_fail('FC403', 'forbidden');
  END IF;
  RETURN v_uid;
END $$;

-- A restaurant id must belong to the company.
CREATE OR REPLACE FUNCTION fixed_cost_private.fc_assert_scope(p_company uuid, p_loc uuid)
RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF p_loc IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.restaurant_locations l
        WHERE l.id = p_loc AND l.company_id = p_company) THEN
    PERFORM fixed_cost_private.fc_fail('FC422', 'invalid_scope');
  END IF;
END $$;

-- The currency is server-resolved; here it only has to be a code that agrees
-- with what the company already stores.
CREATE OR REPLACE FUNCTION fixed_cost_private.fc_assert_currency(p_company uuid, p_currency text)
RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_existing text;
BEGIN
  IF p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$' THEN
    PERFORM fixed_cost_private.fc_fail('FC422', 'invalid_currency');
  END IF;
  SELECT f.currency INTO v_existing FROM public.restaurant_fixed_costs f
   WHERE f.company_id = p_company ORDER BY f.created_at LIMIT 1;
  IF v_existing IS NOT NULL AND v_existing <> p_currency THEN
    PERFORM fixed_cost_private.fc_fail('FC422', 'currency_mismatch');
  END IF;
END $$;

-- Takes the advisory lock of every key, sorted, de-duplicated. Same function
-- and same order for every writer.
CREATE OR REPLACE FUNCTION fixed_cost_private.fc_lock_keys(p_company uuid, p_keys text[])
RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  k text;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  FOR k IN SELECT s.x FROM (SELECT DISTINCT u.x FROM unnest(p_keys) AS u(x)) s ORDER BY s.x COLLATE "C" LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(p_company::text || '|' || k, 0));
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION fixed_cost_private.fc_snapshot(
  p_company uuid, p_loc uuid, p_month date, p_cat text)
RETURNS jsonb LANGUAGE sql STABLE
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT jsonb_build_object(
    'aggregate', (
      SELECT to_jsonb(f) FROM public.restaurant_fixed_costs f
       WHERE f.company_id = p_company AND f.location_id IS NOT DISTINCT FROM p_loc
         AND f.month = p_month AND f.category = p_cat),
    'items', COALESCE((
      SELECT jsonb_agg(to_jsonb(i) ORDER BY i.seq)
        FROM public.fixed_cost_items i
       WHERE i.company_id = p_company AND i.location_id IS NOT DISTINCT FROM p_loc
         AND i.month = p_month AND i.category = p_cat AND i.status = 'active'),
      '[]'::jsonb))
$$;

CREATE OR REPLACE FUNCTION fixed_cost_private.fc_norm(p text)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT lower(btrim(regexp_replace(COALESCE(p, ''), '\s+', ' ', 'g')))
$$;

CREATE OR REPLACE FUNCTION fixed_cost_private.fc_log(
  p_cmd uuid, p_company uuid, p_fixed_id uuid, p_loc uuid, p_month date, p_cat text,
  p_actor uuid, p_action text, p_old jsonb, p_new jsonb, p_source text)
RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  INSERT INTO public.restaurant_fixed_costs_log
    (company_id, fixed_cost_id, location_id, month, category, actor, action,
     old_value, new_value, source, command_id)
  VALUES
    (p_company, p_fixed_id, p_loc, p_month, p_cat, p_actor, p_action,
     p_old, p_new || jsonb_build_object('command_id', p_cmd), p_source, p_cmd);
END $$;

-- Rebuilds the aggregate row of an itemized key from its active items.
-- Returns the new version (null when the key ends up empty and the row is gone).
CREATE OR REPLACE FUNCTION fixed_cost_private.fc_project(
  p_company uuid, p_loc uuid, p_month date, p_cat text, p_currency text,
  p_actor uuid, p_source text, p_repeats boolean, p_split text, p_copy_source jsonb)
RETURNS integer LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  n bigint;
  s bigint;
  labels text;
  a public.restaurant_fixed_costs%ROWTYPE;
  v_ver integer;
BEGIN
  SELECT count(*), COALESCE(sum(i.amount_cents), 0),
         left(string_agg(i.label, ' + ' ORDER BY i.seq)
              FILTER (WHERE i.kind = 'item' AND i.label IS NOT NULL), 120)
    INTO n, s, labels
    FROM public.fixed_cost_items i
   WHERE i.company_id = p_company AND i.location_id IS NOT DISTINCT FROM p_loc
     AND i.month = p_month AND i.category = p_cat AND i.status = 'active';
  SELECT * INTO a FROM public.restaurant_fixed_costs f
   WHERE f.company_id = p_company AND f.location_id IS NOT DISTINCT FROM p_loc
     AND f.month = p_month AND f.category = p_cat
   FOR UPDATE;
  IF n = 0 THEN
    IF FOUND THEN
      DELETE FROM public.restaurant_fixed_costs WHERE id = a.id;
    END IF;
    RETURN NULL;
  END IF;
  IF FOUND THEN
    UPDATE public.restaurant_fixed_costs SET
      amount = s::numeric / 100, pct_of_sales = NULL, detail_state = 'itemized',
      label = labels, status = 'confirmed', source = p_source,
      repeats = COALESCE(p_repeats, a.repeats),
      split_rule = CASE WHEN p_loc IS NULL THEN COALESCE(p_split, a.split_rule, 'sales') ELSE NULL END,
      copy_source = p_copy_source,
      version = nextval('fixed_cost_private.fixed_cost_version_seq'), updated_by = p_actor, updated_at = now()
     WHERE id = a.id
     RETURNING version INTO v_ver;
    RETURN v_ver;
  END IF;
  INSERT INTO public.restaurant_fixed_costs
    (company_id, location_id, month, category, label, amount, currency, source, status,
     repeats, split_rule, detail_state, copy_source, version, created_by, updated_by)
  VALUES
    (p_company, p_loc, p_month, p_cat, labels, s::numeric / 100, p_currency, p_source,
     'confirmed', COALESCE(p_repeats, false),
     CASE WHEN p_loc IS NULL THEN COALESCE(p_split, 'sales') ELSE NULL END,
     'itemized', p_copy_source, nextval('fixed_cost_private.fixed_cost_version_seq'), p_actor, p_actor)
  RETURNING version INTO v_ver;
  RETURN v_ver;
END $$;

-- Replay / reuse check. Returns the stored result for the same key + payload,
-- raises for the same key with a different payload, NULL when the key is new.
CREATE OR REPLACE FUNCTION fixed_cost_private.fc_replay(
  p_company uuid, p_actor uuid, p_key text, p_hash text)
RETURNS jsonb LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  c public.fixed_cost_commands%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.fixed_cost_commands
   WHERE company_id = p_company AND actor = p_actor AND command_key = p_key;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF c.payload_hash <> p_hash THEN
    PERFORM fixed_cost_private.fc_fail('FC409', 'idempotency_key_reuse');
  END IF;
  RETURN c.result || jsonb_build_object('replayed', true, 'command_id', c.id);
END $$;

-- Starts the command row. ON CONFLICT covers a concurrent command that took the
-- same key between our replay check and now: the unique index makes this wait
-- for it, then we return its stored result.
CREATE OR REPLACE FUNCTION fixed_cost_private.fc_begin(
  p_company uuid, p_actor uuid, p_key text, p_kind text, p_hash text, p_draft uuid)
RETURNS uuid LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.fixed_cost_commands (company_id, actor, command_key, kind, payload_hash, draft_id)
  VALUES (p_company, p_actor, p_key, p_kind, p_hash, p_draft)
  ON CONFLICT (company_id, actor, command_key) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id; -- NULL = someone else holds this key: caller re-runs fc_replay
END $$;

CREATE OR REPLACE FUNCTION fixed_cost_private.fc_finish(
  p_cmd uuid, p_affected jsonb, p_before jsonb, p_after jsonb, p_result jsonb, p_undo_of uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  UPDATE public.fixed_cost_commands SET
    affected = p_affected, before_state = p_before, after_state = p_after,
    result = p_result, undo_of = p_undo_of, finalized = true
   WHERE id = p_cmd;
END $$;

CREATE OR REPLACE FUNCTION fixed_cost_private.fc_hash(p jsonb)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT encode(sha256(convert_to(p::text, 'UTF8')), 'hex')
$$;

CREATE OR REPLACE FUNCTION fixed_cost_private.fc_cents(p numeric)
RETURNS bigint LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT round(p * 100)::bigint
$$;

-- The current committed version of a key's aggregate (0 = no row).
CREATE OR REPLACE FUNCTION fixed_cost_private.fc_version(p_company uuid, p_loc uuid, p_month date, p_cat text)
RETURNS integer LANGUAGE sql STABLE
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT COALESCE((SELECT f.version FROM public.restaurant_fixed_costs f
    WHERE f.company_id = p_company AND f.location_id IS NOT DISTINCT FROM p_loc
      AND f.month = p_month AND f.category = p_cat), 0)
$$;

-- ---------------------------------------------------------------------------
-- 7. Upload review (read-only) and approval
-- ---------------------------------------------------------------------------

-- The approvable lines of a draft, resolved: [{id, raw, category, cents, month,
-- loc, ord, one_time}]. p_line_ids NULL = every approvable line. A restaurant
-- that is not the company's makes the line not approvable.
CREATE OR REPLACE FUNCTION fixed_cost_private.fc_draft_lines(
  p_company uuid, p_parsed jsonb, p_line_ids text[])
RETURNS jsonb LANGUAGE sql STABLE
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', x.id, 'raw', left(COALESCE(x.raw, ''), 120), 'category', x.category,
      'cents', fixed_cost_private.fc_cents(x.amount), 'month', x.month, 'loc', x.loc,
      'ord', x.ord, 'one_time', COALESCE(x.one_time, false)) ORDER BY x.ord), '[]'::jsonb)
  FROM (
    SELECT l->>'id' AS id, l->>'raw' AS raw, l->>'category' AS category,
           CASE WHEN jsonb_typeof(l->'amount') = 'number' THEN (l->>'amount')::numeric END AS amount,
           l->>'month' AS month,
           CASE WHEN l->'scope'->>'kind' = 'restaurant' THEN (l->'scope'->>'locationId')::uuid END AS loc,
           l->'scope'->>'kind' AS scope_kind,
           (l->>'oneTime')::boolean AS one_time, t.ord
      FROM jsonb_array_elements(p_parsed) WITH ORDINALITY AS t(l, ord)
     WHERE l->>'status' = 'pending'
  ) x
  WHERE x.category IN ('planilla', 'alquiler', 'servicios', 'otros', 'impuestos')
    AND x.amount IS NOT NULL AND x.amount > 0
    AND (x.category <> 'impuestos' OR x.amount <= 100)
    AND x.month ~ '^\d{4}-(0[1-9]|1[0-2])-01$'
    AND (x.scope_kind = 'group'
         OR (x.scope_kind = 'restaurant' AND x.loc IS NOT NULL AND EXISTS (
               SELECT 1 FROM public.restaurant_locations rl
                WHERE rl.id = x.loc AND rl.company_id = p_company)))
    AND (p_line_ids IS NULL OR x.id = ANY (p_line_ids))
$$;

-- Per key: what exists, what is incoming, and what each choice would do.
-- Pure read. The same classification is used by the approval.
CREATE OR REPLACE FUNCTION fixed_cost_private.fc_classify(
  p_company uuid, p_draft uuid, p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  g record;
  a public.restaurant_fixed_costs%ROWTYPE;
  have boolean;
  v_items jsonb;
  v_base_cents bigint;
  v_active_cents bigint;
  v_n_items int;
  v_incoming jsonb;
  v_sum bigint;
  v_taxes int;
  v_same boolean;
  v_dups jsonb;
  v_kind text;
  v_own boolean;
  v_out jsonb := '[]'::jsonb;
BEGIN
  FOR g IN
    SELECT (x->>'loc')::uuid AS loc, (x->>'month')::date AS month, x->>'category' AS category,
           jsonb_agg(x ORDER BY (x->>'ord')::int) AS lines
      FROM jsonb_array_elements(p_lines) x
     GROUP BY 1, 2, 3
     ORDER BY fixed_cost_private.fc_key((x->>'loc')::uuid, (x->>'month')::date, x->>'category') COLLATE "C"
  LOOP
    SELECT * INTO a FROM public.restaurant_fixed_costs f
     WHERE f.company_id = p_company AND f.location_id IS NOT DISTINCT FROM g.loc
       AND f.month = g.month AND f.category = g.category;
    have := FOUND;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', i.id, 'label', i.label, 'cents', i.amount_cents, 'kind', i.kind,
             'origin', i.origin, 'version', i.version) ORDER BY i.seq), '[]'::jsonb),
           COALESCE(sum(i.amount_cents), 0),
           COALESCE(sum(i.amount_cents) FILTER (WHERE i.kind = 'legacy_base'), 0),
           count(*) FILTER (WHERE i.kind = 'item')
      INTO v_items, v_active_cents, v_base_cents, v_n_items
      FROM public.fixed_cost_items i
     WHERE i.company_id = p_company AND i.location_id IS NOT DISTINCT FROM g.loc
       AND i.month = g.month AND i.category = g.category AND i.status = 'active';
    v_incoming := g.lines;
    SELECT COALESCE(sum((l->>'cents')::bigint), 0) INTO v_sum FROM jsonb_array_elements(v_incoming) l;

    IF g.category = 'impuestos' THEN
      SELECT count(DISTINCT (l->>'cents')::bigint) INTO v_taxes FROM jsonb_array_elements(v_incoming) l;
      v_kind := CASE
        WHEN v_taxes > 1 THEN 'invalid_duplicate_tax'
        WHEN NOT have THEN 'new'
        WHEN a.pct_of_sales IS NOT NULL AND fixed_cost_private.fc_cents(a.pct_of_sales) = (v_incoming->0->>'cents')::bigint THEN 'noop'
        ELSE 'overlap' END;
      v_sum := (v_incoming->0->>'cents')::bigint;
    ELSIF NOT have THEN
      v_kind := 'new';
    ELSE
      -- Same intended upload already approved here: the incoming lines are
      -- exactly the active, fully known items (label + amount).
      v_same := v_base_cents = 0 AND a.detail_state = 'itemized' AND v_n_items = jsonb_array_length(v_incoming)
        AND NOT EXISTS (
          SELECT 1 FROM (
            SELECT fixed_cost_private.fc_norm(l->>'raw') AS n, (l->>'cents')::bigint AS c, count(*) AS k
              FROM jsonb_array_elements(v_incoming) l GROUP BY 1, 2) inc
          FULL JOIN (
            SELECT fixed_cost_private.fc_norm(i->>'label') AS n, (i->>'cents')::bigint AS c, count(*) AS k
              FROM jsonb_array_elements(v_items) i WHERE i->>'kind' = 'item' GROUP BY 1, 2) ex
            ON inc.n = ex.n AND inc.c = ex.c
          WHERE inc.k IS DISTINCT FROM ex.k);
      -- Every active item came from THIS draft: more lines of the same upload
      -- continue it (no warning).
      v_own := v_base_cents = 0 AND a.detail_state = 'itemized' AND v_n_items > 0 AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_items) i
           WHERE COALESCE(i->'origin'->>'draft_id', '') <> p_draft::text);
      v_kind := CASE WHEN v_same THEN 'noop' WHEN v_own THEN 'continue' ELSE 'overlap' END;
    END IF;

    -- Incoming lines that equal an existing active item (a possible duplicate).
    SELECT COALESCE(jsonb_agg(l->>'id'), '[]'::jsonb) INTO v_dups
      FROM jsonb_array_elements(v_incoming) l
     WHERE g.category <> 'impuestos' AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_items) i
        WHERE i->>'kind' = 'item' AND fixed_cost_private.fc_norm(i->>'label') = fixed_cost_private.fc_norm(l->>'raw')
          AND (i->>'cents')::bigint = (l->>'cents')::bigint);

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'key', fixed_cost_private.fc_key(g.loc, g.month, g.category),
      'loc', g.loc, 'month', g.month, 'category', g.category,
      'kind', v_kind,
      'version', CASE WHEN have THEN a.version ELSE 0 END,
      'old_cents', CASE WHEN NOT have THEN NULL
                        WHEN g.category = 'impuestos' THEN fixed_cost_private.fc_cents(a.pct_of_sales)
                        ELSE fixed_cost_private.fc_cents(a.amount) END,
      'detail_state', CASE WHEN have THEN a.detail_state ELSE NULL END,
      'existing_items', v_items,
      'incoming_cents', v_sum,
      'add_total_cents', CASE WHEN NOT have OR g.category = 'impuestos' THEN v_sum
                              ELSE fixed_cost_private.fc_cents(a.amount) + v_sum END,
      'duplicate_line_ids', v_dups,
      'lines', v_incoming));
  END LOOP;
  RETURN v_out;
END $$;

-- READ-ONLY preview of an upload draft: destination, existing items, the
-- effect of add / replace, and the versions the approval must send back.
CREATE OR REPLACE FUNCTION fixed_cost_private.fixed_cost_preview_upload(p_draft_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  d public.fixed_cost_upload_drafts%ROWTYPE;
  v_lines jsonb;
BEGIN
  SELECT * INTO d FROM public.fixed_cost_upload_drafts WHERE id = p_draft_id;
  IF NOT FOUND THEN PERFORM fixed_cost_private.fc_fail('FC404', 'not_found'); END IF;
  -- Another company's draft answers exactly like a missing one.
  BEGIN
    PERFORM fixed_cost_private.fc_assert_writer(d.company_id);
  EXCEPTION WHEN SQLSTATE 'FC403' THEN
    PERFORM fixed_cost_private.fc_fail('FC404', 'not_found');
  END;
  v_lines := fixed_cost_private.fc_draft_lines(d.company_id, d.parsed_lines, NULL);
  RETURN jsonb_build_object(
    'draft_id', d.id, 'draft_version', d.version, 'file_name', d.file_name,
    'file_sha256', d.file_sha256,
    -- Evidence only: the same bytes were approved before. Not a rejection.
    'same_file_seen_before', d.file_sha256 IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.fixed_cost_upload_drafts o
       WHERE o.company_id = d.company_id AND o.id <> d.id AND o.file_sha256 = d.file_sha256
         AND o.status = 'approved'),
    'keys', fixed_cost_private.fc_classify(d.company_id, d.id, v_lines));
END $$;

CREATE OR REPLACE FUNCTION fixed_cost_private.fixed_cost_approve_upload(
  p_command_key text,
  p_draft_id uuid,
  p_expected_draft_version integer,
  p_expected jsonb,        -- {"<key>": <aggregate version, 0 = none>}
  p_line_ids text[],       -- NULL = every approvable line
  p_decisions jsonb,       -- {"<line id>": "add" | "replace" | "add_duplicate"}
  p_currency text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_uid uuid;
  d public.fixed_cost_upload_drafts%ROWTYPE;
  v_hash text;
  v_replay jsonb;
  v_lines jsonb;
  v_keys text[];
  v_groups jsonb;
  v_cmd uuid;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_affected jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_cats jsonb := '[]'::jsonb;
  v_issues jsonb := '[]'::jsonb;
  v_done text[] := ARRAY[]::text[];
  v_noop_ids text[] := ARRAY[]::text[];
  v_written_ids text[] := ARRAY[]::text[];
  g jsonb;
  l jsonb;
  a public.restaurant_fixed_costs%ROWTYPE;
  have boolean;
  v_mode text;
  v_dec text;
  v_prev_total numeric;
  v_ver integer;
  v_recurring boolean;
  v_key text;
  v_loc uuid;
  v_month date;
  v_cat text;
  v_new_lines jsonb;
  v_selected_ids text[];
  v_all_pending boolean;
  v_has_approved boolean;
  v_file jsonb;
  v_items_log jsonb;
  v_outcome text;
  v_requested text[];
BEGIN
  SELECT * INTO d FROM public.fixed_cost_upload_drafts WHERE id = p_draft_id;
  IF NOT FOUND THEN PERFORM fixed_cost_private.fc_fail('FC404', 'not_found'); END IF;
  BEGIN
    v_uid := fixed_cost_private.fc_assert_writer(d.company_id);
  EXCEPTION WHEN SQLSTATE 'FC403' THEN
    PERFORM fixed_cost_private.fc_fail('FC404', 'not_found');
  END;
  PERFORM fixed_cost_private.fc_assert_currency(d.company_id, p_currency);
  IF p_command_key IS NULL OR p_expected_draft_version IS NULL OR p_expected IS NULL THEN
    PERFORM fixed_cost_private.fc_fail('FC422', 'expected_versions_required');
  END IF;

  v_hash := fixed_cost_private.fc_hash(jsonb_build_object(
    'k', 'approve_upload', 'draft', p_draft_id, 'dv', p_expected_draft_version,
    'exp', p_expected, 'lines', to_jsonb(p_line_ids), 'dec', COALESCE(p_decisions, '{}'::jsonb),
    'cur', p_currency));
  v_replay := fixed_cost_private.fc_replay(d.company_id, v_uid, p_command_key, v_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  -- Stale draft, judged on the unlocked snapshot first (cheap), again under lock.
  IF d.version <> p_expected_draft_version THEN
    PERFORM fixed_cost_private.fc_fail('FC409', 'stale_draft');
  END IF;
  v_lines := fixed_cost_private.fc_draft_lines(d.company_id, d.parsed_lines, p_line_ids);
  SELECT COALESCE(array_agg(DISTINCT fixed_cost_private.fc_key((x->>'loc')::uuid, (x->>'month')::date, x->>'category')), ARRAY[]::text[])
    INTO v_keys FROM jsonb_array_elements(v_lines) x;

  -- Every key this command can touch, locked in global order, BEFORE validation.
  PERFORM fixed_cost_private.fc_lock_keys(d.company_id, v_keys);

  -- Authoritative replay check: an identical command that held these locks first
  -- has committed by now.
  v_replay := fixed_cost_private.fc_replay(d.company_id, v_uid, p_command_key, v_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  SELECT * INTO d FROM public.fixed_cost_upload_drafts WHERE id = p_draft_id FOR UPDATE;
  IF d.version <> p_expected_draft_version THEN
    PERFORM fixed_cost_private.fc_fail('FC409', 'stale_draft');
  END IF;
  -- Re-derive under the lock (the draft could not change: we hold its row lock
  -- and its version matched, but keep the derivation in one place).
  v_lines := fixed_cost_private.fc_draft_lines(d.company_id, d.parsed_lines, p_line_ids);
  v_groups := fixed_cost_private.fc_classify(d.company_id, d.id, v_lines);

  -- Requested lines that cannot be approved stay pending with a reason.
  v_requested := COALESCE(p_line_ids, ARRAY[]::text[]);
  FOR l IN SELECT jsonb_build_object('id', x->>'id', 'status', x->>'status') FROM jsonb_array_elements(d.parsed_lines) x
           WHERE x->>'id' = ANY (v_requested) AND x->>'status' = 'pending'
             AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_lines) y WHERE y->>'id' = x->>'id')
  LOOP
    v_issues := v_issues || jsonb_build_array(jsonb_build_object('lineId', l->>'id', 'error', 'not_approvable'));
  END LOOP;

  -- Expected versions: required for every touched key and must match NOW.
  FOR g IN SELECT * FROM jsonb_array_elements(v_groups) LOOP
    v_key := g->>'key';
    IF NOT (p_expected ? v_key) THEN
      PERFORM fixed_cost_private.fc_fail('FC422', 'expected_version_required', jsonb_build_object('key', v_key));
    END IF;
    IF (p_expected->>v_key)::int <> (g->>'version')::int THEN
      PERFORM fixed_cost_private.fc_fail('FC409', 'stale_version', jsonb_build_object('key', v_key));
    END IF;
  END LOOP;

  -- Decisions needed? Nothing is written until every overlap has a choice.
  FOR g IN SELECT * FROM jsonb_array_elements(v_groups) LOOP
    IF g->>'kind' = 'invalid_duplicate_tax' THEN CONTINUE; END IF;
    v_dec := NULL;
    FOR l IN SELECT * FROM jsonb_array_elements(g->'lines') LOOP
      IF p_decisions ? (l->>'id') THEN
        IF v_dec IS NOT NULL AND v_dec <> p_decisions->>(l->>'id') THEN
          PERFORM fixed_cost_private.fc_fail('FC422', 'conflicting_decisions', jsonb_build_object('key', g->>'key'));
        END IF;
        v_dec := p_decisions->>(l->>'id');
      END IF;
    END LOOP;
    IF v_dec IS NOT NULL AND v_dec NOT IN ('add', 'replace', 'add_duplicate') THEN
      PERFORM fixed_cost_private.fc_fail('FC422', 'invalid_decision');
    END IF;
    IF g->>'kind' = 'overlap' AND v_dec IS NULL THEN
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'lineId', g->'lines'->0->>'id', 'key', g->>'key', 'kind', 'overlap',
        'category', g->>'category', 'month', g->>'month',
        'scope', CASE WHEN g->>'loc' IS NULL THEN jsonb_build_object('kind', 'group')
                      ELSE jsonb_build_object('kind', 'restaurant', 'locationId', g->>'loc') END,
        'old', (g->>'old_cents')::numeric / 100,
        'new', (g->>'incoming_cents')::numeric / 100,
        'newIfAdd', (g->>'add_total_cents')::numeric / 100,
        'detailState', g->>'detail_state',
        'existingItems', g->'existing_items', 'incoming', g->'lines',
        'duplicateLineIds', g->'duplicate_line_ids'));
    ELSIF g->>'kind' = 'overlap' AND v_dec IN ('add', 'add_duplicate') AND g->>'category' = 'impuestos' THEN
      PERFORM fixed_cost_private.fc_fail('FC422', 'rate_cannot_be_added', jsonb_build_object('key', g->>'key'));
    ELSIF g->>'kind' IN ('overlap', 'continue') AND v_dec = 'add'
          AND jsonb_array_length(g->'duplicate_line_ids') > 0 THEN
      -- An exact repeat of an existing item needs its own explicit choice.
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'lineId', g->'lines'->0->>'id', 'key', g->>'key', 'kind', 'duplicate',
        'category', g->>'category', 'month', g->>'month',
        'scope', CASE WHEN g->>'loc' IS NULL THEN jsonb_build_object('kind', 'group')
                      ELSE jsonb_build_object('kind', 'restaurant', 'locationId', g->>'loc') END,
        'old', (g->>'old_cents')::numeric / 100,
        'new', (g->>'add_total_cents')::numeric / 100,
        'newIfAdd', (g->>'add_total_cents')::numeric / 100,
        'existingItems', g->'existing_items', 'incoming', g->'lines',
        'duplicateLineIds', g->'duplicate_line_ids'));
    END IF;
  END LOOP;
  IF jsonb_array_length(v_conflicts) > 0 THEN
    RETURN jsonb_build_object('status', 'needs_decision', 'conflicts', v_conflicts);
  END IF;

  v_cmd := fixed_cost_private.fc_begin(d.company_id, v_uid, p_command_key, 'approve_upload', v_hash, d.id);
  IF v_cmd IS NULL THEN
    v_replay := fixed_cost_private.fc_replay(d.company_id, v_uid, p_command_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
    PERFORM fixed_cost_private.fc_fail('FC409', 'idempotency_key_reuse');
  END IF;

  v_file := jsonb_build_object('draft_id', d.id, 'file_name', d.file_name, 'file_sha256', d.file_sha256);

  FOR g IN SELECT * FROM jsonb_array_elements(v_groups) LOOP
    v_loc := (g->>'loc')::uuid; v_month := (g->>'month')::date; v_cat := g->>'category';
    v_key := g->>'key';
    IF g->>'kind' = 'invalid_duplicate_tax' THEN
      FOR l IN SELECT * FROM jsonb_array_elements(g->'lines') LOOP
        v_issues := v_issues || jsonb_build_array(jsonb_build_object('lineId', l->>'id', 'error', 'duplicate_tax'));
      END LOOP;
      CONTINUE;
    END IF;

    v_before := v_before || jsonb_build_object(v_key, fixed_cost_private.fc_snapshot(d.company_id, v_loc, v_month, v_cat));
    v_affected := v_affected || jsonb_build_array(jsonb_build_object('location_id', v_loc, 'month', v_month, 'category', v_cat));
    SELECT * INTO a FROM public.restaurant_fixed_costs f
     WHERE f.company_id = d.company_id AND f.location_id IS NOT DISTINCT FROM v_loc
       AND f.month = v_month AND f.category = v_cat;
    have := FOUND;
    v_prev_total := CASE WHEN NOT have THEN NULL WHEN v_cat = 'impuestos' THEN a.pct_of_sales ELSE a.amount END;

    v_dec := NULL;
    FOR l IN SELECT * FROM jsonb_array_elements(g->'lines') LOOP
      IF p_decisions ? (l->>'id') THEN v_dec := p_decisions->>(l->>'id'); END IF;
    END LOOP;
    v_mode := CASE g->>'kind'
      WHEN 'new' THEN 'new'
      WHEN 'continue' THEN 'add'
      WHEN 'noop' THEN 'noop'
      ELSE CASE WHEN v_dec = 'replace' THEN 'replace' ELSE 'add' END END;

    IF v_mode = 'noop' THEN
      -- Already there with the same reviewed values: lines become approved, no
      -- item, no aggregate change, no history row.
      FOR l IN SELECT * FROM jsonb_array_elements(g->'lines') LOOP
        v_noop_ids := v_noop_ids || (l->>'id');
      END LOOP;
      v_cats := v_cats || jsonb_build_array(jsonb_build_object(
        'key', v_key, 'category', v_cat, 'month', v_month, 'location_id', v_loc,
        'outcome', 'unchanged', 'total', v_prev_total, 'previous_total', v_prev_total,
        'version', a.version,
        'line_ids', (SELECT jsonb_agg(l2->>'id') FROM jsonb_array_elements(g->'lines') l2)));
      v_after := v_after || jsonb_build_object(v_key, jsonb_build_object('version', a.version));
      CONTINUE;
    END IF;

    v_recurring := NOT EXISTS (SELECT 1 FROM jsonb_array_elements(g->'lines') x WHERE (x->>'one_time')::boolean);

    IF v_cat = 'impuestos' THEN
      -- A rate: stored on the aggregate, never an item, never summed.
      IF have THEN
        UPDATE public.restaurant_fixed_costs SET
          pct_of_sales = ((g->>'incoming_cents')::numeric / 100), amount = NULL, label = left(g->'lines'->0->>'raw', 120),
          source = 'upload', status = 'confirmed', version = nextval('fixed_cost_private.fixed_cost_version_seq'),
          updated_by = v_uid, updated_at = now(), copy_source = NULL
         WHERE id = a.id RETURNING version INTO v_ver;
        PERFORM fixed_cost_private.fc_log(v_cmd, d.company_id, a.id, v_loc, v_month, v_cat, v_uid, 'update',
          jsonb_build_object('amount', NULL, 'pct_of_sales', a.pct_of_sales),
          jsonb_build_object('amount', NULL, 'pct_of_sales', (g->>'incoming_cents')::numeric / 100) || v_file,
          'upload');
        v_outcome := 'replaced';
      ELSE
        INSERT INTO public.restaurant_fixed_costs
          (company_id, location_id, month, category, label, pct_of_sales, currency, source, status,
           repeats, split_rule, version, created_by, updated_by)
        VALUES (d.company_id, v_loc, v_month, v_cat, left(g->'lines'->0->>'raw', 120),
                (g->>'incoming_cents')::numeric / 100, p_currency, 'upload', 'confirmed', v_recurring,
                CASE WHEN v_loc IS NULL THEN 'sales' END, nextval('fixed_cost_private.fixed_cost_version_seq'), v_uid, v_uid)
        RETURNING id, version INTO a.id, v_ver;
        PERFORM fixed_cost_private.fc_log(v_cmd, d.company_id, a.id, v_loc, v_month, v_cat, v_uid, 'create',
          NULL, jsonb_build_object('amount', NULL, 'pct_of_sales', (g->>'incoming_cents')::numeric / 100) || v_file,
          'upload');
        v_outcome := 'created';
      END IF;
      v_after := v_after || jsonb_build_object(v_key, jsonb_build_object('version', v_ver));
      v_cats := v_cats || jsonb_build_array(jsonb_build_object(
        'key', v_key, 'category', v_cat, 'month', v_month, 'location_id', v_loc, 'outcome', v_outcome,
        'total', (g->>'incoming_cents')::numeric / 100, 'previous_total', v_prev_total, 'version', v_ver,
        'repeats', v_recurring,
        'line_ids', (SELECT jsonb_agg(l2->>'id') FROM jsonb_array_elements(g->'lines') l2)));
      FOR l IN SELECT * FROM jsonb_array_elements(g->'lines') LOOP
        v_written_ids := v_written_ids || (l->>'id');
      END LOOP;
      CONTINUE;
    END IF;

    -- Cash category: items.
    IF v_mode = 'replace' THEN
      UPDATE public.fixed_cost_items SET status = 'retired', retired_by_command = v_cmd,
             updated_at = now(), version = nextval('fixed_cost_private.fixed_cost_version_seq')
       WHERE company_id = d.company_id AND location_id IS NOT DISTINCT FROM v_loc
         AND month = v_month AND category = v_cat AND status = 'active';
    ELSIF v_mode = 'add' AND have AND a.detail_state = 'legacy_total'
          AND NOT EXISTS (SELECT 1 FROM public.fixed_cost_items i WHERE i.company_id = d.company_id
                          AND i.location_id IS NOT DISTINCT FROM v_loc AND i.month = v_month
                          AND i.category = v_cat AND i.status = 'active') THEN
      -- Adding to a known total with unknown detail: keep that total as ONE
      -- clearly flagged item. Nothing is invented.
      INSERT INTO public.fixed_cost_items
        (company_id, location_id, month, category, kind, label, amount_cents, currency, origin, created_by_command)
      VALUES (d.company_id, v_loc, v_month, v_cat, 'legacy_base', NULL, fixed_cost_private.fc_cents(a.amount),
              a.currency, jsonb_build_object('unknown_detail', true, 'prior_source', a.source), v_cmd);
    END IF;
    FOR l IN SELECT * FROM jsonb_array_elements(g->'lines') LOOP
      INSERT INTO public.fixed_cost_items
        (company_id, location_id, month, category, kind, label, amount_cents, currency, origin, created_by_command)
      VALUES (d.company_id, v_loc, v_month, v_cat, 'item', NULLIF(l->>'raw', ''), (l->>'cents')::bigint,
              p_currency, v_file || jsonb_build_object('line_id', l->>'id')
                || CASE WHEN v_dec = 'add_duplicate' AND g->'duplicate_line_ids' ? (l->>'id')
                        THEN jsonb_build_object('allowed_duplicate', true) ELSE '{}'::jsonb END,
              v_cmd);
      v_written_ids := v_written_ids || (l->>'id');
    END LOOP;
    v_ver := fixed_cost_private.fc_project(d.company_id, v_loc, v_month, v_cat, p_currency, v_uid, 'upload',
      CASE WHEN v_mode = 'add' AND have THEN v_recurring AND a.repeats ELSE v_recurring END,
      NULL, NULL);
    SELECT * INTO a FROM public.restaurant_fixed_costs f
     WHERE f.company_id = d.company_id AND f.location_id IS NOT DISTINCT FROM v_loc
       AND f.month = v_month AND f.category = v_cat;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('raw', COALESCE(i.label, ''), 'amount', i.amount_cents::numeric / 100)
                              ORDER BY i.seq), '[]'::jsonb)
      INTO v_items_log FROM public.fixed_cost_items i
     WHERE i.created_by_command = v_cmd AND i.location_id IS NOT DISTINCT FROM v_loc
       AND i.month = v_month AND i.category = v_cat AND i.kind = 'item';
    PERFORM fixed_cost_private.fc_log(v_cmd, d.company_id, a.id, v_loc, v_month, v_cat, v_uid,
      CASE WHEN have THEN 'update' ELSE 'create' END,
      CASE WHEN have THEN jsonb_build_object('amount', v_prev_total, 'pct_of_sales', NULL) END,
      jsonb_build_object('amount', a.amount, 'pct_of_sales', NULL, 'items', v_items_log, 'mode', v_mode) || v_file,
      'upload');
    v_outcome := CASE WHEN NOT have THEN 'created' WHEN v_mode = 'replace' THEN 'replaced' ELSE 'added' END;
    v_after := v_after || jsonb_build_object(v_key, jsonb_build_object('version', v_ver));
    v_cats := v_cats || jsonb_build_array(jsonb_build_object(
      'key', v_key, 'category', v_cat, 'month', v_month, 'location_id', v_loc, 'outcome', v_outcome,
      'total', a.amount, 'previous_total', v_prev_total, 'version', v_ver, 'repeats', a.repeats,
      'line_ids', (SELECT jsonb_agg(l2->>'id') FROM jsonb_array_elements(g->'lines') l2)));
  END LOOP;

  -- The draft: written lines and no-op lines become approved; the version moves.
  v_done := v_written_ids || v_noop_ids;
  SELECT jsonb_agg(CASE WHEN x->>'id' = ANY (v_done) AND x->>'status' = 'pending'
                        THEN x || '{"status":"approved"}'::jsonb ELSE x END ORDER BY t.ord)
    INTO v_new_lines
    FROM jsonb_array_elements(d.parsed_lines) WITH ORDINALITY t(x, ord);
  SELECT bool_or(x->>'status' = 'pending'), bool_or(x->>'status' = 'approved')
    INTO v_all_pending, v_has_approved
    FROM jsonb_array_elements(v_new_lines) x;
  UPDATE public.fixed_cost_upload_drafts SET
    parsed_lines = v_new_lines,
    status = CASE WHEN v_all_pending THEN 'draft' WHEN v_has_approved THEN 'approved' ELSE 'discarded' END,
    approved_by = CASE WHEN v_all_pending THEN approved_by ELSE v_uid END,
    approved_at = CASE WHEN v_all_pending THEN approved_at ELSE now() END,
    version = nextval('fixed_cost_private.fixed_cost_version_seq'), updated_at = now()
   WHERE id = d.id
   RETURNING * INTO d;

  PERFORM fixed_cost_private.fc_finish(v_cmd, v_affected, v_before, v_after, jsonb_build_object(
    'status', CASE WHEN cardinality(v_written_ids) = 0 THEN 'noop' ELSE 'applied' END,
    'lines_approved', cardinality(v_written_ids),
    'lines_already_approved', cardinality(v_noop_ids),
    'written_line_ids', to_jsonb(v_written_ids),
    'noop_line_ids', to_jsonb(v_noop_ids),
    'categories', v_cats, 'issues', v_issues,
    'draft', jsonb_build_object('id', d.id, 'version', d.version, 'status', d.status,
                                'file_name', d.file_name, 'lines', d.parsed_lines)));
  RETURN (SELECT result || jsonb_build_object('command_id', v_cmd, 'replayed', false)
            FROM public.fixed_cost_commands WHERE id = v_cmd);
END $$;

-- ---------------------------------------------------------------------------
-- 8. Manual commands: save totals, add / edit / delete one item
-- ---------------------------------------------------------------------------

-- Replaces the old direct form save. One command per month and scope.
-- entries: [{category, value (number | null = remove), label, repeats,
--            split_rule, replace_items (bool), expected_version (0 = none)}]
CREATE OR REPLACE FUNCTION fixed_cost_private.fixed_cost_save_totals(
  p_command_key text,
  p_company uuid,
  p_month date,
  p_location uuid,
  p_entries jsonb,
  p_currency text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_uid uuid := fixed_cost_private.fc_assert_writer(p_company);
  v_hash text;
  v_replay jsonb;
  v_keys text[];
  v_cmd uuid;
  e jsonb;
  v_cat text;
  v_key text;
  v_val numeric;
  v_cents bigint;
  a public.restaurant_fixed_costs%ROWTYPE;
  have boolean;
  v_n int;
  v_exp int;
  v_label text;
  v_repeats boolean;
  v_split text;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_affected jsonb := '[]'::jsonb;
  v_changed jsonb := '[]'::jsonb;
  v_ver int;
  v_plan jsonb := '[]'::jsonb;
  v_action text;
  v_same_total boolean;
  v_same_flags boolean;
BEGIN
  PERFORM fixed_cost_private.fc_assert_scope(p_company, p_location);
  PERFORM fixed_cost_private.fc_assert_currency(p_company, p_currency);
  IF p_month IS NULL OR p_month <> date_trunc('month', p_month)::date THEN
    PERFORM fixed_cost_private.fc_fail('FC422', 'invalid_month');
  END IF;
  IF p_command_key IS NULL OR jsonb_typeof(p_entries) <> 'array' OR jsonb_array_length(p_entries) = 0 THEN
    PERFORM fixed_cost_private.fc_fail('FC422', 'invalid_request');
  END IF;
  v_hash := fixed_cost_private.fc_hash(jsonb_build_object('k', 'save_totals', 'm', p_month, 'l', p_location,
    'e', p_entries, 'cur', p_currency));
  v_replay := fixed_cost_private.fc_replay(p_company, v_uid, p_command_key, v_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  SELECT array_agg(fixed_cost_private.fc_key(p_location, p_month, x->>'category')) INTO v_keys
    FROM jsonb_array_elements(p_entries) x;
  PERFORM fixed_cost_private.fc_lock_keys(p_company, v_keys);
  v_replay := fixed_cost_private.fc_replay(p_company, v_uid, p_command_key, v_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  -- Pass 1 (read-only): validate every entry against the locked state and decide.
  FOR e IN SELECT * FROM jsonb_array_elements(p_entries) LOOP
    v_cat := e->>'category';
    IF v_cat NOT IN ('planilla', 'alquiler', 'servicios', 'otros', 'impuestos') THEN
      PERFORM fixed_cost_private.fc_fail('FC422', 'invalid_category');
    END IF;
    v_key := fixed_cost_private.fc_key(p_location, p_month, v_cat);
    IF NOT (e ? 'expected_version') THEN
      PERFORM fixed_cost_private.fc_fail('FC422', 'expected_version_required', jsonb_build_object('key', v_key));
    END IF;
    v_exp := (e->>'expected_version')::int;
    IF v_exp <> fixed_cost_private.fc_version(p_company, p_location, p_month, v_cat) THEN
      PERFORM fixed_cost_private.fc_fail('FC409', 'stale_version', jsonb_build_object('key', v_key));
    END IF;
    SELECT * INTO a FROM public.restaurant_fixed_costs f
     WHERE f.company_id = p_company AND f.location_id IS NOT DISTINCT FROM p_location
       AND f.month = p_month AND f.category = v_cat;
    have := FOUND;
    SELECT count(*) INTO v_n FROM public.fixed_cost_items i
     WHERE i.company_id = p_company AND i.location_id IS NOT DISTINCT FROM p_location
       AND i.month = p_month AND i.category = v_cat AND i.status = 'active';
    IF e->'value' IS NULL OR jsonb_typeof(e->'value') = 'null' THEN
      v_action := CASE WHEN have THEN 'delete' ELSE 'noop' END;
    ELSE
      IF jsonb_typeof(e->'value') <> 'number' THEN PERFORM fixed_cost_private.fc_fail('FC422', 'invalid_value'); END IF;
      v_val := (e->>'value')::numeric;
      IF v_val < 0 OR (v_cat = 'impuestos' AND v_val > 100) OR v_val >= 1e12 THEN
        PERFORM fixed_cost_private.fc_fail('FC422', 'invalid_value');
      END IF;
      v_cents := fixed_cost_private.fc_cents(v_val);
      v_label := NULLIF(left(btrim(COALESCE(e->>'label', '')), 120), '');
      v_repeats := COALESCE((e->>'repeats')::boolean, false);
      v_split := CASE WHEN e->>'split_rule' IN ('sales', 'equal') THEN e->>'split_rule' END;
      IF NOT have THEN
        v_action := 'create';
      ELSE
        v_same_total := CASE WHEN v_cat = 'impuestos' THEN fixed_cost_private.fc_cents(a.pct_of_sales) = v_cents
                             ELSE fixed_cost_private.fc_cents(a.amount) = v_cents END;
        v_same_flags := a.repeats = v_repeats
          AND COALESCE(a.split_rule, '') = COALESCE(CASE WHEN p_location IS NULL THEN COALESCE(v_split, 'sales') END, '')
          AND COALESCE(a.label, '') = COALESCE(v_label, '');
        IF v_same_total AND v_same_flags THEN v_action := 'noop';
        ELSIF v_same_total THEN v_action := 'flags';
        ELSIF a.detail_state = 'itemized' AND v_n > 0 AND NOT COALESCE((e->>'replace_items')::boolean, false) THEN
          PERFORM fixed_cost_private.fc_fail('FC422', 'has_items', jsonb_build_object('key', v_key, 'items', v_n));
        ELSE v_action := 'replace';
        END IF;
      END IF;
    END IF;
    v_plan := v_plan || jsonb_build_array(jsonb_build_object('e', e, 'action', v_action));
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_plan) x WHERE x->>'action' <> 'noop') THEN
    RETURN jsonb_build_object('status', 'noop', 'replayed', false, 'changed', '[]'::jsonb);
  END IF;

  v_cmd := fixed_cost_private.fc_begin(p_company, v_uid, p_command_key, 'save_totals', v_hash, NULL);
  IF v_cmd IS NULL THEN
    v_replay := fixed_cost_private.fc_replay(p_company, v_uid, p_command_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
    PERFORM fixed_cost_private.fc_fail('FC409', 'idempotency_key_reuse');
  END IF;

  -- Pass 2: write.
  FOR e IN SELECT x->'e' FROM jsonb_array_elements(v_plan) x WHERE x->>'action' <> 'noop' LOOP
    v_cat := e->>'category';
    v_key := fixed_cost_private.fc_key(p_location, p_month, v_cat);
    SELECT x->>'action' INTO v_action FROM jsonb_array_elements(v_plan) x WHERE x->'e' = e LIMIT 1;
    v_before := v_before || jsonb_build_object(v_key, fixed_cost_private.fc_snapshot(p_company, p_location, p_month, v_cat));
    v_affected := v_affected || jsonb_build_array(jsonb_build_object('location_id', p_location, 'month', p_month, 'category', v_cat));
    SELECT * INTO a FROM public.restaurant_fixed_costs f
     WHERE f.company_id = p_company AND f.location_id IS NOT DISTINCT FROM p_location
       AND f.month = p_month AND f.category = v_cat;
    have := FOUND;
    IF v_action <> 'delete' THEN
      v_val := (e->>'value')::numeric; v_cents := fixed_cost_private.fc_cents(v_val);
      v_label := NULLIF(left(btrim(COALESCE(e->>'label', '')), 120), '');
      v_repeats := COALESCE((e->>'repeats')::boolean, false);
      v_split := CASE WHEN e->>'split_rule' IN ('sales', 'equal') THEN e->>'split_rule' END;
    END IF;

    IF v_action = 'delete' THEN
      UPDATE public.fixed_cost_items SET status = 'retired', retired_by_command = v_cmd, updated_at = now(),
             version = nextval('fixed_cost_private.fixed_cost_version_seq')
       WHERE company_id = p_company AND location_id IS NOT DISTINCT FROM p_location
         AND month = p_month AND category = v_cat AND status = 'active';
      DELETE FROM public.restaurant_fixed_costs WHERE id = a.id;
      PERFORM fixed_cost_private.fc_log(v_cmd, p_company, a.id, p_location, p_month, v_cat, v_uid, 'delete',
        jsonb_build_object('amount', a.amount, 'pct_of_sales', a.pct_of_sales), 'null'::jsonb, 'manual');
      v_ver := 0;
    ELSIF v_cat = 'impuestos' THEN
      IF have THEN
        UPDATE public.restaurant_fixed_costs SET pct_of_sales = v_val, amount = NULL, label = v_label,
          repeats = v_repeats, split_rule = CASE WHEN p_location IS NULL THEN COALESCE(v_split, 'sales') END,
          source = CASE WHEN v_action = 'flags' THEN source ELSE 'manual' END, status = 'confirmed',
          copy_source = CASE WHEN v_action = 'flags' THEN copy_source END,
          version = nextval('fixed_cost_private.fixed_cost_version_seq'), updated_by = v_uid, updated_at = now()
         WHERE id = a.id RETURNING version INTO v_ver;
      ELSE
        INSERT INTO public.restaurant_fixed_costs
          (company_id, location_id, month, category, label, pct_of_sales, currency, source, status,
           repeats, split_rule, version, created_by, updated_by)
        VALUES (p_company, p_location, p_month, v_cat, v_label, v_val, p_currency, 'manual', 'confirmed',
                v_repeats, CASE WHEN p_location IS NULL THEN COALESCE(v_split, 'sales') END,
                nextval('fixed_cost_private.fixed_cost_version_seq'), v_uid, v_uid)
        RETURNING id, version INTO a.id, v_ver;
      END IF;
      PERFORM fixed_cost_private.fc_log(v_cmd, p_company, a.id, p_location, p_month, v_cat, v_uid,
        CASE WHEN have THEN 'update' ELSE 'create' END,
        CASE WHEN have THEN jsonb_build_object('amount', NULL, 'pct_of_sales', a.pct_of_sales) END,
        jsonb_build_object('amount', NULL, 'pct_of_sales', v_val), 'manual');
    ELSIF v_action = 'flags' THEN
      -- Only a flag / label changed: the amount and its source stay.
      UPDATE public.restaurant_fixed_costs SET label = v_label, repeats = v_repeats,
        split_rule = CASE WHEN p_location IS NULL THEN COALESCE(v_split, 'sales') END,
        version = nextval('fixed_cost_private.fixed_cost_version_seq'), updated_by = v_uid, updated_at = now()
       WHERE id = a.id RETURNING version INTO v_ver;
      PERFORM fixed_cost_private.fc_log(v_cmd, p_company, a.id, p_location, p_month, v_cat, v_uid, 'update',
        jsonb_build_object('amount', a.amount, 'pct_of_sales', NULL),
        jsonb_build_object('amount', a.amount, 'pct_of_sales', NULL, 'flags_only', true), 'manual');
    ELSE
      -- create / replace: ONE manual item is the new known set. A replaced legacy
      -- total or replaced items are named in the history.
      UPDATE public.fixed_cost_items SET status = 'retired', retired_by_command = v_cmd, updated_at = now(),
             version = nextval('fixed_cost_private.fixed_cost_version_seq')
       WHERE company_id = p_company AND location_id IS NOT DISTINCT FROM p_location
         AND month = p_month AND category = v_cat AND status = 'active';
      -- A legacy total (no items) being replaced by a typed value: becomes itemized.
      INSERT INTO public.fixed_cost_items
        (company_id, location_id, month, category, kind, label, amount_cents, currency, origin, created_by_command)
      VALUES (p_company, p_location, p_month, v_cat, 'item', v_label, v_cents, p_currency,
              jsonb_build_object('manual', true), v_cmd);
      v_ver := fixed_cost_private.fc_project(p_company, p_location, p_month, v_cat, p_currency, v_uid, 'manual',
        v_repeats, v_split, NULL);
      SELECT * INTO a FROM public.restaurant_fixed_costs f
       WHERE f.company_id = p_company AND f.location_id IS NOT DISTINCT FROM p_location
         AND f.month = p_month AND f.category = v_cat;
      PERFORM fixed_cost_private.fc_log(v_cmd, p_company, a.id, p_location, p_month, v_cat, v_uid,
        CASE WHEN v_action = 'create' THEN 'create' ELSE 'update' END,
        CASE WHEN v_action = 'replace'
             THEN jsonb_build_object('amount', (v_before->v_key->'aggregate'->>'amount')::numeric, 'pct_of_sales', NULL) END,
        jsonb_build_object('amount', v_val, 'pct_of_sales', NULL), 'manual');
    END IF;
    v_after := v_after || jsonb_build_object(v_key, jsonb_build_object('version', v_ver));
    v_changed := v_changed || jsonb_build_array(jsonb_build_object('key', v_key, 'category', v_cat, 'action', v_action, 'version', v_ver));
  END LOOP;

  PERFORM fixed_cost_private.fc_finish(v_cmd, v_affected, v_before, v_after,
    jsonb_build_object('status', 'applied', 'changed', v_changed));
  RETURN jsonb_build_object('status', 'applied', 'changed', v_changed, 'command_id', v_cmd, 'replayed', false);
END $$;

-- add / update / delete ONE item of a cash category.
CREATE OR REPLACE FUNCTION fixed_cost_private.fixed_cost_item_command(
  p_command_key text,
  p_company uuid,
  p_op text,                  -- 'add' | 'update' | 'delete'
  p_location uuid,
  p_month date,
  p_category text,
  p_item_id uuid,
  p_label text,
  p_amount_cents bigint,
  p_expected_agg_version integer,
  p_expected_item_version integer,
  p_currency text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_uid uuid := fixed_cost_private.fc_assert_writer(p_company);
  v_hash text;
  v_replay jsonb;
  v_cmd uuid;
  v_key text := fixed_cost_private.fc_key(p_location, p_month, p_category);
  a public.restaurant_fixed_costs%ROWTYPE;
  have boolean;
  it public.fixed_cost_items%ROWTYPE;
  v_before jsonb;
  v_ver int;
  v_label text := NULLIF(left(btrim(COALESCE(p_label, '')), 120), '');
  v_old numeric;
  v_kind text;
BEGIN
  IF p_op NOT IN ('add', 'update', 'delete') THEN PERFORM fixed_cost_private.fc_fail('FC422', 'invalid_op'); END IF;
  IF p_category NOT IN ('planilla', 'alquiler', 'servicios', 'otros') THEN
    PERFORM fixed_cost_private.fc_fail('FC422', 'invalid_category');
  END IF;
  PERFORM fixed_cost_private.fc_assert_scope(p_company, p_location);
  PERFORM fixed_cost_private.fc_assert_currency(p_company, p_currency);
  IF p_command_key IS NULL OR p_expected_agg_version IS NULL THEN
    PERFORM fixed_cost_private.fc_fail('FC422', 'expected_version_required');
  END IF;
  IF p_op <> 'delete' AND (p_amount_cents IS NULL OR p_amount_cents < 0 OR p_amount_cents >= 1e14) THEN
    PERFORM fixed_cost_private.fc_fail('FC422', 'invalid_value');
  END IF;
  v_kind := 'item_' || p_op;
  v_hash := fixed_cost_private.fc_hash(jsonb_build_object('k', v_kind, 'l', p_location, 'm', p_month, 'c', p_category,
    'i', p_item_id, 'lab', v_label, 'a', p_amount_cents, 'ev', p_expected_agg_version,
    'iv', p_expected_item_version, 'cur', p_currency));
  v_replay := fixed_cost_private.fc_replay(p_company, v_uid, p_command_key, v_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  PERFORM fixed_cost_private.fc_lock_keys(p_company, ARRAY[v_key]);
  v_replay := fixed_cost_private.fc_replay(p_company, v_uid, p_command_key, v_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  IF p_expected_agg_version <> fixed_cost_private.fc_version(p_company, p_location, p_month, p_category) THEN
    PERFORM fixed_cost_private.fc_fail('FC409', 'stale_version', jsonb_build_object('key', v_key));
  END IF;
  SELECT * INTO a FROM public.restaurant_fixed_costs f
   WHERE f.company_id = p_company AND f.location_id IS NOT DISTINCT FROM p_location
     AND f.month = p_month AND f.category = p_category;
  have := FOUND;
  IF p_op <> 'add' THEN
    SELECT * INTO it FROM public.fixed_cost_items i
     WHERE i.id = p_item_id AND i.company_id = p_company AND i.location_id IS NOT DISTINCT FROM p_location
       AND i.month = p_month AND i.category = p_category AND i.status = 'active' FOR UPDATE;
    IF NOT FOUND THEN PERFORM fixed_cost_private.fc_fail('FC404', 'not_found'); END IF;
    IF it.kind = 'legacy_base' THEN PERFORM fixed_cost_private.fc_fail('FC422', 'legacy_base_immutable'); END IF;
    IF p_expected_item_version IS NULL OR p_expected_item_version <> it.version THEN
      PERFORM fixed_cost_private.fc_fail('FC409', 'stale_item', jsonb_build_object('item', p_item_id));
    END IF;
  END IF;

  v_cmd := fixed_cost_private.fc_begin(p_company, v_uid, p_command_key, v_kind, v_hash, NULL);
  IF v_cmd IS NULL THEN
    v_replay := fixed_cost_private.fc_replay(p_company, v_uid, p_command_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
    PERFORM fixed_cost_private.fc_fail('FC409', 'idempotency_key_reuse');
  END IF;
  v_before := jsonb_build_object(v_key, fixed_cost_private.fc_snapshot(p_company, p_location, p_month, p_category));
  v_old := a.amount;

  IF p_op = 'add' THEN
    IF have AND a.detail_state = 'legacy_total' AND NOT EXISTS (
         SELECT 1 FROM public.fixed_cost_items i WHERE i.company_id = p_company
           AND i.location_id IS NOT DISTINCT FROM p_location AND i.month = p_month
           AND i.category = p_category AND i.status = 'active') THEN
      INSERT INTO public.fixed_cost_items
        (company_id, location_id, month, category, kind, label, amount_cents, currency, origin, created_by_command)
      VALUES (p_company, p_location, p_month, p_category, 'legacy_base', NULL, fixed_cost_private.fc_cents(a.amount),
              a.currency, jsonb_build_object('unknown_detail', true, 'prior_source', a.source), v_cmd);
    END IF;
    INSERT INTO public.fixed_cost_items
      (company_id, location_id, month, category, kind, label, amount_cents, currency, origin, created_by_command)
    VALUES (p_company, p_location, p_month, p_category, 'item', v_label, p_amount_cents, p_currency,
            jsonb_build_object('manual', true), v_cmd);
  ELSIF p_op = 'update' THEN
    UPDATE public.fixed_cost_items SET amount_cents = p_amount_cents, label = v_label, updated_at = now(),
           version = nextval('fixed_cost_private.fixed_cost_version_seq')
     WHERE id = it.id;
  ELSE
    UPDATE public.fixed_cost_items SET status = 'retired', retired_by_command = v_cmd, updated_at = now(),
           version = nextval('fixed_cost_private.fixed_cost_version_seq')
     WHERE id = it.id;
  END IF;
  v_ver := fixed_cost_private.fc_project(p_company, p_location, p_month, p_category, p_currency, v_uid, 'manual',
    CASE WHEN have THEN a.repeats ELSE false END, NULL, NULL);
  SELECT * INTO a FROM public.restaurant_fixed_costs f
   WHERE f.company_id = p_company AND f.location_id IS NOT DISTINCT FROM p_location
     AND f.month = p_month AND f.category = p_category;
  PERFORM fixed_cost_private.fc_log(v_cmd, p_company, a.id, p_location, p_month, p_category, v_uid,
    CASE WHEN a.id IS NULL THEN 'delete' WHEN have THEN 'update' ELSE 'create' END,
    CASE WHEN have THEN jsonb_build_object('amount', v_old, 'pct_of_sales', NULL) END,
    CASE WHEN a.id IS NULL THEN 'null'::jsonb
         ELSE jsonb_build_object('amount', a.amount, 'pct_of_sales', NULL, 'item_op', p_op,
                                 'items', jsonb_build_array(jsonb_build_object('raw', COALESCE(v_label, ''), 'amount', p_amount_cents::numeric / 100))) END,
    'manual');
  PERFORM fixed_cost_private.fc_finish(v_cmd,
    jsonb_build_array(jsonb_build_object('location_id', p_location, 'month', p_month, 'category', p_category)),
    v_before, jsonb_build_object(v_key, jsonb_build_object('version', COALESCE(v_ver, 0))),
    jsonb_build_object('status', 'applied', 'key', v_key, 'version', COALESCE(v_ver, 0), 'total', a.amount));
  RETURN jsonb_build_object('status', 'applied', 'key', v_key, 'version', COALESCE(v_ver, 0),
                            'total', a.amount, 'command_id', v_cmd, 'replayed', false);
END $$;

-- ---------------------------------------------------------------------------
-- 9. Explicit copy between months (replaces the render-time repeat)
-- ---------------------------------------------------------------------------

-- READ-ONLY: what copying p_from into p_to would do, per category, plus whether
-- an earlier copy's source has changed since.
CREATE OR REPLACE FUNCTION fixed_cost_private.fixed_cost_preview_copy(
  p_company uuid, p_location uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  c text;
  s public.restaurant_fixed_costs%ROWTYPE;
  t public.restaurant_fixed_costs%ROWTYPE;
  hs boolean;
  ht boolean;
  v_out jsonb := '[]'::jsonb;
  v_state text;
  v_changed boolean;
BEGIN
  PERFORM fixed_cost_private.fc_assert_writer(p_company);
  PERFORM fixed_cost_private.fc_assert_scope(p_company, p_location);
  IF p_from IS NULL OR p_to IS NULL OR p_from = p_to
     OR p_from <> date_trunc('month', p_from)::date OR p_to <> date_trunc('month', p_to)::date THEN
    PERFORM fixed_cost_private.fc_fail('FC422', 'invalid_month');
  END IF;
  FOREACH c IN ARRAY ARRAY['planilla', 'alquiler', 'servicios', 'otros', 'impuestos'] LOOP
    SELECT * INTO s FROM public.restaurant_fixed_costs f
     WHERE f.company_id = p_company AND f.location_id IS NOT DISTINCT FROM p_location
       AND f.month = p_from AND f.category = c;
    hs := FOUND;
    SELECT * INTO t FROM public.restaurant_fixed_costs f
     WHERE f.company_id = p_company AND f.location_id IS NOT DISTINCT FROM p_location
       AND f.month = p_to AND f.category = c;
    ht := FOUND;
    v_changed := ht AND t.copy_source IS NOT NULL AND hs
      AND (t.copy_source->>'month') = p_from::text
      AND (t.copy_source->>'aggregate_version')::int <> s.version;
    v_state := CASE
      WHEN NOT hs THEN 'no_source'
      WHEN NOT ht THEN 'missing_in_destination'
      WHEN COALESCE(s.amount, -1) = COALESCE(t.amount, -1) AND COALESCE(s.pct_of_sales, -1) = COALESCE(t.pct_of_sales, -1)
        THEN 'same'
      ELSE 'conflict' END;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'category', c, 'state', v_state, 'source_changed_since_copy', COALESCE(v_changed, false),
      'source', CASE WHEN hs THEN jsonb_build_object('version', s.version, 'amount', s.amount,
        'pct_of_sales', s.pct_of_sales, 'detail_state', s.detail_state,
        'items', fixed_cost_private.fc_snapshot(p_company, p_location, p_from, c)->'items') END,
      'destination', CASE WHEN ht THEN jsonb_build_object('version', t.version, 'amount', t.amount,
        'pct_of_sales', t.pct_of_sales, 'detail_state', t.detail_state, 'copy_source', t.copy_source,
        'items', fixed_cost_private.fc_snapshot(p_company, p_location, p_to, c)->'items') END,
      'destination_version', CASE WHEN ht THEN t.version ELSE 0 END));
  END LOOP;
  RETURN jsonb_build_object('from', p_from, 'to', p_to, 'location_id', p_location, 'categories', v_out);
END $$;

-- decisions: {"<category>": "replace" | "skip"} for a destination that already
-- has a different value. expected: {"<destination key>": version}.
CREATE OR REPLACE FUNCTION fixed_cost_private.fixed_cost_copy(
  p_command_key text,
  p_company uuid,
  p_location uuid,
  p_from date,
  p_to date,
  p_categories text[],
  p_decisions jsonb,
  p_expected jsonb,
  p_currency text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_uid uuid := fixed_cost_private.fc_assert_writer(p_company);
  v_hash text;
  v_replay jsonb;
  v_keys text[] := ARRAY[]::text[];
  v_cmd uuid;
  c text;
  s public.restaurant_fixed_costs%ROWTYPE;
  t public.restaurant_fixed_costs%ROWTYPE;
  hs boolean;
  ht boolean;
  v_dk text;
  v_sk text;
  v_dec text;
  v_conflicts jsonb := '[]'::jsonb;
  v_plan jsonb := '[]'::jsonb;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_affected jsonb := '[]'::jsonb;
  v_done jsonb := '[]'::jsonb;
  v_ver int;
  v_src jsonb;
  v_items_log jsonb;
  r jsonb;
  it public.fixed_cost_items%ROWTYPE;
  v_n_src int;
BEGIN
  PERFORM fixed_cost_private.fc_assert_scope(p_company, p_location);
  PERFORM fixed_cost_private.fc_assert_currency(p_company, p_currency);
  IF p_command_key IS NULL OR p_expected IS NULL OR p_categories IS NULL OR cardinality(p_categories) = 0
     OR p_from IS NULL OR p_to IS NULL OR p_from = p_to
     OR p_from <> date_trunc('month', p_from)::date OR p_to <> date_trunc('month', p_to)::date THEN
    PERFORM fixed_cost_private.fc_fail('FC422', 'invalid_request');
  END IF;
  FOREACH c IN ARRAY p_categories LOOP
    IF c NOT IN ('planilla', 'alquiler', 'servicios', 'otros', 'impuestos') THEN
      PERFORM fixed_cost_private.fc_fail('FC422', 'invalid_category');
    END IF;
    v_keys := v_keys || fixed_cost_private.fc_key(p_location, p_from, c) || fixed_cost_private.fc_key(p_location, p_to, c);
  END LOOP;
  v_hash := fixed_cost_private.fc_hash(jsonb_build_object('k', 'copy', 'l', p_location, 'f', p_from, 't', p_to,
    'c', to_jsonb(p_categories), 'd', COALESCE(p_decisions, '{}'::jsonb), 'e', p_expected, 'cur', p_currency));
  v_replay := fixed_cost_private.fc_replay(p_company, v_uid, p_command_key, v_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  -- Source AND destination keys, one global order: the source snapshot cannot
  -- move under us and a concurrent replace of the same category waits.
  PERFORM fixed_cost_private.fc_lock_keys(p_company, v_keys);
  v_replay := fixed_cost_private.fc_replay(p_company, v_uid, p_command_key, v_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  FOREACH c IN ARRAY p_categories LOOP
    v_dk := fixed_cost_private.fc_key(p_location, p_to, c);
    IF NOT (p_expected ? v_dk) THEN
      PERFORM fixed_cost_private.fc_fail('FC422', 'expected_version_required', jsonb_build_object('key', v_dk));
    END IF;
    IF (p_expected->>v_dk)::int <> fixed_cost_private.fc_version(p_company, p_location, p_to, c) THEN
      PERFORM fixed_cost_private.fc_fail('FC409', 'stale_version', jsonb_build_object('key', v_dk));
    END IF;
    SELECT * INTO s FROM public.restaurant_fixed_costs f
     WHERE f.company_id = p_company AND f.location_id IS NOT DISTINCT FROM p_location
       AND f.month = p_from AND f.category = c;
    hs := FOUND;
    IF NOT hs THEN PERFORM fixed_cost_private.fc_fail('FC422', 'no_source', jsonb_build_object('category', c)); END IF;
    SELECT * INTO t FROM public.restaurant_fixed_costs f
     WHERE f.company_id = p_company AND f.location_id IS NOT DISTINCT FROM p_location
       AND f.month = p_to AND f.category = c;
    ht := FOUND;
    v_dec := p_decisions->>c;
    IF v_dec IS NOT NULL AND v_dec NOT IN ('replace', 'skip') THEN
      PERFORM fixed_cost_private.fc_fail('FC422', 'invalid_decision');
    END IF;
    IF ht AND COALESCE(s.amount, -1) = COALESCE(t.amount, -1)
       AND COALESCE(s.pct_of_sales, -1) = COALESCE(t.pct_of_sales, -1) THEN
      v_plan := v_plan || jsonb_build_array(jsonb_build_object('c', c, 'action', 'same'));
    ELSIF ht AND v_dec IS NULL THEN
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'category', c, 'destinationKey', v_dk,
        'old', COALESCE(t.amount, t.pct_of_sales), 'new', COALESCE(s.amount, s.pct_of_sales),
        'destinationItems', fixed_cost_private.fc_snapshot(p_company, p_location, p_to, c)->'items',
        'sourceItems', fixed_cost_private.fc_snapshot(p_company, p_location, p_from, c)->'items'));
    ELSIF ht AND v_dec = 'skip' THEN
      v_plan := v_plan || jsonb_build_array(jsonb_build_object('c', c, 'action', 'skip'));
    ELSE
      v_plan := v_plan || jsonb_build_array(jsonb_build_object('c', c, 'action', CASE WHEN ht THEN 'replace' ELSE 'create' END));
    END IF;
  END LOOP;
  IF jsonb_array_length(v_conflicts) > 0 THEN
    RETURN jsonb_build_object('status', 'needs_decision', 'conflicts', v_conflicts);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_plan) x WHERE x->>'action' IN ('create', 'replace')) THEN
    RETURN jsonb_build_object('status', 'noop', 'replayed', false, 'copied', '[]'::jsonb);
  END IF;

  v_cmd := fixed_cost_private.fc_begin(p_company, v_uid, p_command_key, 'copy', v_hash, NULL);
  IF v_cmd IS NULL THEN
    v_replay := fixed_cost_private.fc_replay(p_company, v_uid, p_command_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
    PERFORM fixed_cost_private.fc_fail('FC409', 'idempotency_key_reuse');
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(v_plan) x WHERE x->>'action' IN ('create', 'replace') LOOP
    c := r->>'c';
    v_dk := fixed_cost_private.fc_key(p_location, p_to, c);
    SELECT * INTO s FROM public.restaurant_fixed_costs f
     WHERE f.company_id = p_company AND f.location_id IS NOT DISTINCT FROM p_location
       AND f.month = p_from AND f.category = c;
    SELECT * INTO t FROM public.restaurant_fixed_costs f
     WHERE f.company_id = p_company AND f.location_id IS NOT DISTINCT FROM p_location
       AND f.month = p_to AND f.category = c;
    ht := FOUND;
    v_before := v_before || jsonb_build_object(v_dk, fixed_cost_private.fc_snapshot(p_company, p_location, p_to, c));
    v_affected := v_affected || jsonb_build_array(jsonb_build_object('location_id', p_location, 'month', p_to, 'category', c));
    -- The copy remembers exactly which source version it took.
    v_src := jsonb_build_object('month', p_from, 'aggregate_version', s.version, 'command_id', v_cmd);

    IF r->>'action' = 'replace' THEN
      UPDATE public.fixed_cost_items SET status = 'retired', retired_by_command = v_cmd, updated_at = now(),
             version = nextval('fixed_cost_private.fixed_cost_version_seq')
       WHERE company_id = p_company AND location_id IS NOT DISTINCT FROM p_location
         AND month = p_to AND category = c AND status = 'active';
    END IF;

    SELECT count(*) INTO v_n_src FROM public.fixed_cost_items i
     WHERE i.company_id = p_company AND i.location_id IS NOT DISTINCT FROM p_location
       AND i.month = p_from AND i.category = c AND i.status = 'active';

    IF c <> 'impuestos' AND v_n_src > 0 THEN
      -- Itemized source: distinct snapshot items with true lineage.
      FOR it IN SELECT * FROM public.fixed_cost_items i
                 WHERE i.company_id = p_company AND i.location_id IS NOT DISTINCT FROM p_location
                   AND i.month = p_from AND i.category = c AND i.status = 'active'
                 ORDER BY i.seq LOOP
        INSERT INTO public.fixed_cost_items
          (company_id, location_id, month, category, kind, label, amount_cents, currency, origin, created_by_command)
        VALUES (p_company, p_location, p_to, c, it.kind, it.label, it.amount_cents, p_currency,
                CASE WHEN it.kind = 'legacy_base'
                     THEN jsonb_build_object('unknown_detail', true, 'copied_from_month', p_from, 'source_item_id', it.id)
                     ELSE jsonb_build_object('source_item_id', it.id, 'source_month', p_from,
                                             'source_aggregate_version', s.version) END,
                v_cmd);
      END LOOP;
      v_ver := fixed_cost_private.fc_project(p_company, p_location, p_to, c, p_currency, v_uid, 'repeat',
        false, s.split_rule, v_src);
      SELECT COALESCE(jsonb_agg(jsonb_build_object('raw', COALESCE(i.label, ''), 'amount', i.amount_cents::numeric / 100)
               ORDER BY i.seq), '[]'::jsonb)
        INTO v_items_log FROM public.fixed_cost_items i
       WHERE i.created_by_command = v_cmd AND i.location_id IS NOT DISTINCT FROM p_location
         AND i.month = p_to AND i.category = c AND i.kind = 'item';
    ELSIF ht THEN
      -- Legacy / rate source over an existing destination: update in place, no items invented.
      UPDATE public.restaurant_fixed_costs SET amount = s.amount, pct_of_sales = s.pct_of_sales,
        label = s.label, source = 'repeat', status = 'confirmed', repeats = false,
        split_rule = s.split_rule, detail_state = 'legacy_total', copy_source = v_src,
        version = nextval('fixed_cost_private.fixed_cost_version_seq'), updated_by = v_uid, updated_at = now()
       WHERE id = t.id RETURNING version INTO v_ver;
      v_items_log := NULL;
    ELSE
      INSERT INTO public.restaurant_fixed_costs
        (company_id, location_id, month, category, label, amount, pct_of_sales, currency, source, status,
         repeats, split_rule, detail_state, copy_source, version, created_by, updated_by)
      VALUES (p_company, p_location, p_to, c, s.label, s.amount, s.pct_of_sales, p_currency, 'repeat',
              'confirmed', false, s.split_rule, 'legacy_total', v_src,
              nextval('fixed_cost_private.fixed_cost_version_seq'), v_uid, v_uid)
      RETURNING version INTO v_ver;
      v_items_log := NULL;
    END IF;

    SELECT * INTO t FROM public.restaurant_fixed_costs f
     WHERE f.company_id = p_company AND f.location_id IS NOT DISTINCT FROM p_location
       AND f.month = p_to AND f.category = c;
    PERFORM fixed_cost_private.fc_log(v_cmd, p_company, t.id, p_location, p_to, c, v_uid, 'repeat',
      CASE WHEN ht THEN jsonb_build_object('amount', (v_before->v_dk->'aggregate'->>'amount')::numeric,
                                           'pct_of_sales', (v_before->v_dk->'aggregate'->>'pct_of_sales')::numeric) END,
      jsonb_build_object('amount', t.amount, 'pct_of_sales', t.pct_of_sales,
                         'from_month', p_from, 'source_aggregate_version', s.version)
        || CASE WHEN v_items_log IS NOT NULL AND jsonb_array_length(v_items_log) > 0
                THEN jsonb_build_object('items', v_items_log) ELSE '{}'::jsonb END,
      'repeat');
    v_after := v_after || jsonb_build_object(v_dk, jsonb_build_object('version', v_ver));
    v_done := v_done || jsonb_build_array(jsonb_build_object(
      'category', c, 'action', r->>'action', 'version', v_ver, 'amount', t.amount, 'pct_of_sales', t.pct_of_sales));
  END LOOP;

  PERFORM fixed_cost_private.fc_finish(v_cmd, v_affected, v_before, v_after,
    jsonb_build_object('status', 'applied', 'copied', v_done, 'from', p_from, 'to', p_to));
  RETURN jsonb_build_object('status', 'applied', 'copied', v_done, 'from', p_from, 'to', p_to,
                            'command_id', v_cmd, 'replayed', false);
END $$;

-- ---------------------------------------------------------------------------
-- 10. Undo (server-derived, guarded by current versions)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fixed_cost_private.fixed_cost_undo(p_command_key text, p_target uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_uid uuid;
  tc public.fixed_cost_commands%ROWTYPE;
  v_hash text;
  v_replay jsonb;
  v_keys text[] := ARRAY[]::text[];
  x jsonb;
  v_key text;
  v_cmd uuid;
  v_loc uuid;
  v_month date;
  v_cat text;
  v_snap jsonb;
  v_agg jsonb;
  v_cur public.restaurant_fixed_costs%ROWTYPE;
  have boolean;
  v_before_ver int;
  v_ver int;
  v_after jsonb := '{}'::jsonb;
  v_bef_now jsonb := '{}'::jsonb;
  v_source text;
  v_action text;
  v_lines jsonb;
  d public.fixed_cost_upload_drafts%ROWTYPE;
  v_ids text[];
  it jsonb;
BEGIN
  SELECT * INTO tc FROM public.fixed_cost_commands WHERE id = p_target;
  IF NOT FOUND THEN PERFORM fixed_cost_private.fc_fail('FC404', 'not_found'); END IF;
  BEGIN
    v_uid := fixed_cost_private.fc_assert_writer(tc.company_id);
  EXCEPTION WHEN SQLSTATE 'FC403' THEN
    PERFORM fixed_cost_private.fc_fail('FC404', 'not_found');
  END;
  IF p_command_key IS NULL THEN PERFORM fixed_cost_private.fc_fail('FC422', 'invalid_request'); END IF;
  IF tc.kind = 'undo' THEN PERFORM fixed_cost_private.fc_fail('FC422', 'cannot_undo_an_undo'); END IF;
  v_hash := fixed_cost_private.fc_hash(jsonb_build_object('k', 'undo', 't', p_target));
  v_replay := fixed_cost_private.fc_replay(tc.company_id, v_uid, p_command_key, v_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  FOR x IN SELECT * FROM jsonb_array_elements(tc.affected) LOOP
    v_keys := v_keys || fixed_cost_private.fc_key((x->>'location_id')::uuid, (x->>'month')::date, x->>'category');
  END LOOP;
  PERFORM fixed_cost_private.fc_lock_keys(tc.company_id, v_keys);
  v_replay := fixed_cost_private.fc_replay(tc.company_id, v_uid, p_command_key, v_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  IF EXISTS (SELECT 1 FROM public.fixed_cost_commands u WHERE u.undo_of = p_target) THEN
    PERFORM fixed_cost_private.fc_fail('FC409', 'already_undone');
  END IF;
  -- Refuse blind undo: every key must still be at the version this command left.
  FOR x IN SELECT * FROM jsonb_array_elements(tc.affected) LOOP
    v_key := fixed_cost_private.fc_key((x->>'location_id')::uuid, (x->>'month')::date, x->>'category');
    IF fixed_cost_private.fc_version(tc.company_id, (x->>'location_id')::uuid, (x->>'month')::date, x->>'category')
       <> COALESCE((tc.after_state->v_key->>'version')::int, 0) THEN
      PERFORM fixed_cost_private.fc_fail('FC409', 'changed_since', jsonb_build_object('key', v_key));
    END IF;
  END LOOP;

  v_cmd := fixed_cost_private.fc_begin(tc.company_id, v_uid, p_command_key, 'undo', v_hash, tc.draft_id);
  IF v_cmd IS NULL THEN
    v_replay := fixed_cost_private.fc_replay(tc.company_id, v_uid, p_command_key, v_hash);
    IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
    PERFORM fixed_cost_private.fc_fail('FC409', 'idempotency_key_reuse');
  END IF;
  v_source := CASE tc.kind WHEN 'approve_upload' THEN 'upload' WHEN 'copy' THEN 'repeat' ELSE 'manual' END;

  FOR x IN SELECT * FROM jsonb_array_elements(tc.affected) LOOP
    v_loc := (x->>'location_id')::uuid; v_month := (x->>'month')::date; v_cat := x->>'category';
    v_key := fixed_cost_private.fc_key(v_loc, v_month, v_cat);
    v_snap := tc.before_state->v_key;
    v_agg := NULLIF(v_snap->'aggregate', 'null'::jsonb);
    v_bef_now := v_bef_now || jsonb_build_object(v_key, fixed_cost_private.fc_snapshot(tc.company_id, v_loc, v_month, v_cat));
    v_before_ver := COALESCE((v_agg->>'version')::int, 0);
    SELECT * INTO v_cur FROM public.restaurant_fixed_costs f
     WHERE f.company_id = tc.company_id AND f.location_id IS NOT DISTINCT FROM v_loc
       AND f.month = v_month AND f.category = v_cat;
    have := FOUND;
    -- A key the command left alone (a no-op) has nothing to restore.
    IF (have AND v_cur.version = v_before_ver) OR (NOT have AND v_agg IS NULL) THEN
      v_after := v_after || jsonb_build_object(v_key, jsonb_build_object('version', fixed_cost_private.fc_version(tc.company_id, v_loc, v_month, v_cat)));
      CONTINUE;
    END IF;

    -- Items this command created go away; items it retired or edited come back as they were.
    UPDATE public.fixed_cost_items SET status = 'retired', retired_by_command = v_cmd, updated_at = now(),
           version = nextval('fixed_cost_private.fixed_cost_version_seq')
     WHERE created_by_command = p_target AND status = 'active'
       AND company_id = tc.company_id AND location_id IS NOT DISTINCT FROM v_loc
       AND month = v_month AND category = v_cat;
    FOR it IN SELECT * FROM jsonb_array_elements(v_snap->'items') LOOP
      UPDATE public.fixed_cost_items SET status = 'active', retired_by_command = NULL,
             amount_cents = (it->>'amount_cents')::bigint, label = it->>'label', updated_at = now(),
             version = nextval('fixed_cost_private.fixed_cost_version_seq')
       WHERE id = (it->>'id')::uuid AND company_id = tc.company_id;
    END LOOP;

    IF v_agg IS NULL THEN
      DELETE FROM public.restaurant_fixed_costs WHERE id = v_cur.id;
      v_ver := 0; v_action := 'delete';
    ELSIF have THEN
      UPDATE public.restaurant_fixed_costs SET
        amount = (v_agg->>'amount')::numeric, pct_of_sales = (v_agg->>'pct_of_sales')::numeric,
        label = v_agg->>'label', source = v_agg->>'source', status = v_agg->>'status',
        repeats = (v_agg->>'repeats')::boolean, split_rule = v_agg->>'split_rule',
        detail_state = v_agg->>'detail_state', copy_source = v_agg->'copy_source',
        version = nextval('fixed_cost_private.fixed_cost_version_seq'), updated_by = v_uid, updated_at = now()
       WHERE id = v_cur.id RETURNING version INTO v_ver;
      v_action := 'update';
    ELSE
      INSERT INTO public.restaurant_fixed_costs
        (id, company_id, location_id, month, category, label, amount, pct_of_sales, currency, source, status,
         repeats, split_rule, detail_state, copy_source, version, created_by, updated_by)
      VALUES ((v_agg->>'id')::uuid, tc.company_id, v_loc, v_month, v_cat, v_agg->>'label',
              (v_agg->>'amount')::numeric, (v_agg->>'pct_of_sales')::numeric, v_agg->>'currency',
              v_agg->>'source', v_agg->>'status', (v_agg->>'repeats')::boolean, v_agg->>'split_rule',
              v_agg->>'detail_state', v_agg->'copy_source', nextval('fixed_cost_private.fixed_cost_version_seq'), v_uid, v_uid)
      RETURNING version INTO v_ver;
      v_action := 'create';
    END IF;
    PERFORM fixed_cost_private.fc_log(v_cmd, tc.company_id, COALESCE(v_cur.id, (v_agg->>'id')::uuid), v_loc, v_month, v_cat,
      v_uid, v_action,
      CASE WHEN have THEN jsonb_build_object('amount', v_cur.amount, 'pct_of_sales', v_cur.pct_of_sales) END,
      CASE WHEN v_action = 'delete' THEN 'null'::jsonb
           ELSE jsonb_build_object('amount', (v_agg->>'amount')::numeric, 'pct_of_sales', (v_agg->>'pct_of_sales')::numeric) END
        || jsonb_build_object('undo_of', p_target),
      v_source);
    v_after := v_after || jsonb_build_object(v_key, jsonb_build_object('version', v_ver));
  END LOOP;

  -- An upload approval: its lines go back to the draft as pending.
  IF tc.kind = 'approve_upload' AND tc.draft_id IS NOT NULL THEN
    SELECT * INTO d FROM public.fixed_cost_upload_drafts WHERE id = tc.draft_id FOR UPDATE;
    IF FOUND THEN
      SELECT COALESCE(array_agg(z), ARRAY[]::text[]) INTO v_ids
        FROM (SELECT jsonb_array_elements_text(tc.result->'written_line_ids')
              UNION ALL SELECT jsonb_array_elements_text(tc.result->'noop_line_ids')) q(z);
      SELECT jsonb_agg(CASE WHEN l->>'id' = ANY (v_ids) AND l->>'status' = 'approved'
                            THEN l || '{"status":"pending"}'::jsonb ELSE l END ORDER BY t.ord)
        INTO v_lines FROM jsonb_array_elements(d.parsed_lines) WITH ORDINALITY t(l, ord);
      UPDATE public.fixed_cost_upload_drafts SET parsed_lines = v_lines,
        status = CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_lines) l WHERE l->>'status' = 'pending')
                      THEN 'draft'
                      WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_lines) l WHERE l->>'status' = 'approved')
                      THEN 'approved' ELSE 'discarded' END,
        approved_by = NULL, approved_at = NULL,
        version = nextval('fixed_cost_private.fixed_cost_version_seq'), updated_at = now()
       WHERE id = d.id RETURNING * INTO d;
    END IF;
  END IF;

  PERFORM fixed_cost_private.fc_finish(v_cmd, tc.affected, v_bef_now, v_after,
    jsonb_build_object('status', 'applied', 'undone', p_target,
                       'draft', CASE WHEN d.id IS NULL THEN NULL
                                ELSE jsonb_build_object('id', d.id, 'version', d.version, 'status', d.status, 'lines', d.parsed_lines) END),
    p_target);
  RETURN jsonb_build_object('status', 'applied', 'undone', p_target, 'command_id', v_cmd, 'replayed', false,
                            'draft', CASE WHEN d.id IS NULL THEN NULL
                                     ELSE jsonb_build_object('id', d.id, 'version', d.version, 'status', d.status, 'lines', d.parsed_lines) END);
END $$;

-- ---------------------------------------------------------------------------
-- 11. API surface: seven SECURITY INVOKER wrappers in public
-- ---------------------------------------------------------------------------
-- A wrapper runs as the caller (so auth.uid() is the caller's) and only forwards
-- to the private implementation, which re-checks the caller's writer role. The
-- argument names are the ones the client already sends (p_*).

CREATE OR REPLACE FUNCTION public.fixed_cost_preview_upload(p_draft_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT fixed_cost_private.fixed_cost_preview_upload(p_draft_id)
$$;

CREATE OR REPLACE FUNCTION public.fixed_cost_approve_upload(
  p_command_key text, p_draft_id uuid, p_expected_draft_version integer,
  p_expected jsonb, p_line_ids text[], p_decisions jsonb, p_currency text)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT fixed_cost_private.fixed_cost_approve_upload(
    p_command_key, p_draft_id, p_expected_draft_version, p_expected, p_line_ids, p_decisions, p_currency)
$$;

CREATE OR REPLACE FUNCTION public.fixed_cost_save_totals(
  p_command_key text, p_company uuid, p_month date, p_location uuid,
  p_entries jsonb, p_currency text)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT fixed_cost_private.fixed_cost_save_totals(
    p_command_key, p_company, p_month, p_location, p_entries, p_currency)
$$;

CREATE OR REPLACE FUNCTION public.fixed_cost_item_command(
  p_command_key text, p_company uuid, p_op text, p_location uuid, p_month date,
  p_category text, p_item_id uuid, p_label text, p_amount_cents bigint,
  p_expected_agg_version integer, p_expected_item_version integer, p_currency text)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT fixed_cost_private.fixed_cost_item_command(
    p_command_key, p_company, p_op, p_location, p_month, p_category, p_item_id,
    p_label, p_amount_cents, p_expected_agg_version, p_expected_item_version, p_currency)
$$;

CREATE OR REPLACE FUNCTION public.fixed_cost_preview_copy(
  p_company uuid, p_location uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT fixed_cost_private.fixed_cost_preview_copy(p_company, p_location, p_from, p_to)
$$;

CREATE OR REPLACE FUNCTION public.fixed_cost_copy(
  p_command_key text, p_company uuid, p_location uuid, p_from date, p_to date,
  p_categories text[], p_decisions jsonb, p_expected jsonb, p_currency text)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT fixed_cost_private.fixed_cost_copy(
    p_command_key, p_company, p_location, p_from, p_to, p_categories, p_decisions, p_expected, p_currency)
$$;

CREATE OR REPLACE FUNCTION public.fixed_cost_undo(p_command_key text, p_target uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT fixed_cost_private.fixed_cost_undo(p_command_key, p_target)
$$;

-- ---------------------------------------------------------------------------
-- 12. Privileges, stated explicitly (never left to default privileges)
-- ---------------------------------------------------------------------------
-- Hosted Supabase default privileges grant EXECUTE on new functions and
-- SELECT/UPDATE/USAGE on new sequences to anon, authenticated and service_role.
-- Everything new is therefore reset here and only the intended grants are made.

-- 12a. Helpers, trigger functions and implementations (private schema).
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'fixed_cost_private'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f.sig);
    -- Only the seven implementations are callable, and only by signed-in users
    -- (through the wrappers); each one checks auth.uid() and the writer role.
    IF f.proname IN ('fixed_cost_preview_upload', 'fixed_cost_approve_upload', 'fixed_cost_save_totals',
                     'fixed_cost_item_command', 'fixed_cost_preview_copy', 'fixed_cost_copy', 'fixed_cost_undo') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
    END IF;
  END LOOP;
END
$$;

-- 12b. Public wrappers: signed-in users only.
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN (
       'fixed_cost_preview_upload', 'fixed_cost_approve_upload', 'fixed_cost_save_totals',
       'fixed_cost_item_command', 'fixed_cost_preview_copy', 'fixed_cost_copy', 'fixed_cost_undo')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, service_role', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
  END LOOP;
END
$$;

-- 12c. Sequences. Only the owner (the SECURITY DEFINER code) may use them: no
-- API role can read, advance or reset a version counter. The identity sequence
-- of fixed_cost_items is exempt from the inserting role's privileges, so the
-- owner-run commands keep working.
REVOKE ALL ON SEQUENCE fixed_cost_private.fixed_cost_version_seq FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role',
                 pg_get_serial_sequence('public.fixed_cost_items', 'seq'));
END
$$;
