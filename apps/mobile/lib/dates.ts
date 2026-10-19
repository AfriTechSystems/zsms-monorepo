/**
 * Date helpers for the phone app.
 *
 * Mirrors `apps/web/lib/dates.ts`, which carries the full reasoning. The short
 * version is the part that matters here.
 */

/**
 * Today as `YYYY-MM-DD`, in the **device's local timezone**.
 *
 * ## Never `toISOString().slice(0, 10)`
 *
 * That is UTC. Zambia is UTC+2, so between midnight and 02:00 local it returns
 * **yesterday** — and on this app that is not a cosmetic error. The register screen
 * opens the date it is given: a teacher marking an early register would have been
 * shown yesterday's sheet, seen yesterday's marks seeded into it, and corrected them.
 * The web app had eight copies of the UTC form and this app had one, here.
 *
 * The local accessors are the whole point. `getUTCFullYear` and friends would put the
 * bug straight back.
 */
export function todayIso(): string {
  const d = new Date()
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}
