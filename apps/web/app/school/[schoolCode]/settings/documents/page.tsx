'use client'

/**
 * Settings → Report cards &amp; documents.
 *
 * Spec: `13 Document and PDF System/CUSTOMISATION.md` steps 2–6,
 *       `13 Document and PDF System/TEMPLATE_SYSTEM.md`
 *
 * ## What was unreachable before this
 *
 * `school_branding.anchor_color` and `.primary_color` have existed since `0092`, each
 * with a `wcag_contrast_ratio()` CHECK — so a school physically cannot set a brand
 * colour that fails contrast on a report card a parent has to read. Nothing could set
 * them. And CUSTOMISATION steps 3–6 had no table at all until `0258`.
 *
 * ## The principal's comment saves on its own
 *
 * It is written every term; the switches are set once a year. A single Save would mean
 * resending the whole config to add a paragraph, which is how a switch gets clobbered —
 * so the comment has its own button and its own request.
 *
 * ## The logo is not here
 *
 * It lives on the school profile screen, and `worker_school_branding()` reads
 * `COALESCE(branding.logo_url, schools.logo_url)`, so that one already reaches every
 * PDF. A second editor for the same picture would be two copies of one decision.
 */

import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { FileText, Palette, Save } from 'lucide-react'
import Link from 'next/link'

import { Alert } from '../../../../../components/ui/alert'
import { Badge } from '../../../../../components/ui/badge'
import { Button } from '../../../../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../../../components/ui/card'
import { CheckboxField } from '../../../../../components/ui/form'
import { ErrorState, PageHeader, TableSkeleton } from '../../../../../components/ui/data-states'
import { Input, Select } from '../../../../../components/ui/field'
import { useToast } from '../../../../../components/ui/toast'

const VARIANTS = [
  { key: 'classic', label: 'Classic — one page, marks in a table' },
  { key: 'modern', label: 'Modern — wider spacing, colour accents' },
  { key: 'compact', label: 'Compact — fits more subjects on a page' },
  { key: 'detailed', label: 'Detailed — adds per-subject comments' },
]

interface Content {
  showPosition: boolean
  showClassAverage: boolean
  showAttendance: boolean
  showComments: boolean
  acknowledgementRequired: boolean
}

interface Payload {
  level: string
  layoutVariant: string | null
  isConfigured: boolean
  canUseLayouts: boolean
  content: Content
  principalComments: Record<string, string>
  branding: {
    anchorColor: string | null
    primaryColor: string | null
    logoUrl: string | null
  } | null
}

