/**
 * @zsms/design-tokens — the single source of truth for ZSMS visual design.
 *
 * Imported by `apps/web` (CSS variables → Tailwind), `@zsms/documents` (PDFs),
 * and `@zsms/notifications` (email), so one school looks like one school across
 * every surface it reaches.
 *
 * Nothing here touches the database or the network. A theme is resolved from
 * plain input, which is what lets the same function run in the browser, in a
 * server component, and inside a Railway worker rendering a report card.
 */

export * from './contrast'
export * from './scale'
export * from './tokens'
export * from './icons'
export * from './theme'
export * from './css'
