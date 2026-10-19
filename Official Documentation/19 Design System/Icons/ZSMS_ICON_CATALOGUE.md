# ZSMS Icon Catalogue & Cross-Platform Usage Standard

**Document type:** UI/UX implementation guide  
**Project:** ZSMS School Management ERP  
**Applies to:** All ZSMS web portals, dashboards, pages, dialogs, forms, navigation, and the React Native mobile app  
**Primary audience:** Claude Code, frontend developers, UI/UX designers, QA  
**Status:** Implementation guidance; validate all mappings against the actual repository before changing code

---

## 1. Purpose

This document establishes a consistent icon language across ZSMS. The accompanying eight visual icon-suite sheets are **visual references**, not production assets. Use them to understand the intended categories, meanings, and visual style, then implement icons using the icon library and components already supported by the repository.

The objective is for every icon to have a clear purpose and consistent meaning wherever it appears. Icons should help users recognise destinations, understand actions, scan information, identify status, and distinguish related modules without making screens noisy or difficult to read.

This standard applies across:
- AfriTech/super-admin and network administration areas.
- School administration and staff portals.
- Teacher workflows.
- Parent/guardian portals.
- Student-facing experiences, where present.
- Shared pages, forms, tables, dashboards, reports, settings, and system feedback.
- Web and mobile experiences, adapting layout and interaction to each platform while preserving icon meaning.

### Core principle

**One meaning, one standard icon choice, consistent behaviour everywhere.**

Do not use a different icon for the same concept on different pages simply because a different icon looks attractive. Do not use an icon whose meaning could reasonably be misunderstood. Where an icon alone is not sufficiently clear, pair it with a text label, tooltip, or accessible name.

---

## 2. Design-system precedence and constraints

The existing ZSMS design system is authoritative. This icon guide supplements it; it does not replace it.

### 2.1 Preserve existing design tokens

Use the repository's current tokens, spacing, typography, radius, elevation, contrast, and component standards. Do not create a competing visual system.

The documented ZSMS brand colours are:

| Token/role | Reference value | Intended use |
|---|---:|---|
| Navy | `#1E2A3F` | Primary text, strong icon emphasis, structural elements |
| Blue | `#3A8DDE` | Primary actions, navigation emphasis, neutral interactive emphasis |
| Green | `#4A9B4F` | Success, completion, positive states |
| Amber | `#F5A623` | Caution, pending states, attention |
| Coral | `#E15A44` | Errors, destructive actions, urgent negative states |
| Teal | `#1BA0B0` | Secondary information, selected categories, supportive emphasis |
| Page background | `#F1F3FA` | Existing page background reference |
| White | Existing design token | Cards and surfaces |

The reference posters also show purple icons. **Purple is not part of the documented core ZSMS palette above.** Do not add purple as a new brand or semantic token just because it appears in an illustration. If the repository already has an approved purple token, use it only according to that token's existing role. Otherwise map those illustrative purple accents to an existing appropriate token.

Use semantic tokens where available rather than hardcoding hex values into components. If a hex value above differs from the repository's current token definition, investigate and preserve the repository's actual authoritative token implementation.

### 2.2 Accessibility and interaction

- Maintain the existing contrast requirements, including WCAG AA where specified by the design system.
- An icon must not be the only carrier of critical information such as paid/unpaid, present/absent, approved/rejected, online/offline, or permission denied.
- Use a visible label for important or unfamiliar actions. Icon-only buttons should have an accessible name and, on web, an appropriate tooltip where useful.
- Keep touch targets at or above the design system's minimum size; the current guidance specifies **44px minimum tap targets**.
- Use a visible focus state for keyboard users.
- Disabled controls must be visibly disabled and must not look actionable.
- Do not rely on colour alone to communicate state. Pair colour with a shape, icon, label, or text.
- Respect reduced-motion preferences and avoid decorative animation for routine icons.
- Do not use emoji as substitutes for production icons.

### 2.3 Icons are supporting UI, not decoration

Use icons to improve recognition and scanning. Avoid adding icons to every piece of text or every card when they add no meaning. Excessive icons can make interfaces noisy and reduce the value of important visual cues.

---

## 3. Reference-sheet inventory

Keep the eight visual sheets together in a dedicated folder so Claude Code and developers can inspect them. Recommended folder:

`docs/design-references/zsms-icon-suite/`

Recommended filenames (rename the saved images to match these names if convenient):

1. `01-navigation-general-ui.png`
2. `02-school-academic-operations.png`
3. `03-finance-payments-resource-management.png`
4. `04-communication-notifications-engagement.png`
5. `05-user-account-authentication-settings.png`
6. `06-analytics-reports-ai-insights.png`
7. `07-actions-navigation-interface-common-ui.png`
8. `08-school-operations-wellbeing-health-transport-marketplace.png`

These filenames are a suggested convention, not a claim that files have already been placed in the repository. Ensure the actual images are present before asking Claude Code to inspect them.

### How to interpret the reference sheets

