/**
 * The Ask AI aura.
 *
 * A slow bloom of ZSMS colour behind the assistant panel, in the spirit of the
 * reference image (a glowing orb) rather than a copy of it: the reference is magenta
 * and violet, which are not ZSMS colours, so this uses the brand blue, purple and
 * teal — three hues close enough to blend the way the reference does instead of
 * fighting each other.
 *
 * ## It cannot make anything unreadable, by construction
 *
 * The blobs paint on their own layer, and a scrim sits between them and the panel's
 * content. So contrast is decided once by the scrim, not by wherever a blob happens
 * to have drifted — which is the failure mode of putting colour directly behind text.
 * The panel itself keeps its solid `bg-surface`; nothing here is transparent to what
 * is behind the panel.
 *
 * ## Deliberately cheap
 *
 * Three CSS gradients animated by the compositor, not a canvas. A
 * requestAnimationFrame loop behind a panel that may sit open all afternoon costs
 * battery on exactly the phones this product has to support, and frames the message
 * list needs on an old Android. Frozen under `prefers-reduced-motion`, where the
 * static gradient still carries the look.
 *
 * Details in `app/globals.css` under "The Ask AI aura".
 */

import type { JSX } from 'react'

export function AiAura(): JSX.Element {
  return (
    // Decorative throughout: it carries no information, so a screen reader should
    // never meet it.
    <div className="zsms-aura" aria-hidden="true">
      <span className="zsms-aura__blob zsms-aura__blob--a" />
      <span className="zsms-aura__blob zsms-aura__blob--b" />
      <span className="zsms-aura__blob zsms-aura__blob--c" />
      <span className="zsms-aura__scrim" />
    </div>
  )
}
