'use client'

/**
 * The platform audit trail.
 *
 * Spec: `Official Documentation/09 Fee and Financial Management/AUDIT.md`,
 *       `Official Documentation/15 Super Admin and Platform/SUPERADMIN.md`
 *
 * AfriTech sees every school, by policy — `leadership_read_own_school_audit_logs` admits
 * `is_afritech_admin()` without a school clause. The scope is stated on the page rather
 * than implied, because an operator reading a trail needs to know whether they are
 * looking at one school or all of them before they draw a conclusion from it.
 */

import type { JSX } from 'react'

import { AuditTrail } from '../../../components/audit/audit-trail'
import { PageHeader } from '../../../components/ui/data-states'

export default function AdminAuditPage(): JSX.Element {
  return (
    <>
      <PageHeader
        title="Audit trail"
        description="Every recorded action, across every school."
        note="Actions taken while impersonating are flagged and name both the operator and the account they were acting as."
      />
      <AuditTrail />
    </>
  )
}