- Treat them as inspiration for icon meanings, groupings, and consistent visual tone.
- Do not reproduce the posters as page layouts.
- Do not use the whole poster as an icon or crop icons out of it for production.
- Do not assume every label shown in a poster corresponds to an existing ZSMS feature.
- Only implement icons for functionality that exists or is explicitly planned in the repository.
- Do not introduce new modules or product features merely because an icon appears on a sheet.
- If a poster contains an unclear, misspelled, duplicated, or visually inconsistent label, prefer the actual product terminology and the repository's existing domain model.
- The same concept may be represented by a different icon if the chosen production library lacks the pictured glyph, but the substitute must be semantically clear and used consistently.

---

## 4. Cross-platform consistency rules

Web and mobile should share an icon vocabulary, not necessarily identical layout or rendering code.

### 4.1 Shared meaning, platform-appropriate implementation

The same concept should use the same icon choice (or the closest consistent equivalent) across platforms. Examples:
- Home means the portal's home/dashboard everywhere.
- Students means student records everywhere.
- Attendance means attendance workflows everywhere.
- Fees means fee accounts or fee management everywhere.
- Messages means communication/inbox everywhere.
- Settings means configuration everywhere.
- AI assistant means the same permission-aware assistant concept everywhere.

The web app and React Native app may need separate components because they use different platform technologies. Share names, semantic mappings, colour roles, and usage rules where feasible; do not force a single component implementation if that harms platform compatibility.

### 4.2 Avoid platform drift

- Do not allow the web and mobile apps to independently invent icon names for the same concept.
- Keep one canonical icon map or registry where the repository architecture supports it.
- Use the existing web and mobile UI primitives rather than creating parallel one-off icon systems.
- If separate registries are unavoidable, document their mapping and test for equivalent meaning.
- If an icon is unavailable on one platform, choose the closest clear equivalent and document the mapping.
- Keep the same meanings for semantic colours on all platforms.

### 4.3 Suggested canonical naming convention

Use semantic names such as:

- `home`
- `dashboard`
- `students`
- `teachers`
- `classes`
- `attendance`
- `timetable`
- `fees`
- `payments`
- `messages`
- `notifications`
- `reports`
- `analytics`
- `aiAssistant`
- `settings`
- `search`
- `filter`
- `sort`
- `add`
- `edit`
- `view`
- `delete`
- `save`
- `cancel`
- `download`
- `upload`
- `success`
- `warning`
- `error`
- `pending`
- `offline`
- `sync`

These are semantic aliases, not instructions to install a new icon library or to use these exact casing conventions if the project already has an established convention. Inspect the repository first and adapt to its patterns.

---

## 5. Production icon implementation requirements

Before making changes, inspect the repository and identify:

1. The icon package currently installed for web.
2. The icon package currently installed for React Native.
3. Shared UI components and existing icon wrappers.
4. Existing design tokens and semantic colour tokens.
5. Existing naming patterns, aliases, and any icon registry.
6. Places where icons are currently used inconsistently.
7. Whether any icon components are already standardised in the design system.

### 5.1 Reuse before adding

- Prefer the existing icon library and current dependency versions.
- Do not add a new icon library unless there is a documented gap and the trade-off is justified.
- Avoid mixing several unrelated icon families.
- Prefer one coherent stroke weight, visual density, and size system.
- Do not build custom SVGs for common icons if an approved icon already exists.
- Use custom icons only for genuine domain concepts that are not well represented by the approved library.
- Keep icons as vector components or platform-native vector assets where supported, not raster screenshots.

### 5.2 Central registry or wrapper

Where compatible with the current architecture, use a central semantic registry or wrapper so pages refer to concepts rather than choosing arbitrary glyphs. For example, pages should ask for the canonical `students` icon rather than independently selecting a different library glyph.

The implementation should:
- Use explicit, typed icon names if the codebase supports TypeScript.
- Provide a safe fallback for unknown names if appropriate.
- Avoid silent fallback to an unrelated glyph.
- Preserve platform-specific imports and bundle constraints.
- Support size, colour, accessibility label, and decorative/semantic usage.
- Avoid hardcoding semantic colours in individual page files.
- Make it straightforward to update a glyph centrally without editing every page.

Do not create a registry solely for architectural neatness if the repository already has an equally good shared abstraction. Reuse the established pattern.

### 5.3 Standard sizing

Use the existing design-system size tokens if they exist. If the repository has no icon sizing standard, audit current usage and propose a small consistent scale rather than introducing arbitrary values. A reasonable starting point for discussion—not a mandate—is:
- Small inline/status icon: 14–16px.
- Standard control/list icon: 18–20px.
- Navigation icon: 20–24px.
- Large empty-state or feature illustration icon: 28–40px.

The actual dimensions must respect existing components, visual rhythm, and mobile platform conventions. Avoid making icons larger just to fill space.

### 5.4 Stroke, fill, and alignment

- Keep stroke width and fill treatment consistent within a family.
- Align icons optically with text, not merely mathematically.
- Use the same baseline and spacing rules for icon-label combinations.
- Avoid stretching or distorting icons.
- Use filled/solid variants for selected navigation only if that is an established pattern and the distinction is consistent.
- Do not randomly switch between outlined and filled variants for the same concept.

---

## 6. Icon catalogue by functional category

