'use client'

/**
 * Feature matrix — which tier includes which feature.
 *
 * Spec: `Official Documentation/17 Integration and Pricing/PRICING.md`
 *       `Official Documentation/01 Foundation Layer/DYNAMIC_CONFIG.md` — ADR-031
 *       `Official Documentation/01 Foundation Layer/DECISIONS.md` — ADR-014
 *
 * ## The blast radius is the design problem
 *
 * A cell here is not a setting on a page; it is a change to every school on that
 * tier, live, with no publish step. ADR-031 wants exactly that — a business
 * person reprices without a deployment — so the screen's job is not to add an
 * approval workflow but to make the consequence legible *before* the click. Each
 * tier column therefore carries its school count, and turning a feature **off**
 * asks for confirmation naming how many schools lose it. Turning one on does
 * not: granting access is recoverable, revoking it is what someone notices
 * mid-lesson.
 *
 * ## Why the grid is not a `<table>` of checkboxes alone
 *
 * The resolution order (revoke override → grant override → tier override →
 * matrix) means this grid is only the *last* step. A school can hold a feature
 * this grid says its tier excludes. That is stated on the page rather than
 * assumed, because an operator who reads this as the final word will make a
 * support promise the resolver does not keep.
 */

import type { JSX } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { Check, Info, Loader2, Minus, ToggleRight } from 'lucide-react'

import { apiSend, useApi } from '../../../lib/use-api'
import { Alert } from '../../../components/ui/alert'
import { Card, CardContent } from '../../../components/ui/card'
import { EmptyState } from '../../../components/ui/empty-state'
import { ErrorState, PageHeader, TableSkeleton } from '../../../components/ui/data-states'
import { cn } from '../../../lib/utils'

interface Feature {
  feature_key: string
  display_name: string
  description: string | null
  category: string
  is_active: boolean
  display_order: number
}

interface MatrixCell {
  tier_name: string
  feature_key: string
  is_included: boolean
}

interface Tier {
  tier_name: string
  display_name: string
  display_order: number
}

interface FeaturesPayload {
  features: Feature[]
  matrix: MatrixCell[]
  tiers: Tier[]
  schoolsPerTier: Record<string, number>
}

/** `tier|feature` — the composite key the matrix is addressed by. */
const cellKey = (tier: string, feature: string): string => `${tier}|${feature}`

