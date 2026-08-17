-- ===========================================================================
-- dev_seed.sql — synthetic fixtures for `zsms-dev`
--
-- Run: npm run db:seed
--
-- ***  SYNTHETIC DATA ONLY. NEVER RUN AGAINST STAGING OR PRODUCTION.  ***
--
-- CLAUDE.md: "Never load real school data into zsms-dev — no production dumps,
-- no anonymised extracts, no pilot records." The `eu-west-1` region exception
-- for this project rests entirely on that constraint, so everything below is
-- invented and follows TEST_DATA.md's conventions for making that obvious at a
-- glance:
--
--   * school sequence numbers above 9000     — ZM-LSK-9001, never ZM-LSK-0001
--   * phone numbers in +260700XXXXXX         — Zamtel test range, non-routable
--   * emails at @zsms-test.invalid           — a reserved TLD, undeliverable by RFC
--   * round financial amounts                — K1,000 / K2,500, easy to verify
--
-- Schools A, B and C are TEST_DATA.md's. D, E and F are added here for one
-- reason: the admin dashboard's job is to rank schools by health and surface the
-- ones in trouble, and a fixture set where every school is healthy cannot show
-- whether it does that. D is failing, E is idle, F is suspended.
--
-- Idempotent. Every insert is ON CONFLICT DO NOTHING against a natural key, so
-- re-running tops up rather than duplicating.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Schools
-- ---------------------------------------------------------------------------
INSERT INTO public.schools
  (id, school_id, clerk_org_id, name, type, level, city_code, country_code,
   address, phone, email, status, subscription_tier, trial_ends_at,
   finance_module_enabled, whatsapp_enabled, max_students)
VALUES
  ('a0000000-0000-4000-8000-000000000001','ZM-LSK-9001','org_test_a',
   'Test Academy Lusaka','day','combined','LSK','ZM',
   'Plot 9001, Great East Road, Lusaka','+260700000001','office@zsms-test.invalid',
   'active','growth',NULL,TRUE,TRUE,500),

  ('a0000000-0000-4000-8000-000000000002','ZM-CBE-9001','org_test_b',
   'Test College Copperbelt','boarding','secondary','CBE','ZM',
   'Plot 9001, Kitwe Road, Ndola','+260700000002','office-b@zsms-test.invalid',
   'active','professional',NULL,TRUE,TRUE,1000),

  ('a0000000-0000-4000-8000-000000000003','ZM-LSK-9002','org_test_c',
   'Test Trial School','day','primary','LSK','ZM',
   'Plot 9002, Kabulonga, Lusaka','+260700000003','office-c@zsms-test.invalid',
   'trial','starter', NOW() + INTERVAL '5 days', FALSE,TRUE,200),

  -- D: billing but nobody using it. The case the health score exists to catch —
  -- an active subscription and no engagement is a school that will not renew.
  ('a0000000-0000-4000-8000-000000000004','ZM-LSK-9003','org_test_d',
   'Test Academy Chelston','day','primary','LSK','ZM',
   'Plot 9003, Chelston, Lusaka','+260700000004','office-d@zsms-test.invalid',
   'active','starter',NULL,FALSE,TRUE,200),

  -- E: onboarded, never configured. Should read as unconfigured, not failing.
  ('a0000000-0000-4000-8000-000000000005','ZM-NDL-9001','org_test_e',
   'Test Primary Ndola','day','primary','NDL','ZM',
   'Plot 9001, Ndola','+260700000005','office-e@zsms-test.invalid',
   'active','starter',NULL,FALSE,TRUE,200),

  -- F: suspended. Must be visibly separated from the active list.
  ('a0000000-0000-4000-8000-000000000006','ZM-KIT-9001','org_test_f',
   'Test School Kitwe','day','combined','KIT','ZM',
   'Plot 9001, Kitwe','+260700000006','office-f@zsms-test.invalid',
   'suspended','growth',NULL,FALSE,FALSE,500)
ON CONFLICT (school_id) DO NOTHING;

