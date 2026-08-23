/**
 * Root loading boundary — the branded splash.
 *
 * Next.js renders this while the root segment is still resolving on the server,
 * which is the *initial application load* case: a cold visit, or a hard refresh.
 * It is deliberately the only place the full-screen splash appears by default.
 *
 * Nested segments define their own `loading.tsx` with skeletons instead, so
 * moving between screens inside a portal never takes the whole viewport back to
 * a logo. A splash on every navigation reads as the app restarting.
 *
 * This boundary has no session, so it cannot know the school — it shows ZSMS.
 * Inside a school's layout, `loading.tsx` at that level passes the school's
 * resolved logo and inherits its colours from the CSS variables already on the
 * document.
 */

import type { JSX } from 'react'

import { BrandSplash } from '../components/brand/brand-splash'

export default function RootLoading(): JSX.Element {
  return <BrandSplash message="Preparing your workspace" />
}
