-- 013_pos_sales_idempotency_and_connections.sql
--
-- Foundation for POS-source sync jobs (GitHub Issue #3, first consumer:
-- Odoo 18). Three additive, independent changes:
--
--   1. A generic idempotency index on pos_sales_items. The uniqueness rule
--      (company_id, pos_source, external_line_id) is canonical — it is not
--      Odoo-specific, so any future source that can supply a stable
--      external_line_id (not just Odoo) gets safe upsert-based dedup for
--      free.
--
--      This is a NORMAL (non-partial) unique index, not a partial one —
--      that is a deliberate correction from an earlier draft of this
--      migration (never applied to production). The Odoo sync route uses
--      Supabase/PostgREST `.upsert()` with
--      `onConflict: "company_id,pos_source,external_line_id"`, which
--      compiles to `INSERT ... ON CONFLICT (company_id, pos_source,
--      external_line_id) DO UPDATE ...`. Postgres can only use a unique
--      index/constraint as an ON CONFLICT arbiter via column-list
--      inference when that index has NO predicate — PostgREST's
--      `onConflict` parameter has no way to express a partial index's
--      WHERE clause. A partial index here would make every upsert call
--      fail immediately with "there is no unique or exclusion constraint
--      matching the ON CONFLICT specification", regardless of whether an
--      actual duplicate exists.
--
--      Existing (and future) Revel rows, which never populate
--      external_line_id, remain completely unaffected by this being a
--      full index: standard SQL/Postgres unique-index semantics treat
--      every NULL as distinct from every other NULL (this project does
--      not use `NULLS NOT DISTINCT`), so any number of
--      (company_id, pos_source, NULL) rows can coexist without violating
--      this constraint — exactly as they could under the old partial
--      index. See tests/unit/migration-013-index.test.ts for a content
--      regression check, and lib/restaurant/odoo/sync.ts /
--      tests/unit/odoo-sync.test.ts for the row-shape this index dedups.
--
--   2. restaurant_pos_connections: per-restaurant NON-SECRET connection
--      configuration for POS sources that require live API access (as
--      opposed to Revel's file-upload flow, which needs no stored
--      connection at all). Deliberately excludes any credential/secret
--      column — see (3) below for where the actual secret lives.
--
--   3. restaurant_pos_secrets: the encrypted Odoo (and future live-API
--      POS source) credential, one row per restaurant_pos_connections
--      row. Split into its own table, rather than a column on
--      restaurant_pos_connections, specifically so it can carry its own
--      RLS posture: enabled, with ZERO policies for any role. With RLS
--      enabled and no permissive policy, Postgres denies ALL access
--      (SELECT/INSERT/UPDATE/DELETE) to any role that isn't exempt from
--      RLS — which in this project means only the Supabase service-role
--      key (see lib/supabase/admin.ts's createAdminClient(), the only
--      client ever used against this table — see
--      lib/restaurant/odoo/secrets.ts). No authenticated user, however
--      privileged within their own company, and no anon request can ever
--      read or write a row here. The stored value itself is additionally
--      encrypted at the application layer (AES-256-GCM, key from the
--      server-only ODOO_CREDENTIALS_ENCRYPTION_KEY env var) before it
--      ever reaches this table, so a raw database dump or a
--      misconfigured future policy still would not expose a usable
--      plaintext credential.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with production
-- access — it is NOT applied automatically by this change.

-- ---------------------------------------------------------------------------
-- 1. Idempotency index (normal, non-partial — see rationale above)
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS pos_sales_items_source_line_uniq
  ON public.pos_sales_items (company_id, pos_source, external_line_id);

