'use client'

/**
 * Makes sure the signed-in member of staff is on their school's roll.
 *
 * Spec: `Official Documentation/08 Staff Management/INVITATIONS.md`
 *
 * ## Why this exists at all
 *
 * Accepting a Clerk invitation creates an organisation membership and nothing else. Until
 * `0184` nothing ever wrote the matching `staff_members` row, so an accepted teacher held a
 * role, passed RLS, and was **invisible on the Staff screen, unassignable to a class, and
 * absent from every recipient list** — every one of which reads `staff_members`, not Clerk.
 *
 * ## Once per mount, and it renders nothing
 *
 * `ensure_my_staff_record()` is idempotent and returns early when a record exists, so the
 * cost of being wrong here is one indexed lookup. The guard is a ref rather than state
 * because re-rendering must not re-fire it, and React's development double-mount would
 * otherwise send it twice.
 *
 * ## Failure is silent, deliberately
 *
 * A teacher who opens the portal has something to do. If reconciliation fails — offline,
 * a transient 500 — the right outcome is that the rest of the page still works and the
 * next launch tries again, not a banner about a record they have never heard of. The
 * school-side symptom (a missing name on the Staff screen) is visible to the person who
 * can act on it.
 */

import { useEffect, useRef } from 'react'
import { useUser } from '@zsms/auth-provider/react'

export function StaffRecordSync(): null {
  const { user } = useUser()
  const done = useRef(false)

  useEffect(() => {
    // Wait for Clerk: firing without a name would write the placeholder the function
    // substitutes, and the school would see "Unnamed Staff member" for somebody whose
    // name was available a moment later.
    if (!user || done.current) return
    done.current = true

    void fetch('/api/session/staff-record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: user.firstName ?? undefined,
        lastName: user.lastName ?? undefined,
      }),
    }).catch(() => {
      // See the header. The next launch retries.
    })
  }, [user])

  return null
}
