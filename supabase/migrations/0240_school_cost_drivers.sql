-- ===========================================================================
-- 0240 — per-school cost drivers (COST_MANAGEMENT.md)
--
-- Spec: `03 Infrastructure Services/COST_MANAGEMENT.md` → *Cost-Per-School Unit
--       Economics*, *Billing Alerts*
--
-- ## What this is, and what it deliberately is not
--
-- COST_MANAGEMENT.md lists nine billed services — Vercel, Supabase, R2,
-- Cloudflare, Upstash, Railway, QStash, Clerk, Anthropic. ZSMS cannot read any
-- of those bills: they are external accounts with their own APIs and their own
-- credentials, and inventing a number for them would be worse than showing none.
--
-- What ZSMS does know is **what each school consumes**, which is the thing the
-- document calls unit economics and the thing you need before any threshold can
-- be set sensibly. A school with 40 pupils sending 2,000 messages a month is a
-- different proposition from one with 900 pupils sending 50, and no invoice from
-- Vercel will tell you that.
--
-- So: drivers, not costs. Naming it `cost_drivers` rather than `costs` is the
-- point — the first is measured, the second would be guessed.
--
-- ## Why a function rather than a view
--
-- A view would be `security_invoker` and evaluate per caller against nine tables,
-- most of which a school must never read across tenants. A DEFINER function with
-- one capability check at the top is simpler to reason about and simpler to keep
-- right.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.admin_school_cost_drivers(
  p_since_days INT DEFAULT 30
)
RETURNS TABLE (
  out_school_id        UUID,
  out_school_name      TEXT,
  out_school_code      TEXT,
  out_status           TEXT,
  out_tier             TEXT,
  out_active_pupils    BIGINT,
  out_staff            BIGINT,
  out_ai_credits_spent BIGINT,
  out_messages_used    BIGINT,
  out_message_quota    INT,
  out_documents        BIGINT,
  out_api_calls        BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, afritech, pg_temp
AS $$
DECLARE
  v_since TIMESTAMPTZ := NOW() - make_interval(days => GREATEST(1, p_since_days));
BEGIN
  /*
    `billing:read`, not `is_afritech_admin()`.

    Unit economics is revenue data. ROLES.md gives it to the finance officer and
    withholds it from the loan officer, and `0237` made that distinction real.
  */
  IF NOT public.has_afritech_capability('billing:read') THEN
    RAISE EXCEPTION
      'Your AfriTech role does not include revenue data' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.name,
    s.school_id,
    s.status,
    COALESCE(s.subscription_tier, 'none'),

    -- Pupils on the roll, which is what per-student pricing bills against.
    (SELECT COUNT(*) FROM public.students st
      WHERE st.school_id = s.id
        AND st.status IN ('active', 'on_leave')
        AND COALESCE(st.is_deleted, FALSE) = FALSE),

    -- Staff, which is what Clerk bills per monthly active user.
    (SELECT COUNT(*) FROM public.staff_members sm
      WHERE sm.school_id = s.id AND COALESCE(sm.is_active, TRUE)),

    /*
      AI credits SPENT, not the balance.

      The ledger holds grants as positive and spends as negative, so the cost
      driver is the negative side made positive — a school that bought 500 and
      used 12 costs what 12 cost, and the other 488 are deferred revenue.
    */
    COALESCE((
      SELECT -SUM(l.credits)
      FROM public.ai_credit_ledger l
      JOIN public.ai_credit_accounts a ON a.id = l.account_id
      WHERE a.school_id = s.id
        AND l.credits < 0
        AND l.created_at >= v_since
    ), 0),

    COALESCE((
      SELECT SUM(q.messages_used) FROM public.school_message_quotas q
      WHERE q.school_id = s.id
    ), 0),

    (SELECT q.quota_limit FROM public.school_message_quotas q
      WHERE q.school_id = s.id
      ORDER BY q.billing_period DESC LIMIT 1),

    -- Documents, which drive R2 storage and PUT operations.
    (SELECT COUNT(*) FROM public.generated_documents g
      WHERE g.school_id = s.id AND g.created_at >= v_since),

    /*
      A proxy for request volume, and labelled as one.

      `audit_logs` records writes, not reads, so this undercounts real traffic by
      a lot. It is still the only per-school signal ZSMS has, and a wrong-but-
      consistent number is useful for comparing schools even when it is useless
      for predicting a Vercel bill.
    */
    (SELECT COUNT(*) FROM public.audit_logs al
      WHERE al.school_id = s.id AND al.created_at >= v_since)

  FROM public.schools s
  WHERE s.status <> 'deleted'
  ORDER BY s.name;
END;
$$;

COMMENT ON FUNCTION public.admin_school_cost_drivers(INT) IS
  'Per-school consumption of the things ZSMS can measure (COST_MANAGEMENT.md unit economics). NOT external bills — Vercel, Supabase and the rest are separate accounts ZSMS cannot read (0240).';

REVOKE ALL ON FUNCTION public.admin_school_cost_drivers(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_school_cost_drivers(INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_school_cost_drivers(INT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Exercise the capability boundary and the shape.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_n INT;
BEGIN
  -- A loan officer has no business reading revenue — ROLES.md, enforced by 0237.
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'probe_loan', 'role', 'authenticated',
    'o', json_build_object('id', 'org_afritech', 'slg', 'afritech-systems-admin',
                           'rol', 'loan_officer'))::text, TRUE);
  BEGIN
    PERFORM * FROM public.admin_school_cost_drivers(30);
    RAISE EXCEPTION '0240: a loan officer read revenue data';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- A finance officer must.
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'probe_fin', 'role', 'authenticated',
    'o', json_build_object('id', 'org_afritech', 'slg', 'afritech-systems-admin',
                           'rol', 'finance_officer'))::text, TRUE);

  SELECT COUNT(*) INTO v_n FROM public.admin_school_cost_drivers(30);
  IF v_n = 0 THEN
    RAISE EXCEPTION '0240: the finance officer saw no schools at all';
  END IF;

  -- And a school owner is not AfriTech staff.
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'probe_owner', 'role', 'authenticated',
    'o', json_build_object('id', 'org_school', 'slg', 'a-school',
                           'rol', 'owner'))::text, TRUE);
  BEGIN
    PERFORM * FROM public.admin_school_cost_drivers(30);
    RAISE EXCEPTION '0240: a school owner read platform revenue data';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  RAISE NOTICE '0240: verified — finance officer sees % school(s), loan officer and school owner refused', v_n;
END;
$$;
