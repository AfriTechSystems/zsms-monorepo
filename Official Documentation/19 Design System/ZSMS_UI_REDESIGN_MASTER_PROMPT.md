# ZSMS UI/UX Redesign — Master Implementation Prompt

## 1. Role and objective

Act as a senior UI/UX designer, frontend architect, React Native engineer, and design-system specialist working on ZSMS, a multi-tenant School Management ERP.

Your task is to progressively redesign the existing ZSMS application using the 12 supplied UI reference images as visual inspiration and direction.

The desired design direction combines:

- **Clean & Professional:** structured layouts, excellent readability, clear hierarchy, intuitive navigation, and a polished enterprise SaaS experience.
- **Modern & Colourful:** tasteful pastel accents, attractive icons, colourful but restrained cards, clear data visualisations, and visually engaging interfaces.

The result should feel like one cohesive, premium school management product across every portal, while adapting the navigation, layouts, and functionality to each user type.

**Important:** The supplied images are suggestive design references, not rigid specifications. You have the final technical and implementation judgment. Inspect the actual repository, understand what has already been built, and adapt the designs to the existing application. Where a reference conflicts with the actual functionality, architecture, accessibility requirements, or established business rules, preserve the correct existing behaviour and implement the best appropriate design.

Do not blindly reproduce the images or introduce features, data, workflows, or controls that do not exist.

## 2. Non-negotiable rule: redesign the UI, not the business logic

This is primarily a visual and user-experience redesign.

Do not change existing:

- Business logic, calculations, validation rules, or database behaviour.
- API contracts, authentication, authorisation, or permission checks.
- Tenant isolation or per-school data boundaries.
- Payment, fee, loan, attendance, marks, results, publishing, or correction workflows.
- Existing feature availability, subscription restrictions, or role-based access.
- Established data models, integrations, or background processes.

Do not remove, bypass, replace, or weaken existing functionality simply to make a screen resemble a reference image.

You may reorganise the visual presentation of existing functionality, improve navigation, group controls, use tabs, introduce appropriate dialogs, or simplify the interaction flow, provided the underlying behaviour remains intact.

Before modifying a screen, understand its current implementation and dependencies.

If a proposed visual change requires a functional or architectural change, identify it separately rather than silently making that change.

## 3. Read and respect the existing design system

First inspect:

`Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md`

Also inspect the actual design-token package, shared UI components, shells, navigation configuration, and the `/design` reference page.

The existing design system is the source of truth.

Preserve the existing brand colours:

- Navy: `#1E2A3F`
- Blue: `#3A8DDE`
- Green: `#4A9B4F`
- Amber: `#F5A623`
- Coral: `#E15A44`
- Teal: `#1BA0B0`

Use the existing derived colour scales, semantic colours, neutral colours, typography, spacing, radius, shadow, and sizing tokens.

Do not introduce a competing palette, hardcode styles, or create a duplicate design-token system.

Maintain the established rules for WCAG contrast, school-specific branding, visible focus states, semantic status indicators, and minimum touch targets.

Reuse and improve existing shared components wherever practical instead of creating a parallel component library.

## 4. Mandatory layout and navigation improvements

One of the biggest objectives is to make ZSMS feel organised, spacious, and easy to navigate rather than crowded or overloaded.

### A. Use top-level section navigation instead of stacking everything

Do not put every subsection, form, table, chart, setting, and action on one extremely long page.

Where a feature has multiple distinct sections, introduce an appropriate horizontal top navigation or section-tab system below the page header.

For example, a student record could use:

- Overview
- Academic Record
- Attendance
- Fees
- Timetable
- Behaviour
- Documents
- Contacts

Selecting a tab must switch the displayed section or view. **It must not merely scroll down to another section on the same long page.**

Use the existing routing and component architecture to implement this properly. Preserve useful route semantics, browser navigation, permissions, and existing data-loading behaviour.

