'use client'

/**
 * Partner lenders.
 *
 * Spec: `Official Documentation/14 Loan and Finance Module/LENDER_INTEGRATION.md`
 *
 * ## The commercial detail lives here and nowhere else
 *
 * Commission rate, terms and the intake address are AfriTech's side of the relationship.
 * A parent choosing a lender reads `lenders_for_application()`, which returns the
 * description, the rate display and the turnaround — and never what AfriTech earns from
 * sending them there.
 *
 * API keys and webhook secrets are not returned by the route at all, so they cannot
 * appear on this page even by accident.
 *
 * ## Withdrawn, not deleted
 *
 * A lender with applications behind them must stop being offered while those
 * applications keep their meaning.
 */

import type { JSX } from 'react'
import { useCallback, useState } from 'react'
import { Building2, Plus } from 'lucide-react'

import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import { Dialog } from '../../../components/ui/dialog'
import { ErrorState, PageHeader, TableSkeleton } from '../../../components/ui/data-states'
import { EmptyState } from '../../../components/ui/empty-state'
import { Field, Input, Select, Textarea } from '../../../components/ui/field'
import { useToast } from '../../../components/ui/toast'
import { apiSend, useApi } from '../../../lib/use-api'

interface Lender {
  id: string
  lenderName: string
  displayName: string
  tagline: string | null
  description: string | null
  minAmount: number
  maxAmount: number
  minScore: number
  interestRate: string
  turnaround: string
  integrationType: string
  intakeEmail: string | null
  commissionRate: number
  commissionTerms: string | null
  collectionInstructions: string | null
  isActive: boolean
  isFeatured: boolean
}

function blank(): Lender {
  return {
    id: '',
    lenderName: '',
    displayName: '',
    tagline: null,
    description: null,
    minAmount: 500,
    maxAmount: 50000,
    // The documented default, on the 300-850 scale.
    minScore: 450,
    interestRate: '',
    turnaround: '',
    integrationType: 'email',
    intakeEmail: null,
    commissionRate: 0.025,
    commissionTerms: null,
    collectionInstructions: null,
    isActive: true,
    isFeatured: false,
  }
}

