/**
 * Inline SVG illustrations for empty states and public pages.
 *
 * Spec: `Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md`
 *
 * ## Why these are drawn here rather than fetched
 *
 * Every one is geometry — `rect`, `circle`, `path`, `line` — coloured through the same
 * semantic tokens as the rest of the product. Three consequences, and each is the reason:
 *
 *   * **They theme.** A stock PNG is one set of colours; these follow `--primary` into a
 *     school's own palette and into dark mode without a second asset.
 *   * **They cost nothing to load.** A Zambian school on a slow link pays no extra request
 *     for a picture that exists to say "there is nothing here yet".
 *   * **They cannot 404.** An external image that fails leaves a broken icon in the one
 *     place a user is already unsure whether the page is working.
 *
 * ## Why an empty state deserves a picture at all
 *
 * A blank panel reads as a fault. A drawing with a sentence reads as a state — and the
 * difference matters most to the audience least likely to assume the software is fine: a
 * head teacher opening a screen for the first time.
 *
 * ## Motion
 *
 * Everything moves slowly, by a few pixels, and **stops entirely** under
 * `prefers-reduced-motion`. The animation exists so a page feels alive rather than frozen
 * mid-load; anything faster would turn an empty list into the busiest thing on screen.
 */

import type { JSX, SVGProps } from 'react'

import { cn } from '../../lib/utils'

type IllustrationProps = SVGProps<SVGSVGElement> & { className?: string }

/**
 * Shared frame.
 *
 * `currentColor` is never used: these sit inside text containers whose colour is the body
 * colour, and the whole point is that the drawing is tinted independently of the sentence
 * under it.
 */
function Frame({
  children,
  className,
  title,
  ...rest
}: IllustrationProps & { title: string }): JSX.Element {
  return (
    <svg
      viewBox="0 0 160 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      className={cn('h-auto w-40 max-w-full', className)}
      {...rest}
    >
      {children}
    </svg>
  )
}

/** The ground every scene sits on, so they share a horizon. */
function Ground(): JSX.Element {
  return (
    <ellipse cx="80" cy="104" rx="52" ry="6" className="fill-muted" opacity="0.6" />
  )
}

/**
 * No pupils on the roll yet.
 *
 * An open register rather than a person: the screen is about records, and drawing a child
 * where a school expects a list invites the reading that a pupil is missing.
 */
export function NoPupils(props: IllustrationProps): JSX.Element {
  return (
    <Frame title="An empty class register" {...props}>
      <Ground />
      <rect x="40" y="28" width="80" height="68" rx="6" className="fill-surface stroke-border" strokeWidth="2" />
      <line x1="80" y1="30" x2="80" y2="94" className="stroke-border" strokeWidth="2" />
      {[44, 56, 68, 80].map((y) => (
        <g key={y}>
          <line x1="48" y1={y} x2="72" y2={y} className="stroke-muted-foreground" strokeWidth="2" strokeLinecap="round" opacity="0.35" />
          <line x1="88" y1={y} x2="112" y2={y} className="stroke-muted-foreground" strokeWidth="2" strokeLinecap="round" opacity="0.35" />
        </g>
      ))}
      <circle cx="116" cy="34" r="12" className="fill-primary" opacity="0.14" />
      <path d="M110 34 l4 4 l8 -9" className="stroke-primary" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </Frame>
  )
}

/** Nothing to mark today — a register with no school day behind it. */
export function NoAttendance(props: IllustrationProps): JSX.Element {
  return (
    <Frame title="No register to mark" {...props}>
      <Ground />
      <rect x="44" y="26" width="72" height="70" rx="6" className="fill-surface stroke-border" strokeWidth="2" />
      <rect x="44" y="26" width="72" height="16" rx="6" className="fill-primary" opacity="0.16" />
      <line x1="60" y1="20" x2="60" y2="32" className="stroke-border" strokeWidth="3" strokeLinecap="round" />
      <line x1="100" y1="20" x2="100" y2="32" className="stroke-border" strokeWidth="3" strokeLinecap="round" />
      {[0, 1, 2].map((row) =>
        [0, 1, 2, 3].map((col) => (
          <rect
            key={`${row}-${col}`}
            x={54 + col * 15}
            y={52 + row * 14}
            width="9"
            height="9"
            rx="2"
            className="fill-muted"
          />
        )),
      )}
    </Frame>
  )
}

/** No marks entered — a mark sheet waiting. */
export function NoResults(props: IllustrationProps): JSX.Element {
  return (
    <Frame title="No marks entered yet" {...props}>
      <Ground />
      <rect x="38" y="24" width="84" height="72" rx="6" className="fill-surface stroke-border" strokeWidth="2" />
      {[40, 54, 68, 82].map((y, i) => (
        <g key={y}>
          <line x1="48" y1={y} x2="92" y2={y} className="stroke-muted-foreground" strokeWidth="2" strokeLinecap="round" opacity="0.3" />
          <rect x="100" y={y - 5} width="14" height="10" rx="2" className={i === 0 ? 'fill-primary' : 'fill-muted'} opacity={i === 0 ? '0.3' : '1'} />
        </g>
      ))}
    </Frame>
  )
}

/** Nothing owed, or nothing billed — a clear account. */
export function NoFees(props: IllustrationProps): JSX.Element {
  return (
    <Frame title="Nothing outstanding" {...props}>
      <Ground />
      <rect x="46" y="30" width="68" height="62" rx="6" className="fill-surface stroke-border" strokeWidth="2" />
      <path d="M46 44 h68" className="stroke-border" strokeWidth="2" />
      {[56, 68, 80].map((y) => (
        <line key={y} x1="56" y1={y} x2="92" y2={y} className="stroke-muted-foreground" strokeWidth="2" strokeLinecap="round" opacity="0.3" />
      ))}
      <circle cx="108" cy="80" r="16" className="fill-success" opacity="0.16" />
      <path d="M100 80 l5 5 l11 -12" className="stroke-success" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </Frame>
  )
}

