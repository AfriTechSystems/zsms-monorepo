'use client'

/**
 * The prompt a parent sees once, when a child has left.
 *
 * Spec: `07 Student and Parent Modules/TRANSFER.md` → *Marketing Opt-In at Transfer*,
 *       `PARENT_LINKING.md` → *Parent Account After Graduation*, ADR-015
 *
 * ## Why this exists as a moment rather than a setting
 *
 * `/parent/account` already lets a parent turn AfriTech's news on whenever they like,
 * and essentially nobody goes looking for it. Both documents describe a prompt at the
 * point a child leaves — which is the one moment the question is natural, and the one
 * moment the consent is unambiguous because they were asked in context.
 *
 * ## Never pre-ticked, and the schema cannot enforce that
 *
 * `0229` guarantees the column defaults FALSE, so silence never becomes consent. The
 * checkbox below starting unticked is the part only this file can get right, and it is
 * the part a growth-minded change would quietly flip.
 *
 * ## Continue is an answer
 *
 * Clicking through without ticking records that they were asked. A parent who declines
 * and is asked again every login has not been asked once — they have been nagged, which
 * is what a monthly cap on messages is supposed to rule out.
 */

import type { JSX } from 'react'
import { useState } from 'react'
import { GraduationCap } from 'lucide-react'

import { Card } from '../ui/card'
import { Button } from '../ui/button'

export interface DeparturePrompt {
  studentName: string | null
  schoolName: string | null
  status: string | null
}

const LEAVING: Record<string, string> = {
  graduated: 'has graduated',
  transferred: 'has been transferred',
  withdrawn: 'has left',
}

export function DeparturePromptCard({
  prompt,
  onAnswered,
}: {
  prompt: DeparturePrompt
  onAnswered: () => void
}): JSX.Element {
  // Unticked. See the header — this is the line that matters most in the file.
  const [optIn, setOptIn] = useState(false)
  const [saving, setSaving] = useState(false)

  async function answer(): Promise<void> {
    setSaving(true)
    try {
      await fetch('/api/parent/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optIn }),
      })
    } finally {
      /*
        The card goes either way, including on a network failure. Leaving it up after
        a click reads as the button being broken, and the worst case is that a parent
        is asked once more on their next visit — which is better than a card they
        cannot dismiss.
      */
      onAnswered()
      setSaving(false)
    }
  }

  const name = prompt.studentName ?? 'Your child'
  const verb = LEAVING[prompt.status ?? ''] ?? 'has left'

  return (
    <Card className="border-primary/40 bg-primary/5 p-card">
      <GraduationCap aria-hidden="true" className="h-6 w-6 text-primary" />

      <h2 className="mt-stack font-medium">
        {name} {verb}.
      </h2>

      <p className="mt-1 text-sm text-muted-foreground">
        Thank you for being part of {prompt.schoolName ?? 'the school'}.{' '}
        {/*
          Said before the ask, not after. A parent's first worry when a child leaves is
          whether the reports go with them — and ADR-015 means they do not.
        */}
        {name}&rsquo;s records stay in your account, so you can come back for a report
        card or a receipt whenever you need one.
      </p>

      <div className="mt-stack rounded-md border border-border bg-surface p-3">
        <p className="text-sm font-medium">Stay connected with AfriTech</p>
        <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
          <li>Scholarship opportunities</li>
          <li>Educational resources</li>
          <li>Community updates</li>
        </ul>

        <label className="mt-stack flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-primary"
            checked={optIn}
            onChange={(e) => setOptIn(e.target.checked)}
          />
          <span>
            Yes, I&rsquo;d like to receive opportunities from AfriTech
            <span className="block text-xs text-muted-foreground">
              At most four messages a month. You can stop them any time from your
              account.
            </span>
          </span>
        </label>
      </div>

      <Button className="mt-stack" onClick={() => void answer()} disabled={saving}>
        {saving ? 'Saving…' : 'Continue to my account'}
      </Button>

      <p className="mt-2 text-xs text-muted-foreground">
        {/*
          Stated plainly, because a parent who leaves the box alone should know that is
          a complete answer rather than wondering whether they must tick something.
        */}
        Leaving the box unticked is fine — you will not be asked again, and nothing
        changes about messages from {prompt.schoolName ?? 'the school'}.
      </p>
    </Card>
  )
}
