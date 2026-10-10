'use client'

/**
 * Records a page view on every navigation, with the path and nothing else.
 *
 * Spec: `Official Documentation/01 Foundation Layer/COMPLIANCE.md`
 *
 * ## Why this exists rather than PostHog's own page view
 *
 * `capture_pageview` is disabled in `lib/analytics.ts` because PostHog's version sends
 * the full URL. ZSMS puts `?childId=`, `?classId=` and `?feeRecordId=` in query strings,
 * and each of those identifies a child — so a default page view would send a stream of
 * pupil identifiers to a service outside `af-south-1`.
 *
 * This sends `usePathname()`, which carries no query string at all.
 *
 * ## The dynamic segments are still identifiers
 *
 * `/school/ZM-LSK-0001/pupils/<uuid>` names a pupil in the PATH. So dynamic segments are
 * replaced with a placeholder before sending: the useful question is "how often is the
 * pupil detail screen opened", not "who was looked at".
 */

import type { JSX } from 'react'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

import { trackPageView } from '../../lib/analytics'

/** A UUID anywhere in the path — a pupil, a payment, a resource. */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/** A school code such as `ZM-LSK-0001`, which names one customer. */
const SCHOOL_CODE = /\b[A-Z]{2}-[A-Z]{3}-\d{4}\b/g

export function PageViews(): JSX.Element | null {
  const pathname = usePathname()

  useEffect(() => {
    if (!pathname) return

    /*
      `/school/ZM-LSK-0001/pupils/8f3c…` becomes `/school/:school/pupils/:id`.

      That answers every question analytics is actually for — which screens are used, in
      what order, by whom — without naming a school or a child.
    */
    const generic = pathname.replace(SCHOOL_CODE, ':school').replace(UUID, ':id')

    trackPageView(generic)
  }, [pathname])

  return null
}