export default function AdminLendersPage(): JSX.Element {
  const { toast } = useToast()
  const { data, loading, error, code, reload } = useApi<{ lenders: Lender[] }>(
    '/api/admin/lenders',
  )

  const [editing, setEditing] = useState<Lender | null>(null)
  const [busy, setBusy] = useState(false)

  const save = useCallback(async () => {
    if (!editing) return
    setBusy(true)
    try {
      const result = await apiSend<{ message: string }>('/api/admin/lenders', 'PATCH', {
        action: 'save',
        id: editing.id || undefined,
        lenderName: editing.lenderName,
        displayName: editing.displayName,
        tagline: editing.tagline,
        description: editing.description,
        minAmount: Number(editing.minAmount),
        maxAmount: Number(editing.maxAmount),
        minScore: Number(editing.minScore),
        interestRate: editing.interestRate,
        turnaround: editing.turnaround,
        integrationType: editing.integrationType,
        intakeEmail: editing.intakeEmail,
        commissionRate: Number(editing.commissionRate),
        commissionTerms: editing.commissionTerms,
        collectionInstructions: editing.collectionInstructions,
        isFeatured: editing.isFeatured,
      })

      if (result.error) {
        toast(result.error, 'danger')
        return
      }
      setEditing(null)
      toast(result.data?.message ?? 'Saved.', 'success')
      reload()
    } finally {
      setBusy(false)
    }
  }, [editing, toast, reload])

  const setActive = useCallback(
    async (id: string, isActive: boolean) => {
      const result = await apiSend<{ message: string }>('/api/admin/lenders', 'PATCH', {
        action: 'setActive',
        id,
        isActive,
      })
      toast(
        result.error ?? result.data?.message ?? 'Updated.',
        result.error ? 'danger' : 'success',
      )
      reload()
    },
    [toast, reload],
  )

  if (loading && !data) return <TableSkeleton rows={4} columns={3} />
  if (error) return <ErrorState message={error} code={code} onRetry={reload} />

  const lenders = data?.lenders ?? []

  return (
    <>
      <PageHeader
        title="Lending partners"
        description="The MFIs and banks parents can apply to."
        note="Parents see the description, the rate and the turnaround. They never see the commission rate."
      />

      <Card>
        <CardContent className="flex flex-col gap-cards pt-card">
          {lenders.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No lenders yet"
              description="Add a partner before parents can apply for fee loans."
            />
          ) : (
            <ul className="divide-y divide-border">
              {lenders.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-2 py-stack">
                  <span className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-2 font-medium">
                      {l.displayName}
                      {l.isFeatured && <Badge variant="primary">Featured</Badge>}
                      {!l.isActive && <Badge variant="neutral">Withdrawn</Badge>}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {l.interestRate} · {l.turnaround} · commission{' '}
                      <span data-numeric>{(l.commissionRate * 100).toFixed(2)}%</span> ·
                      minimum score <span data-numeric>{l.minScore}</span>
                    </span>
                  </span>

                  <span className="ml-auto flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(l)}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void setActive(l.id, !l.isActive)}
                    >
                      {l.isActive ? 'Withdraw' : 'Offer again'}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <Button variant="outline" className="self-start" onClick={() => setEditing(blank())}>
            <Plus aria-hidden="true" />
            Add a lender
          </Button>
        </CardContent>
      </Card>

      <Dialog
        open={editing !== null}
        title={editing?.id ? 'Edit lender' : 'Add a lender'}
        description="What parents see, and what AfriTech earns."
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button
              disabled={busy || !editing?.displayName.trim() || !editing?.lenderName.trim()}
              onClick={() => void save()}
            >
              {busy ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </>
        }
      >
        {editing && (
          <div className="flex flex-col gap-stack">
            <Field
              id="l-name"
              label="Internal name"
              required
              hint="Unique. Not shown to parents."
            >
              {(props) => (
                <Input
                  {...props}
                  value={editing.lenderName}
                  maxLength={120}
                  onChange={(e) => setEditing({ ...editing, lenderName: e.target.value })}
                />
              )}
            </Field>

            <Field id="l-display" label="Name parents see" required>
              {(props) => (
                <Input
                  {...props}
                  value={editing.displayName}
                  maxLength={120}
                  onChange={(e) => setEditing({ ...editing, displayName: e.target.value })}
                />
              )}
            </Field>

            <Field id="l-desc" label="Description" hint="Shown on the lender choice screen.">
              {(props) => (
                <Textarea
                  {...props}
                  rows={2}
                  value={editing.description ?? ''}
                  maxLength={1000}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                />
              )}
            </Field>

            <Field
              id="l-rate"
              label="Interest rate, in words"
              required
              hint="Written out, such as 18% per annum. ZSMS does not compute it."
            >
              {(props) => (
                <Input
                  {...props}
                  value={editing.interestRate}
                  maxLength={120}
                  onChange={(e) => setEditing({ ...editing, interestRate: e.target.value })}
                />
              )}
            </Field>

            <Field
              id="l-turn"
              label="Turnaround"
              required
              hint="Decision within 3-5 business days"
            >
              {(props) => (
                <Input
                  {...props}
                  value={editing.turnaround}
                  maxLength={120}
                  onChange={(e) => setEditing({ ...editing, turnaround: e.target.value })}
                />
              )}
            </Field>

            <div className="grid gap-stack sm:grid-cols-3">
              <Field id="l-min" label="Lends from" required>
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    min={0}
                    value={String(editing.minAmount)}
                    onChange={(e) =>
                      setEditing({ ...editing, minAmount: Number(e.target.value) })
                    }
                  />
                )}
              </Field>
              <Field id="l-max" label="Lends up to" required>
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    min={0}
                    value={String(editing.maxAmount)}
                    onChange={(e) =>
                      setEditing({ ...editing, maxAmount: Number(e.target.value) })
                    }
                  />
                )}
              </Field>
              <Field id="l-score" label="Minimum score" required hint="300 to 850.">
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    min={300}
                    max={850}
                    value={String(editing.minScore)}
                    onChange={(e) =>
                      setEditing({ ...editing, minScore: Number(e.target.value) })
                    }
                  />
                )}
              </Field>
            </div>

            <Field id="l-int" label="How applications reach them" required>
              {(props) => (
                <Select
                  {...props}
                  value={editing.integrationType}
                  onChange={(e) => setEditing({ ...editing, integrationType: e.target.value })}
                >
                  <option value="email">Email (Phase 1)</option>
                  <option value="api">API (Phase 2)</option>
                  <option value="zsms_internal">ZSMS itself (Phase 3)</option>
                </Select>
              )}
            </Field>

            {editing.integrationType === 'email' && (
              <Field id="l-email" label="Intake address" required>
                {(props) => (
                  <Input
                    {...props}
                    type="email"
                    value={editing.intakeEmail ?? ''}
                    maxLength={160}
                    onChange={(e) => setEditing({ ...editing, intakeEmail: e.target.value })}
                  />
                )}
              </Field>
            )}

            <Field
              id="l-comm"
              label="Commission rate"
              required
              hint="As a decimal — 0.025 is 2.5%. Never shown to a parent."
            >
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  min={0}
                  max={1}
                  step="0.0001"
                  value={String(editing.commissionRate)}
                  onChange={(e) =>
                    setEditing({ ...editing, commissionRate: Number(e.target.value) })
                  }
                />
              )}
            </Field>

            <Field
              id="l-collect"
              label="How parents repay them"
              hint="Shown to a parent once their loan is disbursed."
            >
              {(props) => (
                <Textarea
                  {...props}
                  rows={2}
                  value={editing.collectionInstructions ?? ''}
                  maxLength={600}
                  onChange={(e) =>
                    setEditing({ ...editing, collectionInstructions: e.target.value })
                  }
                />
              )}
            </Field>

            <label className="flex min-h-tap cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={editing.isFeatured}
                onChange={(e) => setEditing({ ...editing, isFeatured: e.target.checked })}
              />
              Show this lender first
            </label>
          </div>
        )}
      </Dialog>
    </>
  )
}
