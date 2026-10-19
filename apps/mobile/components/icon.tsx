/**
 * The mobile half of the canonical icon vocabulary.
 *
 * Spec: `Official Documentation/19 Design System/Icons/ZSMS_ICON_CATALOGUE.md`
 *       `packages/design-tokens/src/icons.ts` — the shared names
 *       `apps/web/components/ui/icon.tsx` — the web half
 *
 * ## One vocabulary, two maps, and why it is not one
 *
 * The catalogue (§4.2) warns against the two apps independently inventing names for
 * the same concept, and that is what had happened — an audit on 2026-10-19 found 22 of
 * 24 core concepts drawn more than one way or differing between platforms.
 *
 * The NAMES are shared, in `@zsms/design-tokens`, as a union type. The MAPS cannot be:
 * `lucide-react` and `lucide-react-native` export the same names as different
 * component types, so one map could not type-check against both, and the token package
 * is imported by a Railway worker that renders PDFs — React has no business in its
 * dependency tree.
 *
 * So the guard is a test rather than a type: `apps/web/lib/icons.test.ts` asserts both
 * maps cover every name and choose the same glyph wherever both packages have it. A
 * concept that exists on one platform only fails to compile; one drawn differently on
 * each fails that test.
 *
 * ## Where mobile deliberately differs
 *
 * Noted inline. The only differences should be glyphs `lucide-react-native` does not
 * export at its pinned version — never a different opinion about what a concept means.
 */

import type { JSX } from 'react'
import type { IconName } from '@zsms/design-tokens'
import {
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
  Check,
  CircleSlash,
  Clock,
  CircleMinus,
  Circle,
  Wallet,
  CreditCard,
  Receipt,
  FileSpreadsheet,
  Scroll,
  Landmark,
  Coins,
  BadgeDollarSign,
  MessageSquare,
  Megaphone,
  Bell,
  Mail,
  Phone,
  Lock,
  LockOpen,
  KeyRound,
  Shield,
  ScrollText,
  BadgeCheck,
  ChartPie,
  FileBarChart,
  ChartColumn,
  TrendingUp,
  Sparkles,
  Lightbulb,
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
  File,
  Paperclip,
  type LucideIcon,
} from 'lucide-react-native'

import { usePalette } from './ui'

/** Concept to glyph. Identical choices to the web map; see the header. */
export const ICONS: Record<IconName, LucideIcon> = {
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
    `unmarked` is a hollow ring here exactly as on web, and for the reason
    ATTENDANCE.md gives: an unmarked pupil is not an absent one. On the register this
    is the difference between a gap a teacher can still fill and a record of absence,
    so it is the one glyph in the set that must not read as a filled state.
  */
  present: Check,
  absent: CircleSlash,
  late: Clock,
  excused: CircleMinus,
  unmarked: Circle,

  fees: Wallet,
  payment: CreditCard,
  receipt: Receipt,
  invoice: FileSpreadsheet,
  statement: Scroll,
  loan: Landmark,
  credits: Coins,
  billing: BadgeDollarSign,

  messages: MessageSquare,
  announcement: Megaphone,
  notification: Bell,
  email: Mail,
  phone: Phone,

  lock: Lock,
  unlock: LockOpen,
  permission: KeyRound,
  security: Shield,
  auditLog: ScrollText,
  verified: BadgeCheck,

  analytics: ChartPie,
  reports: FileBarChart,
  chart: ChartColumn,
  trendUp: TrendingUp,
  aiAssistant: Sparkles,
  insight: Lightbulb,

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

  document: File,
  spreadsheet: FileSpreadsheet,
  attachment: Paperclip,
}

/**
 * Draw a concept.
 *
 * Colour defaults to the body text colour rather than a hue: the catalogue (§2.3) is
 * explicit that icons are supporting UI, and a sidebar where every glyph carries its
 * own colour is a rainbow. Pass `colour` for the cases that genuinely encode state.
 */
export function Icon({
  name,
  size = 20,
  colour,
  label,
}: {
  name: IconName
  size?: number
  colour?: string
  /** Accessible name. Omit beside a visible label; supply for an icon-only control. */
  label?: string
}): JSX.Element {
  const c = usePalette()
  const Glyph = ICONS[name]
  return (
    <Glyph
      size={size}
      color={colour ?? c.text}
      strokeWidth={2}
      accessibilityLabel={label}
      accessibilityRole={label ? 'image' : undefined}
    />
  )
}
