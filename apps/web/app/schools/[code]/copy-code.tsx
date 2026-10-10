'use client'

/**
 * The school code, with a copy button.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/PUBLIC_DIRECTORY.md`
 *       → *School ID Display and Copy*
 *
 * A client island inside an otherwise server-rendered page. The profile page has to be server-rendered
 * — its whole purpose is ranking in search results, which needs the content in the HTML — and a copy
 * button needs the clipboard. So this is the smallest possible piece marked `'use client'`, and the
 * code itself is passed in as a prop so it is present in the markup a crawler reads either way.
 *
 * `navigator.clipboard` is unavailable over plain HTTP and can be refused by the browser, so the
 * failure path keeps the code visible and selectable rather than reporting success it did not achieve.
 */

import type { JSX } from 'react'
import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

import { Button } from '../../../components/ui/button'

export function CopyCode({ code }: { code: string }): JSX.Element {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code)
      setState('copied')
      // Two seconds, per the document. Long enough to notice, short enough that the button is back
      // to its normal label before anybody tries again.
      setTimeout(() => setState('idle'), 2000)
    } catch {
      setState('failed')
    }
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-3">
      {/* `select-all` so a tap selects the whole code — which is the fallback when the clipboard is
          unavailable, and is how most people on an older Android browser will actually copy it. */}
      <span className="select-all font-mono text-2xl font-semibold tracking-tight">{code}</span>
      <Button size="sm" variant="outline" onClick={() => void copy()}>
        {state === 'copied' ? (
          <>
            <Check aria-hidden="true" />
            Copied
          </>
        ) : (
          <>
            <Copy aria-hidden="true" />
            Copy
          </>
        )}
      </Button>
      {/* Announced, because the visual change on the button is not conveyed to a screen reader. */}
      <span role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {state === 'copied' ? 'School code copied.' : ''}
        {state === 'failed' ? 'Could not copy — select the code above instead.' : ''}
      </span>
    </div>
  )
}
