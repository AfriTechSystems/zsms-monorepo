-- Migration: 0127_billing_public_views.sql
-- Created: 2026-09-27
-- Description: Public `security_invoker` views over the billing tables, and the
--              pricing model and bands added to the tier catalogue.
-- Related documents: Official Documentation/01 Foundation Layer/RLS.md
--                    migrations 0097/0098 — the pattern this follows
--
-- ===========================================================================
-- WHY THESE VIEWS EXIST AT ALL
--
-- `afritech` is deliberately not exposed to PostgREST (0097/0098): the pricing and
-- platform tables are not a REST surface, and keeping them off it means no policy
-- mistake there can ever be reachable over HTTP. The admin dashboard reads them
-- through a handful of `security_invoker` views in `public` instead.
--
-- 0126 added three billing tables and no views, so `/api/admin/billing` compiled and
-- would have failed at runtime with "relation invoices does not exist" — found by
-- asking how the existing admin screens read `afritech` rather than by running it.
--
-- `security_invoker = true` is the whole point of the pattern. Without it a view
-- runs as its owner and silently bypasses the RLS on the table beneath, which for
-- invoices would mean every authenticated user reading every school's bill. With it,
-- the `afritech_admin_all_invoices` policy still decides, and a non-admin sees an
-- empty view rather than a leak.
--
-- ALSO: the tier catalogue could not describe a per-student tier
--
-- `subscription_tier_catalogue` predates 0124, so it exposed neither
-- `pricing_model` nor the bands. The admin pricing screen therefore had no way to
-- show that a tier is charged per pupil, or at what rate — the feature would have
-- been invisible in the one screen meant to manage it.
-- ===========================================================================

-- === MIGRATION START ===

CREATE OR REPLACE VIEW public.invoices
WITH (security_invoker = true) AS
SELECT i.id, i.invoice_number, i.school_id,
       i.period_start, i.period_end, i.currency,
       i.tier_name, i.pricing_model, i.student_count, i.unit_price,
       i.subtotal, i.tax_rate, i.tax_amount, i.total, i.amount_paid,
       i.status, i.issued_at, i.due_at, i.paid_at, i.voided_at, i.void_reason,
       i.notes, i.created_at,
       -- Joined so the admin list does not need a second query per row, which at
       -- 300 invoices would be 300 round trips.
       s.school_id AS school_code,
       s.name      AS school_name
FROM   afritech.invoices i
JOIN   public.schools s ON s.id = i.school_id;

COMMENT ON VIEW public.invoices IS
  'Subscription invoices (school → AfriTech). security_invoker, so RLS on '
  'afritech.invoices still decides who sees what. NOT parent fee payments — those '
  'are public.payments (0127).';

CREATE OR REPLACE VIEW public.invoice_lines
WITH (security_invoker = true) AS
SELECT l.id, l.invoice_id, l.line_type, l.description, l.feature_key,
       l.quantity, l.unit_price, l.amount, l.display_order
FROM   afritech.invoice_lines l;

CREATE OR REPLACE VIEW public.invoice_payments
WITH (security_invoker = true) AS
SELECT p.id, p.invoice_id, p.amount, p.currency, p.method, p.status,
       p.reference, p.gateway_name, p.gateway_reference, p.webhook_verified,
       p.received_at, p.recorded_by, p.notes, p.created_at
       -- `gateway_payload` is deliberately omitted: it is a raw provider response
       -- that may carry payer detail nobody needs on a reconciliation screen.
FROM   afritech.invoice_payments p;

-- ---------------------------------------------------------------------------
-- The tier catalogue, now able to describe a per-student tier.
-- ---------------------------------------------------------------------------
-- DROP then CREATE, not CREATE OR REPLACE: replacing a view cannot insert a column
-- into the middle of its column list, and `annual_price_usd` and `pricing_model`
-- both belong beside their siblings rather than tacked on the end. Postgres refuses
-- the replace with 42P16 rather than silently renaming columns, which is the right
-- behaviour and the reason this is two statements.
--
-- Safe to drop: nothing in the database depends on this view — the admin screens
-- read it over HTTP, and they are redeployed with this migration.
DROP VIEW IF EXISTS public.subscription_tier_catalogue;

CREATE VIEW public.subscription_tier_catalogue
WITH (security_invoker = true) AS
SELECT t.tier_name, t.display_name,
       t.monthly_price_zmw, t.monthly_price_usd,
       t.annual_price_zmw, t.annual_price_usd,
       t.student_limit, t.whatsapp_quota,
       t.is_publicly_listed, t.display_order,
       t.pricing_model,
       -- Bands inline. A per-student tier is meaningless without them, and a second
       -- query per tier to fetch them is the N+1 this codebase already has one of.
       COALESCE(
         (SELECT jsonb_agg(
                   jsonb_build_object(
                     'id', b.id,
                     'minStudents', b.min_students,
                     'maxStudents', b.max_students,
                     'priceZmw', b.price_per_student_zmw,
                     'priceUsd', b.price_per_student_usd
                   ) ORDER BY b.min_students)
            FROM afritech.tier_student_price_bands b
            WHERE b.tier_name = t.tier_name),
         '[]'::JSONB
       ) AS price_bands
FROM   afritech.subscription_tiers t;

COMMENT ON VIEW public.subscription_tier_catalogue IS
  'Tiers with their pricing model and per-student bands inline. security_invoker, '
  'so RLS on afritech.subscription_tiers decides. Bands are embedded rather than '
  'fetched per tier (0127).';

-- The grant is re-stated because dropping the view dropped its privileges with it.
GRANT SELECT ON public.subscription_tier_catalogue TO authenticated;
REVOKE ALL  ON public.subscription_tier_catalogue FROM anon;

GRANT SELECT ON public.invoices         TO authenticated;
GRANT SELECT ON public.invoice_lines    TO authenticated;
GRANT SELECT ON public.invoice_payments TO authenticated;

REVOKE ALL ON public.invoices         FROM anon;
REVOKE ALL ON public.invoice_lines    FROM anon;
REVOKE ALL ON public.invoice_payments FROM anon;

-- === MIGRATION END ===