Do not create tabs unnecessarily for simple pages. Use them where they genuinely reduce clutter and make separate areas easier to access.

### B. Organise the sidebar properly

Review every portal's sidebar and navigation configuration.

Group features into logical categories based on the user's role and workflow. Use clear labels, appropriate icons, consistent spacing, and sensible visual hierarchy.

Where categories contain many items, use collapsible dropdown groups and, where justified, nested submenus.

For example, a school portal might group navigation into:

- Overview
- People: Pupils, Staff, Teaching Assignments
- Academics: Timetable, Attendance, Results
- Finance: Fees, Accounts, Loans
- Communication: Announcements, Messages
- Administration: Settings, Roles, Permissions, Integrations, Audit

Treat these as examples, not mandatory replacements for the actual navigation structure.

Requirements:

- Keep frequently used features easy to reach.
- Avoid excessive nesting and too many navigation categories.
- Show clear active states.
- Preserve permission-gated navigation and existing access restrictions.
- Ensure expanded and collapsed states behave correctly.
- Preserve existing sidebar persistence and responsive behaviour.
- Use suitable dropdowns and sub-dropdowns where they improve navigation.
- Never show a user an actionable feature they are not authorised to access simply because it appears in a reference image.

### C. Create a consistent top navigation bar

Establish a consistent top bar for authenticated web portals using the existing architecture.

Where appropriate, it should accommodate:

- Page or portal context.
- Global search, where already supported.
- Notifications and help.
- School or organisation context.
- AI assistant access.
- User profile and account menu.

Avoid duplicating the same navigation and actions unnecessarily in both the sidebar and top bar.

On mobile, follow native platform conventions and the existing mobile navigation architecture instead of forcing the desktop top bar into a phone-sized screen.

### D. Give pages enough breathing room

Avoid clustered interfaces, excessive cards, redundant headings, too many competing colours, and unnecessarily dense layouts.

Use clear page headers, grouped content, appropriate whitespace, readable tables, consistent alignment, and restrained visual emphasis.

Prioritise the most important information first.

Do not force dashboards, record details, and settings pages to use identical layouts when their purposes differ.

For long forms, use meaningful sections and progressive disclosure where appropriate. Keep related fields together and avoid presenting unrelated settings simultaneously.

## 5. Forms, dialogs, popups, drawers, and sheets

Review the existing form and overlay components before making changes.

Use consistent, polished interaction patterns for:

- Create and edit forms.
- Confirmation dialogs.
- Destructive actions.
- Detail popups and contextual actions.
- Filters and advanced options.
- Help and explanatory information.
- Multi-step workflows where the existing process requires them.
- Mobile bottom sheets and appropriate native modal presentations.

Choose the right presentation for the task:

- Small confirmations should generally use a dialog.
- Short contextual actions may use a popover or compact menu.
- Complex creation or editing workflows may use a dedicated page or a suitably sized dialog or drawer.
- Mobile interactions should use touch-friendly native-appropriate sheets or screens.

Do not put large, complicated forms into tiny popups.

Every form must retain its existing validation, permissions, submission behaviour, error handling, loading indicators, and success feedback.

Forms should use visible labels, helpful descriptions, inline validation where appropriate, and clear primary and secondary actions.

For unsaved changes, preserve any existing safeguards and introduce appropriate warnings where necessary.

Destructive actions must be clearly distinguished from normal actions.

## 6. AI assistant redesign: transparent, contextual, and useful

ZSMS includes or is intended to include an AI assistant. Review the existing AI implementation before redesigning it.

### Visual design

Design the AI assistant as a modern, unobtrusive, **visually transparent or translucent sidebar** that can open over the current interface without making the underlying page feel disconnected.

The sidebar should use a subtle translucent surface, appropriate backdrop treatment, readable text, and the existing design tokens. Ensure sufficient contrast and readability; visual transparency must never compromise accessibility.

It should:

