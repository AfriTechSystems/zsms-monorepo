'use client'

/**
 * Moving the whole school up a year.
 *
 * Spec: `Official Documentation/07 Student and Parent Modules/STUDENTS.md`
 *         → *Student Grade Promotion*
 *
 * ## Preview, then confirm, because there is no undo
 *
 * Promotion rewrites every pupil's grade in one statement. A school that ran it against the
 * wrong year — or twice — would have no remedy short of a database restore. So the preview
 * is the default and the real run is a second, deliberate act with the counts on screen.
 *
 * `STUDENTS.md` shows exactly this: a preview listing each grade's destination, then
 * "[Preview promotion] [Run promotion]".
 *
 * ## The final year is shown, not hidden
 *
 * Pupils in the highest grade are listed as graduating rather than omitted. A principal
 * needs to see that 38 Form 6 pupils are NOT being moved — otherwise the only way to learn
 * it is to count the roll afterwards and find them still there.
 */

import type { JSX } from 'react'
import { useCallback, useState } from 'react'
import { ArrowUp, LoaderCircle } from 'lucide-react'

import { Alert } from '../../../../components/ui/alert'
import { Badge } from '../../../../components/ui/badge'
import { Button } from '../../../../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../../components/ui/card'
import { apiSend } from '../../../../lib/use-api'
import { useToast } from '../../../../components/ui/toast'
import { formatLevel } from '../school-shared'

interface GradeRow {
  out_from_grade: string
  out_to_grade: string
  out_pupils: number
  out_is_final: boolean
}

interface Preview {
  grades: GradeRow[]
  moving: number
  graduating: number
}

export function YearEnd({ onDone }: { onDone: () => void }): JSX.Element {
  const { toast } = useToast()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const run = useCallback(
    async (dryRun: boolean) => {
      setBusy(true)
      try {
        const result = await apiSend<Preview>('/api/school/students/year-end', 'POST', {
          action: 'promote',
          dryRun,
        })

        if (result.error) {
          toast(result.error, 'danger')
          return
        }

        if (dryRun) {
          setPreview(result.data ?? null)
          setConfirming(true)
          return
        }

        toast(
          `${result.data?.moving ?? 0} pupils moved up. ${result.data?.graduating ?? 0} are in their final year and were left where they are.`,
          'success',
        )
        setPreview(null)
        setConfirming(false)
        onDone()
      } finally {
        setBusy(false)
      }
    },
    [toast, onDone],
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowUp aria-hidden="true" className="size-5 text-primary" />
          Move everyone up a year
        </CardTitle>
        <CardDescription>
          Every pupil moves to the next grade the school runs, keeping their stream — Grade 8A
          becomes Grade 9A. Pupils in the final year stay where they are.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-cards">
        {!confirming ? (
          <div>
            <Button disabled={busy} onClick={() => void run(true)}>
              {busy && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
              Preview the promotion
            </Button>
          </div>
        ) : (
          <>
            <ul className="flex flex-col gap-1">
              {(preview?.grades ?? []).map((g) => (
                <li
                  key={g.out_from_grade}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-sm"
                >
                  <span className="min-w-[6rem] font-medium">
                    {formatLevel(g.out_from_grade)}
                  </span>
                  <span aria-hidden="true" className="text-muted-foreground">
                    →
                  </span>
                  {g.out_is_final ? (
                    // Shown rather than omitted: a principal needs to see that these
                    // pupils are deliberately not moving.
                    <Badge variant="neutral">Final year — graduate separately</Badge>
                  ) : (
                    <span className="font-medium">{formatLevel(g.out_to_grade)}</span>
                  )}
                  <span data-numeric className="ml-auto text-muted-foreground">
                    {g.out_pupils} pupils
                  </span>
                </li>
              ))}
            </ul>

            <Alert variant="warning" title="This cannot be undone">
              <span data-numeric>{preview?.moving ?? 0}</span> pupils will move up.{' '}
              <span data-numeric>{preview?.graduating ?? 0}</span> in their final year will stay
              where they are. Running this twice moves everyone up twice.
            </Alert>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="destructive" disabled={busy} onClick={() => void run(false)}>
                {busy && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
                Move {preview?.moving ?? 0} pupils up
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
