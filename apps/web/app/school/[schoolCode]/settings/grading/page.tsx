'use client'

/**
 * Settings → Grading scales.
 *
 * Spec: `11 Examinations and Results/GRADING.md`, ADR-041
 *
 * ## Why this screen exists
 *
 * `revise_grading_scale()` has existed since `0141` with the whole versioning
 * apparatus behind it and a 20-assertion pgTAP suite, and **nothing called it**. A
 * school could not change its own grade boundaries through any surface. `npm run gaps`
 * listed it as unreachable, which is the most expensive failure shape here: work that is
 * finished, correct and unusable.
 *
 * ## A revision is a new version, and the screen says so
 *
 * Saving does not rewrite history. Results already graded keep the version that graded
 * them, which is what lets a grade from last term still be explained after a boundary
 * change. A school changing a boundary needs to understand that, or they will expect old
 * report cards to change and be confused when they do not.
 */

import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { GraduationCap, Plus, Save, Trash2 } from 'lucide-react'

import { Alert } from '../../../../../components/ui/alert'
import { Badge } from '../../../../../components/ui/badge'
import { Button } from '../../../../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../../../components/ui/card'
import { ErrorState, PageHeader, TableSkeleton } from '../../../../../components/ui/data-states'
import { Input } from '../../../../../components/ui/field'
import { useToast } from '../../../../../components/ui/toast'

interface Band {
  letter: string
  min: number
  max: number
  points?: number
  descriptor?: string
}

interface Version {
  id: string
  number: number
  reason: string | null
  effectiveFrom: string | null
  supersededAt: string | null
  isCurrent: boolean
}

interface Scale {
  id: string
  name: string
  type: string
  bands: Band[]
  passMark: number | null
  creditMark: number | null
  appliesToLevels: string[]
  isActive: boolean
  versions: Version[]
}

