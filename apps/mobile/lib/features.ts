/**
 * Every feature the teacher app offers, and the state of each.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *       `Official Documentation/10 Attendance/ATTENDANCE.md`
 *
 * ## One catalogue, so the shell does not restructure itself
 *
 * The dashboard is a grid of every feature a teacher portal has. Linking to a school does
 * not rearrange the app — it **ungates** the school half. A teacher who joins a school in
 * March should recognise the screen they used in February, with more of it available.
 *
 * That is why gating lives in data rather than in two different layouts.
 *
 * ## Unbuilt features are shown, greyed
 *
 * Decided on 2026-10-02: a teacher seeing "Timetable — coming soon" learns what the
 * product will do, and the grid stops reshuffling every time something ships. Hiding them
 * would make each release move every icon, which is worse than an honest placeholder.
 *
 * `state` carries the reason, because "not built" and "needs your school" are different
 * answers and a teacher can act on exactly one of them.
 */

import type { LucideIcon } from 'lucide-react-native'
import {
  BookOpen,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  CreditCard,
  FileText,
  FolderOpen,
  GraduationCap,
  Library,
  MessageSquare,
  Users,
  WandSparkles,
} from 'lucide-react-native'

export type FeatureState =
  /** Reachable now. */
  | 'ready'
  /** Built, but needs a school link this account does not have. */
  | 'needs-school'
  /** Not built yet. Shown so the grid does not reshuffle as things ship. */
  | 'coming'

export interface Feature {
  key: string
  label: string
  icon: LucideIcon
  /** Where it goes. Null while `coming`. */
  href: string | null
  /** True when it only makes sense inside a school. */
  schoolOnly: boolean
  built: boolean
  group: 'Teaching' | 'My tools' | 'School' | 'Account'
  /** Shown under the label on the More screen, never on the grid. */
  hint?: string
}

export const FEATURES: Feature[] = [
  // ---- Teaching: what a linked teacher does daily ------------------------
  {
    key: 'attendance',
    label: 'Attendance',
    icon: CalendarCheck,
    href: '/(teacher)/(tabs)/attendance',
    schoolOnly: true,
    built: true,
    group: 'Teaching',
    hint: 'Mark today’s register',
  },
  {
    key: 'marks',
    label: 'Marks',
    icon: ClipboardList,
    href: '/(teacher)/(tabs)/marks',
    schoolOnly: true,
    built: true,
    group: 'Teaching',
    hint: 'Enter and review marks',
  },
  {
    key: 'results',
    label: 'Results',
    icon: GraduationCap,
    href: null,
    schoolOnly: true,
    built: false,
    group: 'Teaching',
    hint: 'Published results and report cards',
  },
  {
    key: 'pupils',
    label: 'Pupils',
    icon: Users,
    href: '/(teacher)/(tabs)/pupils',
    schoolOnly: true,
    built: false,
    group: 'Teaching',
    hint: 'Look up a pupil in your classes',
  },
  {
    key: 'timetable',
    label: 'Timetable',
    icon: CalendarDays,
    href: null,
    schoolOnly: true,
    built: false,
    group: 'Teaching',
    hint: 'Your week',
  },

  // ---- My tools: the Hub, which belongs to the teacher -------------------
  {
    key: 'lesson-plan',
    label: 'Lesson plan',
    icon: WandSparkles,
    href: '/(teacher)/(tabs)/create?kind=lesson_plan',
    schoolOnly: false,
    built: true,
    group: 'My tools',
    hint: 'A timed plan with objectives and activities',
  },
  {
    key: 'quiz',
    label: 'Quiz',
    icon: FileText,
    href: '/(teacher)/(tabs)/create?kind=quiz',
    schoolOnly: false,
    built: true,
    group: 'My tools',
    hint: 'Questions with an answer key',
  },
  {
    key: 'homework',
    label: 'Homework',
    icon: BookOpen,
    href: '/(teacher)/(tabs)/create?kind=homework',
    schoolOnly: false,
    built: true,
    group: 'My tools',
    hint: 'Set work for a class',
  },
  {
    key: 'library',
    label: 'My library',
    icon: FolderOpen,
    href: '/(teacher)/(tabs)/library',
    schoolOnly: false,
    built: true,
    group: 'My tools',
    hint: 'Everything you have made',
  },
  {
    key: 'community',
    label: 'Community',
    icon: Library,
    href: null,
    schoolOnly: false,
    built: false,
    group: 'My tools',
    hint: 'Plans shared by other Zambian teachers',
  },

  // ---- School: things that exist only inside one -------------------------
  {
    key: 'notices',
    label: 'Notices',
    icon: MessageSquare,
    href: '/(teacher)/(tabs)/notices',
    schoolOnly: true,
    built: true,
    group: 'School',
    hint: 'What your school has announced',
  },

  // ---- Account -----------------------------------------------------------
  {
    key: 'credits',
    label: 'AI credits',
    icon: CreditCard,
    href: '/(teacher)/(tabs)/account',
    schoolOnly: false,
    built: true,
    group: 'Account',
    hint: 'What you have left, and your plan',
  },
]

/**
 * The state of one feature for this teacher.
 *
 * `coming` beats `needs-school`: a teacher with no school should not be told that an
 * unbuilt feature is merely locked, which would read as "join a school and you can have
 * it" — an offer the product cannot keep.
 */
export function featureState(feature: Feature, linkedToSchool: boolean): FeatureState {
  if (!feature.built) return 'coming'
  if (feature.schoolOnly && !linkedToSchool) return 'needs-school'
  return 'ready'
}
