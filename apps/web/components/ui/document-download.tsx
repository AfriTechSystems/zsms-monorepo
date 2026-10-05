'use client'

/**
 * A button that downloads one generated PDF.
 *
 * Spec: `Official Documentation/13 Document and PDF System/STORAGE.md`
 *
 * ## One component, every screen
 *
 * Receipts appear on the school fees screen and the parent fees screen; report cards
 * appear on the results screen. All three need the same four states and the same
 * two-step fetch, so they share this rather than growing three copies that drift —
 * and the state that matters most is the one a naive version omits.
 *
 * ## Two steps, because the URL is short-lived
 *
 * `GET /api/documents/[id]` returns a **signed URL valid for sixty seconds**, not the
 * bytes. So the URL is fetched when the button is pressed and used immediately. Putting
 * it in an `href` at render time would hand every visitor a link that is dead before
 * they read the page, and would put a live link to a child's name and an amount into the
 * DOM of a page that might be left open.
 *
 * ## A document that is not ready is not an error
 *
 * The worker renders asynchronously, so between a payment being verified and its receipt
 * existing there is a real interval. The route reports that as CONFLICT, and this shows
 * it as "still being produced" with the button still live, because trying again in ten
 * seconds is exactly the right thing to do. Reporting it as a failure would send a
 * bursar to the office to ask about a receipt that was already on its way.
 *
 * A document that genuinely failed shows why, when the row says why — the remedy is
 * usually the school's own.
 */

import type { JSX } from 'react'
import { useCallback, useState } from 'react'
import { AlertCircle, Download, Loader2 } from 'lucide-react'

import { Button } from './button'
import { useToast } from './toast'

type State = 'idle' | 'working' | 'pending' | 'failed'

export function DocumentDownload({
  documentId,
  label = 'Download',
  /** Shown instead of a button when the row says the render failed before we asked. */
  knownFailure,
  size = 'sm',
  variant = 'outline',
}: {
  documentId: string
  label?: string
  knownFailure?: string | null
  size?: 'sm' | 'default'
  variant?: 'outline' | 'ghost' | 'default'
}): JSX.Element {
  const { toast } = useToast()
  const [state, setState] = useState<State>('idle')
  const [why, setWhy] = useState<string | null>(knownFailure ?? null)

  const download = useCallback(async () => {
    setState('working')
    try {
      const res = await fetch(`/api/documents/${documentId}`)
      const body = (await res.json().catch(() => null)) as
        | { data?: { url?: string }; error?: string; code?: string }
        | null

      if (res.ok && body?.data?.url) {
        /*
          A new tab rather than a navigation.

          R2 serves the object with its own content-disposition, so the tab either
          downloads and closes or shows the PDF. Navigating the current tab away from a
          half-entered fees form would lose it.
        */
        window.open(body.data.url, '_blank', 'noopener,noreferrer')
        setState('idle')
        return
      }

      /*
        CONFLICT covers both "still rendering" and "the render failed", and the
        difference decides whether trying again is worth anything. The route's message
        carries it, so it is shown rather than replaced with a generic line.
      */
      if (body?.code === 'CONFLICT') {
        const stillGoing = /still being produced/i.test(body.error ?? '')
        setState(stillGoing ? 'pending' : 'failed')
        setWhy(body.error ?? null)
        return
      }

      setState('idle')
      toast(body?.error ?? 'That document could not be downloaded.', 'danger')
    } catch {
      setState('idle')
      // A network failure, not a document problem. Named as such so nobody goes
      // looking at the renderer.
      toast('Could not reach the server. Check your connection and try again.', 'danger')
    }
  }, [documentId, toast])

  // A row that already says it failed gets no button: there is nothing to press.
  if (state === 'failed' || (state === 'idle' && knownFailure)) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-danger">
        <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
        <span>{why ?? 'Could not be produced'}</span>
      </span>
    )
  }

  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <Button
        variant={variant}
        size={size}
        disabled={state === 'working'}
        onClick={() => void download()}
      >
        {state === 'working' ? (
          <Loader2 aria-hidden="true" className="animate-spin" />
        ) : (
          <Download aria-hidden="true" />
        )}
        {state === 'working' ? 'Preparing…' : label}
      </Button>

      {/* Still live, because trying again shortly is the correct action. */}
      {state === 'pending' && (
        <span className="text-xs text-muted-foreground">
          Still being produced — try again in a moment.
        </span>
      )}
    </span>
  )
}