The following catalogue records the intended concepts across the visual sheets. These are **semantic concepts to map to actual repository features and available glyphs**, not a requirement to create every listed feature.

### 6.1 Navigation and general UI

| Semantic concept | Meaning / use | Guidance |
|---|---|---|
| Home | Portal landing page | Use consistently across portals |
| Dashboard | Overview of the current role or organisation | Distinguish from Home only if the product does |
| Menu | Open navigation | Use the same menu glyph across layouts |
| More | Additional actions or navigation | Do not use in place of a clear primary action |
| Back / Forward | Navigate history or workflow | Use platform conventions |
| Close | Dismiss a dialog, sheet, or panel | Accessible name required for icon-only control |
| Search | Search records or content | Use consistently in global and local search |
| Filter | Narrow results | Pair with active-filter count/state where useful |
| Sort | Change ordering | Show current direction where applicable |
| Refresh | Reload current data | Do not imply data is saved |
| Grid / List / Card / Table | Change display mode | Indicate selected mode clearly |
| Calendar | Calendar or date-related view | Do not confuse with a single date input when context differs |
| Timeline | Chronological activity or events | Use only where a timeline view exists |
| Settings | Configure the current area or system | Use the same glyph throughout |
| Help / Info | Explain functionality or provide assistance | Keep Help and Info meanings distinct |
| External link | Open an external destination | Use where users leave the current application |

### 6.2 Common actions

| Semantic concept | Meaning / use | Guidance |
|---|---|---|
| Add / Create | Create a record or item | Use one canonical icon unless context requires a more specific one |
| Edit | Modify an existing record | Do not confuse with annotate or compose |
| View | Open or inspect details | Use for explicit view actions |
| Delete | Permanently remove where allowed | Destructive colour and confirmation should follow existing patterns |
| Save | Save current changes | Must reflect real save state |
| Cancel | Cancel current operation | Distinguish from Close if cancellation has consequences |
| Copy | Copy a value or record | Give feedback when copy succeeds |
| Paste | Insert copied content | Use only where supported |
| Undo / Redo | Reverse or reapply an edit | Do not use as generic back/forward navigation |
| Share | Share a record or link | Respect permissions and sensitive data |
| Download / Export | Retrieve a file or report | Distinguish export from simple download when useful |
| Upload / Import | Add a file or import data | Explain supported file types where relevant |
| Print | Print a page or report | Use consistent placement |
| Attach | Add a file to a record or message | Show attachment state |
| Scan / Camera / Image | Capture or select media | Respect permission and platform constraints |
| Link | Add/open a related link | External-link meaning may differ |
| Expand / Collapse | Show or hide content | State must be visually clear |
| More actions | Open a contextual action menu | Keep the menu consistent across lists and detail pages |

### 6.3 Forms and input controls

Use the icon treatment already built into the repository's form primitives. Do not add redundant icons to every input.

| Concept | Meaning / use | Guidance |
|---|---|---|
| Checkbox | Boolean selection | Use the native/design-system control |
| Radio | Choose one option from a group | Use established radio component |
| Toggle on/off | Enable/disable a setting | State and label must be clear |
| Dropdown / Select | Choose from options | Use the same chevron convention |
| Calendar / Date | Choose a date | Avoid duplicate calendar icons if the input already includes one |
| Clock / Time | Choose a time | Respect locale and formatting |
| Eye / Eye-off | Show/hide password or sensitive field | Accessible label should change with state |
| Lock / Unlock | Locked or unlocked state | Do not imply permission access if it means data lock |
| Attachment | File attached | Show file name and removal action where relevant |
| Clear | Clear a search/filter/input | Only show when the field can be cleared |
| Required / Validation | Field needs attention | Pair with explanatory text; never use colour alone |
| Help / Tooltip | Explain a field | Do not hide essential instructions only in a tooltip |

### 6.4 School and academic operations

| Semantic concept | Meaning / use | Guidance |
|---|---|---|
| School / Organisation | School or tenant context | Respect the active tenant and branding |
| Student | Student records and student-specific workflows | Use consistently across all portals |
| Parent / Guardian | Parent or guardian records | Use actual role terminology in product copy |
| Teacher | Teacher or teaching staff | Do not use for all staff if role distinction matters |
| Staff / User | General staff or account | Use only where role is not more specific |
| Class / Classroom | Class group or physical room | Keep group and room meanings distinct |
| Subject | Curriculum subject | Use in timetable, marks, and academic records |
| Academic year / Term | Academic calendar periods | Do not confuse with general calendar events |
| Timetable / Lesson / Period | Scheduled academic activity | Distinguish overview, lesson, and time period where necessary |
| Attendance | Attendance records/register | The same concept should retain the same icon |
| Present | Learner recorded present | Pair with visible label |
| Absent | Learner recorded absent | Pair with visible label and follow domain rules |
| Late | Learner arrived late | Do not use the pending icon |
| Excused | Absence/attendance excused | Use actual supported status terminology |
| Unmarked | Attendance has not yet been recorded | Must not look like absent |
| Assignment / Homework | Work assigned to learners | Use product terminology consistently |
| Assessment / Exam / Test | Evaluation activity | Keep assessment type distinctions where supported |
| Marks / Grade / Results | Score, calculated grade, or result | Do not imply marks and grades are the same thing |
| Report card / Transcript | Formal academic record | Use existing naming and permissions |
| Performance / Progress | Trends over time | Avoid implying predictive certainty |
| Certificate / Achievement | Formal award or milestone | Use only when the feature exists |
| Library / Book / Resource | Learning resources | Keep resource and physical library meanings distinct |
| Behaviour / Incident / Wellbeing | Student behaviour and wellbeing workflows | Use sensitive, neutral visual language |
| Counselling / Health | Support or health-related records | Keep access controlled and privacy-aware |

