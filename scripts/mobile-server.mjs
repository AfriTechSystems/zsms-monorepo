/**
 * Start Metro for the phone app, from anywhere in the repository.
 *
 * ## Why this exists
 *
 * Reported from use:
 *
 *     Unable to resolve "../../App" from node_modules/expo/AppEntry.js
 *
 * That is what `expo start` says when it is run from the WORKSPACE ROOT. Expo reads
 * `main` from whichever `package.json` it finds; the root has none, so it falls back to
 * `expo/AppEntry`, which expects a bare-workflow `App.tsx` this project does not have.
 * `apps/mobile/package.json` says `expo-router/entry`, which is correct — Expo simply
 * never read it.
 *
 * The error names a file nobody wrote and a path that does not exist, so it reads as a
 * broken install rather than a wrong working directory. Making the right thing easy is
 * better than documenting the trap.
 *
 * ## It also wires the API address
 *
 * `EXPO_PUBLIC_API_URL` has to be a LAN address: on a phone, `localhost` is the phone.
 * The address changes whenever the machine moves network, so it is detected here rather
 * than written into a file that goes stale.
 */

import { spawn } from 'node:child_process'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MOBILE = path.resolve(HERE, '..', 'apps', 'mobile')

/** Every address a phone on the same network could reach. */
function lanAddresses() {
  const out = []
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue
      // 169.254.x.x is link-local: assigned when DHCP failed, never reachable from a
      // phone, and listing it sends somebody chasing it.
      if (a.address.startsWith('169.254.')) continue
      out.push({ name, address: a.address })
    }
  }
  return out
}

const addresses = lanAddresses()
const chosen = addresses[0]?.address

if (!chosen) {
  console.error(
    '[mobile] No LAN address found. A phone cannot reach this machine — connect to Wi-Fi first.',
  )
  process.exit(1)
}

const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? `http://${chosen}:3000`

console.log('[mobile] project   ', MOBILE)
console.log('[mobile] API        ', apiUrl)
if (addresses.length > 1) {
  console.log(
    '[mobile] other addresses:',
    addresses
      .slice(1)
      .map((a) => `${a.address} (${a.name})`)
      .join(', '),
  )
  console.log('[mobile] set EXPO_PUBLIC_API_URL to override.')
}
console.log('[mobile] the web app must be running too — `npm run dev` in another terminal.')
console.log()

/*
  `--dev-client` because this project has native modules Expo Go cannot run.

  Expo removed push from Expo Go in SDK 53, and the drawer needs Reanimated and gesture
  handler. Opening the installed ZSMS build is the only arrangement where everything
  works; defaulting to it stops the question being asked again.
*/
const args = ['expo', 'start', '--dev-client', ...process.argv.slice(2)]

const child = spawn('npx', args, {
  cwd: MOBILE,
  stdio: 'inherit',
  env: { ...process.env, EXPO_PUBLIC_API_URL: apiUrl },
  // Windows resolves `npx.cmd` only through a shell; without this it fails EINVAL.
  shell: true,
})

child.on('exit', (code) => process.exit(code ?? 0))
