'use client'

/**
 * Transient confirmation, anchored to the viewport rather than to a button.
 *
 * Spec: `Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md`
 *
 * ## Why "Saved." next to the button was not enough
 *
 * Every form so far confirms by putting a word beside its submit button. On a
 * laptop that works. On a phone the button is often the last thing on a long
 * form, and the act of saving scrolls or re-renders the page — so the
 * confirmation appears somewhere the reader is not looking, and the honest
 * result is that people press Save twice.
 *
 * A toast is fixed to the bottom of the viewport, so it is in the same place
 * regardless of scroll position or form length.
 *
 * ## It announces, and it never carries the only copy of anything
 *
 * `role="status"` with `aria-live="polite"` so a screen reader hears it without
 * being interrupted mid-sentence. And nothing important lives *only* here: a
 * toast disappears, so an error that needs acting on stays in an `Alert` beside
 * the field. Toasts confirm; they do not inform.
 *
 * Bottom rather than top on purpose — a top toast on a phone lands under the
 * browser's address bar, and on this portal the thumb is already at the bottom.
 */

import type { JSX, ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Check, TriangleAlert, X } from 'lucide-react'

import { cn } from '../../lib/utils'

type Tone = 'success' | 'danger'

interface ToastState {
  id: number
  tone: Tone
  message: string
}

interface ToastApi {
  /** Confirms something that happened. Disappears on its own. */
  toast: (message: string, tone?: Tone) => void
}

const ToastContext = createContext<ToastApi | null>(null)

/**
 * Read by any screen that wants to confirm an action.
 *
 * Returns a no-op outside the provider rather than throwing. A component that
 * confirms a save should not crash the page because it was rendered somewhere
 * without a provider — the save still happened, and that is the important part.
 */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? { toast: () => undefined }
}

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [items, setItems] = useState<ToastState[]>([])

  const toast = useCallback((message: string, tone: Tone = 'success') => {
    // `Date.now()` plus a random tail: two toasts fired in the same millisecond
    // would otherwise share a key and React would reuse one element for both.
    const id = Date.now() + Math.random()
    setItems((current) => [...current, { id, tone, message }])
  }, [])

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((t) => t.id !== id))
  }, [])

  const api = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        // `pointer-events-none` on the container so the strip never blocks a
        // control underneath it; each toast re-enables its own events for the
        // dismiss button.
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-gutter"
      >
        {items.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }): JSX.Element {
  useEffect(() => {
    // Long enough to read a sentence, short enough not to sit over the next
    // thing someone does. A danger toast lingers because it is more likely to
    // matter, though anything requiring action belongs in an Alert instead.
    const ms = toast.tone === 'danger' ? 7000 : 4000
    const timer = setTimeout(onDismiss, ms)
    return () => clearTimeout(timer)
  }, [toast.tone, onDismiss])

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'pointer-events-auto flex w-full max-w-md items-start gap-2 rounded-lg border p-3 shadow-lg',
        'animate-in slide-in-from-bottom-2',
        toast.tone === 'success'
          ? 'border-success bg-success-tint text-success-text'
          : 'border-danger bg-danger-tint text-danger-text',
      )}
    >
      {toast.tone === 'success' ? (
        <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      ) : (
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      )}
      <span className="flex-1 text-sm">{toast.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="-m-1 rounded p-1 opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X aria-hidden="true" className="size-4" />
        <span className="sr-only">Dismiss</span>
      </button>
    </div>
  )
}
