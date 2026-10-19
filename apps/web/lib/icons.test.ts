/**
 * The web and mobile icon maps must cover the same concepts and agree on the glyph.
 *
 * Spec: `Official Documentation/19 Design System/Icons/ZSMS_ICON_CATALOGUE.md` §4.2
 *
 * ## Why this is a test and not a type
 *
 * `IconName` already forces each map to be complete — a missing concept is a compile
 * error on that platform. What a type cannot check is **agreement**: nothing stops web
 * drawing `students` as `Users` while mobile draws it as `GraduationCap`, because the
 * two maps satisfy their own `Record` independently.
 *
 * That is precisely the drift the catalogue exists to stop, and precisely what the
 * 2026-10-19 audit found: 22 of 24 core concepts drawn more than one way across the
 * two apps.
 *
 * ## Why it reads the files as text
 *
 * The mobile map imports `lucide-react-native` and a React Native component, neither of
 * which loads in Node. Importing it here would mean standing up a React Native test
 * environment to compare two lists of names. Reading the source is cruder and tests
 * exactly the thing that matters — which glyph each file names for each concept.
 *
 * ## The invisible drift this would have caught
 *
 * lucide renamed several glyphs and kept the old names as aliases, so the `Alert`-
 * prefixed spellings and their `Triangle`/`Circle`-prefixed replacements are the same
 * picture. Before this registry, 16 files used one spelling and others used the other,
 * and the check-in-a-circle glyph was split the same way.
 * Nobody could see it, which is how it spread. A reviewer comparing two maps by eye
 * would not catch it either — so the assertion is on the names, mechanically.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { ICON_NAMES, ICON_ROLE } from '@zsms/design-tokens'

const REPO = join(import.meta.dirname, '..', '..', '..')
const WEB_MAP = join(REPO, 'apps', 'web', 'components', 'ui', 'icon.tsx')
const MOBILE_MAP = join(REPO, 'apps', 'mobile', 'components', 'icon.tsx')

/**
 * Pull `name: Glyph,` pairs out of the `ICONS` object literal.
 *
 * Bounded to that object rather than the whole file, so an import list or a doc comment
 * mentioning a glyph cannot be mistaken for a mapping.
 */
function parseMap(path: string): Map<string, string> {
  const source = readFileSync(path, 'utf8')
  const start = source.indexOf('ICONS: Record<IconName, LucideIcon> = {')
  assert.ok(start > -1, `${path} has no ICONS map`)

  const body = source.slice(start)
  const pairs = new Map<string, string>()
  for (const match of body.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*):\s*([A-Z][A-Za-z0-9]*),/gm)) {
    pairs.set(match[1] as string, match[2] as string)
  }
  return pairs
}

const web = parseMap(WEB_MAP)
const mobile = parseMap(MOBILE_MAP)

test('both maps were parsed', () => {
  // A regex that silently matched nothing would make every assertion below vacuous.
  assert.ok(web.size > 50, `web map parsed ${web.size} entries`)
  assert.ok(mobile.size > 50, `mobile map parsed ${mobile.size} entries`)
})

test('every canonical name is mapped on web', () => {
  const missing = ICON_NAMES.filter((n) => !web.has(n))
  assert.deepEqual(missing, [], `web icon map is missing: ${missing.join(', ')}`)
})

test('every canonical name is mapped on mobile', () => {
  const missing = ICON_NAMES.filter((n) => !mobile.has(n))
  assert.deepEqual(missing, [], `mobile icon map is missing: ${missing.join(', ')}`)
})

test('neither map invents a concept the vocabulary does not have', () => {
  const known = new Set<string>(ICON_NAMES)
  const strayWeb = [...web.keys()].filter((k) => !known.has(k))
  const strayMobile = [...mobile.keys()].filter((k) => !known.has(k))
  assert.deepEqual(strayWeb, [], `web maps unknown names: ${strayWeb.join(', ')}`)
    assert.deepEqual(strayMobile, [], `mobile maps unknown names: ${strayMobile.join(', ')}`)
})

test('web and mobile choose the same glyph for every concept', () => {
  const disagreements = ICON_NAMES.filter((n) => web.get(n) !== mobile.get(n)).map(
    (n) => `${n}: web=${web.get(n)} mobile=${mobile.get(n)}`,
  )
  assert.deepEqual(
    disagreements,
    [],
    'one meaning, one icon — these differ:\n  ' + disagreements.join('\n  '),
  )
})

test('unmarked is not drawn as absent, on either platform', () => {
  /*
    ATTENDANCE.md's rule and the catalogue's §6.4, asserted rather than trusted to a
    comment. An unmarked pupil is a gap a teacher can still fill; drawn as absent it
    becomes a record of absence, and on a printed register that error outlives the
    correction.
  */
  assert.notEqual(web.get('unmarked'), web.get('absent'), 'web draws unmarked as absent')
  assert.notEqual(mobile.get('unmarked'), mobile.get('absent'), 'mobile draws unmarked as absent')
  assert.equal(ICON_ROLE['unmarked'], 'neutral', 'unmarked must not carry a warning or danger role')
})

test('no deprecated lucide alias is used in either map', () => {
  /*
    lucide kept the old names as aliases, so these render identically to their
    replacements — which is what made the original drift invisible. Using one here
    would reintroduce exactly that: two names for one picture, in the file whose job
    is to have one name for one picture.
  */
  const DEPRECATED = new Set([
    'AlertTriangle',
    'AlertCircle',
    'AlertOctagon',
    'CheckCircle',
    'CheckCircle2',
    'XCircle',
    'PlusCircle',
    'MinusCircle',
    'HelpCircle',
    'Edit',
    'Edit2',
    'Edit3',
    'Wand2',
    'Loader2',
    'MoreVertical',
    'MoreHorizontal',
  ])

  for (const [label, map] of [
    ['web', web],
    ['mobile', mobile],
  ] as const) {
    const used = [...map.entries()].filter(([, glyph]) => DEPRECATED.has(glyph))
    assert.deepEqual(
      used.map(([name, glyph]) => `${name}=${glyph}`),
      [],
      `${label} map uses a deprecated lucide alias`,
    )
  }
})
