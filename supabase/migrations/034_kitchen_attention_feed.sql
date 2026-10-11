-- 034_kitchen_attention_feed.sql
--
-- Kitchen tab (#148): needs-attention feed + 3 backend facts.
-- Additive. Safe to re-run. Apply on Milton Staging after 033.
--
-- WHAT THIS FILE DOES:
--   1. kitchen_reports.resolved_at / resolved_by so managers can mark
--      low-stock rows resolved. Idempotent ADD COLUMN.
--   2. kitchen_attention_feed: one SECURITY DEFINER JSON payload of
--      reports, pending recipe drafts and kitchen staff for the selected
--      company / location / local-date window. Membership checked once
--      via is_company_member; fail closed (empty JSON). Telegram file
--      ids are never returned.
--
-- IMPORTANT: This file is for repo history. Supabase migrations are not
-- applied from the repo by CI yet, so this SQL must also be pasted
-- manually into the Supabase SQL Editor by someone with staging access
-- first — it is NOT applied automatically by this change.

-- ---------------------------------------------------------------------------
-- 1. Resolve columns on kitchen_reports
-- ---------------------------------------------------------------------------

ALTER TABLE public.kitchen_reports
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz NULL;

ALTER TABLE public.kitchen_reports
  ADD COLUMN IF NOT EXISTS resolved_by uuid NULL;

CREATE INDEX IF NOT EXISTS kitchen_reports_company_location_open_idx
  ON public.kitchen_reports (company_id, location_id, report_type, created_at DESC)
  WHERE resolved_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. kitchen_attention_feed
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.kitchen_attention_feed(
  p_company_id uuid,
  p_location_id uuid DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_timezone text DEFAULT 'UTC'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tz text;
  result jsonb;
BEGIN
  -- Fail closed: do not scan another company's rows, even as DEFINER.
  IF p_company_id IS NULL OR NOT public.is_company_member(p_company_id) THEN
    RETURN jsonb_build_object(
      'reports', '[]'::jsonb,
      'drafts', '[]'::jsonb,
      'staff', '[]'::jsonb
    );
  END IF;

  IF p_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.restaurant_locations loc
    WHERE loc.id = p_location_id
      AND loc.company_id = p_company_id
  ) THEN
    RETURN jsonb_build_object(
      'reports', '[]'::jsonb,
      'drafts', '[]'::jsonb,
      'staff', '[]'::jsonb
    );
  END IF;

  tz := nullif(trim(coalesce(p_timezone, '')), '');
  IF tz IS NULL THEN
    tz := 'UTC';
  END IF;
  BEGIN
    PERFORM now() AT TIME ZONE tz;
  EXCEPTION
    WHEN others THEN
      tz := 'UTC';
  END;

  WITH report_rows AS (
    SELECT
      r.id,
      r.location_id,
      r.staff_id,
      coalesce(s.display_name, '') AS staff_name,
      r.report_type,
      r.text,
      r.media_kind,
      r.created_at,
      r.resolved_at,
      to_char((r.created_at AT TIME ZONE tz), 'YYYY-MM-DD') AS local_date,
      EXTRACT(HOUR FROM (r.created_at AT TIME ZONE tz))::int AS local_hour,
      EXTRACT(MINUTE FROM (r.created_at AT TIME ZONE tz))::int AS local_minute
    FROM public.kitchen_reports r
    LEFT JOIN public.kitchen_staff s ON s.id = r.staff_id
    WHERE r.company_id = p_company_id
      AND (p_location_id IS NULL OR r.location_id = p_location_id)
      AND (
        (
          p_from IS NOT NULL AND p_to IS NOT NULL
          AND to_char((r.created_at AT TIME ZONE tz), 'YYYY-MM-DD')
            BETWEEN to_char(p_from, 'YYYY-MM-DD') AND to_char(p_to, 'YYYY-MM-DD')
        )
        OR (
          r.resolved_at IS NULL
          AND r.report_type IN ('running_out', '86')
        )
      )
    ORDER BY r.created_at DESC
    LIMIT 2000
  ),
  draft_rows AS (
    SELECT
      d.id,
      d.dish_name,
      d.portions,
      d.status,
      coalesce(s.display_name, '') AS staff_name,
      d.created_at,
      to_char((d.created_at AT TIME ZONE tz), 'YYYY-MM-DD') AS local_date,
      EXTRACT(HOUR FROM (d.created_at AT TIME ZONE tz))::int AS local_hour,
      EXTRACT(MINUTE FROM (d.created_at AT TIME ZONE tz))::int AS local_minute,
      EXISTS (
        SELECT 1
        FROM public.kitchen_reports kr
        WHERE kr.id = d.kitchen_report_id
          AND kr.media_kind = 'photo'
      ) AS has_photo
    FROM public.kitchen_recipe_drafts d
    LEFT JOIN public.kitchen_staff s ON s.id = d.staff_id
    WHERE d.company_id = p_company_id
      AND (p_location_id IS NULL OR d.location_id = p_location_id)
      AND d.status IN ('draft', 'awaiting_portions')
    ORDER BY d.created_at DESC
    LIMIT 200
  ),
  staff_rows AS (
    SELECT
      st.id,
      st.display_name,
      st.is_active
    FROM public.kitchen_staff st
    WHERE st.company_id = p_company_id
      AND (p_location_id IS NULL OR st.location_id = p_location_id)
  )
  SELECT jsonb_build_object(
    'reports', coalesce(
      (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC) FROM report_rows r),
      '[]'::jsonb
    ),
    'drafts', coalesce(
      (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.created_at DESC) FROM draft_rows d),
      '[]'::jsonb
    ),
    'staff', coalesce(
      (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.display_name) FROM staff_rows s),
      '[]'::jsonb
    )
  )
  INTO result;

  RETURN coalesce(
    result,
    jsonb_build_object(
      'reports', '[]'::jsonb,
      'drafts', '[]'::jsonb,
      'staff', '[]'::jsonb
    )
  );
END;
$$;

COMMENT ON FUNCTION public.kitchen_attention_feed(uuid, uuid, date, date, text) IS
  'Kitchen needs-attention feed. SECURITY DEFINER after is_company_member. Fail closed. Safe to re-run this migration.';

REVOKE EXECUTE ON FUNCTION public.kitchen_attention_feed(uuid, uuid, date, date, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kitchen_attention_feed(uuid, uuid, date, date, text)
  TO authenticated, service_role;
