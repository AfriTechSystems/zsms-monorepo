/**
 * Starts the web dev server on a known port, clearing whatever is holding it.
 *
 * ## Why this exists
 *
 * Three things went wrong repeatedly during Phase 4, all of them costing real
 * debugging time on problems that were not in the product:
 *
 *   1. **A killed parent leaves a listening orphan.** `next dev` runs under
 *      turbo; when the wrapper dies the child often survives, holding port 3000
 *      while its compiler worker pool is broken. The symptom is a page that
 *      answers 500 with "Jest worker encountered 2 child process exceptions" —
 *      which reads as an application error and is not one.
 *
 *   2. **Next silently moves to another port.** `Port 3000 is in use … using
 *      3001 instead` is a one-line warning, and every URL anyone has written
 *      down is then wrong.
 *
 *   3. **`next build` overwrites the `.next` that `next dev` is serving from.**
 *      A build run while the dev server is up wedges it.
 *
 * So: free the port, optionally clear the build cache, start on the port that
 * was asked for, and print the addresses that actually work.
 *
 * ## And it prints the LAN address, because that is not guessable
 *
 * Testing on a phone means opening the laptop's address from the phone. On a
 * mobile hotspot that address is reassigned freely — it changed three times in
 * one session while this was being written. Printing it beats writing it down.
 *
 * Usage:
 *   node scripts/dev-server.mjs              # free port 3000, start
 *   node scripts/dev-server.mjs --clean      # also delete apps/web/.next first
 *   node scripts/dev-server.mjs --port 3005
 *   node scripts/dev-server.mjs --kill-only  # free the port and exit
 */

import { execSync, spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WEB = join(ROOT, 'apps', 'web')

const args = process.argv.slice(2)
const has = (flag) => args.includes(flag)
const portIndex = args.indexOf('--port')
const PORT = portIndex >= 0 ? args[portIndex + 1] : '3000'

/** Quiet exec — returns stdout, or '' rather than throwing on a non-zero exit. */
function run(command) {
  try {
    return execSync(command, { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
  } catch {
    return ''
  }
}

/**
 * Every PID listening on the port.
 *
 * Windows and POSIX need different tools, and neither is present on the other.
 * `netstat -ano` is used rather than PowerShell's `Get-NetTCPConnection` because
 * it is the same on every Windows this repo will meet.
 */
function listenersOn(port) {
  const pids = new Set()

  if (process.platform === 'win32') {
    for (const line of run(`netstat -ano -p tcp`).split(/\r?\n/)) {
      // "  TCP    0.0.0.0:3000   0.0.0.0:0   LISTENING   12345"
      if (!line.includes('LISTENING')) continue
      const cols = line.trim().split(/\s+/)
      const local = cols[1] ?? ''
      if (!local.endsWith(`:${port}`)) continue
      const pid = cols[cols.length - 1]
      // PID 0 is the system idle process and cannot — and must not — be killed.
      if (pid && pid !== '0') pids.add(pid)
    }
  } else {
    for (const pid of run(`lsof -ti tcp:${port} -sTCP:LISTEN`).split(/\s+/)) {
      if (pid) pids.add(pid)
    }
  }

  return [...pids]
}

function freePort(port) {
  const pids = listenersOn(port)
  if (pids.length === 0) {
    console.log(`[dev] port ${port} is free`)
    return
  }

  for (const pid of pids) {
    console.log(`[dev] port ${port} held by pid ${pid} — stopping it`)
    // `/T` kills the process tree: a turbo wrapper and its next-dev child are
    // two processes, and killing only the parent is what leaves the orphan.
    run(process.platform === 'win32' ? `taskkill /PID ${pid} /F /T` : `kill -9 ${pid}`)
  }

  // Windows releases the socket a moment after the process dies. Starting
  // immediately makes Next think the port is still taken and silently move on.
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    if (listenersOn(port).length === 0) {
      console.log(`[dev] port ${port} released`)
      return
    }
    execSync(process.platform === 'win32' ? 'ping -n 2 127.0.0.1 > NUL' : 'sleep 1', {
      stdio: 'ignore',
      shell: true,
    })
  }

  console.warn(`[dev] port ${port} still held after 8s — Next may choose another port`)
}

/** Every non-internal IPv4 address, so a phone knows where to point. */
function lanAddresses() {
  const out = []
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue
      // 169.254.x.x is link-local: an address assigned when DHCP failed. It is
      // never reachable from a phone, and listing it sends someone chasing it.
      if (a.address.startsWith('169.254.')) continue
      out.push({ name, address: a.address })
    }
  }
  return out
}

freePort(PORT)

if (has('--kill-only')) {
  process.exit(0)
}

if (has('--clean')) {
  console.log('[dev] clearing apps/web/.next')
  try {
    // `maxRetries`/`retryDelay` exist for precisely this: on Windows the
    // just-killed `next dev` (or a virus scanner walking the directory) can
    // still hold handles inside `.next` for a moment after the process is gone,
    // and the delete fails ENOTEMPTY. Observed exactly that.
    rmSync(join(WEB, '.next'), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  } catch (err) {
    // Warn and carry on. Clearing the cache is a convenience; refusing to start
    // the server because a stale directory could not be removed turns a small
    // inconvenience into no dev server at all — which is what happened before
    // this catch existed.
    console.warn(
      `[dev] could not clear .next (${err.code ?? err.message}) — starting anyway. ` +
        'If the server misbehaves, close anything reading apps/web/.next and retry.',
    )
  }
}

console.log('')
console.log(`  Local:    http://localhost:${PORT}`)
for (const { name, address } of lanAddresses()) {
  console.log(`  Network:  http://${address}:${PORT}   (${name})`)
}
console.log('')
console.log('  On a phone, open a Network address above — the laptop and the phone')
console.log('  must be on the same network (a hotspot counts). The address changes')
console.log('  whenever the network does, so read it here rather than remembering it.')
console.log('')

// Spawned as `node <next-cli>` rather than `npx next`, and WITHOUT `shell: true`.
//
// That detail is the whole point. `npx` on Windows is `npx.cmd`, which needs a
// shell, which puts a `cmd.exe` between this script and the node process that
// actually listens on the port. Killing or losing the shell then leaves the
// server running and unowned — precisely the orphan this script exists to clean
// up, recreated by the script itself. Observed: the wrapper exited 0 while port
// 3000 stayed held by a live `next dev`.
//
// Resolving the CLI entry point directly gives one real child, whose exit is
// Next's exit and whose kill actually kills the server.
//
// `-H 0.0.0.0` explicitly rather than relying on the default: it is what makes
// the Network addresses above true. `-p` pins the port, so a port somehow still
// held becomes a loud failure instead of a quiet move to 3001.
const NEXT_CLI = join(WEB, 'node_modules', 'next', 'dist', 'bin', 'next')

const child = spawn(process.execPath, [NEXT_CLI, 'dev', '-p', PORT, '-H', '0.0.0.0'], {
  cwd: WEB,
  stdio: 'inherit',
})

// Pass signals through, so Ctrl-C stops the server rather than orphaning it —
// the failure this whole script exists to clean up after.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal)
    process.exit(0)
  })
}

child.on('exit', (code) => process.exit(code ?? 0))
