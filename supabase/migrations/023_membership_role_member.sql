-- 023_membership_role_member.sql
--
-- Add 'member' to company_memberships.role check constraint so workspace
-- invites with role='member' can be accepted (R1 item 2, GitHub issue #45,
-- PR #56). Without this fix, accept_workspace_invite() fails when inserting
-- the membership for every non-owner invite, because the baseline check
-- (001_baseline.sql, applied on staging) only allowed owner/admin/manager/
-- analyst/viewer.
--
-- Product decision: first invitee to a workspace gets role 'owner', later
-- invitees get 'member' (migration 020, Brief Decision 3). That decision is
-- unchanged; this migration makes the database schema consistent with it.
--
-- IDEMPOTENT: safe to run multiple times. Single transaction. No data
-- migration needed (staging has no company_memberships rows with
-- role='member' yet, since none could be inserted).

BEGIN;

-- Drop the existing constraint (created by 001_baseline.sql)
ALTER TABLE public.company_memberships
DROP CONSTRAINT IF EXISTS company_memberships_role_check;

-- Re-create the constraint with 'member' added
ALTER TABLE public.company_memberships
ADD CONSTRAINT company_memberships_role_check
CHECK (role = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text, 'analyst'::text, 'viewer'::text, 'member'::text]));

COMMIT;