export default function DocumentsPage(): JSX.Element {
  const { toast } = useToast()
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingComment, setSavingComment] = useState(false)

  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [term, setTerm] = useState(1)
  const [comment, setComment] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/school/documents/template')
      const body = await response.json()
      if (!response.ok) {
        setError(body.error ?? 'Could not load document settings.')
        return
      }
      setData(body.data)
      setError(null)
    } catch {
      setError('Could not reach the server.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Load the stored comment for whichever term is selected, so switching term shows
  // what is actually on those cards rather than an empty box.
  useEffect(() => {
    if (!data) return
    setComment(data.principalComments[`${year}-${term}`] ?? '')
  }, [data, year, term])

  if (loading) return <TableSkeleton rows={8} columns={2} />
  if (error || !data) return <ErrorState message={error ?? 'Not available.'} onRetry={() => void load()} />

  const d = data
  function setContent(patch: Partial<Content>): void {
    setData((p) => (p ? { ...p, content: { ...p.content, ...patch } } : p))
  }

  async function save(): Promise<void> {
    setSaving(true)
    try {
      const response = await fetch('/api/school/documents/template', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: d.content,
          layoutVariant: d.layoutVariant,
          anchorColor: d.branding?.anchorColor ?? '',
          primaryColor: d.branding?.primaryColor ?? '',
        }),
      })
      const body = await response.json()
      toast(body.data?.message ?? body.error ?? 'Saved.', response.ok ? 'success' : 'danger')
      if (response.ok) await load()
    } finally {
      setSaving(false)
    }
  }

  async function saveComment(): Promise<void> {
    setSavingComment(true)
    try {
      const response = await fetch('/api/school/documents/template', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ academicYear: year, termNumber: term, comment }),
      })
      const body = await response.json()
      toast(body.data?.message ?? body.error ?? 'Saved.', response.ok ? 'success' : 'danger')
      if (response.ok) await load()
    } finally {
      setSavingComment(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Report cards & documents"
        description="How your school's documents look, and what they say."
      />

      <Alert className="mb-cards">
        These settings apply to report cards generated <strong>from now on</strong>.
        Cards already produced keep the settings they were made with.
      </Alert>

      <Card className="mb-cards">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-4 w-4" />
            Colours
          </CardTitle>
          <CardDescription>
            Used on report cards, receipts and the portal header. ZSMS refuses a colour
            too pale to read — a report card has to be legible to a parent before it is
            on-brand.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-stack">
            <label className="block">
              <span className="text-sm font-medium">Main colour</span>
              <span className="mt-1 flex items-center gap-2">
                <Input
                  value={d.branding?.anchorColor ?? ''}
                  onChange={(e) =>
                    setData((p) =>
                      p
                        ? {
                            ...p,
                            branding: {
                              anchorColor: e.target.value,
                              primaryColor: p.branding?.primaryColor ?? null,
                              logoUrl: p.branding?.logoUrl ?? null,
                            },
                          }
                        : p,
                    )
                  }
                  placeholder="#1D4ED8"
                  className="w-32"
                />
                {/*
                  A swatch, because a hex code is not a colour to most people. Inline
                  style is the one honest exception to the tokens rule here: the value
                  is the school's own, not a design decision.
                */}
                {d.branding?.anchorColor && /^#[0-9A-Fa-f]{6}$/.test(d.branding.anchorColor) && (
                  <span
                    aria-hidden
                    className="inline-block h-8 w-8 rounded-md border border-border"
                    style={{ backgroundColor: d.branding.anchorColor }}
                  />
                )}
              </span>
            </label>
          </div>

          <p className="mt-stack text-xs text-muted-foreground">
            Your logo is set on the{' '}
            <Link href="../" className="underline">
              school profile
            </Link>{' '}
            — it is the same picture everywhere, so it lives in one place.
          </p>
        </CardContent>
      </Card>

      <Card className="mb-cards">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            What the report card shows
          </CardTitle>
          <CardDescription>
            Turning something off removes it from the card; it does not stop ZSMS
            recording it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-stack">
            <CheckboxField
              id="show-position"
              label="Position in class"
              hint="Some schools consider ranking children unhelpful"
              checked={d.content.showPosition}
              onChange={(v) => setContent({ showPosition: v })}
            />
            <CheckboxField
              id="show-average"
              label="Class average beside each mark"
              checked={d.content.showClassAverage}
              onChange={(v) => setContent({ showClassAverage: v })}
            />
            <CheckboxField
              id="show-attendance"
              label="Attendance summary"
              checked={d.content.showAttendance}
              onChange={(v) => setContent({ showAttendance: v })}
            />
            <CheckboxField
              id="show-comments"
              label="Teacher comments"
              checked={d.content.showComments}
              onChange={(v) => setContent({ showComments: v })}
            />
            <CheckboxField
              id="ack"
              label="Parent acknowledgement slip"
              hint="A tear-off section for a parent to sign and return"
              checked={d.content.acknowledgementRequired}
              onChange={(v) => setContent({ acknowledgementRequired: v })}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="mb-cards">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Layout
            {!d.canUseLayouts && <Badge variant="warning">Growth tier</Badge>}
          </CardTitle>
          <CardDescription>
            {d.canUseLayouts
              ? 'Pick the shape that suits your subjects.'
              : 'Your plan uses the standard layout. Layout variants are included from the Growth tier.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            value={d.layoutVariant ?? ''}
            onChange={(e) =>
              setData((p) => (p ? { ...p, layoutVariant: e.target.value || null } : p))
            }
            disabled={!d.canUseLayouts}
          >
            <option value="">Standard layout</option>
            {VARIANTS.map((v) => (
              <option key={v.key} value={v.key}>
                {v.label}
              </option>
            ))}
          </Select>
        </CardContent>
      </Card>

      <Button className="mb-cards" onClick={() => void save()} disabled={saving}>
        <Save className="mr-2 h-4 w-4" />
        {saving ? 'Saving…' : 'Save these settings'}
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>Principal&rsquo;s comment</CardTitle>
          <CardDescription>
            One paragraph that appears on every report card for the term you choose.
            Saved on its own, so writing this term&rsquo;s comment cannot disturb the
            settings above.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-stack">
            <label className="block">
              <span className="text-sm font-medium">Year</span>
              <Input
                value={year}
                onChange={(e) => setYear(e.target.value)}
                inputMode="numeric"
                className="mt-1 w-24"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Term</span>
              <Select
                value={String(term)}
                onChange={(e) => setTerm(Number(e.target.value))}
                className="mt-1 w-28"
              >
                <option value="1">Term 1</option>
                <option value="2">Term 2</option>
                <option value="3">Term 3</option>
              </Select>
            </label>
          </div>

          <label className="mt-stack block">
            <span className="text-sm font-medium">Comment</span>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="The school is proud of the effort shown this term…"
              className="mt-1 min-h-tap w-full rounded-md border border-border bg-surface p-2 text-sm"
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              {/*
                Said plainly: each term is stored separately, so last term's words
                cannot print on this term's cards. That is the behaviour `0258` keys
                by year and term to guarantee.
              */}
              Each term is kept separately. Clearing this box removes the comment from
              that term&rsquo;s cards.
            </span>
          </label>

          <Button
            className="mt-stack"
            variant="outline"
            onClick={() => void saveComment()}
            disabled={savingComment}
          >
            {savingComment ? 'Saving…' : `Save the term ${term} comment`}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
