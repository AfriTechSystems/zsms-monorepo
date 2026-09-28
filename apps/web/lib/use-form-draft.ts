'use client'

/**
 * Keeps a half-finished form so leaving the page, losing signal, or closing the tab does not
 * throw the work away.
 *
 * Spec: `Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md`
 *
 * ## The rule that shapes everything here: an ALLOWLIST, never a denylist
 *
 * `fields` names exactly what gets written to the browser. The tempting alternative is to save
 * the whole form and strip the sensitive parts — and it fails in the one direction that matters.
 * With a denylist, a field added next year is persisted **by default**, and nobody finds out. The
 * failure mode of an allowlist is a draft that does not restore one box. The failure mode of a
 * denylist is a pupil's identity number sitting in `localStorage` on a school office computer.
 *
 * Which is not hypothetical. A shared machine in a school office is the **normal** case here, not
 * the edge case, and `localStorage` survives sign-out. So:
 *
 *   - every key is namespaced by the **Clerk user id**, so one member of staff cannot restore
 *     another's draft into their own form;
 *   - `clearAllDrafts()` runs on sign-out, so the data does not outlive the session;
 *   - a draft older than `MAX_AGE_DAYS` is discarded on read, because restoring last month's
 *     half-written announcement is confusing rather than helpful.
 *
 * **Do not use this for a form containing `nrc_or_birth_cert`, a medical note, a payment
 * reference, or anything under a `sensitivity = 'sensitive'` custom field**, even by allowlisting
 * a field individually. That decision has not been taken, and the enrolment and payment forms are
 * deliberately not wired up.
 *
 * ## Storage can throw rather than return null
 *
 * Every access is wrapped. A private window, or a browser set to block site data, raises on the
 * property access itself — the documented pattern in this repository, and why `no-empty` allows an
 * empty catch.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

const PREFIX = 'zsms.draft.'
const MAX_AGE_DAYS = 7
/**
 * Long enough that typing a sentence is one write rather than forty, short enough that a browser
 * closed mid-thought loses at most this much.
 */
const DEBOUNCE_MS = 600

interface StoredDraft {
  savedAt: number
  values: Record<string, unknown>
}

function read(key: string): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (
      typeof parsed !== 'object' || parsed === null
      || typeof (parsed as StoredDraft).savedAt !== 'number'
    ) {
      return null
    }
    return parsed as StoredDraft
  } catch {
    return null
  }
}

function write(key: string, draft: StoredDraft): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(draft))
  } catch {
    // Quota exceeded, or storage blocked. A draft that cannot be saved is a draft that is not
    // there later — nothing else breaks, and the form still works.
  }
}

function remove(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // As above.
  }
}

/**
 * Removes every ZSMS draft in this browser. Called on sign-out, which is the whole reason it
 * exists: on a shared office machine the next person to sign in must not be able to find the
 * previous one's half-written announcement by opening the same form.
 */
export function clearAllDrafts(): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i)
      if (key?.startsWith(PREFIX)) keys.push(key)
    }
    // Collected first, then removed: removing while iterating shifts the indices and skips keys.
    for (const key of keys) window.localStorage.removeItem(key)
  } catch {
    // Nothing to do. The drafts are per-user-keyed anyway, so the fallback is that they expire.
  }
}

export interface UseFormDraftOptions<T extends Record<string, unknown>> {
  /** Stable identifier for this form. `announcement`, `import-mapping`, `hub-profile`. */
  formId: string
  /**
   * The signed-in user. Namespacing by it is what stops one member of staff restoring another's
   * draft on a shared computer, so a draft is NOT saved at all while this is undefined.
   */
  userId: string | null | undefined
  /** A record, a pupil, a school — so two drafts of the same form do not collide. */
  scopeId?: string | null
  /** Current form values. Only the keys named in `fields` are read from it. */
  values: T
  /** **The allowlist.** Exactly these keys are written. Nothing else ever is. */
  fields: Array<keyof T & string>
  /** Suppresses saving — while submitting, or before the form is ready. */
  enabled?: boolean
}

export interface FormDraft<T> {
  /** A recovered draft, or null. Present only until restored or discarded. */
  pending: Partial<T> | null
  /** When it was saved, for "from 20 minutes ago". */
  savedAt: Date | null
  /** Applies the draft and dismisses the prompt. */
  restore: () => Partial<T> | null
  /** Throws the draft away and dismisses the prompt. */
  discard: () => void
  /** Call after a successful submit, so a saved form does not offer to restore itself. */
  clear: () => void
}

export function useFormDraft<T extends Record<string, unknown>>({
  formId,
  userId,
  scopeId,
  values,
  fields,
  enabled = true,
}: UseFormDraftOptions<T>): FormDraft<T> {
  const key = userId ? `${PREFIX}${userId}.${formId}${scopeId ? `.${scopeId}` : ''}` : null

  const [pending, setPending] = useState<Partial<T> | null>(null)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  /**
   * Set once a draft has been offered or dismissed. Without it, the save effect below would write
   * the empty initial form over a stored draft before the user has had the chance to restore it —
   * which is the obvious bug in every implementation of this.
   */
  const settled = useRef(false)

  // Read once, after mount. Reading storage during render makes server and client markup disagree.
  useEffect(() => {
    if (!key) return
    const stored = read(key)
    if (!stored) {
      settled.current = true
      return
    }

    const ageDays = (Date.now() - stored.savedAt) / 86_400_000
    if (ageDays > MAX_AGE_DAYS) {
      remove(key)
      settled.current = true
      return
    }

    setPending(stored.values as Partial<T>)
    setSavedAt(new Date(stored.savedAt))
  }, [key])

  // Debounced save of the allowlisted fields only.
  useEffect(() => {
    if (!key || !enabled || !settled.current) return

    const timer = setTimeout(() => {
      const subset: Record<string, unknown> = {}
      let hasContent = false

      for (const field of fields) {
        const value = values[field]
        if (value === undefined || value === null || value === '') continue
        if (Array.isArray(value) && value.length === 0) continue
        subset[field] = value
        hasContent = true
      }

      // An empty form is not a draft. Saving one would mean a user who opened a form, typed
      // nothing and left is offered a restore of nothing next time.
      if (!hasContent) {
        remove(key)
        return
      }

      write(key, { savedAt: Date.now(), values: subset })
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [key, enabled, fields, values])

  const restore = useCallback((): Partial<T> | null => {
    settled.current = true
    const draft = pending
    setPending(null)
    return draft
  }, [pending])

  const discard = useCallback((): void => {
    settled.current = true
    setPending(null)
    setSavedAt(null)
    if (key) remove(key)
  }, [key])

  const clear = useCallback((): void => {
    settled.current = true
    setPending(null)
    setSavedAt(null)
    if (key) remove(key)
  }, [key])

  return { pending, savedAt, restore, discard, clear }
}

/** "20 minutes ago" — a draft's age is only ever asked relatively. */
export function draftAge(savedAt: Date | null): string {
  if (!savedAt) return ''
  const mins = Math.round((Date.now() - savedAt.getTime()) / 60_000)
  if (mins < 1) return 'a moment ago'
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
