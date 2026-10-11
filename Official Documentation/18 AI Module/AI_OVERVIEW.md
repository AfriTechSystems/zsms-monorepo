# AI_OVERVIEW.md — AI Module Overview

## Related Documents

- `docs/modules/ai/AI_ASSISTANT.md` — role-based conversational assistant
- `docs/modules/ai/LESSON_PLANNER.md` — RAG-based lesson planner
- `docs/modules/ai/ANALYTICS_INTELLIGENCE.md` — statistical analytics layer
- `docs/modules/ai/AI_DATA_REQUIREMENTS.md` — data completeness requirements
- `docs/modules/admin/PRICING.md` — AI as premium feature flag
- `docs/DATABASE.md` — ai_conversations, lesson_plans, knowledge_base tables
- `docs/infra/SUPABASE.md` — pgvector extension for embeddings

---

## Implementation Status (2026-10-11)

**All four systems exist in some form, and the four are at genuinely different stages —
which is the point this document makes and worth confirming.**

| System | State |
|---|---|
| 1 — Smart Analytics (SQL only, no LLM) | Built. `school_data_completeness()` gates it |
| 2 — AI Assistant (Claude, RLS-enforced) | Built: `start_ai_conversation()`, `ai_assistant_begin()`, `ai_assistant_quota()`, `ai_conversations`, `ai_messages` |
| 3 — Lesson Planner (RAG over a Zambian curriculum) | Built, **generating from templates**: `AI_GENERATOR=template`, and `curriculum_topics` is empty |
| 4 — Predictive Intelligence | Not built, correctly — blocked until 18+ months of data across 50+ schools |

**Fixed this pass: `afritech.tier_ai_allowances` was empty and nothing could write it.**
Grepped on 2026-10-11 — referenced by exactly two migrations, one of which only inserts
inside a rolled-back assertion. So `ai_allowance_for_account()` resolved **every school on
every tier to zero included credits**, and the only way to change that was a deployment.

A school paying K2,000 a month for Professional got no AI at all. That is the failure
ADR-031 exists to prevent: configuration with no editor is indistinguishable from a
hardcoded zero.

`0264` adds `admin_tier_ai_allowances()` and `admin_set_tier_ai_allowance()`, surfaced on
`/admin/pricing`. **No amounts are seeded** — the table is still empty, because a seeded
guess would make a commercial decision by accident. The screen says so: an undecided tier
carries a warning rather than a bare zero, since "deliberately none" and "nobody has
decided" are different facts and only the second explains why a teacher's generate button
fails.

---

## Purpose

This document defines the ZSMS AI module — the four-system architecture, what is genuinely AI vs smart analytics, the cost model, the phased build plan, and the data quality gate that governs when AI features activate. Every Claude Code session building any AI feature must read this document before starting.

---

## The Four AI Systems

ZSMS AI is not one thing. It is four distinct systems with different architectures, costs, and data requirements. Understanding the distinction prevents building the wrong thing.

| System | What It Is | LLM Required | Data Needed | Build Phase |
|---|---|---|---|---|
| 1 — Smart Analytics | SQL aggregations with visualisations | No | 1+ term of attendance and marks | Phase 2 |
| 2 — AI Assistant | Role-based conversational query interface | Yes (Claude) | Same as analytics | Phase 2 |
| 3 — Lesson Planner | RAG with curriculum knowledge base | Yes (Claude) | Knowledge base only | Phase 3 |
| 4 — Predictive Intelligence | ML models trained on outcomes | Yes (ML model) | 18+ months of data, 50+ schools | Phase 4 |

Most of what educational AI vendors call "AI" is System 1 — statistical analysis. Only Systems 2, 3, and 4 involve actual language models.

---

## Core AI Philosophy

ZSMS AI must satisfy one test before any feature is built: **does this directly improve student outcomes, teacher efficiency, or financial/operational clarity?**

Features that fail this test are not built regardless of how impressive they sound technically.

**What ZSMS AI does:**
- Turns raw school data into actionable insights (System 1 and 2)
- Reduces teacher lesson preparation time (System 3)
- Surfaces at-risk students before they fail (System 1 and 4)
- Answers natural language questions about school data (System 2)

**What ZSMS AI does not do:**
- Replace teachers in any decision-making capacity
- Make credit decisions independently (behaviour score is advisory only)
- Generate insights from incomplete data without flagging the incompleteness
- Share data across school boundaries regardless of how the prompt is framed

---

## The Data Quality Gate

AI insights are only as trustworthy as the data they are built on. A school where teachers consistently fail to mark attendance or enter marks cannot receive meaningful AI insights — the inputs are unreliable.

