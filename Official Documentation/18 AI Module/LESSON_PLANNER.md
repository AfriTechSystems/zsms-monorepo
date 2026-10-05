# LESSON_PLANNER.md — Lesson Planner

## Related Documents

- `docs/modules/ai/AI_OVERVIEW.md` — AI module architecture
- `docs/modules/ai/AI_DATA_REQUIREMENTS.md` — data requirements
- `docs/DATABASE.md` — knowledge_base, lesson_plans, standalone_teacher_accounts tables
- `docs/modules/documents/STORAGE.md` — lesson plan PDF export storage
- `docs/infra/SUPABASE.md` — pgvector extension for embeddings
- `docs/modules/admin/PRICING.md` — standalone teacher subscription pricing

---

## Purpose

This document defines the complete lesson planner — the RAG architecture, the curriculum knowledge base, the standalone B2C teacher product, the lesson plan output format, and the embedding pipeline. Every Claude Code session building any lesson planner feature must read this document first.

---

## Strategic Context

The lesson planner is the most strategically important AI feature in ZSMS for two reasons:

**1. The knowledge base is the moat.** Any competitor can call the Claude API. Building a properly structured, embedded Zambian curriculum knowledge base — ECZ syllabuses, Cambridge content, approved textbooks — takes months of content work. Once built, it is a defensible asset.

**2. Standalone B2C product.** Individual teachers who are not affiliated with any ZSMS-registered school can sign up, pay a monthly subscription, and use the lesson planner independently. This creates a separate revenue stream and a sales channel — teachers who love the planner recommend ZSMS to their schools.

---

## The Knowledge Base

The lesson planner's quality is determined entirely by the quality of the knowledge base. Generic LLMs know very little about the ECZ Grade 7 Science syllabus or the Zambian Mathematics textbook series. The knowledge base fills this gap.

### Knowledge Base Content

| Source Type | Description | Coverage |
|---|---|---|
| `ecz_syllabus` | Official ECZ syllabuses — all subjects, Grade 1-12 | All subjects |
| `cambridge_igcse` | Cambridge IGCSE syllabuses — Sciences, Mathematics, English, Humanities | Forms 3-4 (O-Level) |
| `cambridge_alevel` | Cambridge A-Level syllabuses | Forms 5-6 |
| `curriculum_framework` | MESVTEE national curriculum framework documents | All levels |
| `textbook` | Approved Zambian textbooks (copyright-cleared or partnered with publisher) | Priority subjects |
| `exam_papers` | Past ECZ and Cambridge exam papers (structure and topics) | Grade 6, Form 4, Form 6 |

### Knowledge Base Construction Pipeline

Content is processed in four steps:

**Step 1 — Document Collection**
AfriTech content team collects all source documents as PDFs. ECZ syllabuses are publicly available from the Examinations Council of Zambia website. Cambridge syllabuses are downloaded from the Cambridge Assessment International Education website. Textbook content requires publisher permission or partnership agreements.

**Step 2 — Chunking**
Each document is split into chunks of 800-1,200 tokens. Chunks respect natural document boundaries — a chunk does not split mid-topic or mid-objective. Each chunk is tagged with metadata:

```typescript
interface KnowledgeChunk {
  source_type: string      // 'ecz_syllabus'
  source_name: string      // 'ECZ Mathematics Grade 9 Syllabus 2023'
  grade_level: string      // 'grade_9'
  subject: string          // 'mathematics'
  topic: string            // 'Simultaneous Equations' (extracted from heading)
  curriculum_type: string  // 'ecz'
  country_code: string     // 'ZM'
  chunk_text: string       // The actual content
  chunk_index: number      // Position within the source document
}
```

**Step 3 — Embedding**
Each chunk is embedded using OpenAI `text-embedding-3-small` (1,536 dimensions) or a compatible Supabase-supported embedding model. Embeddings are stored in the `knowledge_base` table's `embedding vector(1536)` column.