export default function GradingPage(): JSX.Element {
  const { toast } = useToast()
  const [scales, setScales] = useState<Scale[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Band[]>([])
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/school/grading')
      const body = await response.json()
      if (!response.ok) {
        setError(body.error ?? 'Could not load grading scales.')
        return
      }
      setScales(body.data?.scales ?? [])
      setHistoryLoaded(body.data?.historyLoaded ?? true)
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

  if (loading) return <TableSkeleton rows={6} columns={4} />
  if (error) return <ErrorState message={error} onRetry={() => void load()} />

  function startEdit(scale: Scale): void {
    setEditing(scale.id)
    // A copy, so cancelling leaves the live scale untouched.
    setDraft(scale.bands.map((b) => ({ ...b })))
    setReason('')
  }

  function setBand(i: number, patch: Partial<Band>): void {
    setDraft((d) => d.map((b, j) => (j === i ? { ...b, ...patch } : b)))
  }

  async function save(scaleId: string): Promise<void> {
    setSaving(true)
    try {
      const response = await fetch('/api/school/grading', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scaleId, bands: draft, reason }),
      })
      const body = await response.json()
      toast(body.data?.message ?? body.error ?? 'Saved.', response.ok ? 'success' : 'danger')
      if (response.ok) {
        setEditing(null)
        await load()
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Grading scales"
        description="The grade boundaries this school marks against."
      />

      {/*
        Stated before anybody edits anything. A head teacher changing a boundary will
        otherwise expect last term's report cards to change, and be confused when they
        do not — which is the behaviour ADR-041 exists to guarantee.
      */}
      <Alert className="mb-cards">
        Changing boundaries saves a <strong>new version</strong>. Results already graded
        keep the version that graded them, so last term&rsquo;s grades still mean what
        they meant. Only marks entered from now on use the new boundaries.
      </Alert>

      {!historyLoaded && (
        <Alert variant="warning" className="mb-cards">
          Revision history could not be loaded. The scales below are current and safe to
          edit.
        </Alert>
      )}

      {scales.length === 0 && (
        <Card>
          <CardContent className="p-card">
            <p className="text-sm text-muted-foreground">
              No grading scales are configured. Add one from Settings → Academic
              structure before entering marks — without a scale, marks save but no grade
              can be worked out.
            </p>
          </CardContent>
        </Card>
      )}

      {scales.map((scale) => (
        <Card key={scale.id} className="mb-cards">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <GraduationCap className="h-4 w-4" />
              {scale.name}
              <Badge variant="neutral">{scale.type}</Badge>
              {!scale.isActive && <Badge variant="warning">Not in use</Badge>}
            </CardTitle>
            <CardDescription>
              {scale.appliesToLevels.length > 0
                ? `Applies to ${scale.appliesToLevels.join(', ')}`
                : 'Applies to every level'}
              {scale.passMark !== null && ` · pass at ${scale.passMark}%`}
              {scale.versions.length > 0 &&
                ` · version ${scale.versions.find((v) => v.isCurrent)?.number ?? scale.versions[0]!.number}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {editing === scale.id ? (
              <>
                <div className="space-y-2">
                  {draft.map((b, i) => (
                    <div key={i} className="flex flex-wrap items-end gap-2">
                      <label className="block">
                        <span className="text-xs font-medium">Grade</span>
                        <Input
                          value={b.letter}
                          onChange={(e) => setBand(i, { letter: e.target.value })}
                          className="mt-1 w-16 text-center"
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs font-medium">From %</span>
                        <Input
                          value={String(b.min)}
                          onChange={(e) => setBand(i, { min: Number(e.target.value) || 0 })}
                          inputMode="numeric"
                          className="mt-1 w-20 text-center"
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs font-medium">To %</span>
                        <Input
                          value={String(b.max)}
                          onChange={(e) => setBand(i, { max: Number(e.target.value) || 0 })}
                          inputMode="numeric"
                          className="mt-1 w-20 text-center"
                        />
                      </label>
                      <label className="block flex-1 min-w-[10rem]">
                        <span className="text-xs font-medium">Descriptor</span>
                        <Input
                          value={b.descriptor ?? ''}
                          onChange={(e) => setBand(i, { descriptor: e.target.value })}
                          placeholder="Distinction"
                          className="mt-1"
                        />
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}
                        disabled={draft.length <= 2}
                        title={draft.length <= 2 ? 'A scale needs at least two grades' : 'Remove'}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-stack"
                  onClick={() => setDraft((d) => [...d, { letter: '', min: 0, max: 0 }])}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add a grade
                </Button>

                <label className="mt-stack block">
                  <span className="text-sm font-medium">
                    Why is this changing? <span className="text-destructive">*</span>
                  </span>
                  <Input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Aligned with the 2027 ECZ boundaries"
                    className="mt-1"
                  />
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Stored with the version, so somebody reading an old grade can see
                    what changed and when.
                  </span>
                </label>

                <div className="mt-stack flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={() => void save(scale.id)}
                    disabled={saving || reason.trim().length < 3}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {saving ? 'Saving…' : 'Save as a new version'}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {scale.bands.map((b) => (
                    <span
                      key={b.letter}
                      className="rounded-md border border-border px-2 py-1 text-sm"
                    >
                      <strong>{b.letter}</strong>{' '}
                      <span data-numeric className="text-muted-foreground">
                        {b.min}–{b.max}%
                      </span>
                      {b.descriptor ? (
                        <span className="block text-xs text-muted-foreground">
                          {b.descriptor}
                        </span>
                      ) : null}
                    </span>
                  ))}
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-stack"
                  onClick={() => startEdit(scale)}
                >
                  Revise boundaries
                </Button>

                {scale.versions.length > 1 && (
                  <div className="mt-stack border-t border-border pt-stack">
                    <h3 className="text-sm font-medium">Revision history</h3>
                    <ul className="mt-2 space-y-1">
                      {scale.versions.map((v) => (
                        <li key={v.id} className="text-xs text-muted-foreground">
                          <span data-numeric>v{v.number}</span>
                          {v.isCurrent ? ' · current' : ''}
                          {v.reason ? ` — ${v.reason}` : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
