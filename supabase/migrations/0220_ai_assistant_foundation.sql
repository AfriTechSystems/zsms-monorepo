-- ===========================================================================
-- 0220 — the AI assistant: conversations, quota, and the two missing flags
--
-- Spec: `Official Documentation/18 AI Module/AI_ASSISTANT.md`, ADR-034
--
-- `AI_ASSISTANT.md` names `public.ai_conversations` and this schema has never
-- had it. The `ai_assistant` feature flag has existed since `0095` with nothing
-- behind it, and the two the document requires —
-- `ai_assistant_navigation` and `ai_assistant_write`, "independently disableable
-- per country" — did not exist at all.
--
-- ## Billing: capped, then charged, and it must LOOK free
--
-- Confirmed on 2026-10-06. The assistant is not metered like the lesson planner.
-- A user gets a daily allowance and inside it the feature behaves as though it
-- costs nothing — no balance, no warning, no mention of credits. Past the cap it
-- charges one credit per interaction from the user's own account, and only then
-- does the subject come up.
--
-- That is a deliberately different shape from `ai_credit_consume()`'s usual
-- caller, so the decision lives in ONE function: `ai_assistant_begin()` returns
-- what the caller may do and what it cost, and the route never decides.
--
-- `AI_ASSISTANT.md` puts the defaults at 100 per school per day and 20 per
-- person. `0216` seeded both as platform settings rather than constants, so they
-- are read here rather than written in.
--
-- ## Why a conversation is scoped to a user, not a school
--
-- A parent has children at two schools and a teacher may hold a Hub account as
-- well as a post. `school_id` is recorded on the conversation for the audit
-- trail and for school-wide quota, but access is `user_id = get_user_id()` —
-- the same rule `is_linked_parent_of()` applies, and the only one that works for
-- a caller whose organisation changes between messages.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The two flags `AI_ASSISTANT.md` requires.
-- ---------------------------------------------------------------------------

/*
  Navigation and writes are independently disableable, per the document's
  *Country customisation* section: "a country can launch with navigation and read
  before enabling writes."

  Both default OFF in the tier matrix by the rule `0095` already enforces — a
  feature with no row for a tier is not sold with that tier — so adding the flags
  grants nothing until AfriTech says so.
*/
-- `updated_by` is NOT NULL on this table, which the first attempt at this
-- migration missed. Attributed to the migration rather than to a person, because
-- no person added these.
INSERT INTO afritech.feature_flags
  (feature_key, display_name, description, category, is_available_as_addon,
   display_order, updated_by)
VALUES
  ('ai_assistant_navigation',
   'AI assistant — navigation',
   'Lets the assistant take a user to a page or a filtered view. Harmless on its own: '
   'it only ever offers routes the user''s role already allows.',
   'ai', FALSE, 95, 'migration_0220'),
  ('ai_assistant_write',
   'AI assistant — actions',
   'Lets the assistant PREPARE a create, update or delete for the user to confirm. Every '
   'one shows a preview and stops; nothing is ever written without an explicit '
   'confirmation, and that cannot be configured away.',
   'ai', FALSE, 96, 'migration_0220')
ON CONFLICT (feature_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Conversations.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  /*
    The school the user was acting in. Nullable: a standalone teacher and a
    parent mid-signup have none, and refusing them a conversation would exclude
    two of the five audiences.
  */
  school_id   UUID REFERENCES public.schools(id) ON DELETE SET NULL,
  /** Taken from the first message, so a history list reads as something. */
  title       TEXT NOT NULL DEFAULT 'New conversation',
  /** The role in force when it started, for the audit trail. */
  started_as  TEXT,
  archived_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ai_conversations_title_not_blank CHECK (btrim(title) <> '')
);

COMMENT ON TABLE public.ai_conversations IS
  'One assistant conversation. Scoped to the USER, not the school — a parent spans schools and a teacher may also hold a Hub account (0220).';

CREATE INDEX IF NOT EXISTS idx_ai_conversations_user
  ON public.ai_conversations (user_id, updated_at DESC)
  WHERE archived_at IS NULL;

ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_conversations FORCE ROW LEVEL SECURITY;

/*
  Nobody but the author. Not the school owner, not a principal.

  A conversation records what somebody asked, which for a teacher might be "which
  of my pupils are failing" and for a parent "what do I owe". Making it readable
  by management would turn the assistant into surveillance and stop people using
  it honestly.

  AfriTech is excluded too — `0169` established that AfriTech sees AI aggregates
  and never a user identity, and this table is the identity.
*/
CREATE POLICY own_conversations
  ON public.ai_conversations
  FOR ALL
  TO authenticated
  USING (user_id = public.get_user_id())
  WITH CHECK (user_id = public.get_user_id());

GRANT SELECT, INSERT, UPDATE ON public.ai_conversations TO authenticated;
REVOKE DELETE ON public.ai_conversations FROM authenticated;
REVOKE ALL ON public.ai_conversations FROM anon;

