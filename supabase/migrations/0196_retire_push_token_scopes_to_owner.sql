-- ---------------------------------------------------------------------------
-- 0196 — `retire_push_token()` would retire anybody's token
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/12 Communication System/NOTIFICATIONS.md`
--
-- The function matched on the token alone:
--
--   WHERE t.push_token = BTRIM(p_push_token)
--
-- No owner clause. Any authenticated caller who knew a token could retire it, and the
-- person it belonged to would simply stop receiving notices with nothing to see.
--
-- **Exploitability was low and that is not the point.** A push token is a secret, so an
-- attacker needs one already — but it travels to the server on every app launch, sits
-- in logs if anybody ever puts it in a URL, and is held by whatever delivery provider
-- is configured. A function that trusts an identifier it was handed is wrong whether or
-- not today's attacker can get one, and this is a SECURITY DEFINER function, so RLS
-- never had a chance to disagree.
--
-- Found by exercising the function as a second user rather than by reading it. The
-- table has held zero rows since it was created, so nothing has been affected.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.retire_push_token(p_push_token TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user TEXT := public.get_user_id();
  v_rows INT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;

  UPDATE public.parent_push_tokens t
     SET is_active = FALSE,
         retired_at = NOW(),
         retired_reason = 'signed out',
         updated_at = NOW()
   WHERE t.push_token = btrim(p_push_token)
     -- The clause that was missing. A caller may retire their OWN device and nobody
     -- else's, whatever token they present.
     AND t.parent_user_id = v_user
     AND t.is_active;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  /*
    `false` for a token that is not the caller's, exactly as for one already retired.

    Deliberately indistinguishable: a different answer would confirm that a given token
    exists and belongs to somebody, which is the question an attacker holding a guessed
    token would most like answered.
  */
  RETURN v_rows > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.retire_push_token(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.retire_push_token(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.retire_push_token(TEXT) TO authenticated;

COMMENT ON COLUMN public.parent_push_tokens.parent_user_id IS
  'The Clerk user id of whoever owns this device. Named for parents because they were '
  'the first audience specified; it holds staff and Hub teachers too, and '
  'register_push_token() has never checked for a parent. Renaming would touch the '
  'worker boundary functions and a pgTAP suite for no behaviour change.';

-- ---------------------------------------------------------------------------
-- Prove the hole is closed, as the owner and as somebody else.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_ok BOOLEAN;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', 'verify_owner', 'role', 'authenticated')::text, TRUE);
  PERFORM public.register_push_token('ExponentPushToken[verify0196verify0196]', 'android');

  -- Somebody else, holding the token.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', 'verify_thief', 'role', 'authenticated')::text, TRUE);
  SELECT public.retire_push_token('ExponentPushToken[verify0196verify0196]') INTO v_ok;
  IF v_ok THEN
    RAISE EXCEPTION 'a second user still retired somebody else''s token';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.parent_push_tokens
                  WHERE push_token = 'ExponentPushToken[verify0196verify0196]'
                    AND is_active) THEN
    RAISE EXCEPTION 'the token was deactivated by somebody who did not own it';
  END IF;

  -- The owner still can.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', 'verify_owner', 'role', 'authenticated')::text, TRUE);
  SELECT public.retire_push_token('ExponentPushToken[verify0196verify0196]') INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'the owner can no longer retire their own token';
  END IF;

  DELETE FROM public.parent_push_tokens
   WHERE push_token = 'ExponentPushToken[verify0196verify0196]';
  PERFORM set_config('request.jwt.claims', NULL, TRUE);

  RAISE NOTICE 'verified: only the owner retires a token, and the owner still can';
END;
$$;