-- Branding: one school themed, the rest on the ZSMS default. Both paths need to
-- be visible in the admin list.
INSERT INTO public.school_branding (school_id, anchor_color, primary_color, updated_by)
VALUES ('a0000000-0000-4000-8000-000000000002','#1A3A5B','#2E6EB0','seed')
ON CONFLICT (school_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Grade levels — School A on ECZ, School B on Cambridge forms
-- ---------------------------------------------------------------------------
INSERT INTO public.school_grade_levels
  (school_id, level_id, display_name, level_order, level_type, examination_type, is_active)
SELECT 'a0000000-0000-4000-8000-000000000001', 'grade_' || g, 'Grade ' || g, g,
       CASE WHEN g <= 7 THEN 'primary' WHEN g <= 9 THEN 'junior_secondary' ELSE 'senior_secondary' END,
       'ecz', TRUE
FROM generate_series(1, 12) g
ON CONFLICT DO NOTHING;

INSERT INTO public.school_grade_levels
  (school_id, level_id, display_name, level_order, level_type, examination_type, is_active)
SELECT 'a0000000-0000-4000-8000-000000000002', 'form_' || f, 'Form ' || f, f,
       CASE WHEN f <= 4 THEN 'senior_secondary' ELSE 'a_level' END,
       'cambridge', TRUE
FROM generate_series(1, 6) f
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Students
--
-- Volumes differ on purpose: A is a working school, D is billing for 40 pupils
-- and doing nothing with them, E has 12 and no configuration at all.
-- ---------------------------------------------------------------------------
INSERT INTO public.students
  (school_id, student_id, first_name, last_name, grade_id, class_id, status, is_boarding)
SELECT
  'a0000000-0000-4000-8000-000000000001',
  'STU-ZM-LSK-9001-' || lpad(n::TEXT, 5, '0'),
  (ARRAY['Chanda','Bwalya','Mutale','Nsofwa','Lubuto','Mwansa','Chileshe','Kunda',
         'Temwani','Natasha','Joseph','Mercy','Given','Bright','Peggy','Isaac'])[1 + (n % 16)],
  (ARRAY['Mwale','Phiri','Banda','Zulu','Tembo','Lungu','Sakala','Daka',
         'Mumba','Chirwa','Kalaba','Ngoma'])[1 + (n % 12)],
  'grade_' || (1 + (n % 12)),
  'grade_' || (1 + (n % 12)) || 'a',
  'active', FALSE
FROM generate_series(1, 120) n
ON CONFLICT (student_id) DO NOTHING;

INSERT INTO public.students
  (school_id, student_id, first_name, last_name, grade_id, class_id, status, is_boarding)
SELECT
  'a0000000-0000-4000-8000-000000000002',
  'STU-ZM-CBE-9001-' || lpad(n::TEXT, 5, '0'),
  (ARRAY['Kondwani','Thandiwe','Chipo','Mapalo','Musonda','Sepo','Taonga','Chimwemwe'])[1 + (n % 8)],
  (ARRAY['Sichone','Musonda','Nkandu','Chanda','Simukonda','Mwape'])[1 + (n % 6)],
  'form_' || (1 + (n % 6)),
  'form_' || (1 + (n % 6)) || 'a',
  'active', TRUE
FROM generate_series(1, 80) n
ON CONFLICT (student_id) DO NOTHING;

INSERT INTO public.students
  (school_id, student_id, first_name, last_name, grade_id, class_id, status, is_boarding)
SELECT
  'a0000000-0000-4000-8000-000000000004',
  'STU-ZM-LSK-9003-' || lpad(n::TEXT, 5, '0'),
  (ARRAY['Mutinta','Kaunda','Namakau','Lweendo'])[1 + (n % 4)],
  (ARRAY['Hamalambo','Muyunda','Sikaonga'])[1 + (n % 3)],
  'grade_' || (1 + (n % 7)), 'grade_' || (1 + (n % 7)) || 'a', 'active', FALSE
FROM generate_series(1, 40) n
ON CONFLICT (student_id) DO NOTHING;

INSERT INTO public.students
  (school_id, student_id, first_name, last_name, grade_id, class_id, status, is_boarding)
SELECT
  'a0000000-0000-4000-8000-000000000005',
  'STU-ZM-NDL-9001-' || lpad(n::TEXT, 5, '0'),
  'Pupil', 'Number' || n, 'grade_1', 'grade_1a', 'active', FALSE
FROM generate_series(1, 12) n
ON CONFLICT (student_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Parents and guardian links
--
-- School A is well linked (most students have a guardian), D deliberately is
-- not — parent activation is an engagement input, and D exists to score badly
-- on it.
-- ---------------------------------------------------------------------------
INSERT INTO public.parents (clerk_user_id, phone_e164, email, full_name, preferred_contact)
SELECT 'user_test_parent_' || n,
       '+26070010' || lpad(n::TEXT, 4, '0'),
       'parent' || n || '@zsms-test.invalid',
       (ARRAY['Grace','Peter','Mary','Daniel','Ruth','Alice','James','Esther'])[1 + (n % 8)]
         || ' ' || (ARRAY['Mwale','Phiri','Banda','Zulu','Tembo'])[1 + (n % 5)],
       'whatsapp'
FROM generate_series(1, 100) n
ON CONFLICT (clerk_user_id) DO NOTHING;

INSERT INTO public.student_parent_links (student_id, parent_id, parent_user_id, is_active, is_primary)
SELECT st.id, p.id, p.clerk_user_id, TRUE, TRUE
FROM (
  SELECT id, row_number() OVER (ORDER BY student_id) AS rn
  FROM public.students
  WHERE school_id = 'a0000000-0000-4000-8000-000000000001'
) st
JOIN (
  SELECT id, clerk_user_id, row_number() OVER (ORDER BY clerk_user_id) AS rn
  FROM public.parents
) p ON p.rn = st.rn
WHERE st.rn <= 100
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------
-- No `role` column: a staff member's role is a Clerk organisation membership,
-- not a database field. `department` is the nearest thing this table records.
INSERT INTO public.staff_members
  (school_id, clerk_user_id, staff_number, first_name, last_name, department, email, phone_e164, is_active)
SELECT
  'a0000000-0000-4000-8000-000000000001',
  'user_test_staff_a' || n,
  'STF-9001-' || lpad(n::TEXT, 3, '0'),
  (ARRAY['Agnes','Emmanuel','Beatrice','Fredrick','Loveness','Kelvin'])[1 + (n % 6)],
  (ARRAY['Simumba','Kabwe','Ngosa','Mubanga','Chibale'])[1 + (n % 5)],
  CASE WHEN n <= 3 THEN 'Administration' ELSE 'Teaching' END,
  'staff' || n || '@zsms-test.invalid',
  '+26070020' || lpad(n::TEXT, 4, '0'),
  TRUE
FROM generate_series(1, 14) n
ON CONFLICT (school_id, clerk_user_id) DO NOTHING;

INSERT INTO public.staff_members
  (school_id, clerk_user_id, staff_number, first_name, last_name, department, email, phone_e164, is_active)
SELECT
  'a0000000-0000-4000-8000-000000000002',
  'user_test_staff_b' || n,
  'STF-CBE9001-' || lpad(n::TEXT, 3, '0'),
  'Staff', 'Member' || n,
  CASE WHEN n <= 2 THEN 'Administration' ELSE 'Teaching' END,
  'staffb' || n || '@zsms-test.invalid',
  '+26070021' || lpad(n::TEXT, 4, '0'),
  TRUE
FROM generate_series(1, 9) n
ON CONFLICT (school_id, clerk_user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Fees — structures, records, and payments
--
-- School A collects well. B collects moderately. D bills and collects almost
-- nothing, which is what puts it at the top of the at-risk list.
-- ---------------------------------------------------------------------------
-- `fee_structures` carries no due date — it is a price list. The date a
-- particular pupil's charge falls due lives on `fee_records`, which is what
-- lets one structure be issued with different deadlines.
INSERT INTO public.fee_structures
  (school_id, academic_year, term_number, grade_id, fee_label, amount, currency_code, is_mandatory, is_active)
VALUES
  ('a0000000-0000-4000-8000-000000000001','2026',1,'ALL','Tuition Fee',2500.00,'ZMW',TRUE,TRUE),
  ('a0000000-0000-4000-8000-000000000002','2026',1,'ALL','Tuition Fee',5000.00,'ZMW',TRUE,TRUE),
  ('a0000000-0000-4000-8000-000000000004','2026',1,'ALL','Tuition Fee',1000.00,'ZMW',TRUE,TRUE)
ON CONFLICT DO NOTHING;

INSERT INTO public.fee_records
  (school_id, student_id, fee_structure_id, academic_year, term_number, fee_label,
   amount_due, amount_paid, discount_amount, due_date)
SELECT
  st.school_id, st.id, fs.id, '2026', 1, 'Tuition Fee',
  fs.amount,
  -- A pays ~85%, B ~65%, D ~8%.
  CASE st.school_id
    WHEN 'a0000000-0000-4000-8000-000000000001' THEN
      CASE WHEN (row_number() OVER (PARTITION BY st.school_id ORDER BY st.student_id)) % 20 < 17
           THEN fs.amount ELSE 0 END
    WHEN 'a0000000-0000-4000-8000-000000000002' THEN
      CASE WHEN (row_number() OVER (PARTITION BY st.school_id ORDER BY st.student_id)) % 20 < 13
           THEN fs.amount ELSE fs.amount / 2 END
    ELSE
      CASE WHEN (row_number() OVER (PARTITION BY st.school_id ORDER BY st.student_id)) % 12 = 0
           THEN fs.amount ELSE 0 END
  END,
  0,
  -- D's charges fell due six weeks ago and are still unpaid; that is what puts
  -- it into arrears rather than merely behind.
  CASE st.school_id WHEN 'a0000000-0000-4000-8000-000000000004'
       THEN CURRENT_DATE - 45 ELSE CURRENT_DATE - 20 END
FROM public.students st
JOIN public.fee_structures fs
  ON fs.school_id = st.school_id AND fs.academic_year = '2026' AND fs.term_number = 1
WHERE st.school_id IN (
  'a0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000002',
  'a0000000-0000-4000-8000-000000000004')
ON CONFLICT DO NOTHING;

-- Verified payments for every fully-paid record, so the collected-this-month
-- figure has something real behind it rather than being inferred from balances.
INSERT INTO public.payments
  (school_id, fee_record_id, student_id, recorded_by_user_id, amount, currency_code,
   payment_method, status, verified_by, verified_at, paid_at, receipt_number)
SELECT
  f.school_id, f.id, f.student_id, 'user_test_staff_a3', f.amount_paid, 'ZMW',
  -- The CHECK on payments.payment_method admits cash / bank_deposit / cheque /
  -- online_gateway / loan_disbursement / reversal / waiver. Notably there is no
  -- `mobile_money`, which is the dominant rail in Zambia — mobile collections
  -- have to be recorded as `online_gateway`. Flagged rather than worked around.
  (ARRAY['cash','bank_deposit','online_gateway'])[1 + (row_number() OVER (ORDER BY f.id))::INT % 3],
  'verified', 'user_test_staff_a1', NOW() - INTERVAL '3 days',
  NOW() - INTERVAL '3 days',
  'REC-' || (SELECT school_id FROM public.schools s WHERE s.id = f.school_id)
    || '-' || lpad((row_number() OVER (ORDER BY f.id))::TEXT, 6, '0')
FROM public.fee_records f
WHERE f.amount_paid > 0
ON CONFLICT (receipt_number) DO NOTHING;

-- A handful awaiting verification — the admin dashboard surfaces this count, and
-- a zero would not prove the query works.
INSERT INTO public.payments
  (school_id, fee_record_id, student_id, recorded_by_user_id, amount, currency_code,
   payment_method, status, paid_at, receipt_number)
SELECT
  f.school_id, f.id, f.student_id, 'user_test_staff_a3', 500.00, 'ZMW',
  'online_gateway', 'pending_verification', NOW() - INTERVAL '1 day',
  'REC-PENDING-' || lpad((row_number() OVER (ORDER BY f.id))::TEXT, 4, '0')
FROM public.fee_records f
WHERE f.school_id = 'a0000000-0000-4000-8000-000000000001' AND f.amount_paid = 0
LIMIT 7
ON CONFLICT (receipt_number) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Attendance and results — the operational-health inputs
--
-- School A marks registers on most days and has entered marks. B marks some.
-- D and E have none, which is the whole reason they exist in this fixture.
-- ---------------------------------------------------------------------------
INSERT INTO public.attendance_records
  (school_id, student_id, attendance_date, academic_year, term_number, status, recorded_by_user_id, class_id)
SELECT st.school_id, st.id, d::DATE, '2026', 1,
       CASE WHEN (st.rn + extract(day FROM d)::INT) % 25 = 0 THEN 'absent'
            WHEN (st.rn + extract(day FROM d)::INT) % 17 = 0 THEN 'late'
            ELSE 'present' END,
       'user_test_staff_a4', st.class_id
FROM (
  SELECT id, school_id, class_id, row_number() OVER (ORDER BY student_id) AS rn
  FROM public.students WHERE school_id = 'a0000000-0000-4000-8000-000000000001'
  LIMIT 40
) st
CROSS JOIN generate_series(CURRENT_DATE - 30, CURRENT_DATE - 1, INTERVAL '1 day') d
WHERE extract(isodow FROM d) < 6
ON CONFLICT DO NOTHING;

INSERT INTO public.attendance_records
  (school_id, student_id, attendance_date, academic_year, term_number, status, recorded_by_user_id, class_id)
SELECT st.school_id, st.id, d::DATE, '2026', 1, 'present', 'user_test_staff_b3', st.class_id
FROM (
  SELECT id, school_id, class_id FROM public.students
  WHERE school_id = 'a0000000-0000-4000-8000-000000000002' LIMIT 25
) st
CROSS JOIN generate_series(CURRENT_DATE - 12, CURRENT_DATE - 1, INTERVAL '1 day') d
WHERE extract(isodow FROM d) < 6
ON CONFLICT DO NOTHING;

INSERT INTO public.exam_results
  (school_id, student_id, class_id, academic_year, term_number, subject_code, subject_name,
   marks_obtained, marks_total, grade_letter, entered_by_user_id, results_published, published_at)
SELECT st.school_id, st.id, st.class_id, '2026', 1, 'MATH', 'Mathematics',
       40 + (st.rn * 7) % 55, 100,
       CASE WHEN 40 + (st.rn * 7) % 55 >= 75 THEN 'A'
            WHEN 40 + (st.rn * 7) % 55 >= 65 THEN 'B'
            WHEN 40 + (st.rn * 7) % 55 >= 50 THEN 'C'
            ELSE 'D' END,
       -- `exam_results_published_has_timestamp` requires published_at whenever
       -- results_published is true. Publication is an event, not a flag.
       'user_test_staff_a4', TRUE, NOW() - INTERVAL '6 days'
FROM (
  SELECT id, school_id, class_id, row_number() OVER (ORDER BY student_id) AS rn
  FROM public.students WHERE school_id = 'a0000000-0000-4000-8000-000000000001'
  LIMIT 95
) st
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Message dispatches — the second engagement input
--
-- Written through `record_message_dispatch()` rather than inserted: 0089 grants
-- no INSERT on `message_log` to anyone, so the function is the only way in. That
-- is deliberate on the schema's part and the seed respects it rather than
-- reaching around it with elevated rights.
--
-- Without these every school scores zero on communication and the whole fixture
-- set reads "critical", which tells you nothing about whether the ranking works.
-- ---------------------------------------------------------------------------
SELECT public.record_message_dispatch(
  l.school_id, 'whatsapp', 'fee_payment_confirmed',
  p.phone_e164, p.email, p.clerk_user_id, l.student_id,
  CASE WHEN l.n % 17 = 0 THEN 'failed' WHEN l.n % 5 = 0 THEN 'sent' ELSE 'delivered' END,
  NULL, FALSE, NULL, TRUE)
FROM (
  SELECT st.school_id, st.id AS student_id, spl.parent_id,
         row_number() OVER (ORDER BY st.student_id) AS n
  FROM public.students st
  JOIN public.student_parent_links spl ON spl.student_id = st.id
  WHERE st.school_id = 'a0000000-0000-4000-8000-000000000001'
  LIMIT 90
) l
JOIN public.parents p ON p.id = l.parent_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.message_log m
  WHERE m.school_id = l.school_id AND m.student_id = l.student_id
);

SELECT public.record_message_dispatch(
  'a0000000-0000-4000-8000-000000000002', 'email', 'fee_reminder_due',
  NULL, 'parentb' || n || '@zsms-test.invalid', NULL, NULL,
  'delivered', NULL, FALSE, NULL, TRUE)
FROM generate_series(1, 25) n
WHERE (SELECT count(*) FROM public.message_log
        WHERE school_id = 'a0000000-0000-4000-8000-000000000002') < 25;

-- ---------------------------------------------------------------------------
-- Feature overrides — the admin exception surface needs rows to show
-- ---------------------------------------------------------------------------
INSERT INTO afritech.school_feature_overrides
  (school_id, override_type, feature_key, reason, ticket_ref, granted_by)
VALUES
  ('a0000000-0000-4000-8000-000000000001','grant_feature','loan_module',
   'Pilot participant — finance module granted ahead of Professional upgrade.','ZSMS-114','seed'),
  ('a0000000-0000-4000-8000-000000000006','revoke_feature','per_absence_alerts',
   'Suspended for non-payment; outbound messaging withdrawn pending settlement.','ZSMS-131','seed')
ON CONFLICT DO NOTHING;

COMMIT;

-- ---------------------------------------------------------------------------
-- What was loaded
-- ---------------------------------------------------------------------------
SELECT s.school_id, s.name, s.status, s.subscription_tier,
       (SELECT count(*) FROM public.students st WHERE st.school_id = s.id) AS students,
       (SELECT count(*) FROM public.fee_records f WHERE f.school_id = s.id) AS fee_records
FROM public.schools s
ORDER BY s.school_id;
