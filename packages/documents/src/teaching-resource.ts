/**
 * A teaching resource as a document — PDF and Word from one content model.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *
 * ## One generation, many renderings
 *
 * Both functions here read the same `TeachingResourceDocument`, which is what
 * `teaching_resources.content` already holds. Adding PowerPoint later is a third function over the
 * same shape — not another model call, another prompt, or another credit price. That is the whole
 * reason the generator was built to fill a schema rather than to write prose.
 *
 * ## Exporting costs nothing, and that is a decision
 *
 * Rendering consumes no model tokens, so there is nothing to recover. A teacher who took the PDF
 * and now wants Word has already paid for the content; charging again for the same words reads as
 * a trick and discourages the suite this is meant to encourage.
 *
 * ## Diagrams are carried as source, not pictures
 *
 * `content.diagrams[].source` is Mermaid or SVG the model emitted. Turning Mermaid into an image
 * needs a browser — Mermaid's renderer is a browser library — and running headless Chrome inside
 * an API route to draw one flowchart is a disproportionate dependency.
 *
 * So the export prints the diagram's title and caption, then its source in a monospace block. That
 * is honest and usable: a teacher can paste it into any Mermaid viewer, and the text says so. The
 * alternative — dropping diagrams silently — would leave a teacher wondering where the picture
 * went. Drawing them properly is a follow-up that belongs on the client, where Mermaid already runs.
 */

import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx'

import {
  A4,
  MARGIN,
  MUTED,
  bullets,
  finish,
  move,
  newDocument,
  paragraph,
  rule,
  text,
} from './pdf'
import type { RenderedDocument } from './types'

export interface TeachingResourceDocument {
  title: string
  resourceKind: string
  subject: string
  gradeLevel: string
  topic: string
  curriculumType: string
  durationMinutes: number | null
  lessonType: string | null
  teacherNotes: string | null
  /** Whose plan it is. A school name appears only when the resource was made in a school context. */
  schoolName: string | null
  generatedBy: string
  createdAt: string
  content: {
    summary?: string
    objectives?: string[]
    priorKnowledge?: string
    materials?: string[]
    outline?: Array<{
      phase: string
      minutes: number
      teacherActivity: string
      pupilActivity: string
    }>
    assessment?: { formative: string; questions: string[] }
    homework?: string
    differentiation?: { support: string; extension: string }
    reflectionPrompts?: string[]
    questions?: Array<{
      number: number
      type: string
      prompt: string
      options?: string[]
      marks: number
      answer: string
      markingNotes?: string
    }>
    totalMarks?: number
    instructions?: string
    diagrams?: Array<{ title: string; kind: string; source: string; caption: string }>
    charts?: Array<{
      title: string
      kind: string
      labels: string[]
      series: Array<{ name: string; values: number[] }>
    }>
    citations?: Array<{ source: string; reference: string }>
  }
}

/** `Grade 9 Mathematics — Simultaneous Equations.pdf`, safe on every filesystem. */
function filename(doc: TeachingResourceDocument, extension: string): string {
  const base = `${doc.gradeLevel} ${doc.subject} - ${doc.topic}`
    // Windows refuses these outright, and a colon in a filename silently truncates on macOS.
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return `${base}.${extension}`
}

const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

