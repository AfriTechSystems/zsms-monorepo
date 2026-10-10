'use client'

/**
 * The impersonation banner.
 *
 * Spec: `02 Authentication and Identity/IMPERSONATION.md` → *The Impersonation Banner*
 *
 * ## Why this is loud, and at the top of every page
 *
 * During impersonation the whole application looks exactly like the customer's — that is
 * the point, and it is also the danger. An operator who forgets which tab they are in can
 * change a real school's fee records believing they are on their own account.
 *
 * So the banner sits above everything, uses the destructive colour, and never collapses.
 * It is mounted in the ROOT layout rather than per shell, because the operator is inside
 * the customer's session and could be on any screen in any portal — including ones
 * written before impersonation existed.
 *
 * ## It costs one request, and only inside a session
 *
 * `my_impersonation_context()` returns a single row saying "no" for an ordinary session,
 * and the component renders nothing. Every signed-in page pays one cheap RPC for the
 * guarantee that no impersonated page can ever look ordinary.
 */

import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { ShieldAlert } from 'lucide-react'

interface Context {
  isImpersonating: boolean
  targetUserId: string | null
  reason: string | null
  expiresAt: string | null
}

export function ImpersonationBanner(): JSX.Element | null {
  const [ctx, setCtx] = useState<Context | null>(null)
  const [ending, setEnding] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/session/impersonation')
      if (!response.ok) return
      const body = await response.json()
      setCtx(body.data ?? null)
    } catch {
      /*
        Silent. A failed check must not render a banner claiming impersonation that is
        not happening, nor block a page that is working — and the real protection is
        the audit trail, which does not depend on this component.
      */
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (!ctx?.isImpersonating) return null

  async function end(): Promise<void> {
    setEnding(true)
    try {
      await fetch('/api/session/impersonation', { method: 'DELETE' })
    } finally {
      /*
        A full reload, not a router refresh. Ending impersonation changes who the
        session is, and every cached server component on the page belongs to the
        person being left behind.
      */
      window.location.href = '/admin'
    }
  }

  const expires = ctx.expiresAt ? new Date(ctx.expiresAt) : null
  const minutesLeft = expires
    ? Math.max(0, Math.round((expires.getTime() - Date.now()) / 60000))
    : null

  return (
    <div
      role="alert"
      className="sticky top-0 z-50 flex flex-wrap items-center gap-3 bg-destructive px-4 py-2 text-sm text-destructive-foreground"
    >
      <ShieldAlert aria-hidden="true" className="h-4 w-4 shrink-0" />

      <span className="min-w-0 flex-1">
        <span className="font-semibold">You are viewing ZSMS as someone else.</span>{' '}
        Everything you do is recorded against your own name.
        {ctx.reason ? <span className="opacity-90"> — {ctx.reason}</span> : null}
      </span>

      {minutesLeft !== null ? (
        <span className="shrink-0 opacity-90">
          {/*
            Shown because the document names the failure it prevents: a tab closed
            without ending the session stays open until the token lapses.
          */}
          ends in <span data-numeric>{minutesLeft}</span> min
        </span>
      ) : null}

      <button
        type="button"
        onClick={() => void end()}
        disabled={ending}
        className="shrink-0 rounded-md bg-destructive-foreground/15 px-3 py-1 font-medium underline-offset-2 hover:underline"
      >
        {ending ? 'Ending…' : 'End impersonation'}
      </button>
    </div>
  )
}