```typescript
// Embedding pipeline — run once per document, re-run when content updates
async function embedKnowledgeChunk(chunk: KnowledgeChunk): Promise<void> {
  const embedding = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: chunk.chunk_text,
  })

  await supabaseAdmin.from('knowledge_base').insert({
    source_type: chunk.source_type,
    source_name: chunk.source_name,
    grade_level: chunk.grade_level,
    subject: chunk.subject,
    curriculum_type: chunk.curriculum_type,
    country_code: chunk.country_code,
    chunk_text: chunk.chunk_text,
    chunk_index: chunk.chunk_index,
    embedding: embedding.data[0].embedding,
  })
}
```

**Step 4 — Index Verification**
After embedding, verify the IVFFlat index is active and test a sample similarity search to confirm retrieval quality.

---

## The RAG Query Pipeline

When a teacher requests a lesson plan, the RAG pipeline runs:

```
Teacher request: "Grade 9 Mathematics — Simultaneous Equations, 40-minute lesson"

Step 1: Extract query parameters
  → grade_level: grade_9
  → subject: mathematics
  → topic: simultaneous equations
  → curriculum_type: ecz (from teacher's account config)
  → duration_minutes: 40

Step 2: Embed the query
  → query_vector = embed("Grade 9 Mathematics simultaneous equations ECZ Zambia")

Step 3: Vector similarity search
  → SELECT chunk_text, source_name, metadata
     FROM knowledge_base
     WHERE curriculum_type = 'ecz'
       AND grade_level = 'grade_9'
       AND subject = 'mathematics'
     ORDER BY embedding <=> query_vector
     LIMIT 6
  → Returns: 6 most relevant curriculum chunks about simultaneous equations

Step 4: Build context
  → Combine retrieved chunks into a context block
  → Include teacher preferences (if any saved preferences exist)

Step 5: Generate lesson plan
  → Pass context + request to Claude
  → Claude generates structured lesson plan

Step 6: Save and display
  → Save to lesson_plans table
  → Display with source citations
```

### Vector Search Implementation

```typescript
async function retrieveRelevantChunks(
  queryText: string,
  curriculumType: string,
  gradeLevel: string,
  subject: string,
  limit: number = 6
): Promise<KnowledgeChunk[]> {

  // Embed the query
  const queryEmbedding = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: queryText,
  })

  // Supabase pgvector similarity search
  const { data } = await supabaseAdmin.rpc('match_knowledge_chunks', {
    query_embedding: queryEmbedding.data[0].embedding,
    curriculum_filter: curriculumType,
    grade_filter: gradeLevel,
    subject_filter: subject,
    match_count: limit,
    similarity_threshold: 0.70,  // Minimum cosine similarity
  })

  return data
}

// Postgres function (created in migration):
// CREATE OR REPLACE FUNCTION match_knowledge_chunks(
//   query_embedding vector(1536),
//   curriculum_filter text,
//   grade_filter text,
//   subject_filter text,
//   match_count int,
//   similarity_threshold float
// )
// RETURNS TABLE (chunk_text text, source_name text, similarity float)
// LANGUAGE plpgsql AS $$
// BEGIN
//   RETURN QUERY
//   SELECT kb.chunk_text, kb.source_name,
//          1 - (kb.embedding <=> query_embedding) as similarity
//   FROM knowledge_base kb
//   WHERE kb.curriculum_type = curriculum_filter
//     AND (grade_filter IS NULL OR kb.grade_level = grade_filter)
//     AND (subject_filter IS NULL OR kb.subject = subject_filter)
//     AND 1 - (kb.embedding <=> query_embedding) > similarity_threshold
//   ORDER BY kb.embedding <=> query_embedding
//   LIMIT match_count;
// END;
// $$;
```

---

## Lesson Plan Output Format

Claude generates lesson plans as structured JSON stored in `lesson_plans.content`:

```typescript
interface LessonPlanContent {
  learning_objectives: string[]
  // Aligned to ECZ/Cambridge syllabus objectives from knowledge base

  prerequisites: string[]
  // What students should already know

  materials: string[]
  // Resources, textbooks, equipment needed

  outline: LessonSection[]
  // Structured lesson flow

  formative_assessment: AssessmentQuestion[]
  // 3-5 questions to check understanding during the lesson

  homework: {
    description: string
    questions: string[]
    estimated_duration_minutes: number
  }

  differentiation: {
    for_advanced_students: string
    for_struggling_students: string
  }

  teacher_notes: string
  // Practical tips, common misconceptions, suggested explanations

  curriculum_references: string[]
  // Which syllabus objectives this lesson covers (from knowledge base)

  knowledge_sources_used: string[]
  // Which knowledge base documents were retrieved — shown to teacher for transparency
}

interface LessonSection {
  phase: 'introduction' | 'development' | 'activity' | 'conclusion'
  duration_minutes: number
  title: string
  teacher_actions: string
  student_activities: string
  resources: string[]
}
```