export default function AdminFeaturesPage(): JSX.Element {
  const { data, loading, error, code, reload } = useApi<FeaturesPayload>('/api/admin/features')

  /** Cells with a request in flight, so each toggle disables only itself. */
  const [pending, setPending] = useState<Set<string>>(new Set())
  /** Applied changes held locally, so the grid updates without a full refetch. */
  const [applied, setApplied] = useState<Record<string, boolean>>({})
  const [failure, setFailure] = useState<string | null>(null)

  const included = useMemo(() => {
    const map: Record<string, boolean> = {}
    for (const cell of data?.matrix ?? []) map[cellKey(cell.tier_name, cell.feature_key)] = cell.is_included
    return { ...map, ...applied }
  }, [data, applied])

  const toggle = useCallback(
    async (tier: Tier, feature: Feature, next: boolean, schools: number) => {
      // Only the destructive direction is confirmed. A dialog on every click
      // trains people to dismiss the dialog, which is how the one that mattered
      // gets dismissed too.
      if (!next && schools > 0) {
        const ok = window.confirm(
          `Remove “${feature.display_name}” from ${tier.display_name}?\n\n` +
            `${schools} school${schools === 1 ? '' : 's'} on this tier will lose it immediately, ` +
            `unless an override grants it individually.`,
        )
        if (!ok) return
      }

      const key = cellKey(tier.tier_name, feature.feature_key)
      setFailure(null)
      setPending((p) => new Set(p).add(key))

      const result = await apiSend('/api/admin/features', 'PATCH', {
        tierName: tier.tier_name,
        featureKey: feature.feature_key,
        included: next,
      })

      setPending((p) => {
        const n = new Set(p)
        n.delete(key)
        return n
      })

      if (result.error) {
        // The grid is not updated on failure. An optimistic cell that silently
        // reverts is worse than one that never moved: the operator walks away
        // believing the change landed.
        setFailure(`Could not update ${feature.display_name} on ${tier.display_name}: ${result.error}`)
        return
      }

      setApplied((a) => ({ ...a, [key]: next }))
    },
    [],
  )

  const byCategory = useMemo(() => {
    const groups = new Map<string, Feature[]>()
    for (const f of data?.features ?? []) {
      if (!f.is_active) continue
      const list = groups.get(f.category) ?? []
      list.push(f)
      groups.set(f.category, list)
    }
    return [...groups.entries()]
  }, [data])

  return (
    <>
      <PageHeader
        title="Feature matrix"
        description="Which features each subscription tier includes. Changes take effect immediately for every school on the tier — there is no publish step."
      />

      {error && <ErrorState message={error} code={code} onRetry={reload} />}
      {loading && !error && <TableSkeleton rows={8} columns={5} />}

      {failure && (
        <Alert variant="danger" title="The change was not saved" className="mb-cards">
          {failure}
        </Alert>
      )}

      {!loading && !error && data && (
        <div className="space-y-cards">
          <Alert variant="info" title="This grid is the fallback, not the final answer">
            <p>
              Feature access resolves in a fixed order: a revoke override, then a grant override,
              then a tier override, and only then this matrix. A school carrying an override can
              have a feature its tier excludes — check the school&rsquo;s own page before promising
              anything to it.
            </p>
          </Alert>

          {byCategory.length === 0 ? (
            <EmptyState
              icon={ToggleRight}
              title="No active features"
              description="The feature catalogue is empty. Features are seeded by migration 0095."
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">
                      Feature inclusion by subscription tier. Each cell is a toggle button.
                    </caption>
                    <thead className="border-b border-border bg-sunken">
                      <tr>
                        <th scope="col" className="px-4 py-2.5 text-left font-medium">
                          Feature
                        </th>
                        {data.tiers.map((tier) => (
                          <th key={tier.tier_name} scope="col" className="px-3 py-2.5 text-center font-medium">
                            <span className="block">{tier.display_name}</span>
                            {/* The count is the blast radius, in the column
                                header where it is read before the click. */}
                            <span data-numeric className="block text-xs font-normal text-muted-foreground">
                              {data.schoolsPerTier[tier.tier_name] ?? 0} school
                              {(data.schoolsPerTier[tier.tier_name] ?? 0) === 1 ? '' : 's'}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>

                    {byCategory.map(([category, features]) => (
                      <tbody key={category}>
                        <tr>
                          <th
                            scope="colgroup"
                            colSpan={data.tiers.length + 1}
                            className="border-y border-border bg-sunken/60 px-4 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                          >
                            {category.replace(/_/g, ' ')}
                          </th>
                        </tr>

                        {features.map((feature) => (
                          <tr key={feature.feature_key} className="border-b border-border last:border-0">
                            <th scope="row" className="px-4 py-3 text-left font-normal">
                              <span className="block font-medium text-foreground">{feature.display_name}</span>
                              {feature.description && (
                                <span className="block max-w-md text-xs text-muted-foreground">
                                  {feature.description}
                                </span>
                              )}
                            </th>

                            {data.tiers.map((tier) => {
                              const key = cellKey(tier.tier_name, feature.feature_key)
                              const on = included[key] === true
                              const busy = pending.has(key)
                              const schools = data.schoolsPerTier[tier.tier_name] ?? 0

                              return (
                                <td key={tier.tier_name} className="px-3 py-2 text-center">
                                  <button
                                    type="button"
                                    // The button *is* the state, so it carries
                                    // it — a checkbox styled as a button would
                                    // announce nothing useful here.
                                    aria-pressed={on}
                                    disabled={busy}
                                    onClick={() => void toggle(tier, feature, !on, schools)}
                                    className={cn(
                                      'inline-flex size-tap items-center justify-center rounded-md border transition-colors',
                                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                                      'disabled:cursor-wait disabled:opacity-60',
                                      on
                                        ? 'border-success bg-success-tint text-success-text hover:bg-success-tint/70'
                                        : 'border-border bg-background text-subtle hover:bg-sunken',
                                    )}
                                  >
                                    {busy ? (
                                      <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                                    ) : on ? (
                                      <Check aria-hidden="true" className="size-4" />
                                    ) : (
                                      <Minus aria-hidden="true" className="size-4" />
                                    )}
                                    {/* Never colour alone: the announced label
                                        states tier, feature, and state. */}
                                    <span className="sr-only">
                                      {feature.display_name} on {tier.display_name}:{' '}
                                      {on ? 'included' : 'not included'}
                                    </span>
                                  </button>
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    ))}
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              Every change is written with the operator who made it and a timestamp. Removing a
              feature asks for confirmation; adding one does not.
            </span>
          </p>
        </div>
      )}
    </>
  )
}
