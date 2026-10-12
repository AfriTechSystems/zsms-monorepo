'use client'

/**
 * A school's logo, with an honest empty state.
 *
 * ## Why not `Avatar`
 *
 * `Avatar` falls back to a person's initials, which is right for a person and wrong
 * for an institution: "Twalumbu Secondary School" reduces to "TS", which looks like a
 * name somebody failed to enter. A school with no logo gets a building mark instead —
 * a placeholder that reads as "no logo yet" rather than as a broken avatar.
 *
 * ## It says where the logo goes
 *
 * When editable and empty, the frame is dashed and labelled. A school that has not
 * uploaded one should be able to see that there is somewhere to put it, which was the
 * actual problem: the only logo control in the product was a text field asking for a
 * URL, on a settings tab, with no preview of any kind.
 *
 * Upload goes through `/api/uploads/photo`, which is where the 2MB cap, the format
 * allow-list and the magic-byte check live — the same route `Avatar` uses, so there
 * is one place that decides what an acceptable image is.
 */

import type { JSX } from 'react'
import { useRef, useState } from 'react'
import { Building2, Camera, Loader2 } from 'lucide-react'

import { cn } from '../../lib/utils'

type LogoSize = 'sm' | 'md' | 'lg'

const SIZES: Record<LogoSize, string> = {
  sm: 'size-8',
  md: 'size-12',
  lg: 'size-20',
}

export function SchoolLogo({
  src,
  name,
  size = 'md',
  onChange,
  className,
}: {
  src?: string | null
  /** Used for the alt text, so the image is not announced as "image". */
  name: string
  size?: LogoSize
  /** Supplying this is what makes the logo editable. Omit it to display only. */
  onChange?: (url: string | null) => void | Promise<void>
  className?: string
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const editable = typeof onChange === 'function'

  const upload = async (file: File): Promise<void> => {
    setBusy(true)
    setFailed(null)
    try {
      const body = new FormData()
      body.append('file', file)
      const response = await fetch('/api/uploads/photo', { method: 'POST', body })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        // Named, not swallowed. "Too large" and "not an image" are different
        // problems and the person can fix either one.
        setFailed(payload?.error ?? 'That file could not be uploaded.')
        return
      }
      await onChange?.(payload.data.url)
    } catch {
      setFailed('That file could not be uploaded.')
    } finally {
      setBusy(false)
    }
  }

  const frame = (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-sunken',
        SIZES[size],
        // Dashed only when it is empty AND somebody can fill it — a dashed box
        // nobody can act on is just a broken-looking picture.
        !src && editable ? 'border-2 border-dashed border-border' : 'border border-border',
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- an arbitrary R2 host
        <img src={src} alt={`${name} logo`} className="size-full object-contain" />
      ) : (
        <Building2 aria-hidden="true" className="size-1/2 text-muted-foreground" />
      )}

      {busy && (
        <span className="absolute inset-0 inline-flex items-center justify-center bg-black/40">
          <Loader2 aria-hidden="true" className="size-4 animate-spin text-white" />
        </span>
      )}

      {/* Always visible when empty, not on hover: a phone has no hover, and this is
          exactly the state that needs to invite a tap. */}
      {editable && !busy && !src && (
        <span className="absolute bottom-0 right-0 inline-flex size-5 items-center justify-center rounded-tl-md bg-primary text-primary-foreground">
          <Camera aria-hidden="true" className="size-3" />
        </span>
      )}
    </span>
  )

  if (!editable) return <span className={className}>{frame}</span>

  return (
    <span className={cn('inline-flex flex-col gap-1', className)}>
      <span className="inline-flex items-center gap-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label={src ? `Change the ${name} logo` : `Add a logo for ${name}`}
          className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {frame}
        </button>

        <span className="text-sm">
          <span className="block font-medium">{src ? 'School logo' : 'No logo yet'}</span>
          <span className="block text-xs text-muted-foreground">
            {src
              ? 'Appears on report cards, receipts and your public listing.'
              : 'Add one — it appears on report cards, receipts and your public listing.'}
          </span>
          {src && (
            <button
              type="button"
              onClick={() => void onChange?.(null)}
              className="mt-1 text-xs text-danger-text underline"
            >
              Remove
            </button>
          )}
        </span>
      </span>

      <input
        ref={fileRef}
        type="file"
        // The same three the upload route accepts. Listing more here would offer a
        // file the server then refuses, which reads as a bug rather than a rule.
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0]
          // Reset, so choosing the SAME file again still fires a change event.
          e.target.value = ''
          if (file) void upload(file)
        }}
      />

      {failed && <span className="text-xs text-danger-text">{failed}</span>}
    </span>
  )
}
