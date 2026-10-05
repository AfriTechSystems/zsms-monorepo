/**
 * Sign the debug APK with the v1 (JAR) scheme as well as v2.
 *
 * `assembleDebug` drops v1 once `minSdkVersion` reaches 24. Android 7 and later accept
 * a v2-only APK, but several OEM package installers still want v1 for a SIDELOADED
 * one and reject it without saying why — another bare "App not installed".
 *
 * Run after `expo prebuild`, because `android/` is generated and not in the repository.
 * Editing it here keeps `app.json` the single source of configuration rather than
 * committing a native project that drifts from it.
 *
 * Idempotent: running twice leaves one copy of each line.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const GRADLE = path.resolve(HERE, '..', '..', 'apps', 'mobile', 'android', 'app', 'build.gradle')

if (!existsSync(GRADLE)) {
  console.error('[signing] No android/app/build.gradle — run `expo prebuild` first.')
  process.exit(1)
}

let source = readFileSync(GRADLE, 'utf8')

if (source.includes('enableV1Signing')) {
  console.log('[signing] already enabled')
  process.exit(0)
}

/*
  Anchored on the `debug {` inside `signingConfigs`, not on a regex over the whole file.

  The React Native template has several `debug {` blocks — one in `signingConfigs`, one
  in `buildTypes` — and only the first takes signing options.
*/
const configs = source.indexOf('signingConfigs {')
if (configs < 0) {
  console.error('[signing] No signingConfigs block. The template has changed shape.')
  process.exit(1)
}

const debugAt = source.indexOf('debug {', configs)
if (debugAt < 0) {
  console.error('[signing] No debug signingConfig. The template has changed shape.')
  process.exit(1)
}

const insertAt = debugAt + 'debug {'.length
source = `${source.slice(0, insertAt)}
            enableV1Signing true
            enableV2Signing true${source.slice(insertAt)}`

writeFileSync(GRADLE, source)
console.log('[signing] v1 and v2 signing enabled')