-- ---------------------------------------------------------------------------
-- 2. restaurant_pos_connections — non-secret per-restaurant config
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.restaurant_pos_connections (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Matches pos_sales_items.pos_source in spirit (free text, no CHECK —
  -- onboarding a new POS source should never require a migration here
  -- either).
  pos_source     text NOT NULL,

  base_url       text NOT NULL,
  database_name  text NOT NULL,
  username       text NOT NULL,

  -- IANA timezone name (e.g. "America/Mexico_City"). Required to derive
  -- pos_sales_items.sale_date correctly from Odoo's UTC date_order —
  -- deliberately NOT hard-coded anywhere in application code.
  timezone       text NOT NULL,

  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- One connection row per (company, source). Re-configuring is an
  -- UPDATE, not a second row. This also means: for the current Scenario A
  -- model (one Odoo database per company, multiple pos.config values
  -- distinguished by name-matching against restaurant_locations — see the
  -- Odoo Production Readiness Audit), one company has at most one Odoo
  -- connection. Supporting genuinely separate Odoo databases per
  -- restaurant location (Scenario B) is a deliberately deferred,
  -- unimplemented decision — it would need this constraint to become
  -- UNIQUE (company_id, pos_source, location_id) with a nullable
  -- location_id, which is out of scope here.
  CONSTRAINT restaurant_pos_connections_uniq
    UNIQUE (company_id, pos_source)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_pos_connections_company
  ON public.restaurant_pos_connections(company_id);

-- Row Level Security ---------------------------------------------------------
ALTER TABLE public.restaurant_pos_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS restaurant_pos_connections_select ON public.restaurant_pos_connections;
CREATE POLICY restaurant_pos_connections_select ON public.restaurant_pos_connections
  FOR SELECT USING (public.is_company_member(company_id));

DROP POLICY IF EXISTS restaurant_pos_connections_insert ON public.restaurant_pos_connections;
CREATE POLICY restaurant_pos_connections_insert ON public.restaurant_pos_connections
  FOR INSERT WITH CHECK (public.is_company_member(company_id));

DROP POLICY IF EXISTS restaurant_pos_connections_update ON public.restaurant_pos_connections;
CREATE POLICY restaurant_pos_connections_update ON public.restaurant_pos_connections
  FOR UPDATE USING (public.is_company_member(company_id))
              WITH CHECK (public.is_company_member(company_id));

DROP POLICY IF EXISTS restaurant_pos_connections_delete ON public.restaurant_pos_connections;
CREATE POLICY restaurant_pos_connections_delete ON public.restaurant_pos_connections
  FOR DELETE USING (public.is_company_member(company_id));

-- ---------------------------------------------------------------------------
-- 3. restaurant_pos_secrets — encrypted credential, service-role only
--
-- No SELECT/INSERT/UPDATE/DELETE policy is defined for this table, for
-- ANY role, ANYWHERE in this migration or any future one that doesn't
-- explicitly revisit this decision. That absence is the access control —
-- see the rationale above. Do not add a policy here without a deliberate,
-- separately-reviewed reason.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.restaurant_pos_secrets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- One secret per connection. UNIQUE, not just indexed — this is the
  -- keyed-upsert target the application code (storeOdooSecret) relies on,
  -- and it transitively caps this at one Odoo secret per company today,
  -- matching restaurant_pos_connections_uniq above.
  connection_id   uuid NOT NULL UNIQUE
                  REFERENCES public.restaurant_pos_connections(id) ON DELETE CASCADE,

  -- Denormalized from restaurant_pos_connections.company_id so every
  -- server-side query can filter by company_id directly (defense in
  -- depth — see lib/restaurant/odoo/secrets.ts's secretBelongsToCompany())
  -- without requiring a join. Application code is the only writer and
  -- always derives both ids from the same authenticated request, so they
  -- cannot drift; there is intentionally no CHECK enforcing the two
  -- tables agree, since that would require a function-based constraint
  -- for no real additional safety here.
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- AES-256-GCM output, each base64-encoded. Never plaintext. The
  -- encryption key lives only in the server-only ODOO_CREDENTIALS_ENCRYPTION_KEY
  -- env var (Vercel), never in this database.
  encrypted_secret text NOT NULL,
  iv               text NOT NULL,
  auth_tag         text NOT NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_pos_secrets_company
  ON public.restaurant_pos_secrets(company_id);

ALTER TABLE public.restaurant_pos_secrets ENABLE ROW LEVEL SECURITY;
-- Deliberately no CREATE POLICY statements below this line for this table.
