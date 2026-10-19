/**
 * The canonical icon vocabulary — names only, no glyphs.
 *
 * Spec: `Official Documentation/19 Design System/Icons/ZSMS_ICON_CATALOGUE.md`
 *       — §4.2 "keep one canonical icon map or registry", §4.3 naming convention
 *
 * ## Why the names live here and the glyphs do not
 *
 * The catalogue's core principle is "one meaning, one standard icon choice, consistent
 * behaviour everywhere", and its §4.2 warns against the two apps independently
 * inventing names for the same concept. That is exactly what had happened: an audit on
 * 2026-10-19 found **22 of 24 core concepts** drawn with more than one glyph, or with
 * web and mobile disagreeing.
 *
 * So this module holds the one list of concepts, and each app maps it to its own icon
 * package — `lucide-react` on web, `lucide-react-native` on mobile. The split is not
 * architectural tidiness; it is forced:
 *
 *   * This package is imported by `@zsms/documents` and `@zsms/notifications`, which
 *     render PDFs and email in a Railway worker. Pulling a React icon library in here
 *     would put React in a worker's dependency tree to draw a receipt.
 *   * The two lucide packages export the same names but different component types, so
 *     a single shared map could not type-check against both.
 *
 * What IS shared is the thing that drifts: the vocabulary. `IconName` is a union, so a
 * platform that forgets a concept fails to compile, and
 * `apps/web/lib/icons.test.ts` asserts both maps are complete and agree.
 *
 * ## Adding one
 *
 * Add the name here, then both maps. The type error in each app is the point — it is
 * what stops a concept existing on one platform only. Do not add a name for a feature
 * that does not exist: the catalogue is explicit that a module must not be invented
 * because a poster shows an icon for it.
 */

/**
 * Every concept ZSMS draws an icon for.
 *
 * Grouped by the reference sheets. Names follow the catalogue's §4.3 convention
 * (camelCase semantic aliases) rather than glyph names, so a page asks for `students`
 * and never for whichever picture happens to mean students this month.
 */
export const ICON_NAMES = [
  // --- Navigation (sheet 01, section A) -------------------------------------
  'home',
  'dashboard',
  'menu',
  'more',
  'back',
  'close',
  'search',
  'filter',
  'sort',
  'refresh',
  'settings',
  'help',
  'info',
  'externalLink',
  'chevronRight',

  // --- Portals and people (sheet 01 B, sheet 02 A) --------------------------
  'school',
  'students',
  'teacher',
  'parent',
  'staff',
  'admin',
  'alumni',
  'profile',
  'switchPortal',
  'logout',

  // --- Academic (sheet 02 B–H) ----------------------------------------------
  'classes',
  'subjects',
  'timetable',
  'lesson',
  'attendance',
  'assignment',
  'homework',
  'quiz',
  'exam',
  'marks',
  'results',
  'reportCard',
  'library',
  'resource',
  'curriculum',

  // --- Attendance states (sheet 02 D) ---------------------------------------
  // `unmarked` is its own concept and must never be drawn as `absent`. See
  // ATTENDANCE.md and the catalogue §6.4.
  'present',
  'absent',
  'late',
  'excused',
  'unmarked',

  // --- Finance (sheet 03) ----------------------------------------------------
  'fees',
  'payment',
  'receipt',
  'invoice',
  'statement',
  'loan',
  'credits',
  'billing',

  // --- Communication (sheet 04) ---------------------------------------------
  'messages',
  'announcement',
  'notification',
  'email',
  'phone',

  // --- Account and access (sheet 05) ----------------------------------------
  'lock',
  'unlock',
  'permission',
  'security',
  'auditLog',
  'verified',

  // --- Analytics and AI (sheet 06) ------------------------------------------
  'analytics',
  'reports',
  'chart',
  'trendUp',
  'aiAssistant',
  'insight',

  // --- Common actions (sheet 01 D, sheet 02 K) ------------------------------
  'add',
  'edit',
  'view',
  'delete',
  'save',
  'cancel',
  'copy',
  'share',
  'download',
  'upload',
  'print',
  'send',

  // --- Status and feedback (sheet 01 F) -------------------------------------
  'success',
  'error',
  'warning',
  'pending',
  'loading',
  'offline',
  'sync',
  'published',
  'draft',
  'approved',
  'rejected',
  'empty',

  // --- Documents (sheet 02 H) -----------------------------------------------
  'document',
  'spreadsheet',
  'attachment',
] as const

export type IconName = (typeof ICON_NAMES)[number]

/**
 * The semantic colour role an icon carries by default, where it has one.
 *
 * Only states get a role. A navigation icon takes its colour from the surface it sits
 * on, and giving `students` a permanent hue would make the sidebar a rainbow — the
 * catalogue is explicit (§2.3) that icons are supporting UI rather than decoration.
 *
 * `unmarked` is deliberately `neutral` and NOT `warning`: an unmarked pupil is a gap a
 * teacher can still fill, not a problem with the child, and colouring it amber beside
 * a red `absent` reads as a lesser accusation rather than as no answer yet.
 */
export const ICON_ROLE: Partial<Record<IconName, 'success' | 'warning' | 'danger' | 'primary' | 'neutral'>> = {
  success: 'success',
  present: 'success',
  approved: 'success',
  published: 'success',
  verified: 'success',
  sync: 'success',

  warning: 'warning',
  late: 'warning',
  pending: 'warning',

  error: 'danger',
  absent: 'danger',
  rejected: 'danger',
  offline: 'danger',

  excused: 'primary',
  info: 'primary',
  aiAssistant: 'primary',

  unmarked: 'neutral',
  draft: 'neutral',
  empty: 'neutral',
}
