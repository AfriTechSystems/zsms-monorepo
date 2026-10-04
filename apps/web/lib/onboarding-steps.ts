/**
 * Where each setup step is actually done.
 *
 * Spec: `Official Documentation/15 Super Admin and Platform/ONBOARDING.md`
 *
 * ## Why this exists
 *
 * A checklist that names what is missing and leaves somebody to find the screen is a
 * complaint, not a prompt. Every derivable step has a destination, and most now point
 * at a specific TAB rather than a page — "Term dates" lands on the term dates tab of
 * School settings, not at the top of it.
 *
 * Shared because the dashboard card and the checklist screen both need it, and two
 * copies would disagree the first time a screen moved.
 *
 * ## The four with no destination
 *
 * WhatsApp, the payment gateway, document templates and custom roles have no screen
 * because the features are not built. They carry an explanation instead, which is
 * better than a link to nowhere.
 */

export interface StepDestination {
  /** Appended to the school base path. */
  href: string
  /** The tab to open on arrival, matching a `SectionTabs` key. */
  tab?: string
  /** What the person will do there, in their words. */
  action: string
}

export const STEP_DESTINATIONS: Record<string, StepDestination> = {
  school_profile: {
    href: '/settings',
    tab: 'profile',
    action: 'Add your address, phone and email',
  },
  grade_structure: {
    href: '/settings',
    tab: 'academic',
    action: 'Choose which grades your school offers',
  },
  grading_system: {
    href: '/settings',
    tab: 'academic',
    action: 'Pick the grading scale you mark against',
  },
  subjects: {
    href: '/settings',
    tab: 'academic',
    action: 'Choose the subjects you teach',
  },
  term_dates: {
    href: '/settings',
    tab: 'terms',
    action: 'Set when each term opens and closes',
  },
  fee_structure: {
    href: '/fees/structures',
    action: 'Set what each grade pays per term',
  },
  first_student: {
    href: '/students/new',
    action: 'Enrol your first pupil',
  },
  first_staff: {
    href: '/staff',
    tab: 'invite',
    action: 'Invite your first teacher',
  },
  parent_links: {
    href: '/students',
    action: 'Link a parent to their child',
  },
  logo: {
    href: '/settings/public-profile',
    action: 'Upload your school crest',
  },
}

/**
 * Why a step has nowhere to go.
 *
 * Shown in place of a link. A school reading "not done" with no way to act on it
 * assumes the fault is theirs; these four are ours.
 */
export const STEP_UNAVAILABLE: Record<string, string> = {
  whatsapp_configured:
    'AfriTech switches this on. WhatsApp delivery is not available yet — no school has it.',
  payment_gateway:
    'Online card and mobile-money payments are still being built. You can record payments by hand today.',
  document_templates:
    'AfriTech sets these up for you. Ask us if you want your own report-card or receipt layout.',
  custom_roles:
    'Custom staff roles are still being built. The standard roles cover most schools.',
}