### 6.5 Finance, payments, and accounting

| Semantic concept | Meaning / use | Guidance |
|---|---|---|
| Fees | Fee structure or fee account | Distinguish fees from payment transaction |
| Payment | A payment transaction/action | Do not imply money has been received unless confirmed |
| Make payment | Start a payment flow | Use an action icon and clear label |
| Payment history | List of previous payment activity | Keep distinct from account statement if both exist |
| Paid | Confirmed paid state | Only show after authoritative confirmation |
| Partial payment | Partially settled amount | Use text and amount details |
| Outstanding / Overdue | Amount still owed / past due | Follow existing status rules |
| Refund | Refund or reversal flow | Confirm where appropriate and show resulting state |
| Invoice | Request for payment | Distinguish from receipt |
| Receipt | Evidence of a recorded transaction | Never show a receipt icon as proof of actual receipt if only a claim exists |
| Statement / Ledger | Account history or accounting records | Use financial permissions |
| Budget / Revenue / Expense | Financial summaries and transactions | Distinguish incoming and outgoing values |
| Loan / Apply / Repay | Loan workflows where supported | Use only existing features and permissions |
| Approve / Reject | Review decision | Pair icon and explicit text in consequential actions |
| Payroll / Payslip | Staff compensation records | Restrict to permitted roles |
| Procurement / Inventory / Stock | Purchasing and stock workflows | Distinguish add stock, remove stock, and low-stock warning |
| Canteen / Meal / Nutrition | Food services and meal management | Use only where implemented |
| Transport / Route / Vehicle | Transport operations | Keep route, vehicle, and trip meanings clear |
| Asset / Facility / Maintenance | Physical resources and upkeep | Do not use a generic settings icon when a specific concept exists |

**Critical financial meaning:** A parent action may create a payment claim or submission; it must not be represented as confirmed payment until the authoritative payment workflow says the money was received. Icon, label, and status must reflect the true business state.

### 6.6 Communication, notifications, and engagement

| Semantic concept | Meaning / use | Guidance |
|---|---|---|
| Message / Inbox | Direct or inbox communication | Use one canonical message glyph |
| New message / Compose | Start a message | Keep distinct from inbox |
| Reply / Reply all / Forward | Message actions | Use standard directional semantics |
| Group chat | Group communication | Do not use for announcements |
| Announcement / Broadcast | One-to-many communication | Keep distinct from private messages |
| Notice / Circular / Newsletter | Formal communication types | Use the actual product labels |
| Notification | A system/user alert | Show unread count or dot only when meaningful |
| Reminder | Time-based prompt | Do not confuse with urgent alert |
| Urgent alert | Important or time-critical notice | Reserve stronger visual emphasis for genuinely urgent cases |
| Parent / Teacher / Student message | Role-specific communication | Respect role and privacy |
| Meeting / Appointment | Scheduled conversation or event | Show date/time context |
| Video / Audio call | Live communication | Use only if supported |
| Comment / Feedback / Reaction | Engagement on content | Keep reaction icons consistent |
| Read / Unread | Message state | Use clear status labels where necessary |
| Delivered | Message delivery status | Do not confuse with read |
| Online / Offline / Busy / Away | Presence | Do not imply availability if presence data is stale |
| Invite / Accept / Decline / Block | Contact or invitation actions | Keep explicit labels on consequential actions |
| Email / SMS / Phone / External link | External communication channel | Use only channels supported by the product |
| Webhook / Integration | System-to-system communication | Usually admin-only; don't expose in user-facing navigation unnecessarily |

### 6.7 User, account, authentication, and access

| Semantic concept | Meaning / use | Guidance |
|---|---|---|
| Profile / Account | User's own identity or account | Distinguish personal profile from organisation profile |
| Contact information | Contact details | Use consistent field icons only where helpful |
| Login / Logout | Authentication actions | Follow platform patterns |
| Sign up / Invite user | Account creation or invitation | Distinguish public registration from admin invitation |
| Password / Reset / Forgot password | Credential management | Use accessible labels and safe UX |
| Two-factor authentication | Additional authentication step | Use only if supported |
| Role / Permission | Assigned role or permission rule | Use clear labels; do not imply access from icon alone |
| Allow / Deny / Restricted | Permission decision or state | Keep status explicit |
| Admin / Super admin | Administrative identity | Do not expose unnecessary privilege cues to users |
| School / Organisation / Branch | Tenant or organisational scope | Ensure tenant context is explicit where needed |
| Subscription / Plan / Billing | Subscription management | Distinguish plan status from payment status |
| Active / Inactive / Pending / Expired / Suspended | Account or subscription state | Use the correct domain state, not a generic state guessed from colour |
| Verified / Unverified / Pending verification | Verification state | Do not use verified icon without authoritative confirmation |
| Security / Privacy / Audit log | Security and traceability | Keep security-sensitive routes permission-protected |
| Session / Lock / Unlock | Session or lock state | Distinguish UI lock from account lock |
| Help / Support / Documentation | Support resources | Use a consistent Help icon and route |

