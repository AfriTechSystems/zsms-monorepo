/**
 * The shape of a portal's navigation.
 *
 * ## Grouped by job, not by table
 *
 * A school administrator thinks *I need to chase arrears*, not *I need the `fee_records`
 * table*. So the groups are named for the work — "Money", "People", "Academics" — and a
 * feature sits under the group whose job it serves. The previous flat row of nine links made
 * the reader scan all nine every time, because nothing said which three were about money.
 *
 * ## Why this is data
 *
 * Four portals share one renderer. Keeping the structure as a value means a new screen is a
 * line in an array rather than JSX in a nav component, and it means the permission filter, the
 * active-route logic and the keyboard handling exist once instead of four times — which is how
 * the old top navs drifted apart in the first place.
 */

import type { LucideIcon } from 'lucide-react'

import type { Capability } from '../../lib/roles'

export interface NavItem {
  /** Appended to the portal's base path. `''` is the portal root. */
  path: string
  label: string
  icon: LucideIcon
  /**
   * `true` matches only this exact path. A portal root must be exact, or it stays highlighted
   * on every child route and the sidebar stops telling you where you are.
   */
  exact?: boolean
  /** Hidden unless the role holds this capability. `undefined` means always visible. */
  needs?: Capability
  /**
   * A count or short status shown at the end of the row — open incidents, unmarked registers.
   * The thing that makes a sidebar actively useful rather than only a way to move around.
   */
  badge?: number | string | null
}

export interface NavGroup {
  /**
   * `null` renders the items with no heading, which is right for a single-item group like the
   * portal root — a heading above one link is noise.
   */
  label: string | null
  items: NavItem[]
  /** Collapsed by default. For a group most users open rarely, like Settings. */
  defaultCollapsed?: boolean
}