---

## Lesson Plan Request Form

**For school-linked teachers:**
```
New Lesson Plan
━━━━━━━━━━━━━━

Subject:          [Mathematics ▼]  (pre-filled from class assignment)
Grade Level:      [Grade 9 ▼]      (pre-filled from class assignment)
Curriculum:       [ECZ ▼]          (from school config)
Topic:            [text field — e.g. "Simultaneous Equations"]

Duration:         [40] minutes
Lesson Type:      ○ Introduction  ● Core lesson  ○ Revision  ○ Assessment prep

Additional context (optional):
[Students have already covered linear equations. Some struggle with fractions.]

[Generate Lesson Plan →]
```

**For standalone teachers:**
```
New Lesson Plan
━━━━━━━━━━━━━━

Curriculum:   [ECZ ▼]  /  [Cambridge IGCSE ▼]
Subject:      [Mathematics ▼]
Grade/Level:  [Grade 9 ▼]
Topic:        [Simultaneous Equations]
Duration:     [40] minutes
Lesson Type:  ○ Introduction  ● Core lesson  ○ Revision  ○ Assessment prep

[Generate Lesson Plan →]
```

---

## Standalone Teacher B2C Product

### Account Type: `platform:teacher`

Individual teachers create accounts independent of any school. They are not `org:teacher` (which requires a Clerk organisation/school) — they are a new platform-level account type.

**Subscription pricing:**
- Free trial: 5 lesson plans (no time limit — enough to evaluate the product)
- Monthly: K300/month
- Annual: K3,000/year (K250/month — 17% saving)
- Bundle (lesson planner + quiz generator + homework creator): K400/month

**What standalone teachers can do:**
- Generate unlimited lesson plans within subscription
- Generate quizzes and assessments (separate prompt flow using same RAG pipeline)
- Generate homework assignments
- Save, organise, and tag all generated content
- Export lesson plans as PDF or Word document
- Share selected plans publicly (optional — builds a teacher community)

**What standalone teachers cannot do:**
- Access any school's ZSMS data
- Enter marks or attendance
- View fee records
- Access any feature requiring school affiliation

### Lead Generation Flywheel

```
Individual teacher signs up for standalone lesson planner
         ↓
Uses and loves the product
         ↓
Recommends ZSMS to their school principal
         ↓
School registers for ZSMS trial
         ↓
Teacher's standalone account optionally linked to school account
(lesson plans carry over — no data loss on linking)
```

---

## Quiz and Assessment Generator

Built on the same RAG pipeline as the lesson planner. Teacher selects:
- Subject, grade, topic
- Assessment type: Quiz / Test / Exam practice / Homework
- Number of questions
- Difficulty: Standard / Mixed / Exam-style

Claude generates:
- Multiple choice questions with answer key
- Short answer questions with marking guidelines
- Extended response questions with mark scheme
- Matching exercises and fill-in-the-blank (for appropriate topics)

Output is editable before saving — teacher can remove questions, adjust marks, or modify wording before distributing to students.

---

## Knowledge Base Maintenance

The knowledge base is maintained by the AfriTech content team — not by schools or teachers.