### 6.8 Analytics, reports, and AI

| Semantic concept | Meaning / use | Guidance |
|---|---|---|
| Analytics / Statistics | Aggregated measures | Use consistent chart and analytics icons |
| Bar / Line / Pie / Area / Donut / Scatter chart | Data visualisation type | Only use when the chart type is actually present |
| Comparison | Compare entities or periods | Label comparison dimensions |
| Growth / Decline / Trend | Directional movement | Do not imply causation from direction alone |
| Report / Generate report | View or produce a report | Distinguish report from export |
| Export / Download | Output data or a file | Respect access controls and data minimisation |
| Academic analytics | Student/class/subject/attendance outcomes | Use approved definitions and role permissions |
| Financial analytics | Fees, income, expenses, cash flow | Ensure figures reflect authoritative data |
| Operational analytics | Resource use, attendance rates, staff and facility metrics | Do not overstate incomplete data |
| AI assistant / Ask AI | Conversational assistant | Use the same assistant symbol across web and mobile |
| AI insight | AI-generated observation | Label AI-generated content appropriately |
| AI suggestion / Recommendation | Suggested next step | Make it clear the suggestion is advisory |
| Summarise / Explain / Generate / Draft | AI tasks | Keep labels explicit and consistent |
| Prediction / Forecast | Estimated future outcome | Clearly label as an estimate, not fact |
| Risk / Opportunity / Anomaly | Possible issue or pattern | Use cautious language and supporting context |
| Goal / Target / KPI / Benchmark | Measured objective | Define the metric and time period |
| Progress / Completion / On track / Behind | Progress state | Use clear text and avoid colour-only meaning |
| Data / Data source / No data / Partial data | Data availability | Distinguish no records from a failed load |
| Loading / Processing / Sync | Work in progress | Reflect actual state and avoid false completion |

**AI-specific guidance:**
- Use one canonical AI assistant icon and one consistent entry point across products.
- The icon can signal AI functionality, but the UI must also say what the assistant can do.
- The assistant must remain context-aware and permission-aware; an icon must never suggest that the user has access to data they are not authorised to see.
- Distinguish generated insight, suggestion, prediction, and confirmed system data.
- Never use a prediction icon or “risk” colour as if an outcome were certain.
- Do not decorate every AI-generated sentence with a sparkle icon; use icons when they aid recognition.

### 6.9 System states, feedback, and maintenance

| Semantic concept | Meaning / use | Guidance |
|---|---|---|
| Success / Completed | Operation completed successfully | Confirm only after success is known |
| Error / Failed | Operation failed | Provide a useful explanation and recovery path |
| Warning | Caution before or during an operation | Reserve for meaningful risk |
| Info | Supporting information | Do not use as an alert |
| Pending / In progress | Work is awaiting or underway | Distinguish queued, processing, and awaiting approval if product supports them |
| Loading | Data or content is loading | Pair with appropriate skeleton/spinner pattern |
| Sync / Synced / Unsynced | Data synchronisation state | Reflect actual persisted and synchronised status |
| Offline | Network unavailable | Must not imply unsaved data has been saved |
| No data / Empty state | No records available | Distinguish an empty result from an error |
| Retry | Repeat a failed operation | Only retry safe operations |
| Approved / Rejected / Draft / Published | Domain workflow state | Use exact business status and permissions |
| Locked / Unlocked | A record or workflow is locked/unlocked | Use the actual domain meaning |
| Database / Server / Backup / Restore | System administration | Keep privileged actions protected |
| Bug / Report issue | Report a problem | Avoid exposing internal diagnostic details to unauthorised users |

**Critical offline rule:** On mobile, icon and message must distinguish saved locally, synchronised, syncing, unsaved, and failed-to-save states. Never show a green success/check icon if data has not actually been saved. Keep the existing business rule and offline behaviour intact.

### 6.10 Additional school operations and marketplace concepts

Use only if the feature exists in the product:
- Admissions, applications, enrolment, waiting list, placement, transfer, withdrawal.
- Behaviour, discipline, incident, detention, counselling, wellbeing, commendation.
- Health record, first aid, illness, allergy, health alert, vaccination, emergency, safety.
- Hostel/boarding, room, bed, room allocation, check-in/check-out, house, house parent.
- Canteen, meal plan, food item, dietary requirements, meal attendance, supplier.
- Library, book, borrow, return, reservation, e-book, resource, library report.
- Assets, facilities, maintenance, repair, service request, inspection, booking, condition.
- Marketplace, shop, product, category, cart, order, wishlist, supplier, tracking, delivery.
- Events, clubs, activities, trips, participants, schedules, permission slips, gallery, certificates.
- Exam, assessment, test, result, grade, marksheet, progress, transcript, compliance.

