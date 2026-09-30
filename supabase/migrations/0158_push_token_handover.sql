-- Migration: 0158_push_token_handover.sql
-- Created: 2026-09-30
-- Description: A phone changing hands could not be re-registered. `register_push_token()` was
--              SECURITY INVOKER, and the upsert's UPDATE is checked against the policy's USING clause.
-- Related documents: Official Documentation/10 Attendance/NOTIFICATIONS.md
--
-- ===========================================================================
-- A FUNCTION THAT HAS TO DO SOMETHING THE POLICY FORBIDS
--
-- `0157` made `register_push_token()` SECURITY INVOKER, reasoning that `parent_manage_own_push_tokens`
-- already says a caller may write only their own row, so the function needed no check of its own.
--
-- That reasoning is right for registration and wrong for the case it was also meant to handle. When a
-- handset is passed to another family member who signs in as themselves, the token already exists and
-- belongs to somebody else — and `ON CONFLICT ... DO UPDATE` is evaluated against the policy's
-- **USING** clause, which requires the row to be the caller's. CI:
--
--     new row violates row-level security policy (USING expression) for table "parent_push_tokens"
--
-- The policy was not wrong. A parent genuinely must not be able to write another parent's rows. The
-- mistake was expecting a function with no privileges of its own to perform an operation whose whole
-- point is to cross that line.
--
-- So it becomes SECURITY DEFINER — and safe for a specific, checkable reason: **it takes no user id.**
-- The owner is always `get_user_id()`, so there is no argument a caller could pass to assign a token
-- to anybody but themselves. The elevated rights buy exactly one thing, retiring the previous holder's
-- claim, and nothing else.
--
-- ---------------------------------------------------------------------------
-- AND THE HISTORY IS KEPT, WHICH NEEDS THE UNIQUE KEY TO CHANGE
-- ---------------------------------------------------------------------------
-- Reassigning the row in place would work and would erase the fact that the device ever belonged to
-- the first parent — in the one case somebody is most likely to ask about, because two people will
-- disagree about who should be getting the alerts.
--
-- `UNIQUE (push_token)` becomes a **partial** unique index over active rows only. A retired row and a
-- live one may then share a token, so a handover is: retire the old claim, insert a new one. Both are
-- visible afterwards, with a reason on the retired one.
-- ===========================================================================

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- 1. One ACTIVE row per device, rather than one row ever.
-- ---------------------------------------------------------------------------
ALTER TABLE public.parent_push_tokens
  DROP CONSTRAINT IF EXISTS parent_push_tokens_push_token_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_parent_push_tokens_active_token
  ON public.parent_push_tokens(push_token)
  WHERE is_active;

COMMENT ON INDEX public.idx_parent_push_tokens_active_token IS
  'One ACTIVE row per device. Partial rather than a plain UNIQUE so a retired claim and a live one '
  'can share a token — which is what makes a handset changing hands visible afterwards instead of '
  'overwritten.';

-- ---------------------------------------------------------------------------
-- 2. Registration, now able to take a device over.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_push_token(
  p_push_token TEXT,
  p_platform   TEXT
)
RETURNS public.parent_push_tokens
LANGUAGE plpgsql
SECURITY DEFINER
/**
 * DEFINER, and the argument list is what makes that safe: there is no parameter naming an owner, so
 * the only account a caller can register a device to is their own. Compare
 * `worker_parent_push_tokens()`, which is DEFINER because a worker has no JWT at all — different
 * reason, same discipline of buying the narrowest possible privilege.
 */
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user TEXT;
  v_row  public.parent_push_tokens;
BEGIN
  v_user := public.get_user_id();
  IF v_user IS NULL OR v_user = '' THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  IF p_push_token IS NULL OR BTRIM(p_push_token) = '' THEN
    RAISE EXCEPTION 'A push token is required.' USING ERRCODE = '22023';
  END IF;

  /**
   * Retire an active claim held by somebody else.
   *
   * This is the one statement the elevated rights exist for. Scoped to a different owner, so a parent
   * refreshing their own token falls through to the upsert below and keeps the row they already have
   * — re-registering on every app launch must not churn the table or lose `created_at`.
   */
  UPDATE public.parent_push_tokens AS t
     SET is_active      = FALSE,
         retired_at     = NOW(),
         retired_reason = 'device_reassigned'
   WHERE t.push_token = BTRIM(p_push_token)
     AND t.is_active
     AND t.parent_user_id <> v_user;

  INSERT INTO public.parent_push_tokens (parent_user_id, push_token, platform)
  VALUES (v_user, BTRIM(p_push_token), p_platform)
  -- Inferring the partial index, so the conflict target is "the active row for this device".
  ON CONFLICT (push_token) WHERE is_active DO UPDATE
    SET platform     = EXCLUDED.platform,
        last_seen_at = NOW()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_push_token(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_push_token(TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.register_push_token(TEXT, TEXT) IS
  'Registers or refreshes the calling parent''s device, taking it over from a previous holder if the '
  'handset changed hands. SECURITY DEFINER because that last part is something the RLS policy '
  'correctly forbids; safe because the function takes no user id, so a caller cannot name anybody '
  'else as the owner.';

-- === MIGRATION END ===
