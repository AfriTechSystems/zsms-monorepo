-- Migration: 0071_create_fee_rls.sql
-- Created: 2026-08-15
-- Description: RLS policies for the fee tables, plus the SECURITY DEFINER
--              parent-access lookups they depend on.
-- Related documents: Official Documentation/01 Foundation Layer/RLS.md — fee tables
--
-- Parent predicates are relocated into SECURITY DEFINER functions for the same
-- reason as in 0016: RLS.md expresses them as subqueries into
-- student_parent_links and students, and those tables' own policies read back
-- into this one. Written literally, PostgreSQL aborts with
-- "infinite recursion detected in policy". The conditions are unchanged.

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- Parent-access lookups
-- ---------------------------------------------------------------------------

-- TRUE when the caller is a linked parent of a student at this school. Used by
-- the fee_structures read policy — a parent may see what a school charges only
-- because they have a child there.
CREATE OR REPLACE FUNCTION public.parent_has_child_at_school(p_school_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.student_parent_links spl
    JOIN public.students s ON s.id = spl.student_id
    WHERE spl.parent_user_id = public.get_user_id()
      AND s.school_id = p_school_id
      AND spl.is_active = TRUE
  );
$$;

-- TRUE when the caller may see this fee record, i.e. is a linked parent of the
-- student it belongs to. Honours the 30-day unlink grace period via
-- is_linked_parent_of().
CREATE OR REPLACE FUNCTION public.parent_can_access_fee_record(p_fee_record_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.fee_records fr
    WHERE fr.id = p_fee_record_id
      AND public.is_linked_parent_of(fr.student_id)
  );
$$;

-- TRUE when the caller is the student this record belongs to.
CREATE OR REPLACE FUNCTION public.is_own_student_record(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.id = p_student_id
      AND s.clerk_user_id = public.get_user_id()
  );
$$;

GRANT EXECUTE ON FUNCTION public.parent_has_child_at_school(UUID)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.parent_can_access_fee_record(UUID)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_own_student_record(UUID)          TO authenticated;

-- ---------------------------------------------------------------------------
-- fee_structures
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "afritech_admin_all_fee_structures" ON public.fee_structures;
CREATE POLICY "afritech_admin_all_fee_structures"
ON public.fee_structures FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

-- Teachers are included: they need to know term fee amounts.
DROP POLICY IF EXISTS "school_staff_read_fee_structures" ON public.fee_structures;
CREATE POLICY "school_staff_read_fee_structures"
ON public.fee_structures FOR SELECT
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin', 'org:accountant', 'org:teacher')
);

DROP POLICY IF EXISTS "parent_read_fee_structures" ON public.fee_structures;
CREATE POLICY "parent_read_fee_structures"
ON public.fee_structures FOR SELECT
USING (parent_has_child_at_school(school_id));

DROP POLICY IF EXISTS "fee_structure_write" ON public.fee_structures;
CREATE POLICY "fee_structure_write"
ON public.fee_structures FOR INSERT
WITH CHECK (
  school_id = current_school_uuid()
  AND (
    get_user_role() IN ('org:owner', 'org:accountant')
    OR has_permission_grant('fee_structures', 'write')
  )
);

DROP POLICY IF EXISTS "fee_structure_update" ON public.fee_structures;
CREATE POLICY "fee_structure_update"
ON public.fee_structures FOR UPDATE
USING (
  school_id = current_school_uuid()
  AND (
    get_user_role() IN ('org:owner', 'org:accountant')
    OR has_permission_grant('fee_structures', 'write')
  )
)
WITH CHECK (school_id = current_school_uuid());

-- ---------------------------------------------------------------------------
-- fee_records
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "afritech_admin_all_fee_records" ON public.fee_records;
CREATE POLICY "afritech_admin_all_fee_records"
ON public.fee_records FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

DROP POLICY IF EXISTS "financial_staff_read_fee_records" ON public.fee_records;
CREATE POLICY "financial_staff_read_fee_records"
ON public.fee_records FOR SELECT
USING (
  school_id = current_school_uuid()
  AND (
    get_user_role() IN ('org:owner', 'org:principal', 'org:accountant')
    OR has_permission_grant('fees', 'read')
  )
);

-- Admin reads for clearance checks but never writes.
DROP POLICY IF EXISTS "admin_read_fee_records" ON public.fee_records;
CREATE POLICY "admin_read_fee_records"
ON public.fee_records FOR SELECT
USING (
  school_id = current_school_uuid()
  AND get_user_role() = 'org:admin'
);

