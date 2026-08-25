/**
 * What each school role may do, as the portal understands it.
 *
 * Spec: `Official Documentation/02 Authentication and Identity/ROLES.md`
 *       `Official Documentation/02 Authentication and Identity/PERMISSIONS.md`
 *       `Official Documentation/01 Foundation Layer/RLS.md`
 *
 * ## This file is not the boundary, and it must not be read as one
 *
 * Every query the portal issues goes through `createUserClient()`, so RLS
 * decides what comes back. An accountant who reaches the staff list by URL gets
 * an empty result from `management_read_staff`, not because of anything here.
 *
 * What this adds is a portal that does not offer what it cannot deliver. A nav
 * with six links of which three answer "you do not have access" is a worse
 * interface than a nav with three links, and an "Enrol pupil" button that always
 * fails is worse than no button. So the map below exists to *hide affordances*,
 * never to grant them.
 *
 * ## Every entry is transcribed from a policy, and says which
 *
 * The risk with a table like this is drift: the policy changes and the map does
 * not, so the portal starts hiding something a role can now do, or offering
 * something it cannot. Each capability therefore names the policy it mirrors.
 * When a policy moves, grep for its name here.
 *
 * Note the two that are easy to get backwards:
 *   - `org:accountant` CAN read students (`school_management_read_students`)
 *     but cannot enrol or edit one (`management_write_students`).
 *   - `org:admin` CAN read fee records (`admin_read_fee_records`, its own
 *     policy) but cannot change one (`fee_record_update`).
 *
 * ## Permission grants are deliberately absent
 *
 * Several policies admit `has_permission_grant(...)` as an alternative to the
 * role check — the custom-role system on the `org:staff` base (ADR-012). Those
 * grants are per-user rows, not a property of the role, so they cannot be
 * resolved from a JWT claim. A holder of a custom role therefore sees the
 * conservative nav and still succeeds at whatever their grants allow. Widening
 * the nav for them needs the grant list fetched per session; it is not
 * guesswork this file should do.
 */

import type { Role } from '@zsms/auth-provider'

/** Roles that hold a management view of the whole school. */
const MANAGEMENT: readonly Role[] = ['org:owner', 'org:principal', 'org:admin']

export type Capability =
  /** See the pupil roll. `school_management_read_students` + teacher scope. */
  | 'students:read'
  /** Enrol or edit a pupil. `management_write_students` / `management_update_students`. */
  | 'students:write'
  /** See fee records and balances. `financial_staff_read_fee_records` + `admin_read_fee_records`. */
  | 'fees:read'
  /** Record or adjust a fee. `fee_record_update`. */
  | 'fees:write'
  /** See the staff list. `management_read_staff`. */
  | 'staff:read'
  /** Add or change staff. `management_write_staff` — owner and principal only. */
  | 'staff:write'
  /** See attendance beyond one's own classes. `management_read_attendance`. */
  | 'attendance:read'
  /** Mark a register. `attendance_insert` / `attendance_update`, teacher scoped by class. */
  | 'attendance:write'
  /** See results across the school. */
  | 'results:read'
  /** Enter or publish marks. */
  | 'results:write'
  /** See who teaches what. `management_read_teacher_assignments`. */
  | 'assignments:read'
  /** Assign a teacher to a class or subject. `management_write_teacher_assignments` — owner and principal only. */
  | 'assignments:write'
  /** Compose and send announcements. `management_write_announcements`. */
  | 'announcements:write'
  /** Change the school's own record and academic structure. */
  | 'settings:write'

const CAPABILITIES: Record<Capability, readonly Role[]> = {
  'students:read': [...MANAGEMENT, 'org:accountant', 'org:teacher'],
  'students:write': MANAGEMENT,

  'fees:read': ['org:owner', 'org:principal', 'org:accountant', 'org:admin'],
  'fees:write': ['org:owner', 'org:accountant'],

  'staff:read': MANAGEMENT,
  'staff:write': ['org:owner', 'org:principal'],

  'attendance:read': [...MANAGEMENT, 'org:teacher'],
  'attendance:write': ['org:owner', 'org:principal', 'org:teacher'],

  'results:read': [...MANAGEMENT, 'org:teacher'],
  'results:write': ['org:owner', 'org:principal', 'org:teacher'],

  // A teacher also reads their OWN assignments through
  // `teacher_read_own_teacher_assignments`. That is a row-level grant, not a
  // capability, so it is not listed here — the teaching screen is a management
  // screen, and a teacher sees their scope on the screens it governs instead.
  'assignments:read': MANAGEMENT,
  'assignments:write': ['org:owner', 'org:principal'],

  'announcements:write': MANAGEMENT,

  'settings:write': ['org:owner', 'org:principal', 'org:admin'],
}

export function can(role: Role | 'none' | null | undefined, capability: Capability): boolean {
  if (!role || role === 'none') return false
  return (CAPABILITIES[capability] as readonly string[]).includes(role)
}

/**
 * Roles that belong in the school portal at all.
 *
 * Parents and students are school-org members but have their own portals with
 * their own shapes; landing them in the staff shell would show them a nav of
 * things they cannot open. `org:staff` is included — a custom-role holder is
 * staff, and their grants decide the rest.
 */
const PORTAL_ROLES: readonly Role[] = [
  'org:owner',
  'org:principal',
  'org:admin',
  'org:accountant',
  'org:teacher',
  'org:staff',
]

export function isPortalRole(role: Role | 'none' | null | undefined): boolean {
  if (!role || role === 'none') return false
  return (PORTAL_ROLES as readonly string[]).includes(role)
}

/** Display names, so a role never renders as a raw `org:` claim. */
export const ROLE_LABEL: Record<string, string> = {
  'org:owner': 'Owner',
  'org:principal': 'Principal',
  'org:admin': 'Administrator',
  'org:accountant': 'Accountant',
  'org:teacher': 'Teacher',
  'org:staff': 'Staff',
  'org:parent': 'Parent',
  'org:student': 'Pupil',
}