- Open and close without unexpectedly resetting the user's current page.
- Preserve the underlying screen context.
- Avoid covering critical controls unnecessarily.
- Support a clear conversation area, input area, loading state, and error state.
- Adapt to smaller screens, using an appropriate full-screen or bottom-sheet experience where needed.

Do not apply transparency indiscriminately to ordinary cards, forms, or data tables.

### Page- and section-aware intelligence

The AI assistant must be context-aware.

When opened, it should understand the current page and, where applicable, the currently selected section, school or tenant context, user role, and the relevant record being viewed.

For example:

- On the dashboard, it can help interpret displayed metrics and trends.
- On the student record, it can help explain authorised academic and attendance information.
- On the results page, it can explain grade distributions and performance patterns.
- On the fees page, it can help interpret balances and outstanding amounts.
- On settings pages, it can explain the current configuration and its implications.

Suggestions, quick prompts, and explanations should change according to the current context.

Do not implement this merely by changing the sidebar's visual appearance or hardcoding generic suggestions for every page.

Inspect the actual AI capabilities, backend integration, permission system, and available data before deciding how to supply context.

The assistant must never bypass API permissions, expose data from other tenants, or reveal information that the current user is not authorised to see. Client-side context must not be treated as an authorisation mechanism.

If a capability does not exist yet, document the gap instead of inventing a working feature.

## 7. Dashboard and data presentation

Use the supplied references to establish reusable patterns for dashboards, analytics, lists, record details, data entry, and settings.

### Dashboards

Use summary cards selectively, with clear labels, appropriately formatted values, and useful contextual information. Use charts where they genuinely improve understanding.

Do not display fake values or make unavailable data appear to be zero.

### Lists and tables

Use consistent search, filters, sorting, pagination, row actions, bulk actions, and empty states where the existing feature supports them.

Reuse the existing `DataTable` and other shared components. Investigate the known raw-table inconsistencies identified in the implementation audit.

### Record details

Organise identity information, key metrics, related records, and actions into logical groups or tabs. Avoid forcing every detail onto one screen.

### Forms and settings

Use clear sections, concise explanations, appropriate controls, and explicit save behaviour.

### Interface states

Provide consistent loading, empty, error, success, disabled, permission-denied, and offline states where relevant. Every state should accurately reflect the real system condition.

## 8. Preserve critical ZSMS business rules

Pay particular attention to the following rules identified in the repository audit.

- An empty marks field is not the same as a mark of zero.
- Grades are calculated and displayed, not manually typed, except for an authorised grade override with its required reason and indicator.
- Published results must follow the existing correction and granular unlocking rules.
- A parent's fee-payment action may record a payment claim rather than confirm that money has been received. Preserve the correct wording and confirmation flow.
- Offline attendance must not imply that data has been saved or synced when it has not.
- Permission checks must remain authoritative, and unknown permission keys must not accidentally grant access.
- School theming, tenant isolation, and database-enforced contrast rules must remain intact.

Preserve other business rules discovered during implementation, even if they are not listed here.

## 9. Phase One: Web redesign

Complete the web redesign first.

Before making changes:

1. Inspect the working tree and current branch.
2. Review the audit report and the 12 design references.
3. Inspect the shared tokens, primitives, shells, route structure, and existing page implementations.
4. Establish a prioritised implementation plan.
5. Identify components and patterns that can be improved centrally.
6. Confirm the current tests and CI state.

Use the eight web reference images as visual guidance:

- W1: AfriTech Admin dashboard and analytics.
- W2: School student list, search, filters, and pagination.
- W3: Student record details.
- W4: Multi-section school settings.
- W5: Results and marks entry.
- W6: Attendance register.
- W7: Authentication and onboarding.
- W8: Interface states and design-system reference.

Apply the resulting patterns across all relevant web portals:

- Public site.
- AfriTech Admin.
- School portal.
- Parent web portal.
- Teacher Hub.
- School Network.
- Student/Alumni.
- Shared account, authentication, invitation, and onboarding pages.