-- ---------------------------------------------------------------------------
-- 3. Messages.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ai_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,

  /** What the classifier decided, for measuring which intents actually get used. */
  intent          TEXT,
  /** A navigation answer carries somewhere to go. */
  route           TEXT,
  /*
    What the answer was built from — which function was called with which
    parameters, and how many rows came back.

    `AI_ASSISTANT.md` requires "Response with citations ... not just text". A
    narrated figure a user cannot trace is a figure they cannot act on.
  */
  citations       JSONB NOT NULL DEFAULT '[]'::jsonb,

  /** A prepared write, awaiting confirmation. NULL for everything else. */
  pending_action  JSONB,
  /** Set when the user confirmed it, so a preview cannot be replayed. */
  acted_at        TIMESTAMPTZ,

  input_tokens    INT,
  output_tokens   INT,
  /** TRUE when this interaction fell outside the free allowance and cost a credit. */
  charged         BOOLEAN NOT NULL DEFAULT FALSE,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ai_messages_content_not_blank CHECK (btrim(content) <> '')
);

COMMENT ON TABLE public.ai_messages IS
  'Turns in an assistant conversation. `citations` records what the answer was built from, because a narrated figure nobody can trace is one nobody can act on (0220).';

CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation
  ON public.ai_messages (conversation_id, created_at);

/*
  Daily usage, per user and per school, for the quota check.

  A partial index on the timestamp rather than a counter column: a counter cannot
  be recomputed if it drifts, and a day boundary is a question about rows.
*/
CREATE INDEX IF NOT EXISTS idx_ai_messages_user_day
  ON public.ai_messages (created_at)
  WHERE role = 'user';

ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages FORCE ROW LEVEL SECURITY;

CREATE POLICY own_messages
  ON public.ai_messages
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ai_conversations c
      WHERE c.id = ai_messages.conversation_id
        AND c.user_id = public.get_user_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.ai_conversations c
      WHERE c.id = ai_messages.conversation_id
        AND c.user_id = public.get_user_id()
    )
  );

GRANT SELECT, INSERT, UPDATE ON public.ai_messages TO authenticated;
REVOKE DELETE ON public.ai_messages FROM authenticated;
REVOKE ALL ON public.ai_messages FROM anon;

-- ---------------------------------------------------------------------------
-- 4. The quota, which is the whole billing model.
-- ---------------------------------------------------------------------------