Do not implement a module merely because it is represented here. Verify the current product scope and repository first.

---

## 7. Semantic state and colour rules

Use existing semantic tokens and state components. The following are meaning guidelines, not a replacement for existing business rules.

| Meaning | Preferred visual treatment | Important constraint |
|---|---|---|
| Primary navigation/action | Existing primary/blue or navy token | Must match the design system |
| Positive/success/confirmed | Existing success/green token | Use only after success is confirmed |
| Caution/pending/attention | Existing warning/amber token | Explain what is pending or needed |
| Error/destructive/failed | Existing error/coral token | Use explicit text for consequential states |
| Informational/secondary | Existing info/teal or neutral token | Keep meaning consistent |
| Neutral/inactive/disabled | Existing neutral/disabled token | Must not appear interactive |
| Selected/current | Existing selected-state token and clear visual cue | Do not rely on colour alone |
| Unread | Badge/dot plus accessible count or label when needed | Do not add unread dots to everything |
| Offline/unsynced | Clear status label plus icon | Do not present as saved/synced |
| Restricted/permission denied | Clear lock/restriction cue and explanatory text | Do not expose protected information |

Never infer a state solely from the colour in an image sheet. The real application state and its authoritative business logic determine the label and visual treatment.

---

## 8. Where icons should be used across ZSMS

### 8.1 Navigation
- Use a canonical icon for each main navigation destination.
- Keep icons consistent across sidebar, mobile tab bar, role switcher, and compact navigation when the concept is the same.
- Pair navigation icons with labels except where an established, accessible compact pattern is appropriate.
- Selected navigation should be unmistakable.
- Do not add a separate icon for a submenu if it creates unnecessary visual clutter.

### 8.2 Tables and lists
- Use icons for meaningful row actions such as view, edit, download, and delete.
- Keep action order consistent across tables.
- Use tooltips/accessibility labels for icon-only actions.
- Avoid putting multiple decorative icons inside every data cell.
- Use status icons alongside clear status text for attendance, payment, approval, publication, and sync states.
- Respect responsive layouts: a desktop row action may move into a mobile overflow menu, but its icon meaning must remain consistent.

### 8.3 Buttons
- Use leading icons for recognisable actions where they improve scanning.
- Use trailing icons for navigation/expand actions when consistent with the design system.
- Do not add icons to every button by default.
- Keep icon-to-label spacing consistent.
- Destructive actions must follow the current confirmation and destructive-action conventions.

### 8.4 Forms
- Use input icons only when they clarify the field type or action.
- Avoid redundant calendar, search, dropdown, or clear icons if the shared input component already provides them.
- Use status icons for validation only alongside a clear message.
- Keep icon behaviour and placement consistent across forms.

### 8.5 Dashboards and cards
- Use a small number of purposeful icons to help users scan KPIs and module cards.
- Do not use colour and icon choice to imply an unsupported interpretation of a metric.
- A KPI icon is a cue, not a replacement for the metric title, value, unit, period, and context.

### 8.6 Dialogs, drawers, sheets, and menus
- Use consistent close, back, expand, and action icons.
- Use clear status/action icons for confirmation, warning, or destructive dialogs.
- Keep mobile bottom sheets and web dialogs semantically aligned while respecting platform interaction conventions.

### 8.7 Empty, loading, error, and permission states
- Use the existing standard state components wherever possible.
- Icons should reinforce the state; they should not replace the explanatory heading, body copy, or recovery action.
- Distinguish no data, no search results, loading, failed request, permission denied, offline, and unsaved changes.
- Do not create a success state merely because a user tapped a button; wait for the real operation result.

### 8.8 AI surfaces
- Use one consistent AI entry icon across the application.
- Make contextual AI access visually recognisable but not intrusive.
- Ensure the AI panel knows the current page/section and only uses data permitted for that user and tenant.
- Keep AI suggestions distinct from confirmed actions or official system values.
- Avoid using the AI icon as decoration on unrelated cards.

---

## 9. Do not misrepresent business state

Icons can influence how users interpret the application's data. Preserve these ZSMS domain rules:

1. **Empty marks are not zero.** An empty mark field must not be shown as zero or represented by a completed/graded icon.
2. **Grades are calculated, not typed by default.** If a deliberate override exists, preserve the reason and the appropriate indicator.
3. **Published results follow the existing correction/unlock rules.** Do not use a generic delete/withdraw icon to suggest published results can be casually withdrawn.
4. **Payment claims are not confirmed receipts.** A parent-submitted payment action may be a claim and must not be visually marked as money received until the authoritative workflow confirms it.
5. **Offline attendance states must be truthful.** Distinguish saved, synchronised, unsaved, and failed-to-save.
6. **Permissions and tenant boundaries remain authoritative.** An icon or UI affordance must not bypass API/RLS/server-side access checks.
7. **Approval icons reflect real workflow status.** Do not show approved merely because an approval action was clicked.
8. **Predictions are estimates.** AI and analytics icons must not make forecasts look like confirmed facts.

