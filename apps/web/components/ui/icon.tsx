/**
 * The web half of the canonical icon vocabulary.
 *
 * Spec: `Official Documentation/19 Design System/Icons/ZSMS_ICON_CATALOGUE.md`
 *       `packages/design-tokens/src/icons.ts` — the shared names
 *
 * ## What this is for
 *
 * An audit on 2026-10-19 found 142 distinct glyphs across 155 web files, with **22 of
 * 24 core concepts** drawn more than one way. The worst of it was invisible: lucide
 * renamed several glyphs and both names were in use, so the old `Alert`-prefixed names
 * and their current `Triangle`/`Circle`-prefixed replacements were the *same picture*
 * under two names — 16 files on one spelling, the rest on the other. Nobody could see
 * that drift, and that is exactly why it spread.
 *
 * A page asks for a concept — `<Icon name="students" />` — and this file decides the
 * glyph. Change the glyph here and every screen follows; no page has an opinion about
 * which picture means a pupil.
 *
 * ## Importing lucide directly is still fine
 *
 * This does not ban `import { Plus } from 'lucide-react'`. Plenty of icons are one-off
 * and local, and routing every one through a registry would be ceremony. What the
 * registry owns is the set of concepts that appear in more than one place — navigation
 * destinations, domain objects, states — because those are the ones that drift.
 *
 * ## The glyph choices come from the reference sheets
 *
 * Sheets 01 and 02 in the Icons folder. Where lucide has no equivalent of a pictured
 * glyph, the nearest semantically clear one is used and noted — the catalogue permits
 * that (§3) and asks only that the substitute be consistent.
 */

import type { JSX } from 'react'
import type { IconName } from '@zsms/design-tokens'
import {
  // Navigation
  House,
  LayoutDashboard,
  Menu,
  Ellipsis,
  ArrowLeft,
  X,
  Search,
  Filter,
  ArrowUpDown,
  RefreshCw,
  Settings,
  CircleHelp,
  Info,
  ExternalLink,
  ChevronRight,
  // People and portals
  School,
  Users,
  UserCog,
  UserRound,
  Briefcase,
  ShieldCheck,
  GraduationCap,
  CircleUser,
  ArrowLeftRight,
  LogOut,
  // Academic
  Boxes,
  BookOpen,
  CalendarRange,
  BookMarked,
  ClipboardCheck,
  ClipboardList,
  NotebookPen,
  ListChecks,
  FileBadge,
  Percent,
  Award,
  FileText,
  Library,
  FolderOpen,
  BookA,
  // Attendance states
  Check,
  CircleSlash,
  Clock,
  CircleMinus,
  Circle,
  // Finance
  Wallet,
  CreditCard,
  Receipt,
  FileSpreadsheet,
  Scroll,
  Landmark,
  Coins,
  BadgeDollarSign,
  // Communication
  MessageSquare,
  Megaphone,
  Bell,
  Mail,
  Phone,
  // Account and access
  Lock,
  LockOpen,
  KeyRound,
  Shield,
  ScrollText,
  BadgeCheck,
  // Analytics and AI
  ChartPie,
  FileBarChart,
  ChartColumn,
  TrendingUp,
  Sparkles,
  Lightbulb,
  // Actions
  Plus,
  Pencil,
  Eye,
  Trash2,
  Save,
  Ban,
  Copy,
  Share2,
  Download,
  Upload,
  Printer,
  Send,
  // Status
  CircleCheck,
  CircleX,
  TriangleAlert,
  Hourglass,
  LoaderCircle,
  WifiOff,
  RefreshCcwDot,
  Globe,
  FileClock,
  Inbox,
  // Documents
  File,
  Paperclip,
  type LucideIcon,
} from 'lucide-react'

/**
 * Concept to glyph. Every name in `ICON_NAMES` must appear here — the `Record` makes a
 * missing one a compile error, and `lib/icons.test.ts` asserts web and mobile agree.
 */
