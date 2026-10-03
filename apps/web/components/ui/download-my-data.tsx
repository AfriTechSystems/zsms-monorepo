'use client'

/**
 * The right to portability, exercised by the person themselves.
 *
 * Spec: `Official Documentation/01 Foundation Layer/COMPLIANCE.md`
 *         → *Data Subject Rights Procedures*
 *
 * ## Why it is in the account menu rather than one portal
 *
 * `COMPLIANCE.md` names the parent portal, because parents are the audience the right was
 * written for. But `export_my_data()` resolves the caller from `get_user_id()` and works
 * for anybody signed in — a parent, a member of staff, a standalone Hub teacher. Putting
 * it where `AccountMenu` already lives gives every portal the same right at once, and
 * means a teacher does not have to email AfriTech for something the database can answer
 * in a second.
 *
 * ## Fourteen days, or none
 *
 * The ZDPA allows fourteen days for a portability request. Self-service makes that
 * instant, which also removes the processing activity that answering by hand would be —
 * a developer running a query against production is itself something that should have
 * been logged.
 *
 * ## Downloaded, never rendered
 *
 * The export is the person's whole record. Putting it on screen leaves it in a browser
 * cache and over the shoulder of anybody passing a shared school office machine. A file
 * goes straight to them.
 */

import type { JSX } from 'react'
import { useCallback, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'

import { cn } from '../../lib/utils'

export function DownloadMyData({ className }: { className?: string }): JSX.Element {
  const [busy, setBusy] = useState(false)

  const download = useCallback(async () => {
    setBusy(true)
    try {
      const response = await fetch('/api/session/my-data', { method: 'POST' })
      if (!response.ok) return

      const body = await response.json()
      const blob = new Blob([JSON.stringify(body?.data?.export ?? {}, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `my-zsms-data-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // Silent. A failed download is visible by its absence, and an error dialog in a
      // header menu over a right somebody may be exercising quietly is worse.
    } finally {
      setBusy(false)
    }
  }, [])

  return (
    <button
      type="button"
      onClick={() => void download()}
      disabled={busy}
      title="Download everything ZSMS holds about you"
      className={cn(
        'inline-flex min-h-tap shrink-0 items-center gap-1.5 rounded-md border border-border',
        'px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-sunken hover:text-foreground',
        'disabled:cursor-not-allowed disabled:opacity-70',
        className,
      )}
    >
      {busy ? (
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
      ) : (
        <Download aria-hidden="true" className="size-4" />
      )}
      <span className="hidden sm:inline">My data</span>
      <span className="sr-only sm:hidden">Download my data</span>
    </button>
  )
}