/*
  How much of today's free allowance is left.

  Read-only, so a screen can show "free" without committing to anything. The
  charge decision is `ai_assistant_begin()`'s alone.
*/
CREATE OR REPLACE FUNCTION public.ai_assistant_quota()
RETURNS TABLE (
  out_user_used     INT,
  out_user_limit    INT,
  out_school_used   INT,
  out_school_limit  INT,
  out_within_free   BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, afritech, pg_temp
AS $$
DECLARE
  v_user   TEXT := public.get_user_id();
  v_school UUID := public.current_school_uuid();
  v_ulim   INT;
  v_slim   INT;
  v_uused  INT;
  v_sused  INT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;

  -- Settings, not constants. `0216` seeded both from AI_ASSISTANT.md's defaults.
  v_ulim := COALESCE(
    NULLIF(public.platform_setting('ai_assistant_daily_user_limit'), '')::INT, 20);
  v_slim := COALESCE(
    NULLIF(public.platform_setting('ai_assistant_daily_school_limit'), '')::INT, 100);

  /*
    Counted over the caller's OWN messages, which this function can see because
    it is DEFINER — the policy would otherwise scope it correctly and a
    school-wide count would be impossible.

    `role = 'user'` so an assistant reply does not consume the asker's allowance.
  */
  SELECT COUNT(*) INTO v_uused
  FROM public.ai_messages m
  JOIN public.ai_conversations c ON c.id = m.conversation_id
  WHERE c.user_id = v_user
    AND m.role = 'user'
    AND m.created_at >= date_trunc('day', NOW());

  IF v_school IS NOT NULL THEN
    SELECT COUNT(*) INTO v_sused
    FROM public.ai_messages m
    JOIN public.ai_conversations c ON c.id = m.conversation_id
    WHERE c.school_id = v_school
      AND m.role = 'user'
      AND m.created_at >= date_trunc('day', NOW());
  ELSE
    v_sused := 0;
  END IF;

  RETURN QUERY SELECT
    v_uused, v_ulim, v_sused, v_slim,
    (v_uused < v_ulim AND (v_school IS NULL OR v_sused < v_slim));
END;
$$;

REVOKE ALL ON FUNCTION public.ai_assistant_quota() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_assistant_quota() FROM anon;
GRANT EXECUTE ON FUNCTION public.ai_assistant_quota() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Starting an interaction: the one place that decides free or charged.
-- ---------------------------------------------------------------------------

/*
  Called before the model is. Returns whether this interaction may proceed and
  whether it cost a credit.

  Inside the allowance it charges nothing and says so, which is what makes the
  feature look free. Outside it, it spends ONE credit from the caller's own
  account through `ai_credit_consume()` — the same ledger as every other AI
  spend, so a user sees one balance rather than two.

  If the charge fails the interaction is refused rather than given away: a user
  with no credits past their cap is told to wait until tomorrow, which is honest
  and costs nothing.
*/
CREATE OR REPLACE FUNCTION public.ai_assistant_begin(
  p_conversation_id UUID,
  p_idempotency_key TEXT
)
RETURNS TABLE (
  out_allowed    BOOLEAN,
  out_charged    BOOLEAN,
  out_reason     TEXT,
  out_user_used  INT,
  out_user_limit INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, afritech, pg_temp
AS $$
DECLARE
  v_user  TEXT := public.get_user_id();
  v_q     RECORD;
  v_ok    BOOLEAN;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;

  -- The conversation must be the caller's own. A DEFINER function must never
  -- trust an id argument.
  IF NOT EXISTS (
    SELECT 1 FROM public.ai_conversations c
    WHERE c.id = p_conversation_id AND c.user_id = v_user
  ) THEN
    RAISE EXCEPTION 'That conversation is not available' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_q FROM public.ai_assistant_quota();

  IF v_q.out_within_free THEN
    RETURN QUERY SELECT TRUE, FALSE, NULL::TEXT, v_q.out_user_used, v_q.out_user_limit;
    RETURN;
  END IF;

  /*
    The SCHOOL's cap is not something a user can buy past.

    It exists to stop a loop or an automated query running up the school's cost,
    and letting one user spend their personal credits through it would defeat
    that — the next user still cannot ask, and the school's bill grows anyway.
  */
  IF v_q.out_school_used >= v_q.out_school_limit THEN
    RETURN QUERY SELECT
      FALSE, FALSE,
      'Your school has used all of today''s assistant questions. It resets at midnight.',
      v_q.out_user_used, v_q.out_user_limit;
    RETURN;
  END IF;

  -- Past the personal cap: one credit, from the caller's own account.
  BEGIN
    PERFORM public.ai_credit_consume(
      'ai_assistant', 1, NULL, NULL, NULL, NULL,
      p_idempotency_key,
      jsonb_build_object('conversation_id', p_conversation_id),
      'auto'
    );
    v_ok := TRUE;
  EXCEPTION WHEN OTHERS THEN
    v_ok := FALSE;
  END;

  IF NOT v_ok THEN
    RETURN QUERY SELECT
      FALSE, FALSE,
      'You have used today''s free questions and have no credits left. It resets at midnight.',
      v_q.out_user_used, v_q.out_user_limit;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, TRUE, NULL::TEXT, v_q.out_user_used, v_q.out_user_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_assistant_begin(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_assistant_begin(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.ai_assistant_begin(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.ai_assistant_begin(UUID, TEXT) IS
  'Decides whether an assistant interaction may proceed and whether it costs a credit. Free inside the daily allowance; one credit past it; refused past the school cap, which cannot be bought through (0220).';

-- ---------------------------------------------------------------------------
-- 6. Starting and listing conversations.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.start_ai_conversation()
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO public.ai_conversations (user_id, school_id, started_as)
  VALUES (public.get_user_id(), public.current_school_uuid(), public.get_user_role())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.start_ai_conversation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_ai_conversation() FROM anon;
GRANT EXECUTE ON FUNCTION public.start_ai_conversation() TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Prove it.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_n INT;
BEGIN
  -- Both flags must exist, or the document's per-country staging is impossible.
  SELECT COUNT(*) INTO v_n FROM afritech.feature_flags
  WHERE feature_key IN ('ai_assistant', 'ai_assistant_navigation', 'ai_assistant_write');

  IF v_n <> 3 THEN
    RAISE EXCEPTION '0220: expected 3 assistant flags, found %', v_n;
  END IF;

  -- Both tables RLS-forced, so the owner is filtered too.
  SELECT COUNT(*) INTO v_n FROM pg_class
  WHERE relname IN ('ai_conversations', 'ai_messages')
    AND relrowsecurity AND relforcerowsecurity;

  IF v_n <> 2 THEN
    RAISE EXCEPTION '0220: RLS is not enabled and forced on both tables (% of 2)', v_n;
  END IF;

  -- A conversation is a record of what somebody asked. No hard delete.
  IF has_table_privilege('authenticated', 'public.ai_conversations', 'DELETE') THEN
    RAISE EXCEPTION '0220: authenticated can DELETE conversations — archive instead';
  END IF;

  IF has_table_privilege('anon', 'public.ai_messages', 'SELECT') THEN
    RAISE EXCEPTION '0220: anon can read assistant messages';
  END IF;

  -- The grants RLS does not imply. Missing these is the `0212`/`0218` mistake.
  IF NOT has_table_privilege('authenticated', 'public.ai_conversations', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.ai_messages', 'INSERT') THEN
    RAISE EXCEPTION '0220: authenticated cannot INSERT — the policy would be unreachable';
  END IF;
END;
$$;
