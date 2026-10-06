-- ===========================================================================
-- 0222 — archive assistant conversations after 30 days
--
-- `AI_ASSISTANT.md`: "Conversations older than 30 days are archived. The
-- assistant does not have memory of conversations from previous sessions."
--
-- ## Archived, not deleted
--
-- `ai_conversations` already has `archived_at`, and the policy on `ai_messages`
-- is unchanged — so a user can still find an old conversation if they look for
-- it. What archiving does is keep the history list to what somebody might
-- plausibly return to, and keep an old thread out of the classifier's context.
--
-- Deleting would be worse on two counts: business rule 2 makes these rows an
-- audit record of what was asked, and a user who remembers asking something
-- three months ago and finds nothing concludes the product lost it.
--
-- ## Called, not scheduled
--
-- There is no pg_cron on this project and the worker set is four jobs with no
-- maintenance runner. So the function exists and the assistant route calls it
-- opportunistically — the cost is one cheap UPDATE against an indexed predicate,
-- and a conversation list that is briefly a day stale harms nobody.
--
-- When a maintenance worker exists, this is one line in it.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.archive_old_ai_conversations()
RETURNS INT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE v_n INT;
BEGIN
  /*
    SECURITY INVOKER, so this only ever archives the CALLER's own conversations —
    the policy scopes it. A DEFINER version would quietly tidy everybody's, which
    is a surprising amount of power for a housekeeping function.
  */
  UPDATE public.ai_conversations
  SET archived_at = NOW()
  WHERE user_id = public.get_user_id()
    AND archived_at IS NULL
    AND updated_at < NOW() - INTERVAL '30 days';

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_old_ai_conversations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archive_old_ai_conversations() FROM anon;
GRANT EXECUTE ON FUNCTION public.archive_old_ai_conversations() TO authenticated;

COMMENT ON FUNCTION public.archive_old_ai_conversations() IS
  'Archives the caller''s conversations untouched for 30 days (AI_ASSISTANT.md). INVOKER, so it can only ever affect their own (0222).';

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.archive_old_ai_conversations()', 'EXECUTE') THEN
    RAISE EXCEPTION '0222: anon can execute archive_old_ai_conversations';
  END IF;
END;
$$;