-- Note there is no teacher policy. A teacher reaching a class does NOT thereby
-- reach that class's fee records — teaching scope and financial scope are
-- separate, and RLS.md grants teachers neither read nor write here.
DROP POLICY IF EXISTS "parent_read_own_fee_records" ON public.fee_records;
CREATE POLICY "parent_read_own_fee_records"
ON public.fee_records FOR SELECT
USING (is_linked_parent_of(student_id));

DROP POLICY IF EXISTS "student_read_own_fee_records" ON public.fee_records;
CREATE POLICY "student_read_own_fee_records"
ON public.fee_records FOR SELECT
USING (is_own_student_record(student_id));

DROP POLICY IF EXISTS "fee_record_insert" ON public.fee_records;
CREATE POLICY "fee_record_insert"
ON public.fee_records FOR INSERT
WITH CHECK (
  school_id = current_school_uuid()
  AND (
    get_user_role() IN ('org:owner', 'org:accountant')
    OR has_permission_grant('fees', 'write')
  )
);

DROP POLICY IF EXISTS "fee_record_update" ON public.fee_records;
CREATE POLICY "fee_record_update"
ON public.fee_records FOR UPDATE
USING (
  school_id = current_school_uuid()
  AND (
    get_user_role() IN ('org:owner', 'org:accountant')
    OR has_permission_grant('fees', 'write')
  )
)
WITH CHECK (school_id = current_school_uuid());

-- No DELETE policy, and no DELETE privilege (0070). Fee records are named in
-- prohibition 8 — voiding is a status change.

-- ---------------------------------------------------------------------------
-- payments
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "afritech_admin_all_payments" ON public.payments;
CREATE POLICY "afritech_admin_all_payments"
ON public.payments FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

DROP POLICY IF EXISTS "financial_staff_read_payments" ON public.payments;
CREATE POLICY "financial_staff_read_payments"
ON public.payments FOR SELECT
USING (
  school_id = current_school_uuid()
  AND (
    get_user_role() IN ('org:owner', 'org:principal', 'org:accountant')
    OR has_permission_grant('payments', 'read')
  )
);

DROP POLICY IF EXISTS "parent_read_own_payments" ON public.payments;
CREATE POLICY "parent_read_own_payments"
ON public.payments FOR SELECT
USING (parent_can_access_fee_record(fee_record_id));

-- Parents may SUBMIT a payment against their own child's fee record. It lands
-- as pending_verification and counts for nothing until a finance role verifies
-- it — which is why letting a parent insert here is safe.
DROP POLICY IF EXISTS "parent_submit_payment" ON public.payments;
CREATE POLICY "parent_submit_payment"
ON public.payments FOR INSERT
WITH CHECK (
  get_user_role() = 'org:parent'
  AND parent_can_access_fee_record(fee_record_id)
  AND status = 'pending_verification'
  AND recorded_by_user_id = get_user_id()
  -- A parent cannot self-verify, cannot record a reversal, and cannot attribute
  -- the submission to someone else.
  AND payment_method IN ('bank_deposit', 'online_gateway', 'cash', 'cheque')
  AND verified_by IS NULL
  AND verified_at IS NULL
);

DROP POLICY IF EXISTS "payment_insert" ON public.payments;
CREATE POLICY "payment_insert"
ON public.payments FOR INSERT
WITH CHECK (
  school_id = current_school_uuid()
  AND (
    get_user_role() IN ('org:owner', 'org:accountant')
    OR has_permission_grant('payments', 'write')
  )
);

-- No UPDATE policy and no UPDATE privilege for end users. Verification runs
-- through verify_payment() in 0075, which is SECURITY DEFINER and checks the
-- caller's role itself — so the only path that can flip a payment to 'verified'
-- is one that records who did it.

-- ---------------------------------------------------------------------------
-- payment_gateways
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "afritech_admin_all_gateways" ON public.payment_gateways;
CREATE POLICY "afritech_admin_all_gateways"
ON public.payment_gateways FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

-- Owner and accountant only. Gateway rows carry credentials; a teacher or admin
-- has no reason to read them, and parents certainly do not.
DROP POLICY IF EXISTS "finance_read_gateways" ON public.payment_gateways;
CREATE POLICY "finance_read_gateways"
ON public.payment_gateways FOR SELECT
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:accountant')
);

DROP POLICY IF EXISTS "owner_write_gateways" ON public.payment_gateways;
CREATE POLICY "owner_write_gateways"
ON public.payment_gateways FOR ALL
USING (
  school_id = current_school_uuid()
  AND get_user_role() = 'org:owner'
)
WITH CHECK (
  school_id = current_school_uuid()
  AND get_user_role() = 'org:owner'
);

-- === MIGRATION END ===
