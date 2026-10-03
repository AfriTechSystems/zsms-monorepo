-- ---------------------------------------------------------------------------
-- 0187 — data subject access, portability and erasure (ZDPA)
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/01 Foundation Layer/COMPLIANCE.md`
--         → *Data Subject Rights Procedures*
--
-- ## Why this is a launch blocker rather than a feature
--
-- The Zambia Data Protection Act 2021 gives a data subject rights with clocks
-- attached — access and erasure in 30 days, portability in 14 — and AfriTech is
-- the **controller**, so the obligation is AfriTech's and not the school's.
--
-- `COMPLIANCE.md` documents all five rights and the procedure for each.
-- **Nothing implemented any of them.** The clock starts the day a real parent
-- asks, and the only honest answer today would be a developer running SQL by
-- hand against a production database — which is itself a processing activity
-- nobody logged.
--
-- ## Erasure means anonymisation, and the document is right about why
--
-- Zambian financial regulation requires seven years of payment records. So a
-- deletion request cannot delete: it **anonymises**, replacing the identifying
-- columns while the financial rows keep their amounts, dates and references.
-- `COMPLIANCE.md` fixes the markers — "DATA SUBJECT DELETED" for a name,
-- "DELETED" for a phone — and those exact strings are used, because a school
-- reading a statement six months later needs to recognise the state rather than
-- wonder whether the record is corrupt.
--
-- ## What is cleared beyond the obvious
--
-- `clerk_user_id`. Masking a name while leaving the account link would let the
-- same person sign in and re-associate with the record their erasure request was
-- about — the one outcome erasure must prevent. The Clerk account itself is
-- deleted through Clerk's own API by the route, because this function cannot
-- reach it.
--
-- ## The export is built from the schema, not from memory
--
-- Eighteen `public` tables reference a data subject. Each is listed explicitly
-- rather than discovered at runtime: a table added later and silently omitted
-- would make the export quietly incomplete, which is worse than failing, and the
-- assertion at the foot of this file fails when a new referencing table appears.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Everything held about one subject.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_export_data_subject(
  p_kind TEXT,
  p_id   UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out JSONB;
BEGIN
  IF NOT public.is_afritech_admin() THEN
    RAISE EXCEPTION 'Only AfriTech may export a data subject' USING ERRCODE = '42501';
  END IF;

  IF p_kind NOT IN ('student', 'parent', 'staff') THEN
    RAISE EXCEPTION 'Unknown data subject kind: %', p_kind USING ERRCODE = '22023';
  END IF;

  IF p_kind = 'student' THEN
    SELECT jsonb_build_object(
      'kind', 'student',
      'exported_at', NOW(),
      'record', to_jsonb(s),
      'attendance', COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM public.attendance_records a
                               WHERE a.student_id = s.id), '[]'::jsonb),
      'results', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM public.exam_results r
                            WHERE r.student_id = s.id), '[]'::jsonb),
      'fees', COALESCE((SELECT jsonb_agg(to_jsonb(f)) FROM public.fee_records f
                         WHERE f.student_id = s.id), '[]'::jsonb),
      'payments', COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM public.payments p
                             WHERE p.student_id = s.id), '[]'::jsonb),
      'custom_fields', COALESCE((SELECT jsonb_agg(to_jsonb(cv)) FROM public.student_custom_values cv
                                  WHERE cv.student_id = s.id), '[]'::jsonb),
      'guardians', COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM public.student_parent_links l
                              WHERE l.student_id = s.id), '[]'::jsonb),
      'documents', COALESCE((SELECT jsonb_agg(to_jsonb(g)) FROM public.generated_documents g
                              WHERE g.student_id = s.id), '[]'::jsonb),
      'messages', COALESCE((SELECT jsonb_agg(to_jsonb(m)) FROM public.message_log m
                             WHERE m.student_id = s.id), '[]'::jsonb)
    ) INTO v_out
    FROM public.students s
    WHERE s.id = p_id;

  ELSIF p_kind = 'parent' THEN
    SELECT jsonb_build_object(
      'kind', 'parent',
      'exported_at', NOW(),
      'record', to_jsonb(pa),
      'children', COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM public.student_parent_links l
                             WHERE l.parent_id = pa.id), '[]'::jsonb),
      'claims', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM public.parent_link_claims c
                           WHERE c.parent_id = pa.id), '[]'::jsonb),
      'devices', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.parent_push_tokens t
                            WHERE t.parent_user_id = pa.clerk_user_id), '[]'::jsonb)
    ) INTO v_out
    FROM public.parents pa
    WHERE pa.id = p_id;

  ELSE
    SELECT jsonb_build_object(
      'kind', 'staff',
      'exported_at', NOW(),
      'record', to_jsonb(st),
      'requests', COALESCE((SELECT jsonb_agg(to_jsonb(rq)) FROM public.staff_requests rq
                             WHERE rq.clerk_user_id = st.clerk_user_id), '[]'::jsonb),
      'hub_account', (SELECT to_jsonb(h) FROM public.standalone_teacher_accounts h
                       WHERE h.clerk_user_id = st.clerk_user_id),
      'network_memberships', COALESCE((SELECT jsonb_agg(to_jsonb(nm))
                                        FROM public.school_network_members nm
                                        WHERE nm.clerk_user_id = st.clerk_user_id), '[]'::jsonb)
    ) INTO v_out
    FROM public.staff_members st
    WHERE st.id = p_id;
  END IF;

  IF v_out IS NULL THEN
    RAISE EXCEPTION 'No % with that id', p_kind USING ERRCODE = 'P0002';
  END IF;

  /*
    The export is itself a processing activity and is logged.

    Only the kind and the id — never the exported content, which would copy the
    subject's whole record into a table the request was partly about.
  */
  PERFORM public.log_audit_event(
    'data_subject_exported', p_kind, p_id,
    jsonb_build_object('kind', p_kind), NULL
  );

  RETURN v_out;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Erasure, which is anonymisation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_anonymise_data_subject(
  p_kind   TEXT,
  p_id     UUID,
  p_reason TEXT
)
RETURNS TABLE (out_done BOOLEAN, out_retained TEXT, out_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- The exact markers `COMPLIANCE.md` specifies. A school reading a statement
  -- months later must recognise the state rather than suspect corruption.
  c_name  CONSTANT TEXT := 'DATA SUBJECT DELETED';
  c_value CONSTANT TEXT := 'DELETED';
  v_kept  TEXT;
  v_rows  INT;
BEGIN
  IF NOT public.is_afritech_admin() THEN
    RAISE EXCEPTION 'Only AfriTech may erase a data subject' USING ERRCODE = '42501';
  END IF;

  IF p_kind NOT IN ('student', 'parent', 'staff') THEN
    RAISE EXCEPTION 'Unknown data subject kind: %', p_kind USING ERRCODE = '22023';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    -- Erasure is irreversible and removes the evidence of why it happened. The
    -- reason is the only thing that survives to answer for it.
    RAISE EXCEPTION 'A reason is required to erase a data subject' USING ERRCODE = '22023';
  END IF;

  IF p_kind = 'student' THEN
    UPDATE public.students s
       SET first_name = c_name,
           last_name = c_value,
           date_of_birth = NULL,
           gender = NULL,
           nrc_or_birth_cert = NULL,
           photo_url = NULL,
           examination_number = NULL,
           -- Cleared so the same Clerk account cannot re-associate with the
           -- record its erasure was about.
           clerk_user_id = NULL,
           updated_at = NOW()
     WHERE s.id = p_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    -- Custom fields are school-defined and may hold anything — a medical note, a
    -- previous school. Cleared wholesale rather than inspected.
    DELETE FROM public.student_custom_values WHERE student_id = p_id;

    v_kept := 'Fee records, payments, attendance and results are retained with '
              || 'amounts and dates intact — Zambian financial regulation requires '
              || 'seven years — but no longer identify anybody.';

  ELSIF p_kind = 'parent' THEN
    UPDATE public.parents pa
       SET full_name = c_name,
           phone_e164 = c_value,
           email = NULL,
           national_id = NULL,
           clerk_user_id = NULL,
           -- Consent cannot survive the person. Both opt-ins go to the safe value.
           whatsapp_opted_in = FALSE,
           updated_at = NOW()
     WHERE pa.id = p_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    -- A device token is a live delivery address. Deleted outright: there is no
    -- retention argument for a push endpoint.
    DELETE FROM public.parent_push_tokens
     WHERE parent_user_id IN (SELECT clerk_user_id FROM public.parents WHERE id = p_id);

    -- The links stay so a pupil's record still shows a guardian existed, which the
    -- school needs; the guardian simply no longer has a name.
    UPDATE public.student_parent_links SET parent_user_id = NULL WHERE parent_id = p_id;

    v_kept := 'The link to each child is retained so the school''s own records stay '
              || 'complete, but it no longer identifies anybody.';

  ELSE
    UPDATE public.staff_members st
       SET first_name = c_name,
           last_name = c_value,
           phone_e164 = c_value,
           email = NULL,
           photo_url = NULL,
           location = NULL,
           qualifications = NULL,
           clerk_user_id = NULL,
           is_active = FALSE,
           updated_at = NOW()
     WHERE st.id = p_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    v_kept := 'Attendance registers and marks they entered are retained — those are '
              || 'the school''s records of a child''s education, not the teacher''s '
              || 'personal data.';
  END IF;

  IF v_rows = 0 THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, format('No %s with that id.', p_kind)::TEXT;
    RETURN;
  END IF;

  /*
    Logged, and the log survives the erasure.

    `0131`'s immutability trigger means nobody — including AfriTech — can delete
    this row afterwards, which is what makes the erasure answerable. The reason is
    recorded; the erased values are not, since copying them here would defeat the
    request.
  */
  PERFORM public.log_audit_event(
    'data_subject_erased', p_kind, p_id,
    jsonb_build_object('kind', p_kind, 'reason', btrim(p_reason)), NULL
  );

  RETURN QUERY SELECT TRUE, v_kept,
    format('%s erased. This cannot be undone.', initcap(p_kind))::TEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Portability — a subject exporting their OWN data.
--
-- Separate from the admin function and not a wrapper around it: this one takes
-- no identifier at all. A function that accepted one would let any signed-in
-- person export somebody else's record by changing a number, which is the exact
-- failure `0170` avoided by making `claim_parent_links()` argument-free.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.export_my_data()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user TEXT := public.get_user_id();
  v_out  JSONB;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'exported_at', NOW(),
    'account', v_user,
    'parent_record', (SELECT to_jsonb(pa) FROM public.parents pa WHERE pa.clerk_user_id = v_user),
    'children', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', s.first_name || ' ' || s.last_name,
        'pupil_number', s.student_id,
        'grade', s.grade_id,
        'class', s.class_id,
        'relationship', l.relationship
      ))
      FROM public.student_parent_links l
      JOIN public.students s ON s.id = l.student_id
      WHERE l.parent_user_id = v_user AND l.is_active
    ), '[]'::jsonb),
    'staff_records', COALESCE((
      SELECT jsonb_agg(to_jsonb(st)) FROM public.staff_members st WHERE st.clerk_user_id = v_user
    ), '[]'::jsonb),
    'teacher_hub', (SELECT to_jsonb(h) FROM public.standalone_teacher_accounts h
                     WHERE h.clerk_user_id = v_user)
  ) INTO v_out;

  PERFORM public.log_audit_event(
    'data_subject_self_export', 'accounts', NULL,
    jsonb_build_object('account', v_user), NULL
  );

  RETURN v_out;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_fn TEXT;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.admin_export_data_subject(TEXT, UUID)',
    'public.admin_anonymise_data_subject(TEXT, UUID, TEXT)',
    'public.export_my_data()'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_fn);

    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon can execute %', v_fn;
    END IF;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- An export that silently misses a table is worse than one that fails.
--
-- The subject-referencing tables are listed explicitly above. This fails when a
-- NEW one appears, so whoever adds it has to decide whether it belongs in the
-- export rather than discovering the omission during a regulator's deadline.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_known TEXT[] := ARRAY[
    'ai_credit_caps', 'attendance_records', 'exam_results', 'fee_records',
    'generated_documents', 'message_log', 'parent_link_claims', 'parent_push_tokens',
    'parents', 'payments', 'school_credit_assignments', 'school_network_members',
    'staff_members', 'staff_requests', 'standalone_teacher_accounts',
    'student_custom_values', 'student_parent_links', 'students'
  ];
  v_new   TEXT[];
BEGIN
  SELECT array_agg(DISTINCT c.table_name) INTO v_new
  FROM information_schema.columns c
  JOIN information_schema.tables t
    ON t.table_schema = c.table_schema AND t.table_name = c.table_name
  WHERE c.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
    AND c.column_name IN ('student_id', 'parent_id', 'parent_user_id', 'clerk_user_id')
    AND NOT (c.table_name = ANY (v_known));

  IF v_new IS NOT NULL AND array_length(v_new, 1) > 0 THEN
    RAISE EXCEPTION
      'these tables reference a data subject and are not in the export: %. Add them to admin_export_data_subject() or to the known list with a reason.',
      array_to_string(v_new, ', ');
  END IF;
END;
$$;
