/**
 * The ZSMS skin for the auth provider's hosted components.
 *
 * Spec: `Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md`
 *       `Official Documentation/02 Authentication and Identity/AUTH.md`
 *
 * ## Why a class map and not a colour list
 *
 * Clerk's `appearance` accepts `variables` (hex values) and `elements` (class
 * names). Using `variables` would mean writing hex here — and a hex typed into
 * this repository is a colour no school can override and no theme can move,
 * which is the one thing `tailwind.config.ts` exists to prevent.
 *
 * So every rule below is a Tailwind class resolving to a `--zsms-*` custom
 * property. Sign-in inherits light and dark, the school's palette, and the
 * mobile spacing scale for free, because it is drawn from the same variables as
 * everything else. Change a token and this changes with it.
 *
 * ## What is being fixed
 *
 * Out of the box these render as a Clerk-branded card: their radius, their
 * shadow, their type scale, a "Secured by Clerk" footer, and — the part that
 * actually hurts on a phone — inputs below the 44px tap floor with their own
 * padding. `h-tap` and `text-base` are applied for the same reason they are on
 * `Field`: 44px is the WCAG floor, and an input under 16px makes iOS Safari zoom
 * the page on focus, which is how a sign-in form ends up scrolled sideways
 * before a single character is typed.
 */

export const authAppearance = {
  layout: {
    // The provider's own footer is removed: on a 390px screen it is a row of
    // chrome below the only button that matters. Attribution belongs on a legal
    // page, not under the password field.
    logoPlacement: 'none',
    socialButtonsVariant: 'blockButton',
    helpPageUrl: undefined,
  },
  elements: {
    // The card is ours: the page already carries the ZSMS lockup above it, so
    // this is a plain surface rather than a second branded box.
    rootBox: 'w-full max-w-md',
    cardBox: 'w-full shadow-none',
    card: 'w-full rounded-xl border border-border bg-card p-card shadow-sm',

    header: 'gap-1',
    headerTitle: 'text-xl font-semibold tracking-tight text-foreground sm:text-2xl',
    headerSubtitle: 'text-sm text-muted-foreground',

    // 44px minimum and 16px type — the two rules that decide whether a form is
    // usable one-handed. See the header note on iOS zoom.
    formFieldInput:
      'h-tap min-h-tap w-full rounded-md border border-input bg-background px-3 py-2 text-base ' +
      'text-foreground transition-colors placeholder:text-subtle ' +
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
    formFieldLabel: 'text-sm font-medium text-foreground',
    formFieldHintText: 'text-sm text-muted-foreground',
    formFieldErrorText: 'text-sm text-danger-text',
    formFieldSuccessText: 'text-sm text-success-text',
    formFieldInputShowPasswordButton: 'text-muted-foreground hover:text-foreground',

    formButtonPrimary:
      'h-tap min-h-tap w-full rounded-md bg-primary px-4 text-base font-medium normal-case ' +
      'text-primary-foreground transition-colors hover:opacity-90 ' +
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    formButtonReset: 'text-sm text-muted-foreground hover:text-foreground',

    socialButtonsBlockButton:
      'h-tap min-h-tap w-full rounded-md border border-border bg-background text-base ' +
      'font-medium text-foreground transition-colors hover:bg-sunken',
    socialButtonsBlockButtonText: 'text-base font-medium',

    dividerLine: 'bg-border',
    dividerText: 'text-sm text-muted-foreground',

    footerAction: 'text-sm text-muted-foreground',
    footerActionLink:
      'font-medium text-primary-text underline-offset-4 hover:underline ' +
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    // "Secured by" strip. Removed for the reason in the header.
    footer: 'hidden',

    identityPreview: 'rounded-md border border-border bg-sunken',
    identityPreviewText: 'text-sm text-foreground',
    identityPreviewEditButton: 'text-primary-text hover:underline',

    // The one-time-code boxes. Sized so six of them fit a 375px screen without
    // wrapping, which is the width AUTH.md's email-OTP-only decision makes the
    // common case.
    otpCodeFieldInput:
      'size-11 rounded-md border border-input bg-background text-center text-lg text-foreground ' +
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',

    alert: 'rounded-md border border-danger bg-danger-tint text-sm text-danger-text',
    alertText: 'text-sm text-danger-text',

    spinner: 'text-primary-text',
  },
} as const