/** No notices — an envelope at rest. */
export function NoNotices(props: IllustrationProps): JSX.Element {
  return (
    <Frame title="No notices" {...props}>
      <Ground />
      <rect x="40" y="38" width="80" height="54" rx="6" className="fill-surface stroke-border" strokeWidth="2" />
      <path d="M40 44 l40 28 l40 -28" className="stroke-border" strokeWidth="2" strokeLinejoin="round" fill="none" />
      <circle cx="80" cy="28" r="6" className="fill-primary" opacity="0.2" />
      <circle cx="62" cy="24" r="3.5" className="fill-primary" opacity="0.12" />
      <circle cx="98" cy="24" r="3.5" className="fill-primary" opacity="0.12" />
    </Frame>
  )
}

/** Nothing matched a filter — distinct from nothing existing. */
export function NoMatches(props: IllustrationProps): JSX.Element {
  return (
    <Frame title="Nothing matched" {...props}>
      <Ground />
      <circle cx="72" cy="56" r="26" className="fill-surface stroke-border" strokeWidth="2" />
      <circle cx="72" cy="56" r="26" className="fill-primary" opacity="0.06" />
      <line x1="91" y1="75" x2="110" y2="94" className="stroke-border" strokeWidth="5" strokeLinecap="round" />
      <line x1="62" y1="46" x2="82" y2="66" className="stroke-muted-foreground" strokeWidth="2.5" strokeLinecap="round" opacity="0.5" />
      <line x1="82" y1="46" x2="62" y2="66" className="stroke-muted-foreground" strokeWidth="2.5" strokeLinecap="round" opacity="0.5" />
    </Frame>
  )
}

/** A school building — for public pages and school-shaped empty states. */
export function SchoolBuilding(props: IllustrationProps): JSX.Element {
  return (
    <Frame title="A school" {...props}>
      <Ground />
      <path d="M34 54 L80 26 L126 54 Z" className="fill-primary" opacity="0.18" />
      <path d="M34 54 L80 26 L126 54" className="stroke-primary" strokeWidth="2.5" strokeLinejoin="round" fill="none" />
      <rect x="44" y="54" width="72" height="42" rx="3" className="fill-surface stroke-border" strokeWidth="2" />
      <rect x="72" y="70" width="16" height="26" rx="2" className="fill-primary" opacity="0.22" />
      {[54, 96].map((x) => (
        <rect key={x} x={x} y="64" width="12" height="12" rx="2" className="fill-muted" />
      ))}
      {/* The flag is the only moving part: a building that breathes looks wrong,
          a flag that does not looks dead. */}
      <line x1="80" y1="26" x2="80" y2="12" className="stroke-border" strokeWidth="2" strokeLinecap="round" />
      <path d="M80 13 h12 l-3 4 l3 4 h-12 z" className="fill-accent zsms-float" />
    </Frame>
  )
}

/** Nobody signed in / no account yet — for the auth and Hub landing screens. */
export function WelcomeDesk(props: IllustrationProps): JSX.Element {
  return (
    <Frame title="A teacher's desk" {...props}>
      <Ground />
      <rect x="30" y="74" width="100" height="8" rx="3" className="fill-border" />
      <rect x="44" y="40" width="44" height="34" rx="4" className="fill-surface stroke-border" strokeWidth="2" />
      <line x1="52" y1="50" x2="80" y2="50" className="stroke-muted-foreground" strokeWidth="2" strokeLinecap="round" opacity="0.35" />
      <line x1="52" y1="58" x2="72" y2="58" className="stroke-muted-foreground" strokeWidth="2" strokeLinecap="round" opacity="0.35" />
      <circle cx="108" cy="52" r="14" className="fill-primary" opacity="0.14" />
      <path d="M102 52 a6 6 0 1 1 12 0 c0 4 -6 4 -6 8" className="stroke-primary" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <circle cx="108" cy="66" r="1.8" className="fill-primary" />
    </Frame>
  )
}

/**
 * Something broke.
 *
 * Deliberately NOT alarming — a tipped-over block, not a red cross. The user has already
 * been told something failed in words; the drawing's job is to stop the page looking
 * hostile while they read the reason.
 */
export function SomethingBroke(props: IllustrationProps): JSX.Element {
  return (
    <Frame title="Something went wrong" {...props}>
      <Ground />
      <rect x="52" y="44" width="34" height="34" rx="5" className="fill-surface stroke-border" strokeWidth="2" />
      <rect
        x="88"
        y="56"
        width="30"
        height="30"
        rx="5"
        className="fill-warning stroke-border"
        strokeWidth="2"
        opacity="0.3"
        transform="rotate(16 103 71)"
      />
      <line x1="60" y1="56" x2="78" y2="56" className="stroke-muted-foreground" strokeWidth="2" strokeLinecap="round" opacity="0.4" />
      <line x1="60" y1="66" x2="72" y2="66" className="stroke-muted-foreground" strokeWidth="2" strokeLinecap="round" opacity="0.4" />
    </Frame>
  )
}

export const ILLUSTRATIONS = {
  pupils: NoPupils,
  attendance: NoAttendance,
  results: NoResults,
  fees: NoFees,
  notices: NoNotices,
  matches: NoMatches,
  school: SchoolBuilding,
  welcome: WelcomeDesk,
  broke: SomethingBroke,
} as const

export type IllustrationName = keyof typeof ILLUSTRATIONS