Before any AI insight is shown, the system evaluates a **data completeness score** for the school:

```typescript
interface DataCompletenessScore {
  attendance_completeness: number    // % of school days with all classes marked
  marks_completeness: number         // % of exam results filled for current term
  parent_link_completeness: number   // % of students with at least one linked parent
  overall_score: number              // Weighted composite (0-100)
  ai_insights_unlocked: boolean      // TRUE if overall_score >= 70
  missing_items: string[]            // Human-readable list of gaps
}
```

**Thresholds:**
- Overall score >= 70%: Full AI insights available
- Overall score 50-69%: Limited insights available with data quality warnings
- Overall score < 50%: AI insights panel shows data improvement guidance only

This gate creates a direct incentive for schools to maintain data quality. Schools with active AI insights are more engaged with ZSMS and less likely to churn.

---

## Access Control — AI Respects RLS

Every AI query respects the same RLS boundaries as every other ZSMS operation. The AI assistant cannot be prompted to reveal data the user is not authorised to see.

**Implementation:**
The AI assistant never receives direct database access. It receives structured query results from the ZSMS API layer — the same API layer that enforces RLS. Claude generates a query intent, ZSMS executes the query through RLS-enforced routes, and Claude narrates the result. The LLM never sees data the user should not see.

**Role-specific data boundaries:**
- Parents: Only their linked children's data
- Teachers: Only their assigned classes and subjects
- Principals/Admins: School-wide aggregated data
- AfriTech: Cross-school analytics only (never individual student data without impersonation)

---

## Subscription Access

AI features are tiered as premium add-ons:

| AI Feature | Included In | Add-On Price |
|---|---|---|
| Smart Analytics Dashboard | Growth+ | K100/month |
| AI Assistant (school data) | Professional+ | K200/month |
| Lesson Planner (school-linked teachers) | Professional+ | Included |
| Lesson Planner (standalone teacher account) | N/A — standalone product | K300/month |
| Predictive Intelligence (Phase 4) | Enterprise | K500/month |

Checked via `schoolHasFeature(schoolId, 'ai_analytics')` and `schoolHasFeature(schoolId, 'ai_assistant')`.

---

## Phased Build Plan

### Phase 2 — Analytics Foundation (Post-Pilot 2027)

1. Data completeness scoring infrastructure
2. Statistical analytics dashboard (no LLM — pure SQL visualisations)
3. Early warning system (configurable threshold rules)
4. AI assistant basic — Claude API with structured school data queries
5. Performance summary narratives (Claude generates text from aggregated data)

### Phase 3 — Lesson Planner (Mid-2027)

1. Curriculum knowledge base construction:
   - ECZ syllabuses Grade 1-12 (all subjects)
   - Cambridge IGCSE syllabuses
   - Cambridge A-Level syllabuses
   - MESVTEE curriculum framework documents
   - Approved Zambian textbook content (where copyright permits)
2. pgvector embedding pipeline — chunk, embed, store
3. RAG query pipeline — similarity search, context construction, Claude generation
4. Standalone teacher account type (platform:teacher — no school affiliation required)
5. Lesson planner B2C subscription product

### Phase 4 — Predictive Intelligence (2028+)

Requirements before starting:
- Minimum 18 months of consistent ZSMS data across 50+ schools
- A data scientist hired or contracted
- Regulatory review for any credit-related predictions
- Explainability framework (schools must understand why predictions are made)

Do not attempt Phase 4 with less data or fewer schools. The models will not generalise.

---

## The Lesson Planner as Standalone B2C Product

The most strategically important insight in the AI module. Individual teachers — not affiliated with any ZSMS school — can sign up for a standalone lesson planner account and pay a monthly subscription. This creates:

**Revenue diversification:** Income from individual teachers independent of school subscription revenue.

**Lead generation:** Teachers who love the lesson planner recommend ZSMS to their schools. The standalone product becomes a sales channel.

**Network effects:** As more teachers use the planner, AfriTech learns which topics, grade levels, and curriculum types are most requested — informing knowledge base expansion priorities.

**Competitive moat:** The Zambian curriculum knowledge base (ECZ syllabuses, Cambridge content, Zambian textbook material) becomes harder to replicate the more content is added. This is the defensible asset, not the LLM.

---

## New Database Tables for AI Module

