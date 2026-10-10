/**
 * Client-side auth surface, re-exported under provider-neutral names.
 *
 * Spec: `Official Documentation/02 Authentication and Identity/AUTH.md`
 * Decision: ADR-032 — this package is the only permitted importer of `@clerk/*`
 *
 * `apps/web` renders `<SessionProvider>` and `<SignedIn>`, never `<ClerkProvider>`
 * and `<Clerk…>`. The renaming is not cosmetic: it is the difference between the
 * Keycloak swap being a change to this file and a change to every screen that
 * shows a sign-in state. The server-side equivalent is `getAuthProvider()` in
 * `./index`, which the same argument produced.
 *
 * These are Clerk's own client components — each already carries `'use client'`
 * in its own file, so re-exporting them from this server-safe module is correct
 * and does not pull the whole app into the client bundle.
 */

export {
  ClerkProvider as SessionProvider,
  SignIn,
  SignUp,
  SignedIn,
  SignedOut,
  SignInButton,
  SignOutButton,
  UserButton,
  OrganizationSwitcher,
  useAuth,
  useUser,
  useOrganization,
  // Needed to build our OWN organisation switcher rather than depend on
  // Clerk's prebuilt one. `useOrganizationList` yields the memberships and
  // `setActive`, which is the whole of what switching requires.
  useOrganizationList,
  useClerk,
} from '@clerk/nextjs'