export const ICONS: Record<IconName, LucideIcon> = {
  // Navigation
  home: House,
  dashboard: LayoutDashboard,
  menu: Menu,
  more: Ellipsis,
  back: ArrowLeft,
  close: X,
  search: Search,
  filter: Filter,
  sort: ArrowUpDown,
  refresh: RefreshCw,
  settings: Settings,
  help: CircleHelp,
  info: Info,
  externalLink: ExternalLink,
  chevronRight: ChevronRight,

  // People and portals
  school: School,
  students: Users,
  teacher: UserCog,
  parent: UserRound,
  staff: Briefcase,
  admin: ShieldCheck,
  alumni: GraduationCap,
  profile: CircleUser,
  switchPortal: ArrowLeftRight,
  logout: LogOut,

  // Academic
  classes: Boxes,
  subjects: BookOpen,
  timetable: CalendarRange,
  lesson: BookMarked,
  attendance: ClipboardCheck,
  assignment: ClipboardList,
  homework: NotebookPen,
  quiz: ListChecks,
  exam: FileBadge,
  marks: Percent,
  results: Award,
  reportCard: FileText,
  library: Library,
  resource: FolderOpen,
  curriculum: BookA,

  /*
    Attendance states, from sheet 02 section D.

    `unmarked` is `Circle` — an empty ring, deliberately the only hollow glyph in the
    set. ATTENDANCE.md's rule is that an unmarked pupil is not an absent one, and the
    catalogue repeats it (§6.4: "must not look like absent"). A hollow ring reads as
    "no answer yet" in a column of filled marks, which is what it is.
  */
  present: Check,
  absent: CircleSlash,
  late: Clock,
  excused: CircleMinus,
  unmarked: Circle,

  // Finance
  fees: Wallet,
  payment: CreditCard,
  receipt: Receipt,
  invoice: FileSpreadsheet,
  statement: Scroll,
  loan: Landmark,
  credits: Coins,
  billing: BadgeDollarSign,

  // Communication
  messages: MessageSquare,
  announcement: Megaphone,
  notification: Bell,
  email: Mail,
  phone: Phone,

  // Account and access
  lock: Lock,
  unlock: LockOpen,
  permission: KeyRound,
  security: Shield,
  auditLog: ScrollText,
  verified: BadgeCheck,

  // Analytics and AI
  analytics: ChartPie,
  reports: FileBarChart,
  chart: ChartColumn,
  trendUp: TrendingUp,
  aiAssistant: Sparkles,
  insight: Lightbulb,

  // Actions
  add: Plus,
  edit: Pencil,
  view: Eye,
  delete: Trash2,
  save: Save,
  cancel: Ban,
  copy: Copy,
  share: Share2,
  download: Download,
  upload: Upload,
  print: Printer,
  send: Send,

  // Status
  success: CircleCheck,
  error: CircleX,
  warning: TriangleAlert,
  pending: Hourglass,
  loading: LoaderCircle,
  offline: WifiOff,
  sync: RefreshCcwDot,
  published: Globe,
  draft: FileClock,
  approved: CircleCheck,
  rejected: CircleX,
  empty: Inbox,

  // Documents
  document: File,
  spreadsheet: FileSpreadsheet,
  attachment: Paperclip,
}

export interface IconProps {
  name: IconName
  className?: string
  /** Pixel size. Omit to inherit the surrounding font size, which is usually right. */
  size?: number
  /**
   * The accessible name.
   *
   * Omit it for an icon beside its own label — a screen reader announcing "pupils,
   * pupils" is worse than one announcing it once — and the icon is then marked
   * `aria-hidden`. Supply it for an icon-only control, which the catalogue (§2.2)
   * requires to have one.
   */
  label?: string
}

/**
 * Draw a concept.
 *
 * `<Icon name="students" />` beside a label, `<Icon name="delete" label="Remove" />`
 * when the icon stands alone.
 */
export function Icon({ name, className, size, label }: IconProps): JSX.Element {
  const Glyph = ICONS[name]
  return (
    <Glyph
      className={className}
      size={size}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    />
  )
}
