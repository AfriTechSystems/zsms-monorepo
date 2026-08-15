-- Migration: 0076_revoke_payment_update_privilege.sql
-- Created: 2026-08-15
-- Description: Revokes the inherited UPDATE privilege on public.payments.
-- Related documents: Official Documentation/01 Foundation Layer/RLS.md — payments
--
-- Found by the Phase 2 isolation suite:
--
--   not ok 3 - authenticated holds no UPDATE on payments   (have 1, want 0)
--
-- Same root cause as 0019. Supabase's default privileges grant ALL on a new
-- public table to `authenticated`. 0070 granted SELECT and INSERT and revoked
-- DELETE/TRUNCATE, but adding grants does not remove the UPDATE already held —
-- and 0019's ALTER DEFAULT PRIVILEGES only covered DELETE and TRUNCATE.
--
-- 0070's own comment asserted "no UPDATE privilege for end users at all". That
-- was wrong when written. This migration makes it true.
--
-- Exposure: payments has no UPDATE policy, so RLS filtered direct updates to
-- zero rows for ordinary roles. But afritech_admin_all_payments is FOR ALL,
-- which covers UPDATE — so a super admin could edit a payment in place,
-- bypassing verify_payment() and its guard against re-verifying an already
-- verified payment. Payments are supposed to be immutable, with corrections
-- made as reversal rows; an in-place edit leaves no trace that it happened.
--
-- verify_payment() is unaffected: it is SECURITY DEFINER and runs as its owner,
-- so it retains the UPDATE it needs. That is the point — it becomes the only
-- path that can change a payment's status, and it records who and when.

-- === MIGRATION START ===

REVOKE UPDATE ON public.payments FROM authenticated, anon;

-- Verify inline. If a future migration re-grants UPDATE here, the failure
-- surfaces at apply time rather than in an audit months later.
DO $$
DECLARE
  n INT;
BEGIN
  SELECT count(*) INTO n
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name   = 'payments'
    AND grantee IN ('authenticated', 'anon')
    AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE');

  IF n > 0 THEN
    RAISE EXCEPTION
      'payments still exposes % mutating privilege(s) to end-user roles; corrections must be reversal rows', n;
  END IF;
END;
$$;

-- === MIGRATION END ===