const KIND_LABEL: Record<string, string> = {
  lesson_plan: 'Lesson plan',
  quiz: 'Quiz',
  homework: 'Homework',
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------
export async function renderTeachingResourcePdf(
  data: TeachingResourceDocument,
): Promise<RenderedDocument> {
  const doc = await newDocument()
  const c = data.content
  const width = A4.width - MARGIN * 2

  text(doc, KIND_LABEL[data.resourceKind] ?? data.resourceKind, { size: 9, color: MUTED })
  move(doc, 16)
  paragraph(doc, data.title, { size: 18, bold: true, width })
  move(doc, 4)

  const meta = [
    data.subject,
    data.gradeLevel,
    data.curriculumType.toUpperCase(),
    data.durationMinutes ? `${data.durationMinutes} minutes` : null,
    data.schoolName,
  ]
    .filter(Boolean)
    .join('  ·  ')
  paragraph(doc, meta, { size: 9, color: MUTED, width })
  rule(doc, 10)

  if (c.summary) {
    paragraph(doc, c.summary, { size: 10, width })
    move(doc, 10)
  }

  const section = (heading: string): void => {
    move(doc, 8)
    paragraph(doc, heading, { size: 12, bold: true, width })
    move(doc, 4)
  }

  if (c.objectives?.length) {
    section('Learning objectives')
    bullets(doc, c.objectives, { width })
  }

  if (c.priorKnowledge) {
    section('Prior knowledge')
    paragraph(doc, c.priorKnowledge, { width })
  }

  if (c.materials?.length) {
    section('Materials')
    bullets(doc, c.materials, { width })
  }

  if (c.outline?.length) {
    // The total is printed because it is the claim the plan makes about itself, and a head of
    // department checks it first.
    const total = c.outline.reduce((sum, p) => sum + p.minutes, 0)
    section(`Lesson outline  (${total} minutes)`)
    for (const phase of c.outline) {
      paragraph(doc, `${phase.phase} — ${phase.minutes} min`, { size: 10, bold: true, width })
      paragraph(doc, `Teacher: ${phase.teacherActivity}`, { size: 9.5, x: MARGIN + 12, width: width - 12 })
      paragraph(doc, `Pupils: ${phase.pupilActivity}`, { size: 9.5, x: MARGIN + 12, width: width - 12 })
      move(doc, 6)
    }
  }

  if (c.instructions) {
    section('Instructions')
    paragraph(doc, c.instructions, { width })
  }

  if (c.questions?.length) {
    section(c.totalMarks ? `Questions  (${c.totalMarks} marks)` : 'Questions')
    for (const q of c.questions) {
      paragraph(doc, `${q.number}. ${q.prompt}`, { size: 10, width })
      if (q.options?.length) {
        bullets(doc, q.options, { x: MARGIN + 12, width: width - 12 })
      }
      /**
       * The answer key sits with the question rather than on a separate page. This is the
       * teacher's copy — the pupil-facing version is a separate concern and not built — so
       * labelling it clearly beats hiding it somewhere a teacher then has to find.
       */
      paragraph(
        doc,
        `Answer (${q.marks} mark${q.marks === 1 ? '' : 's'}): ${q.answer}`
          + (q.markingNotes ? `  —  ${q.markingNotes}` : ''),
        { size: 9, color: MUTED, x: MARGIN + 12, width: width - 12 },
      )
      move(doc, 6)
    }
  }

  if (c.assessment) {
    section('Assessment')
    paragraph(doc, c.assessment.formative, { width })
    if (c.assessment.questions.length) {
      move(doc, 4)
      bullets(doc, c.assessment.questions, { width })
    }
  }

  if (c.homework) {
    section('Homework')
    paragraph(doc, c.homework, { width })
  }

  if (c.differentiation) {
    section('Differentiation')
    paragraph(doc, `Support: ${c.differentiation.support}`, { width })
    move(doc, 4)
    paragraph(doc, `Extension: ${c.differentiation.extension}`, { width })
  }

  if (c.diagrams?.length) {
    section('Diagrams')
    for (const d of c.diagrams) {
      paragraph(doc, d.title, { size: 10, bold: true, width })
      if (d.caption) paragraph(doc, d.caption, { size: 9, color: MUTED, width })
      move(doc, 2)
      // Source rather than a picture — see the file header for why.
      paragraph(doc, d.source, { size: 8, color: MUTED, x: MARGIN + 12, width: width - 12 })
      move(doc, 4)
      paragraph(doc, `(${d.kind} source — paste into a ${d.kind} viewer to draw it)`, {
        size: 8,
        color: MUTED,
        x: MARGIN + 12,
        width: width - 12,
      })
      move(doc, 8)
    }
  }

  if (c.charts?.length) {
    section('Charts')
    for (const chart of c.charts) {
      paragraph(doc, `${chart.title} (${chart.kind})`, { size: 10, bold: true, width })
      // The numbers, which are the part a teacher can actually use on a chalkboard.
      for (const s of chart.series) {
        const pairs = chart.labels.map((l, i) => `${l}: ${s.values[i] ?? '—'}`).join(',  ')
        paragraph(doc, `${s.name} — ${pairs}`, { size: 9, x: MARGIN + 12, width: width - 12 })
      }
      move(doc, 6)
    }
  }

  if (c.citations?.length) {
    section('Curriculum references')
    bullets(doc, c.citations.map((r) => `${r.reference} — ${r.source}`), { width })
  }

  if (c.reflectionPrompts?.length) {
    section('After the lesson')
    bullets(doc, c.reflectionPrompts, { width })
  }

  if (data.teacherNotes) {
    section('Your notes')
    paragraph(doc, data.teacherNotes, { width })
  }

  return finish(
    doc,
    filename(data, 'pdf'),
  )
}

// ---------------------------------------------------------------------------
// Word
// ---------------------------------------------------------------------------
export async function renderTeachingResourceDocx(
  data: TeachingResourceDocument,
): Promise<RenderedDocument> {
  const c = data.content
  const children: Paragraph[] = []

  const heading = (t: string): void => {
    children.push(new Paragraph({ text: t, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } }))
  }
  const body = (t: string, opts: { italic?: boolean; indent?: boolean; small?: boolean } = {}): void => {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: t, italics: opts.italic, size: opts.small ? 18 : 22 })],
        indent: opts.indent ? { left: 360 } : undefined,
        spacing: { after: 80 },
      }),
    )
  }
  const bullet = (t: string): void => {
    children.push(new Paragraph({ text: t, bullet: { level: 0 }, spacing: { after: 60 } }))
  }

  children.push(
    new Paragraph({
      children: [new TextRun({ text: KIND_LABEL[data.resourceKind] ?? data.resourceKind, size: 18, color: '6B7280' })],
    }),
    new Paragraph({ text: data.title, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({
      children: [
        new TextRun({
          text: [
            data.subject,
            data.gradeLevel,
            data.curriculumType.toUpperCase(),
            data.durationMinutes ? `${data.durationMinutes} minutes` : null,
            data.schoolName,
          ].filter(Boolean).join('  ·  '),
          size: 18,
          color: '6B7280',
        }),
      ],
      spacing: { after: 240 },
    }),
  )

  if (c.summary) body(c.summary)

  if (c.objectives?.length) {
    heading('Learning objectives')
    c.objectives.forEach(bullet)
  }

  if (c.priorKnowledge) {
    heading('Prior knowledge')
    body(c.priorKnowledge)
  }

  if (c.materials?.length) {
    heading('Materials')
    c.materials.forEach(bullet)
  }

  if (c.outline?.length) {
    const total = c.outline.reduce((sum, p) => sum + p.minutes, 0)
    heading(`Lesson outline (${total} minutes)`)
    for (const phase of c.outline) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `${phase.phase} — ${phase.minutes} min`, bold: true, size: 22 })],
          spacing: { before: 120, after: 60 },
        }),
      )
      body(`Teacher: ${phase.teacherActivity}`, { indent: true })
      body(`Pupils: ${phase.pupilActivity}`, { indent: true })
    }
  }

  if (c.instructions) {
    heading('Instructions')
    body(c.instructions)
  }

  if (c.questions?.length) {
    heading(c.totalMarks ? `Questions (${c.totalMarks} marks)` : 'Questions')
    for (const q of c.questions) {
      body(`${q.number}. ${q.prompt}`)
      q.options?.forEach(bullet)
      body(
        `Answer (${q.marks} mark${q.marks === 1 ? '' : 's'}): ${q.answer}`
          + (q.markingNotes ? `  —  ${q.markingNotes}` : ''),
        { italic: true, indent: true, small: true },
      )
    }
  }

  if (c.assessment) {
    heading('Assessment')
    body(c.assessment.formative)
    c.assessment.questions.forEach(bullet)
  }

  if (c.homework) {
    heading('Homework')
    body(c.homework)
  }

  if (c.differentiation) {
    heading('Differentiation')
    body(`Support: ${c.differentiation.support}`)
    body(`Extension: ${c.differentiation.extension}`)
  }

  if (c.diagrams?.length) {
    heading('Diagrams')
    for (const d of c.diagrams) {
      body(d.title)
      if (d.caption) body(d.caption, { italic: true, small: true })
      // Monospace so the source stays readable as source, and a teacher can copy it out cleanly.
      children.push(
        new Paragraph({
          children: [new TextRun({ text: d.source, font: 'Consolas', size: 16 })],
          indent: { left: 360 },
          spacing: { after: 80 },
        }),
      )
      body(`(${d.kind} source — paste into a ${d.kind} viewer to draw it)`, {
        italic: true, indent: true, small: true,
      })
    }
  }

  if (c.charts?.length) {
    heading('Charts')
    for (const chart of c.charts) {
      body(`${chart.title} (${chart.kind})`)
      for (const s of chart.series) {
        body(
          `${s.name} — ${chart.labels.map((l, i) => `${l}: ${s.values[i] ?? '—'}`).join(',  ')}`,
          { indent: true, small: true },
        )
      }
    }
  }

  if (c.citations?.length) {
    heading('Curriculum references')
    c.citations.forEach((r) => bullet(`${r.reference} — ${r.source}`))
  }

  if (c.reflectionPrompts?.length) {
    heading('After the lesson')
    c.reflectionPrompts.forEach(bullet)
  }

  if (data.teacherNotes) {
    heading('Your notes')
    body(data.teacherNotes)
  }

  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Generated by ZSMS on ${shortDate(data.createdAt)} · ${data.generatedBy}`,
          size: 16,
          color: '9CA3AF',
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 400 },
    }),
  )

  const document = new Document({ sections: [{ children }] })
  // `toBuffer` rather than `toBlob`: this runs on the server, where Blob would then need
  // converting anyway.
  const buffer = await Packer.toBuffer(document)

  return {
    bytes: new Uint8Array(buffer),
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    suggestedFilename: filename(data, 'docx'),
  }
}
