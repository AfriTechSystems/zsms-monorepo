'use client'

/**
 * Moving between schools without signing out.
 *
 * Spec: `Official Documentation/02 Authentication and Identity/AUTH.md`
 *       Decision: ADR-032 — Clerk is reached only through `@zsms/auth-provider`
 *
 * ## Why switching the session is the whole mechanism
 *
 * Every staff policy scopes on `current_school_uuid()`, which reads the
 * organisation claim out of the JWT. Switching the active organisation re-issues
 * the token, so the same 75 policies resolve to the new school with no change to
 * any of them. That is why this is a small component and not a tenancy rewrite.
 *
 * ## It reloads, deliberately
 *
 * After the switch every cached response on the page belongs to the previous
 * school. Re-fetching piecemeal would leave a screen showing one school's pupils
 * beside another's fee totals for as long as the slowest request took. A full
 * navigation is the honest option: brief, and never wrong.
 *
 * ## A school it cannot enter is shown and disabled, not hidden
 *
 * `my_schools()` answers from ZSMS data; the ability to switch comes from Clerk
 * membership. When those disagree — a staff record exists but the Clerk invitation
 * was never accepted — hiding the school would leave somebody wondering why the
 * place they work is missing. It is listed, unselectable, with the reason.
 */

import type { JSX } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Check, Loader2 } from 'lucide-react'

import { useOrganizationList } from '@zsms/auth-provider/react'

import { useApi } from '../../lib/use-api'
import { Button } from './button'
import { cn } from '../../lib/utils'

interface SchoolOption {
  uuid: string
  code: string
  name: string
  organisationId: string
  relationship: string
  current: boolean
}

const RELATIONSHIP_LABEL: Record<string, string> = {
  staff: 'Staff',
  parent: 'Parent',
  student: 'Pupil',
}

export function SchoolSwitcher(): JSX.Element | null {
  const router = useRouter()
  const { data } = useApi<{ schools: SchoolOption[]; currentOrganisationId: string | null }>(
    '/api/session/schools',
  )

  // `setActive` is the switch; `userMemberships` is what the account may switch
  // INTO. Both come through the provider-neutral re-export, never `@clerk/*`.
  const { isLoaded, setActive, userMemberships } = useOrganizationList({
    userMemberships: { infinite: true },
  })

  const [switching, setSwitching] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const memberOf = useMemo(() => {
    const ids = new Set<string>()
    for (const m of userMemberships?.data ?? []) {
      const id = (m as { organization?: { id?: string } }).organization?.id
      if (id) ids.add(id)
    }
    return ids
  }, [userMemberships?.data])

  const schools = data?.schools ?? []
  const current = schools.find((s) => s.current) ?? null

  const switchTo = useCallback(
    async (organisationId: string) => {
      if (!setActive) return
      setSwitching(organisationId)
      try {
        await setActive({ organization: organisationId })
        // Straight to the school portal root rather than staying put: the current
        // URL may name a pupil or a class that does not exist at the new school,
        // and a 404 immediately after switching reads as the switch having failed.
        router.push('/school')
        router.refresh()
      } finally {
        setSwitching(null)
        setOpen(false)
      }
    },
    [setActive, router],
  )

  // One school is not a choice. Rendering a switcher for it would imply there is
  // somewhere else to be.
  if (schools.length <= 1) return null

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <Building2 aria-hidden="true" />
        <span className="max-w-40 truncate">{current?.name ?? 'Choose a school'}</span>
        <span className="text-xs text-muted-foreground">({schools.length})</span>
      </Button>

      {open && (
        <>
          {/* A click-away layer rather than a document listener: it cannot leak,
              and it cannot fight the button's own click. */}
          <button
            type="button"
            aria-label="Close school list"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <ul
            role="listbox"
            className="absolute right-0 z-50 mt-1 max-h-80 w-72 overflow-y-auto rounded-md border border-border bg-card p-1 shadow-lg"
          >
            {schools.map((s) => {
              const canEnter = memberOf.has(s.organisationId) || s.current
              const busy = switching === s.organisationId
              return (
                <li key={s.uuid}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={s.current}
                    disabled={!isLoaded || s.current || !canEnter || busy}
                    onClick={() => void switchTo(s.organisationId)}
                    className={cn(
                      'flex min-h-tap w-full items-start gap-2 rounded px-2 py-2 text-left text-sm transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                      s.current
                        ? 'bg-muted font-medium'
                        : canEnter
                          ? 'hover:bg-muted'
                          : 'cursor-not-allowed opacity-60',
                    )}
                  >
                    {busy ? (
                      <Loader2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 animate-spin" />
                    ) : s.current ? (
                      <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    ) : (
                      <span aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-foreground">{s.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {RELATIONSHIP_LABEL[s.relationship] ?? s.relationship} · {s.code}
                        {s.current && ' · current'}
                      </span>
                      {!canEnter && (
                        <span className="mt-0.5 block text-xs text-warning-text">
                          Your invitation to this school has not been accepted yet.
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
