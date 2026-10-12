'use client'

/**
 * A person's or a school's picture, with the fallback that is used far more often.
 *
 * Spec: `19 Design System/ZSMS_UI_REDESIGN_MASTER_PROMPT.md`; every reference image
 *       puts a face beside a name in a list and at the top of a record.
 *
 * ## The fallback is the main case, not the error case
 *
 * Almost no pupil will have a photo on the day a school is onboarded, and some never
 * will. So the initials state is designed first: a tinted disc with one or two letters,
 * coloured deterministically from the name so the same person is the same colour on
 * every screen. A grey circle for everybody would make a class list unreadable.
 *
 * It is NOT random per render and not stored — deriving from the name means a school
 * that adds a pupil gets a usable avatar immediately, with nothing to configure.
 *
 * ## Editable is a separate decision from present
 *
 * `onChange` is what makes an avatar editable, and the caller supplies it only where
 * the viewer is actually allowed to change that picture. A parent viewing their child
 * sees the photo and no affordance, because `set_student_photo()` would refuse them
 * (`0265`) and offering a control that fails is worse than offering none.
 */

import type { JSX } from 'react'
import { useRef, useState } from 'react'
import { Camera, Loader2 } from 'lucide-react'

import { cn } from '../../lib/utils'
import { useToast } from './toast'

const SIZES = {
  sm: { box: 'size-8', text: 'text-xs' },
  md: { box: 'size-10', text: 'text-sm' },
  lg: { box: 'size-14', text: 'text-base' },
  xl: { box: 'size-24', text: 'text-2xl' },
} as const

export type AvatarSize = keyof typeof SIZES

/**
 * Six tints, chosen from the validated chart series so an avatar never collides with
 * a status colour — a green disc must not read as "passing".
 */
const TINTS = [
  'bg-primary-tint text-primary-text',
  'bg-success-tint text-success-text',
  'bg-accent-tint text-accent-text',
  'bg-warning-tint text-warning-text',
  'bg-danger-tint text-danger-text',
  'bg-neutral-tint text-neutral-text',
] as const

/** Deterministic, so one person is one colour everywhere. */
function tintFor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0
  return TINTS[Math.abs(hash) % TINTS.length]!
}

/**
 * Up to two letters.
 *
 * Takes the first letter of the first and last words, so "Chanda Mwansa" is CM and
 * "Riverside Academy" is RA. A single word gives one letter rather than two from the
 * same word, which reads as a typo.
 */
function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0]![0]!.toUpperCase()
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase()
}

export interface AvatarProps {
  /** Used for the initials, the colour and the accessible name. */
  name: string
  src?: string | null
  size?: AvatarSize
  /** Square with a soft radius rather than a circle — for a school crest or logo. */
  square?: boolean
  /**
   * Supplied only where this viewer may change this picture. Receives the stored URL
   * and is expected to persist it; the component does not write to any record.
   */
  onChange?: (url: string) => void | Promise<void>
  className?: string
}

export function Avatar({
  name,
  src,
  size = 'md',
  square = false,
  onChange,
  className,
}: AvatarProps): JSX.Element {
  const { toast } = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const s = SIZES[size]
  const editable = typeof onChange === 'function'
  // A broken URL falls back to initials rather than a broken-image icon.
  const showImage = Boolean(src) && !failed

  async function upload(file: File): Promise<void> {
    setBusy(true)
    try {
      const body = new FormData()
      body.append('file', file)

      const response = await fetch('/api/uploads/photo', { method: 'POST', body })
      const result = await response.json()

      if (!response.ok) {
        // The route's messages are written to be read — the size one says what to do.
        toast(result.error ?? 'The image could not be uploaded.', 'danger')
        return
      }

      await onChange?.(result.data.url)
      setFailed(false)
    } finally {
      setBusy(false)
    }
  }

  const disc = (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden font-semibold',
        square ? 'rounded-lg' : 'rounded-full',
        s.box,
        s.text,
        showImage ? 'bg-sunken' : tintFor(name),
        className,
      )}
    >
      {showImage ? (
        // Not `next/image`: the host is an R2 bucket that would need configuring in
        // `next.config`, and an avatar is already small enough that the optimiser
        // would save nothing worth the coupling.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src!}
          alt=""
          className="size-full object-cover"
          onError={() => setFailed(true)}
          loading="lazy"
        />
      ) : (
        <span aria-hidden="true">{initialsFor(name)}</span>
      )}

      {busy && (
        <span className="absolute inset-0 flex items-center justify-center bg-surface/70">
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        </span>
      )}
    </span>
  )

  if (!editable) {
    /*
      The accessible name lives on a wrapper rather than the `alt`, because the image
      is decorative here: the person's name is already beside it in every usage, and
      "Chanda Mwansa Chanda Mwansa" is what an alt would produce.
    */
    return (
      <span role="img" aria-label={`${name}'s picture`}>
        {disc}
      </span>
    )
  }

  return (
    <span className="group relative inline-flex">
      {disc}

      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void upload(file)
          // Cleared so choosing the same file twice still fires a change.
          e.target.value = ''
        }}
      />

      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        aria-label={src ? `Change ${name}'s picture` : `Add a picture for ${name}`}
        className={cn(
          'absolute inset-0 flex items-center justify-center bg-foreground/55 text-background opacity-0 transition-opacity',
          square ? 'rounded-lg' : 'rounded-full',
          // Visible on hover for a mouse, and ALWAYS visible when there is no picture:
          // a hover-only affordance is invisible on a phone, which is where a teacher
          // would actually photograph a pupil.
          src ? 'hover:opacity-100 focus-visible:opacity-100' : 'opacity-100',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <Camera aria-hidden="true" className="size-4" />
      </button>
    </span>
  )
}

/**
 * The name-and-picture pair that a table row or a list item wants.
 *
 * Here rather than repeated per screen because every list in the references uses the
 * same shape — picture, name, and a quiet identifier beneath — and six copies of it
 * would drift within a week.
 */
export function AvatarName({
  name,
  src,
  secondary,
  size = 'md',
}: {
  name: string
  src?: string | null
  /** The student number, the role, the class — whatever identifies without shouting. */
  secondary?: string
  size?: AvatarSize
}): JSX.Element {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Avatar name={name} src={src} size={size} />
      <span className="min-w-0">
        <span className="block truncate font-medium">{name}</span>
        {secondary ? (
          <span data-numeric className="block truncate text-xs text-muted-foreground">
            {secondary}
          </span>
        ) : null}
      </span>
    </span>
  )
}