This guide must not alter backend logic, permissions, financial workflows, grading logic, attendance logic, or any other domain rule.

---

## 10. Naming and documentation standard

Maintain a clear mapping between:
- Product concept.
- Canonical semantic icon name.
- Actual glyph/component from the existing icon library.
- Web implementation.
- Mobile implementation.
- Default size and semantic colour role, if relevant.
- Accessible label/tooltip requirements.
- Pages or shared components that use it.

Example format for a repository-maintained registry:

| Concept | Canonical name | Web glyph | Mobile glyph | Notes |
|---|---|---|---|---|
| Student | `students` | Map to existing icon package | Map to existing mobile package | Same meaning across platforms |
| Attendance | `attendance` | Map to existing icon package | Map to existing mobile package | Use in navigation and register workflows |
| Fees | `fees` | Map to existing icon package | Map to existing mobile package | Do not confuse with payment receipt |
| AI assistant | `aiAssistant` | Map to existing icon package | Map to existing mobile package | Same assistant identity, permission-aware |

The actual glyph names must be filled in after repository inspection. Do not invent icon exports or claim a glyph exists without checking the installed package/version.

---

## 10b. As implemented (2026-10-19)

This section records what was actually built, so the catalogue stays aligned with the
codebase rather than becoming the aspirational list §6 warns about.

### Where it lives

| Piece | Path |
|---|---|
| The vocabulary — 98 semantic names, **no glyphs** | `packages/design-tokens/src/icons.ts` |
| Web map (`lucide-react ^0.469`) | `apps/web/components/ui/icon.tsx` |
| Mobile map (`lucide-react-native ^1.49`) | `apps/mobile/components/icon.tsx` |
| The guard — 28 assertions | `apps/web/lib/icons.test.ts` |

**No icon library was added.** Both apps were already on lucide, and every glyph chosen
resolved in both packages, so no substitution was needed anywhere.

### Why the names and the maps are separate

§5.2 asks for a central registry. It is split in two because it has to be:

- The two lucide packages export the same names as **different component types**, so one
  map cannot type-check against both.
- `@zsms/design-tokens` is imported by `@zsms/documents` and `@zsms/notifications`, which
  render PDFs and email inside a Railway worker. A React icon library in that dependency
  tree would put React in a worker that draws a receipt.

`IconName` is a union, so a platform that omits a concept **fails to compile**. What a
type cannot check is *agreement* — nothing stops web drawing `students` as `Users` while
mobile draws it as `GraduationCap` — so the test asserts both maps are complete, invent
nothing, choose the same glyph for every concept, and use no deprecated lucide alias.

### What the audit found

| | |
|---|---|
| Web | 142 distinct glyphs across 155 files |
| Mobile | 45 across 35 files |
| Drift | **22 of 24 core concepts** drawn more than one way, or web and mobile disagreeing |
| Invisible drift | `AlertTriangle` (16 files) and `TriangleAlert` are the **same picture under two names**; so are `CheckCircle2` and `CircleCheck`. lucide renamed them and kept the old names as aliases |
| Fixed | 65 files de-duplicated; **zero deprecated aliases remain** |

The invisible drift is the part worth remembering. Nobody could see it, so no review
would have caught it, which is why the guard is a mechanical test rather than guidance.

### Two domain rules the test enforces rather than documents

- **`unmarked` is never the `absent` glyph**, on either platform — asserted, not trusted
  to a comment. `ATTENDANCE.md`'s rule is that an unmarked pupil is not an absent one,
  and on a printed register that error outlives the correction. Its colour role is
  `neutral`, not `warning`: amber beside a red `absent` reads as a lesser accusation
  rather than as no answer yet.
- **No deprecated alias in either map.** They render identically to their replacements,
  which is exactly what made the original drift impossible to see.

### Deliberate departures from the sheets

| Sheet | Decision |
|---|---|
| Purple `#8B5CF6` appears on every poster | **Not added.** §2.1 says it is not part of the core palette, and a colour outside the token package is one no school can theme and no contrast check has measured |
| Attendance drawn as a clipboard (01 A, 02 D) | **Adopted**, replacing `CalendarCheck` in both apps. Also the better symbol: a register is a clipboard, and a calendar glyph competed with Timetable two rows below it in the same sidebar |
| Eight sheets expected (§3) | **Seven are present** in the Icons folder. The work used those plus the §6 tables |

### What the registry owns

The concepts that appear in more than one place — navigation destinations, domain
objects, states. A one-off glyph on a single screen may still import lucide directly;
routing every icon through a registry is ceremony. **What drifts is what repeats.**

### Adding a concept

Add the name to `ICON_NAMES`, then both maps. The type error in each app is the point:
it is what stops a concept existing on one platform only. Do not add a name for a
feature that does not exist — §3 is explicit that a module must not be invented because
a poster shows an icon for it.

---

## 11. Implementation workflow for Claude Code

Follow this sequence rather than making broad, unreviewed changes.