Do not redesign only the eight representative screens and leave the remaining portals inconsistent.

Use the references to establish reusable design patterns, then adapt them to each actual screen and workflow.

### Web implementation order

Prioritise shared components and foundational layout improvements, then apply the patterns to the representative screens, and finally propagate them across the remaining routes.

Inspect and resolve the known consistency issues from the audit where appropriate:

- Nine raw-table screens compared with existing `DataTable` usage.
- Raw buttons and inputs that bypass shared primitives.
- Missing loading and error handling on `admin/data-requests`.
- Inconsistent `EmptyState` imports.
- Confusion between the supported `Button` and `Badge` variants.
- Underused pagination and dialog components.
- Dashboard statistics and unavailable-data presentation.

Do not change working functionality solely to resolve a visual inconsistency.

## 10. Phase Two: Mobile app redesign

Only begin the mobile phase after the web redesign has been reviewed and stabilised.

Inspect `apps/mobile`, its navigation, theme bridge, shared mobile components, and actual React Native implementation.

Use the four mobile references:

- M1: Parent home and child overview.
- M2: Teacher attendance register.
- M3: Teacher home, feature grid, and timetable.
- M4: Parent fees, payment workflow, and confirmation sheet.

Adapt these patterns to the actual mobile application, including the real screens, routes, and navigation architecture.

Mobile is not simply a scaled-down web application.

Use native-appropriate layouts, touch-friendly controls, suitable safe-area handling, clear bottom navigation, and responsive content.

Respect the technical difference between React Native and the web. Share design-token values where appropriate, but do not assume web components or CSS can be reused directly in React Native.

Preserve all existing mobile features, permissions, offline behaviour, and data workflows.

For the teacher attendance register, ensure that unmarked, present, absent, late, and other supported states remain unambiguous. Offline feedback must accurately explain whether changes are saved locally, synced, or not saved.

For the parent fees workflow, preserve the distinction between initiating a payment, recording a claim, receiving payment confirmation, and updating the fee account according to the actual implementation.

## 11. Implementation and quality standards

- Reuse existing components before creating new ones.
- Prefer shared improvements that benefit multiple screens.
- Keep components maintainable and appropriately scoped.
- Use the existing design-token package.
- Avoid unnecessary dependencies.
- Preserve accessibility and keyboard navigation on web.
- Maintain readable layouts and appropriate touch targets.
- Ensure active navigation, nested menus, tabs, dialogs, and forms behave correctly.
- Preserve loading, error, empty, success, and permission states.
- Check narrow-screen layouts and avoid horizontal overflow where inappropriate.
- Verify dark mode if supported by the affected components.
- Do not use reference-image mock data as real application data.
- Do not introduce dead buttons or visually convincing controls without real existing behaviour.
- Keep the `/design` page aligned with the implemented design system.
- Run the relevant tests and checks after meaningful implementation milestones.
- Do not report a screen as verified unless it has actually been inspected.
- Do not declare completion merely because the application compiles.

## 12. Working method and reporting

Work incrementally and in clearly separated phases.

Start with a short implementation plan based on the actual repository.

Then implement the web phase, verify it, and report the results before beginning mobile.

At the end of the web phase, report:

- Screens and shared components updated.
- Portals covered.
- Major layout and navigation improvements.
- Functionality intentionally preserved.
- Tests and checks run, with results.
- Known gaps or screens not visually verified.
- Any decisions that differ from the reference images and why.

After web review, proceed to mobile and provide the same report for the native app.

Do not stop after creating a plan unless a genuine blocker or essential decision requires clarification. Use your technical judgment for routine implementation decisions.

**Final objective:** deliver a cohesive, clean, professional, modern, colourful ZSMS experience across the entire web platform and mobile app, with better navigation, less clutter, reusable patterns, accessible interactions, and fully preserved business functionality.
