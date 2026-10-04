/**
 * Every feature the parent app offers, and the state of each.
 *
 * Spec: `Official Documentation/07 Students and Parents/PARENT_PORTAL.md`
 *
 * ## One catalogue, like the teacher side
 *
 * The Home screen is a grid of everything a parent portal has, and the drawer groups
 * the same list. Unbuilt features are shown greyed rather than hidden, for the reason
 * agreed on the teacher app: a parent seeing "Timetable — coming soon" learns what the
 * product will do, and the grid stops reshuffling every time something ships.
 *
 * ## Gating is by LINK, not by role
 *
 * A parent has no Clerk organisation — `is_linked_parent_of()` reads the link row and
 * nothing else. So the only question that gates anything here is whether this account
 * is linked to a child yet. Somebody who has just signed up sees the whole grid with
 * the school half explained rather than a different, emptier app.
 */

import type { LucideIcon } from 'lucide-react-native'
import {
  BookOpen,
  CalendarCheck,
  CalendarDays,
  CreditCard,
  FileText,
  GraduationCap,
  Megaphone,
  MessageSquare,
  Receipt,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react-native'

export type ParentFeatureState =
  /** Reachable now. */
  | 'ready'
  /** Built, but this account is not linked to a child yet. */
  | 'needs-child'
  /** Not built yet. Shown so the grid does not reshuffle as things ship. */
  | 'coming'

export interface ParentFeature {
  key: string
  label: string
  icon: LucideIcon
  /** Where it goes. Null while `coming`. */
  href: string | null
  /** True when it only means anything once a child is linked. */
  needsChild: boolean
  built: boolean
  group: 'My children' | 'Money' | 'School' | 'Account'
  hint?: string
}

export const PARENT_FEATURES: ParentFeature[] = [
  // ---- My children --------------------------------------------------------
  {
    key: 'attendance',
    label: 'Attendance',
    icon: CalendarCheck,
    href: '/(parent)/(tabs)/attendance',
    needsChild: true,
    built: true,
    group: 'My children',
    hint: 'Who was in school, and when',
  },
  {
    key: 'results',
    label: 'Results',
    icon: GraduationCap,
    href: '/(parent)/(tabs)/results',
    needsChild: true,
    built: true,
    group: 'My children',
    hint: 'Marks and grades, once published',
  },
  {
    key: 'children',
    label: 'My children',
    icon: Users,
    href: '/(parent)/(tabs)/children',
    needsChild: false,
    built: true,
    group: 'My children',
    hint: 'Who you are linked to, and at which school',
  },
  {
    key: 'report-cards',
    label: 'Report cards',
    icon: FileText,
    href: null,
    needsChild: true,
    built: false,
    group: 'My children',
    hint: 'Download the end of term report',
  },
  {
    key: 'timetable',
    label: 'Timetable',
    icon: CalendarDays,
    href: null,
    needsChild: true,
    built: false,
    group: 'My children',
    hint: 'Your child’s week',
  },
  {
    key: 'homework',
    label: 'Homework',
    icon: BookOpen,
    href: null,
    needsChild: true,
    built: false,
    group: 'My children',
    hint: 'What has been set, and when it is due',
  },

  // ---- Money --------------------------------------------------------------
  {
    key: 'fees',
    label: 'Fees',
    icon: Wallet,
    href: '/(parent)/(tabs)/fees',
    needsChild: true,
    built: true,
    group: 'Money',
    hint: 'What is owed and what has been paid',
  },
  {
    key: 'receipts',
    label: 'Receipts',
    icon: Receipt,
    href: null,
    needsChild: true,
    built: false,
    group: 'Money',
    hint: 'Download a receipt for a payment',
  },
  {
    key: 'pay',
    label: 'Pay fees',
    icon: CreditCard,
    href: null,
    needsChild: true,
    built: false,
    group: 'Money',
    hint: 'Pay by mobile money or card',
  },

  // ---- School -------------------------------------------------------------
  {
    key: 'notices',
    label: 'Notices',
    icon: Megaphone,
    href: '/(parent)/(tabs)/notices',
    needsChild: true,
    built: true,
    group: 'School',
    hint: 'What the school has announced',
  },
  {
    key: 'message',
    label: 'Message school',
    icon: MessageSquare,
    href: null,
    needsChild: true,
    built: false,
    group: 'School',
    hint: 'Ask the office or a class teacher',
  },

  // ---- Account ------------------------------------------------------------
  {
    key: 'account',
    label: 'My account',
    icon: UserCog,
    href: '/(parent)/(tabs)/account',
    needsChild: false,
    built: true,
    group: 'Account',
    hint: 'Your details, notifications and your data',
  },
]

/**
 * The state of one feature for this parent.
 *
 * `coming` beats `needs-child`: somebody with no child linked should not be told that
 * an unbuilt feature is merely locked, which reads as "link a child and you can have
 * it" — an offer the product cannot keep.
 */
export function parentFeatureState(
  feature: ParentFeature,
  hasChild: boolean,
): ParentFeatureState {
  if (!feature.built) return 'coming'
  if (feature.needsChild && !hasChild) return 'needs-child'
  return 'ready'
}