```sql
-- Lesson plans created by teachers (school-linked and standalone)
CREATE TABLE public.lesson_plans (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id         UUID REFERENCES public.schools(id),
  -- NULL for standalone teacher accounts
  created_by        TEXT NOT NULL,           -- Clerk user ID
  title             TEXT NOT NULL,
  grade_level       TEXT NOT NULL,
  subject           TEXT NOT NULL,
  topic             TEXT NOT NULL,
  curriculum_type   TEXT NOT NULL,
  -- 'ecz' | 'cambridge_igcse' | 'cambridge_alevel' | 'custom'
  duration_minutes  INT,
  content           JSONB NOT NULL,
  -- Full lesson plan structure
  knowledge_sources JSONB,
  -- Which knowledge base chunks were used (for transparency)
  is_shared         BOOLEAN DEFAULT FALSE,
  -- Teacher chooses to share with colleagues
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- AI assistant conversation history
CREATE TABLE public.ai_conversations (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id       UUID REFERENCES public.schools(id),
  user_id         TEXT NOT NULL,
  role            TEXT NOT NULL,
  messages        JSONB NOT NULL DEFAULT '[]',
  -- Array of {role, content} message objects
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Curriculum knowledge base (chunks ready for vector search)
CREATE TABLE public.knowledge_base (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_type     TEXT NOT NULL,
  -- 'ecz_syllabus' | 'cambridge_igcse' | 'cambridge_alevel' | 'textbook' | 'curriculum_framework'
  source_name     TEXT NOT NULL,
  -- E.g. 'ECZ Mathematics Grade 9 Syllabus 2023'
  grade_level     TEXT,
  subject         TEXT,
  curriculum_type TEXT NOT NULL,
  country_code    TEXT NOT NULL DEFAULT 'ZM',
  chunk_text      TEXT NOT NULL,
  chunk_index     INT NOT NULL,
  embedding       vector(1536),
  -- pgvector column — populated by the embedding pipeline
  metadata        JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_knowledge_base_embedding ON public.knowledge_base
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
-- IVFFlat index for fast approximate nearest-neighbour search
-- Required for pgvector similarity search at scale

CREATE INDEX idx_knowledge_base_curriculum ON public.knowledge_base(curriculum_type, subject, grade_level);

-- Standalone teacher accounts (no school affiliation)
CREATE TABLE public.standalone_teacher_accounts (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clerk_user_id         TEXT NOT NULL UNIQUE,
  full_name             TEXT NOT NULL,
  email                 TEXT NOT NULL,
  phone_e164            TEXT,
  country_code          TEXT NOT NULL DEFAULT 'ZM',
  curriculum_types      TEXT[] NOT NULL DEFAULT '{ecz}',
  -- Which curricula this teacher works with
  subjects              TEXT[] NOT NULL DEFAULT '{}',
  subscription_status   TEXT NOT NULL DEFAULT 'trial'
                        CHECK (subscription_status IN ('trial','active','cancelled','suspended')),
  trial_ends_at         TIMESTAMPTZ,
  subscription_ends_at  TIMESTAMPTZ,
  lesson_plans_count    INT DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Business Rules

1. AI insights are never shown for schools with data completeness score below 50%. Scores between 50-70% show limited insights with prominent data quality warnings.
2. The AI assistant never receives raw database access. It generates query intents, ZSMS executes through the RLS-enforced API layer, and Claude narrates the results.
3. The lesson planner knowledge base is maintained by AfriTech content team. Schools and individual teachers do not upload to the knowledge base — they consume from it.
4. Standalone teacher accounts are platform-level — not school-scoped. They cannot access school data even if they happen to teach at a ZSMS-registered school.
5. Phase 4 predictive intelligence is not built until minimum data requirements are met (18+ months, 50+ schools). No exceptions.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | AI module confirmed as major product direction |
| 2026-04-26 | Four-system architecture defined | Distinguishes statistical analytics from true LLM features |
| 2026-04-26 | Data quality gate confirmed | AI insights on bad data cause harm, not value |
| 2026-04-26 | Standalone lesson planner B2C confirmed | Most strategically valuable standalone AI product |

---

## Planned — System 5: AI-Assisted Capture (Phase 4/5)

**Not built.** Design in `AI_CAPTURE.md`, decision in ADR-039.

Teachers photograph paper mark sheets, registers, enrolment lists, and payment proofs; vision extraction pre-fills a verification screen; the teacher approves before anything is written. Like System 2, it is **approval-gated** — it never writes directly.

It differs from the other four in two ways worth noting here:

- **It is the only metered system.** Each capture is a vision-API call, so it is credit-priced rather than bundled into a subscription tier.
- **It feeds the completeness gate the other systems depend on.** Systems 1 and 2 unlock at ≥70% data completeness; capture exists to make reaching that threshold realistic for a school whose teachers work on paper.
