-- 076: allow the five team roles on workspace invites (widens the 020 check).
-- Only widens: every existing row ('owner','member') stays valid.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.workspace_invites'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.workspace_invites DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE public.workspace_invites
  ADD CONSTRAINT workspace_invites_role_check
  CHECK (role IN ('owner','admin','manager','analyst','viewer','member'));
