-- Migration: 0157_parent_push_tokens.sql
-- Created: 2026-09-30
-- Description: Push notification tokens for the parent app. Specified in NOTIFICATIONS.md since
--              April, with DDL, and never created.
-- Related documents: Official Documentation/10 Attendance/NOTIFICATIONS.md
--                    Official Documentation/05 Core Database and API Reference/SCHEMA.md
--                    Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-004
--
-- ===========================================================================
-- THE TABLE THREE DOCUMENTS DESCRIBE AND THE SCHEMA NEVER HAD
--
-- `NOTIFICATIONS.md`, `SCHEMA.md` and `DATABASE.md` all describe `parent_push_tokens`, and
-- `NOTIFICATIONS.md` gives the complete DDL plus the client code that writes to it. It has never
-- existed. The same pattern `CLAUDE.md` opens by warning about, found the usual way — by trying to
-- build against the document.
--
-- Push matters more here than the channel list suggests. `NOTIFICATIONS.md` is explicit that ZSMS is
-- portal-first and does **not** send a WhatsApp message per absence, because each one costs quota —
-- so push is the free channel that makes per-absence alerts viable at all. Without it the parent's
-- only per-absence signal is opening the portal, which is the behaviour a parent app exists to
-- replace.
--
-- ---------------------------------------------------------------------------
-- ONE CORRECTION TO THE DOCUMENTED DDL
-- ---------------------------------------------------------------------------
-- `NOTIFICATIONS.md` specifies `UNIQUE (parent_user_id, platform)`. That caps a parent at one Android
-- device and one iPhone, and the case it breaks is common rather than exotic: **a mother and father
-- sharing one parent account on two Android phones.** Registering the second replaces the first, and
-- one of them silently stops receiving alerts — the hardest class of bug to report, because nothing
-- appears to fail.
--
-- The unique key here is the **token**, which is what actually identifies a device installation.
-- Expo reissues a token when an app is reinstalled, so a stale row is retired by the delivery
-- receipt rather than by guessing from the platform.
--
-- ---------------------------------------------------------------------------
-- NOT SCHOOL-SCOPED, DELIBERATELY
-- ---------------------------------------------------------------------------
-- No `school_id`. `0117` established that not one of the twelve parent policies is school-scoped —
-- a parent may have children at several schools and reads across them from one session. A push token
-- belongs to a person's phone, not to a school, and adding a school column would mean a parent with
-- two children at two schools registering the same device twice.
--
-- A consequence worth naming: `0149`'s write guard does not apply here, since it attaches only to
-- tables with a UUID `school_id`. That is correct. A suspended school must still not send, and that
-- is enforced where the message is composed, not where the device is recorded — revoking a parent's
-- ability to receive anything because one of their children's schools lapsed would punish the wrong
-- person.
-- ===========================================================================

-- === MIGRATION START ===