**Update triggers:**
- ECZ releases a revised syllabus (typically every 5-7 years)
- Cambridge updates IGCSE or A-Level specifications
- New textbooks are adopted by Zambian schools
- MESVTEE releases curriculum framework updates
- AfriTech expands to a new country (new country's curriculum content added)

**Update process:**
1. Content team collects new/revised documents
2. Run the chunking pipeline on new documents
3. Generate embeddings and insert into knowledge_base
4. Mark superseded chunks with `is_active = FALSE` (soft delete — never hard delete curriculum content)
5. Test sample queries to verify retrieval quality improved

**Country expansion:**
When ZSMS launches in a new country (e.g. Zimbabwe), the knowledge base gains new content: Zimbabwe's ZIMSEC curriculum, Zimbabwe textbooks, Zimbabwe exam syllabuses. Country-specific content is filtered at query time using `country_code`.

---

## Explainability — Why This Matters for Schools

Schools will not trust AI-generated lesson plans if they cannot verify the output is curriculum-aligned. Every generated lesson plan includes:

```
Curriculum Alignment
━━━━━━━━━━━━━━━━━━━
This lesson plan was generated using:
  ✓ ECZ Mathematics Grade 9 Syllabus 2023 — Topic 7.3: Simultaneous Equations
  ✓ Golden Opportunities Mathematics Grade 9 — Chapter 12
  ✓ ECZ 2022 Grade 9 Examination Paper — Question 4 (simultaneous equations)

The following ECZ learning objectives are addressed:
  • Solve a pair of simultaneous linear equations algebraically
  • Solve a pair of simultaneous equations using graphical methods
  • Apply simultaneous equations to solve word problems
```

This transparency builds teacher trust and provides a quality signal — if a generated plan cites irrelevant sources, the teacher knows the RAG retrieval needs improvement.

---

## Business Rules

1. The knowledge base is maintained exclusively by the AfriTech content team. No school or teacher uploads to it.
2. Lesson plans are saved to the teacher's account, not the school's database — standalone teachers own their generated content regardless of whether they later link to a school.
3. The similarity_threshold of 0.70 is the minimum for production. If retrieval quality is poor for a topic, AfriTech adds more content to the knowledge base for that topic — not lowering the threshold.
4. Every generated lesson plan stores `knowledge_sources_used` — which chunks were retrieved. This enables AfriTech to audit which knowledge base content is most used and prioritise expansion.
5. The free trial is 5 lesson plans with no time limit. This gives teachers enough time to evaluate the product properly without pressure.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-10-05 | **Extraction takes a set of subjects and a range of grades** | It was one subject and one grade per pass, so an ECZ syllabus covering "Mathematics, Grades 8 to 9" meant running the same PDF once per grade — and a school usually has exactly one copy of it. `curriculumExtractionPrompt()` now takes `subjects[]` and `grades[]`, and every extracted topic carries its OWN `subject` and `grade_level`. Per topic rather than per extraction, because `curriculum_topics` is unique on (country, curriculum, subject, grade_level, topic_code): tagging the extraction as a whole would collapse every grade onto one and silently overwrite as it went. The route DROPS any row the model tagged outside the requested sets and reports the count — the prompt forbids it, but a model ignoring that instruction would otherwise put a row nobody asked for into a review table an operator is likely to approve wholesale, and the result is a fabricated syllabus citation presented to a teacher as national curriculum. Capped at 24 combinations per pass: a larger request extracts worse and costs more. The picker is now a popup — multi-select subjects with free text for anything unlisted, and a from/to grade range that can be applied twice so a school spanning the 2023 reform can combine Grades 8-9 with Form 1. Each reviewed row shows its own subject and grade, because a misfiled topic looks perfectly correct in a review table whereas a missing one is visible. |
| 2026-09-29 | **Syllabus ingestion by document upload, with a verification step** | Hand-writing JSON was the only way in. Now: choose curriculum, subject and grade, upload a PDF or .docx, and the model proposes topic rows that a person checks and corrects before anything is written. The pattern is AI_CAPTURE.md's — extract, verify, then write — for the same reason: a misread topic code does not look misread. Codes the document did not supply are marked as inferred, because an invented code must never be shown to a teacher as a syllabus reference. Not metered against AI credits: an AfriTech admin has no wallet, and curriculum ingestion is platform work rather than a customer action. |
| 2026-04-26 | Initial complete draft | AI module — Phase 3 feature with B2C product |
| 2026-04-26 | RAG pipeline with pgvector | Knowledge base is the moat — generic LLM not sufficient |
| 2026-04-26 | Standalone teacher account type confirmed | B2C lesson planner as independent revenue stream |
| 2026-04-26 | Explainability via knowledge source citations | Teacher trust requires curriculum alignment transparency |