### Phase 1 — Audit first
1. Read this document and the existing `DESIGN_SYSTEM.md`.
2. Locate and inspect all eight icon-suite images.
3. Identify current icon libraries, wrappers, tokens, and usage patterns for web and mobile.
4. Search for inconsistent glyphs used for the same concept.
5. Identify duplicated icon logic, hardcoded icon colours, arbitrary sizes, emoji-as-icons, inaccessible icon-only controls, and unnecessary dependencies.
6. Produce a short audit report before changing implementation.

### Phase 2 — Define the shared vocabulary
1. Create or update the canonical semantic icon mapping using the repository's existing conventions.
2. Map the core concepts used most often first: navigation, students, teachers, classes, attendance, timetable, fees, payments, messages, notifications, reports, AI assistant, settings, search, common actions, and status.
3. Confirm each mapped glyph exists in the installed package and works on its target platform.
4. Document any platform-specific differences.
5. Keep optional/unimplemented modules out of active navigation and mapping unless they are already part of the product.

### Phase 3 — Standardise shared components
1. Update existing shared navigation, button, table-action, status, form, dialog, and empty/error state components to use canonical mappings where appropriate.
2. Reuse the established web primitives and the existing React Native UI exports/components.
3. Avoid one-off per-page icon implementations when a shared component should own the behaviour.
4. Preserve all current business logic, API calls, permission checks, RLS/tenant boundaries, validation, and data workflows.
5. Keep accessible names, tooltips, focus behaviour, and touch targets correct.

### Phase 4 — Roll out incrementally
1. Start with global navigation and shared UI primitives.
2. Apply mappings to the most reused components and highest-traffic pages.
3. Continue module by module across school admin, teachers, parents, students, finance, academics, communication, reports, and settings as applicable.
4. Treat web and mobile as separate implementation passes but use the same semantic decisions.
5. Do not redesign every screen merely to add icons. Only change layout where needed to support consistent, clear icon use.

### Phase 5 — Validate
1. Run the repository's existing lint, type checks, tests, and relevant build checks.
2. Check web and mobile compilation separately.
3. Inspect representative screenshots for each portal and platform.
4. Verify icons render, align, size, and colour correctly in light/dark themes if both exist.
5. Test keyboard accessibility on web and touch targets on mobile.
6. Test disabled, loading, empty, error, success, permission-denied, and offline states where relevant.
7. Confirm no new dependencies were added without justification.
8. Confirm all business rules listed in Section 9 remain unchanged.
9. Report files changed, shared components improved, known gaps, tests run, and any pages still awaiting visual inspection.

### Phase 6 — Keep it maintainable
- Update the catalogue/registry when a new semantic icon is introduced.
- Reuse existing canonical names before adding a new one.
- If a concept genuinely needs multiple variants, document the difference and the context for each.
- Do not allow module-specific teams to invent new meanings without updating the shared standard.
- Keep this guide aligned with actual implementation rather than allowing it to become an aspirational list disconnected from the codebase.

---

## 12. Acceptance criteria

The work is complete when:

- [ ] All eight reference sheets are available in the agreed repository folder.
- [ ] Existing design tokens and icon dependencies have been inspected.
- [ ] A canonical icon vocabulary/mapping exists or the current equivalent has been updated.
- [ ] Common concepts use consistent icons across web and mobile.
- [ ] Navigation destinations have stable, recognisable icons.
- [ ] Important actions and statuses use clear, consistent iconography.
- [ ] Icon-only controls have accessible names and appropriate tooltips where useful.
- [ ] Icon sizes, spacing, colours, stroke/fill treatment, and states follow the existing design system.
- [ ] No unnecessary icon library or duplicate custom icon set was added.
- [ ] No image poster or raster crop is used as a production icon.
- [ ] Unsupported modules were not added solely because they appear in a reference sheet.
- [ ] Payment, grading, attendance, AI, permission, and tenant-security semantics remain correct.
- [ ] Web and mobile builds/tests pass to the extent supported by the existing project.
- [ ] Representative pages have been visually inspected, with remaining gaps documented.
- [ ] Claude Code provides a concise implementation report and flags decisions requiring human review.

---

## 13. Recommended repository organisation

Adapt these paths to the existing repository conventions; do not duplicate existing documentation structures.

```text
docs/
  design-references/
    zsms-icon-suite/
      01-navigation-general-ui.png
      02-school-academic-operations.png
      03-finance-payments-resource-management.png
      04-communication-notifications-engagement.png
      05-user-account-authentication-settings.png
      06-analytics-reports-ai-insights.png
      07-actions-navigation-interface-common-ui.png
      08-school-operations-wellbeing-health-transport-marketplace.png
  design/
    ZSMS_ICON_CATALOGUE.md
```

If `DESIGN_SYSTEM.md` already lives in a different foundation/documentation folder, put this catalogue alongside it or link to it from the existing documentation index rather than creating a conflicting second design-document location.

---

## 14. Final direction

Use these references to make ZSMS feel like one coherent product across every portal and device. Consistency is more important than copying a poster pixel for pixel. The implementation must be grounded in the existing repository, actual features, installed libraries, current design tokens, and real business states.

**Inspect first, standardise the semantic mapping, reuse shared components, roll out incrementally, validate visually, and preserve functionality and security.**
