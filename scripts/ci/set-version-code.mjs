/**
 * Give the Android build a fresh, increasing versionCode.
 *
 * Android refuses to replace an installed app when the incoming versionCode is lower,
 * and several OEM package installers — common on budget handsets — also refuse an EQUAL
 * one. Every build was versionCode 1, so the second APK could never replace the first,
 * reported on the phone as a bare "App not installed" with no reason.
 *
 * Takes the value as an argument so CI can pass its run number, which is monotonic per
 * workflow — exactly the property versionCode needs.
 *
 * A separate file rather than `node -e` in the workflow: the inline version went
 * through three layers of escaping (YAML block scalar, shell, JavaScript string) and
 * arrived with its `\n` already expanded, which broke the workflow in a way GitHub
 * reported as "no workflow_dispatch trigger".
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP_JSON = path.resolve(HERE, '..', '..', 'apps', 'mobile', 'app.json')

const value = Number(process.argv[2])
if (!Number.isInteger(value) || value < 1) {
  console.error(`[version] Expected a positive integer, got ${process.argv[2] ?? '(nothing)'}`)
  process.exit(1)
}

const config = JSON.parse(readFileSync(APP_JSON, 'utf8'))
config.expo.android = config.expo.android ?? {}
config.expo.android.versionCode = value

writeFileSync(APP_JSON, `${JSON.stringify(config, null, 2)}\n`)
console.log(`[version] versionCode ${value}`)