CREATE TABLE IF NOT EXISTS public.parent_push_tokens (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Clerk user id. Matches `get_user_id()`, the same key every parent policy resolves through.
  parent_user_id  TEXT NOT NULL,

  /**
   * The Expo push token — `ExponentPushToken[...]`. UNIQUE, because it identifies one installation
   * on one device, which is the real unit here. See the header for why the documented
   * `(parent_user_id, platform)` key was wrong.
   */
  push_token      TEXT NOT NULL UNIQUE,

  platform        TEXT NOT NULL CHECK (platform IN ('ios', 'android')),

  /**
   * Retired rather than deleted when Expo reports `DeviceNotRegistered`.
   *
   * Kept because a row going quiet is worth being able to see. "This parent had a working device
   * until March" is a diagnosis; a missing row is a mystery, and the commonest support question
   * about push is "why did I stop getting these".
   */
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  retired_at      TIMESTAMPTZ,
  retired_reason  TEXT,

  -- A device the parent has not opened in months is a poor bet for delivery. Recorded so a future
  -- cleanup has something to reason about rather than deleting on age alone.
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parent_push_tokens_parent
  ON public.parent_push_tokens(parent_user_id)
  WHERE is_active;

DROP TRIGGER IF EXISTS update_timestamp_on_parent_push_tokens ON public.parent_push_tokens;
CREATE TRIGGER update_timestamp_on_parent_push_tokens
  BEFORE UPDATE ON public.parent_push_tokens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.parent_push_tokens IS
  'Expo push tokens for the parent app. Keyed on the token, not (parent, platform) as '
  'NOTIFICATIONS.md specified — two parents sharing an account on two Android phones is a normal '
  'case and that key silently dropped one of them. No school_id: a token belongs to a phone.';

ALTER TABLE public.parent_push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parent_push_tokens FORCE  ROW LEVEL SECURITY;

/**
 * A parent sees and manages only their own devices.
 *
 * Note what is absent: no school-side policy at all. A school has no business knowing which phones a
 * parent owns or whether they have the app installed — and a school reading this table could infer
 * which parents to expect a response from, which is not information the product should be handing
 * out about a family.
 */
DROP POLICY IF EXISTS "parent_manage_own_push_tokens" ON public.parent_push_tokens;
CREATE POLICY "parent_manage_own_push_tokens"
ON public.parent_push_tokens FOR ALL
USING (parent_user_id = public.get_user_id())
WITH CHECK (parent_user_id = public.get_user_id());

DROP POLICY IF EXISTS "afritech_admin_read_push_tokens" ON public.parent_push_tokens;
CREATE POLICY "afritech_admin_read_push_tokens"
ON public.parent_push_tokens FOR SELECT
USING (public.is_afritech_admin());

REVOKE ALL ON public.parent_push_tokens FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.parent_push_tokens TO authenticated;

/**
 * No DELETE for anybody. A parent who signs out on one phone retires that device; the row stays so
 * "when did this stop working" remains answerable. Consistent with how the rest of this schema
 * treats a record of something that happened.
 */

-- ---------------------------------------------------------------------------
-- Registering a device.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_push_token(
  p_push_token TEXT,
  p_platform   TEXT
)
RETURNS public.parent_push_tokens
LANGUAGE plpgsql
SECURITY INVOKER
-- INVOKER: the policy above already says a caller may only write their own row, and the function
-- takes no user id precisely so that a caller cannot name somebody else's.
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
   * Upsert on the token. A reinstall gives Expo a new token and therefore a new row; the old one is
   * retired by a delivery receipt, not here — this function cannot tell a reinstall from a second
   * device, and guessing would be how the documented unique key went wrong.
   *
   * `parent_user_id` is included in the conflict update on purpose: if a phone is handed to another
   * family member who signs in with their own account, the token now belongs to them. Expo would
   * otherwise keep delivering the previous owner's alerts to that handset.
   */
  INSERT INTO public.parent_push_tokens (parent_user_id, push_token, platform)
  VALUES (v_user, BTRIM(p_push_token), p_platform)
  ON CONFLICT (push_token) DO UPDATE
    SET parent_user_id = v_user,
        platform       = EXCLUDED.platform,
        is_active      = TRUE,
        retired_at     = NULL,
        retired_reason = NULL,
        last_seen_at   = NOW()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_push_token(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_push_token(TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.register_push_token(TEXT, TEXT) IS
  'Registers or refreshes the calling parent''s device. Takes no user id so a caller cannot name '
  'somebody else''s; INVOKER so the policy decides. Reassigns a token to whoever signed in on that '
  'handset last.';

-- ---------------------------------------------------------------------------
-- Signing out on one device.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.retire_push_token(p_push_token TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE public.parent_push_tokens AS t
     SET is_active      = FALSE,
         retired_at     = NOW(),
         retired_reason = 'signed_out'
   WHERE t.push_token = BTRIM(p_push_token)
     AND t.parent_user_id = public.get_user_id();

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- TRUE whether or not a row matched. A sign-out that reports failure because the token was already
  -- retired would block the sign-out itself, and the caller can do nothing useful with the
  -- distinction.
  RETURN v_count >= 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.retire_push_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retire_push_token(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- What the worker needs.
-- ---------------------------------------------------------------------------
/**
 * Prohibition 1: a worker's connection bypasses RLS, so every worker read goes through a `worker_*`
 * function rather than `.from(` — `.from(` anywhere in `apps/workers` is a defect.
 *
 * Returns active tokens for a set of parents in one call. Batched because a class-wide absence alert
 * resolves forty parents at once, and forty round trips for forty rows is how the report-card batch
 * got slow before `0104`.
 */
CREATE OR REPLACE FUNCTION public.worker_parent_push_tokens(p_parent_user_ids TEXT[])
RETURNS TABLE (
  out_parent_user_id TEXT,
  out_push_token     TEXT,
  out_platform       TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT t.parent_user_id, t.push_token, t.platform
    FROM public.parent_push_tokens t
   WHERE t.is_active
     AND t.parent_user_id = ANY (p_parent_user_ids)
   ORDER BY t.parent_user_id, t.last_seen_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.worker_parent_push_tokens(TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.worker_parent_push_tokens(TEXT[]) TO service_role;

COMMENT ON FUNCTION public.worker_parent_push_tokens(TEXT[]) IS
  'Active push tokens for a batch of parents. service_role only — the worker boundary. Batched '
  'because a class-wide absence alert resolves forty parents at once.';

/**
 * Retiring a token Expo has rejected.
 *
 * Expo returns `DeviceNotRegistered` for an uninstalled app, and continuing to send to it wastes
 * requests and makes the delivery statistics meaningless. Called by the worker from the receipt, so
 * the table converges on reality without anybody auditing it.
 */
CREATE OR REPLACE FUNCTION public.worker_retire_push_token(
  p_push_token TEXT,
  p_reason     TEXT DEFAULT 'device_not_registered'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.parent_push_tokens AS t
     SET is_active      = FALSE,
         retired_at     = NOW(),
         retired_reason = p_reason
   WHERE t.push_token = p_push_token;

  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.worker_retire_push_token(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.worker_retire_push_token(TEXT, TEXT) TO service_role;

-- === MIGRATION END ===
