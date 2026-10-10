/**
 * Everywhere an account can go.
 *
 * Spec: `Official Documentation/02 Authentication and Identity/AUTH.md`
 *
 * ## One person is often several audiences at once
 *
 * Reported from the running application on 2026-10-02: the same address is a parent, a
 * teacher, and possibly a school owner — **all true simultaneously**, and in a small
 * Zambian private school that is ordinary rather than unusual. A head teacher's own
 * children attend the school they run.
 *
 * `/welcome` routed on the FIRST match and redirected, so an owner who was also a parent
 * landed in the school portal and never learned the parent portal existed. The routing
 * was a cascade where it needed to be an inventory.
 *
 * ## Why this is a shared helper rather than only a route
 *
 * `/welcome` decides where to send somebody and `PortalSwitch` decides whether to offer a
 * way back. Both need the same answer, and two enumerations would drift — with the
 * server's copy deciding the redirect and the client's copy deciding whether a control
 * appears, which is exactly the pair that must agree.
 *
 * ## Two sources, because the answer lives in two places
 *
 *   * **Clerk** owns organisation membership, and a session acts in ONE organisation at a
 *     time. A second school needs `setActive` before its portal resolves.
 *   * **The database** owns everything else. A parent has no organisation at all —
 *     `is_linked_parent_of()` reads the link row — and a standalone Hub account has none.
 *
 * `my_schools()` (`0117`) already returns every school with the relationship named, so
 * this adds only what it does not cover: AfriTech, the Hub, and the network.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { SessionUser } from '@zsms/auth-provider'

import { listUserOrganisations } from '@zsms/auth-provider/organisations'

import { AFRITECH_ORG_SLUG } from './admin-context'

export interface Portal {
  /** Stable identity for the client; `school` entries append the code. */
  key: string
  kind: 'admin' | 'school' | 'parent' | 'teacher' | 'network'
  label: string
  description: string
  href: string
  /**
   * The Clerk organisation this portal needs active.
   *
   * Null means none is required — the parent portal and the Hub are reachable from any
   * session. Non-null means the client must `setActive` before navigating, or the portal
   * resolves to whichever organisation the session currently holds.
   */
  organisationId: string | null
  /** True when the session already holds the organisation this portal needs. */
  ready: boolean
}

export async function listPortals(
  client: SupabaseClient,
  session: SessionUser,
): Promise<Portal[]> {
  const portals: Portal[] = []

  /*
    ---- AfriTech ------------------------------------------------------------

    Detected from the account's MEMBERSHIPS, not the active organisation.

    Found on 2026-10-02: comparing `session.organisationSlug` found AfriTech only when
    it happened to be the organisation the session was already in. An account that is
    both an administrator and a school owner therefore reported one portal — whichever
    was active — and the other was unreachable without knowing to switch first, which is
    precisely what the chooser exists to remove.

    Clerk is allowed to fail. An inventory missing AfriTech is worse than the old bug but
    not fatal; one that throws leaves the person on a blank `/welcome` with no way
    anywhere, which is the lockout this page was built to end.
  */
  const memberships = await listUserOrganisations(session.userId).catch(() => [])
  const afritech = memberships.find((m) => m.slug === AFRITECH_ORG_SLUG)

  if (afritech) {
    portals.push({
      key: 'admin',
      kind: 'admin',
      label: 'AfriTech admin',
      description: 'Every school on the platform, billing and support.',
      href: '/admin',
      organisationId: afritech.organisationId,
      // `/admin` resolves through the active organisation like any other portal, so an
      // administrator currently inside a school has to switch before it will open.
      ready: afritech.organisationId === session.organisationId,
    })
  }

  // ---- Schools, through `my_schools()` ------------------------------------
  const schools = await client.rpc('my_schools')

  type SchoolRow = {
    out_school_code: string
    out_school_name: string
    out_clerk_org_id: string | null
    out_relationship: string
  }

  const rows = (schools.data ?? []) as unknown as SchoolRow[]

  // A parent at three schools is still ONE parent portal — the portal itself has a
  // school switcher. Staff at three schools is three portals, because each is a
  // different organisation with different access.
  let parentSchools = 0

  for (const r of rows) {
    if (r.out_relationship === 'parent' || r.out_relationship === 'student') {
      parentSchools += 1
      continue
    }

    portals.push({
      key: `school:${r.out_school_code}`,
      kind: 'school',
      label: r.out_school_name,
      description: `${titleCase(r.out_relationship)} · ${r.out_school_code}`,
      href: `/school/${r.out_school_code.toLowerCase()}`,
      organisationId: r.out_clerk_org_id,
      // A school portal resolves through the ACTIVE organisation, so one the session
      // does not hold needs a switch first. The client uses this to decide whether
      // tapping it navigates or switches then navigates.
      ready: r.out_clerk_org_id === session.organisationId,
    })
  }

  if (parentSchools > 0) {
    portals.push({
      key: 'parent',
      kind: 'parent',
      label: 'Parent',
      description:
        parentSchools === 1
          ? "Your child's attendance, results and fees."
          : `Your children at ${parentSchools} schools.`,
      href: '/parent',
      // No organisation: a parent's access is the link row, which is why `/welcome`
      // can link them by verified email without inviting them to anything.
      organisationId: null,
      ready: true,
    })
  }

  // ---- The Teacher Hub ----------------------------------------------------
  const hub = await client
    .from('standalone_teacher_accounts')
    .select('clerk_user_id')
    .maybeSingle()

  if (hub.data) {
    portals.push({
      key: 'teacher',
      kind: 'teacher',
      label: 'Teacher Hub',
      description: 'Your lesson plans, quizzes and homework.',
      href: '/teacher',
      organisationId: null,
      ready: true,
    })
  }

  // ---- A school network ---------------------------------------------------
  const networks = await client.rpc('my_networks')
  const netRows = (networks.data ?? []) as unknown as Array<{
    out_name: string
    out_schools: number
  }>

  if (netRows.length > 0) {
    portals.push({
      key: 'network',
      kind: 'network',
      label: netRows[0]?.out_name ?? 'School network',
      description: `${netRows[0]?.out_schools ?? 0} schools, consolidated.`,
      href: '/network',
      organisationId: null,
      ready: true,
    })
  }


  return portals
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ')
}
