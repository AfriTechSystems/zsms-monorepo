'use client'

/**
 * The school portal sidebar.
 *
 * ## Grouped by job, which is the whole reason for the change
 *
 * The previous nav was nine links in a horizontally scrolling row. Nine is past the point where
 * a flat list helps: the reader scans all of them every time because nothing signals which
 * three concern money and which three concern academics. The groups below are named for the
 * work, so an administrator chasing arrears looks in one place.
 *
 * ## The permission filter is unchanged, deliberately
 *
 * `can(role, capability)` from `lib/roles` still decides what appears, item by item. This is a
 * courtesy rather than a control — every route and every policy enforces access independently —
 * but showing a teacher a Fees link that 403s is a worse product than not showing it.
 *
 * A group whose every item is filtered out renders nothing at all, heading included. Otherwise
 * a teacher would see an empty "Money" heading, which is a worse signal than absence: it says
 * something is here that you cannot have.
 */

import type { JSX, ReactNode } from 'react'
import {
  BellRing,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  Cog,
  Coins,
  FileSpreadsheet,
  Globe,
  FileText,
  GraduationCap,
  Inbox,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Megaphone,
  Plug,
  Receipt,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react'

import type { Role } from '@zsms/auth-provider'

import { AskAi } from '../../../components/assistant/ask-ai'
import { AppShell } from '../../../components/layout/app-shell'
import type { NavGroup } from '../../../components/layout/nav-config'
import { can } from '../../../lib/roles'

export function SchoolShell({
  base,
  schoolName,
  roleLabel,
  role,
  children,
  headerActions,
}: {
  base: string
  schoolName: string
  roleLabel: string
  role: Role
  children: ReactNode
  headerActions?: ReactNode
}): JSX.Element {
  /**
   * Grouped by the JOB, not by the data type — which is the correction this file is on its second
   * attempt at.
   *
   * The first version had a "Money" group holding both **Fees** and **Subscription**, on the
   * reasoning that both concern money. That is a data-model grouping, and it puts two different
   * people's work in one drawer: the bursar chases a parent's arrears, the owner pays AfriTech.
   * They are different jobs, different permissions, and different frequencies — daily against a
   * few times a year.
   *
   * So **Finance means student money and nothing else**, and the school's own subscription sits in
   * Settings with the rest of the account administration. `SCHOOL_CONFIG.md` draws the same line:
   * its Settings panel holds fee *configuration* while the fees module stays operational.
   *
   * Bulk import moved to Students for the same reason. Importing a roll is a pupil job somebody
   * does at the start of a term; it was under Settings only because it happens rarely.
   */
  const groups: NavGroup[] = [
    {
      label: null,
      items: [{ path: '', label: 'Dashboard', icon: LayoutDashboard, exact: true }],
    },
    {
      label: 'Students',
      items: [
        { path: '/students', label: 'Pupils', icon: Users, needs: 'students:read' },
        { path: '/students/import', label: 'Bulk import', icon: FileSpreadsheet, needs: 'students:write' },
      ],
    },
    {
      label: 'Staff',
      items: [
        { path: '/staff', label: 'Staff', icon: UserCog, needs: 'staff:read' },
        {
          path: '/teaching',
          label: 'Teaching assignments',
          icon: GraduationCap,
          exact: true,
          needs: 'assignments:read',
        },
      ],
    },
    {
      label: 'Teaching',
      items: [
        // A teacher's own scope, first in the group they open every morning.
        { path: '/teaching/my', label: 'My classes', icon: GraduationCap, needs: 'teaching:own' },
        /*
          Two timetable entries, because they answer different questions.

          "My timetable" is where a teacher is this week; "Timetable" is the whole
          school's grid. The second carries no `needs` on purpose — the screen renders
          read-only for anybody without `settings:write`, and seeing the school's week
          is useful even when editing it is not yours to do.
        */
        { path: '/my-timetable', label: 'My timetable', icon: CalendarDays, needs: 'teaching:own' },
        { path: '/timetable', label: 'Timetable', icon: CalendarRange },
        { path: '/attendance', label: 'Attendance', icon: CalendarCheck, needs: 'attendance:read' },
        { path: '/results', label: 'Results', icon: ClipboardList, needs: 'results:read' },
      ],
    },
    {
      // Student money. Nothing else belongs here.
      label: 'Finance',
      items: [
        { path: '/fees', label: 'Fees & payments', icon: Wallet, needs: 'fees:read' },
      ],
    },
    {
      label: 'Communication',
      items: [
        { path: '/announcements', label: 'Announcements', icon: Megaphone },
        /*
          Message log (MESSAGE_LOG.md).

          Beside Announcements because it answers the question an announcement raises:
          did it arrive.

          `fees:read` and not `settings:write`, because its holders are EXACTLY the four
          roles `school_management_read_message_log` admits after `0257` — owner,
          principal, administrator, accountant. A link gated on a different set than the
          policy would either hide a readable page or show an empty one.

          The first draft wrote `settings:read`, which does not exist in the matrix.
          `can()` returns false for an unknown key, so the row would have silently
          vanished for everybody — the exact failure `zsms-feature` warns about, caught
          by grepping the keys rather than trusting the name.
        */
        { path: '/messages', label: 'Message log', icon: Inbox, needs: 'fees:read' },
      ],
    },
    {
      // Account administration. Collapsed by default: set up once, visited rarely.
      label: 'Settings',
      defaultCollapsed: true,
      items: [
        /**
         * First in the group, and ungated: every member of staff can READ the school profile and
         * the term calendar. The page renders what a role cannot change as disabled rather than
         * hiding it — a teacher seeing the term dates is useful, and seeing that leadership sets
         * them is informative rather than a dead end.
         */
        { path: '/settings', label: 'School settings', icon: Cog, exact: true },
        /*
          The setup checklist, beside the settings it sends people to.

          `settings:write` because every outstanding item is management's to do — a
          teacher reading a list of other people's jobs is clutter.
        */
        { path: '/settings/readiness', label: 'Setup checklist', icon: ListChecks, needs: 'settings:write' },
        // Defining what is recorded about a pupil is a pupil-write act.
        { path: '/settings/fields', label: 'Pupil fields', icon: SlidersHorizontal, needs: 'students:write' },
        /*
          The audit trail.

          `settings:write` is the closest the matrix has to "leadership" — the POLICY
          admits only `org:owner` and `org:principal`, and an accountant with
          `settings:write` would see an empty list rather than a refusal. Gating the link
          to roughly the right audience is a convenience; the policy is the rule.

          Deliberately NOT readable by the accountant, which the policy enforces: the
          trail is partly a record of what they did, and a log its subject can read is a
          log they can be pressured over.
        */
        { path: '/settings/audit', label: 'Audit trail', icon: ScrollText, needs: 'settings:write' },
        /*
          School-defined staff roles (ADR-012).

          `settings:write` is the nearest the matrix has to "leadership", and the POLICY
          is narrower still — `org:owner` and `org:principal` only, not even
          `org:admin`, because ticking a box here GRANTS a capability and whoever can
          tick can grant themselves anything.

          So an administrator sees the link and the database refuses the write. That is
          the right way round: the gate is the policy, and this only keeps the nav
          roughly honest.
        */
        /*
          Grading scales (GRADING.md, ADR-041).

          `revise_grading_scale()` existed since `0141` with the whole versioning
          apparatus and a 20-assertion suite behind it, and nothing called it — a school
          could not change its own grade boundaries through any surface.

          `settings:write` gates the link; the function is narrower.
        */
        { path: '/settings/grading', label: 'Grading scales', icon: GraduationCap, needs: 'settings:write' },
        /*
          Report cards and documents (CUSTOMISATION.md, TEMPLATE_SYSTEM.md).

          Beside Grading scales because the two together decide what a report card
          says: the scale decides the grade, this decides whether the card shows a
          position, an average, or the principal's words.

          `settings:write` gates the link; `set_document_template()` and
          `set_school_branding_colours()` are narrower — owner and principal only,
          because what a report card says about a child is the head's responsibility.
        */
        { path: '/settings/documents', label: 'Report cards & documents', icon: FileText, needs: 'settings:write' },
        { path: '/settings/roles', label: 'Staff roles', icon: ShieldCheck, needs: 'settings:write' },
        /*
          Permission grants (PERMISSIONS.md).

          Beside Staff roles because they answer two halves of one question: a role is
          what somebody does permanently, a grant is what they may do for three weeks
          while a colleague is on leave.

          `settings:write` gates the link; the POLICY and `grant_staff_permission()`
          are narrower still — owner and principal only, and a principal cannot grant
          financial write because they do not hold it themselves.
        */
        { path: '/settings/permissions', label: 'Permission grants', icon: KeyRound, needs: 'settings:write' },
        /*
          Accounting and CRM connections (ADR-023).

          `fees:write` rather than `settings:write`, because the POLICY admits the
          accountant alongside the owner and principal — connecting Sage is their job,
          and gating the link to leadership alone would hide it from the one person who
          actually does it.
        */
        { path: '/settings/integrations', label: 'Connections', icon: Plug, needs: 'fees:write' },
        /*
          API keys (API_INTEGRATION.md).

          Beside Connections because they are the two halves of integrating: a
          connection is ZSMS pushing out, a key is another system reading in.

          `settings:write` gates the link and the POLICY is narrower — `org:owner`
          alone, not even the principal, because a key acts as the school with nobody's
          name attached.
        */
        { path: '/settings/api-keys', label: 'API keys', icon: KeyRound, needs: 'settings:write' },
        // Outward-facing rather than internal configuration, and the only settings row a
        // parent ever sees the result of. Kept beside the others because that is where a head
        // teacher looks for it, not because it is the same kind of thing.
        { path: '/settings/public-profile', label: 'Public listing', icon: Globe },
        /*
          Fee reminders (REMINDERS.md).

          `fees:write` rather than `settings:write`, because the POLICY and
          `set_reminder_settings()` admit the accountant alongside the owner and
          principal — deciding when to chase a parent is the bursar's job, and gating
          the link to leadership alone would hide it from the person who does it.
        */
        { path: '/settings/reminders', label: 'Fee reminders', icon: BellRing, needs: 'fees:write' },
        /*
          Attendance alerts (TRIGGERS.md, NOTIFICATIONS.md Channel 3).

          Beside fee reminders because they are the same decision twice: which events
          are worth spending the school's message quota on.

          `settings:write` rather than `attendance:write` — a teacher marks a register,
          but turning this on commits the school's quota for the term, and
          `set_attendance_alerts()` admits only the owner and principal.
        */
        { path: '/settings/attendance-alerts', label: 'Attendance alerts', icon: CalendarCheck, needs: 'settings:write' },
        { path: '/settings/subscription', label: 'Subscription & billing', icon: Receipt, needs: 'fees:read' },
        // `fees:read` to see, `fees:write` to buy — gated in the route, not here. Buying
        // credits spends the school's money, so it sits with the bursar's permissions
        // rather than with the ones for editing a timetable.
        { path: '/settings/credits', label: 'AI credits', icon: Coins, needs: 'fees:read' },
      ],
    },
  ]

  // Drop items the role cannot reach, then drop any group left empty.
  const visible = groups
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.needs || can(role, i.needs)) }))
    .filter((g) => g.items.length > 0)

  return (
    <AppShell
      base={base}
      title={schoolName}
      subtitle={roleLabel}
      groups={visible}
      headerActions={
        <>
          {/*
            Ask AI, in the shell rather than per screen.

            A control on every page belongs in the layout. The parent child-picker and
            the Hub signed-out branch were both bugs caused by copying a control per
            page; the fix each time was to move the single copy up a level.
          */}
          <AskAi audience="school"
            basePath={base} />
          {headerActions}
        </>
      }
    >
      {children}
    </AppShell>
  )
}
