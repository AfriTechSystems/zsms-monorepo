'use client'

/**
 * This school's audit trail.
 *
 * Spec: `Official Documentation/09 Fee and Financial Management/AUDIT.md`
 *
 * Readable by the owner and the principal only — `leadership_read_own_school_audit_logs`.
 * An accountant cannot read it, which is deliberate: the trail is partly a record of what
 * the accountant did, and a log its subject can read is a log they can be pressured over.
 *
 * No role check in this file. The policy returns an empty list to anybody else, and a
 * second copy of the rule here would be the one that drifts.
 */

import type { JSX } from 'react'
import { use } from 'react'

import { AuditTrail } from '../../../../../components/audit/audit-trail'
import { PageHeader } from '../../../../../components/ui/data-states'

export default function SchoolAuditPage({
  params,
}: {
  params: Promise<{ schoolCode: string }>
}): JSX.Element {
  // Consumed so the dynamic segment is read; the trail scopes itself through RLS and
  // must never take a school from the URL.
  use(params)

  return (
    <>
      <PageHeader
        title="Audit trail"
        description="Who changed what in your school, and when."
        note="Payments, fee records, pupil records, marks, attendance, staff, parent links and where parents pay are all recorded. Only the owner and the principal can read this."
      />
      <AuditTrail />
    </>
  )
}
