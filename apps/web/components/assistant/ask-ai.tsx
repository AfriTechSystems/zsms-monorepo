'use client'

/**
 * The "Ask AI" trigger, and the panel it opens.
 *
 * Spec: `Official Documentation/18 AI Module/AI_ASSISTANT.md`
 *
 * ## One copy, in the shell
 *
 * Mounted once per portal shell rather than per screen. A control that appears on every
 * page belongs in the layout — the parent child-picker and the Hub signed-out branch were
 * both bugs caused by copying a control per page, and the fix each time was to move the
 * single copy up a level so every current and future page gets it.
 *
 * ## It knows where the user is
 *
 * The panel reads the pathname itself, which is what makes "who is missing marks here"
 * resolve to the class on screen. `basePath` is passed in because only the shell knows
 * the school code.
 */

import type { JSX } from 'react'
import { useState } from 'react'
import { Sparkles } from 'lucide-react'

import { AssistantPanel } from './assistant-panel'

export function AskAi({
  audience,
  basePath,
}: {
  audience: 'school' | 'teacher' | 'parent'
  basePath?: string
}): JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-tap items-center gap-1.5 rounded-md border border-border px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
      >
        <Sparkles aria-hidden="true" className="size-4 text-primary" />
        {/* The label is hidden on the narrowest screens, where the header has a school
            name and a user menu competing for the same row. The icon alone is still a
            44px target. */}
        <span className="hidden sm:inline">Ask AI</span>
        <span className="sr-only sm:hidden">Ask AI</span>
      </button>

      <AssistantPanel
        open={open}
        onClose={() => setOpen(false)}
        audience={audience}
        basePath={basePath}
      />
    </>
  )
}
