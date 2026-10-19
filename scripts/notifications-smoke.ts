/**
 * Prove a message actually leaves this machine and reaches a person.
 *
 * `npm run notifications:smoke -- --to-phone +260... --to-email you@example.com`
 *
 * ## Why this script exists, and what it is allowed to prove
 *
 * `DOC_AUDIT_PROGRESS.md` scores folder 12 Communication at 65% — the lowest of the
 * eighteen — and the reason is one sentence: **no message has ever left this
 * machine.** The handlers are written, the three-channel fallback is written, the
 * template resolver is written, the message log is written, and every one of them has
 * only ever run against `MockChannel`.
 *
 * That is the exact shape of failure this repository keeps finding: work that is
 * finished, correct, tested, and unproven at the last link. `r2:smoke` closed it for
 * storage and `queue:smoke` closed it for the queue. This is the same instrument for
 * delivery, written before the credentials arrive so that their arrival is a
 * five-minute confirmation rather than another round of discovery.
 *
 * ## It refuses to run against the mock, deliberately
 *
 * `getChannel()` returns a `MockChannel` unless `NOTIFICATION_PROVIDER=live`, and the
 * mock always succeeds. A smoke test that passes against it would be worse than no
 * smoke test — it would produce a green line saying "WhatsApp delivered" while
 * nothing had been sent, which is precisely the false confidence that let the
 * delivery gap survive this long. So this script checks the provider first and exits
 * non-zero if it is mocked.
 *
 * ## It will not invent a recipient
 *
 * Every destination must be passed on the command line. There is no default and no
 * fixture fallback, because **a fixture parent's phone number is still somebody's
 * phone number** — the same reasoning `index.ts` gives for defaulting to the mock
 * outside production. A seeded `+260` number belongs to a real handset in Lusaka.
 *
 * Each channel is skipped, loudly, when its credentials are absent. A skipped channel
 * is reported as SKIP and never as PASS: "we did not try" and "it worked" must not
 * look the same in the output, which is the whole lesson of the CI status line in
 * CLAUDE.md.
 */

import {
  FALLBACK_CHAIN,
  getChannel,
  renderTemplate,
  sendWithFallback,
  type Channel,
} from '../packages/notifications/src/index'

interface Target {
  phone?: string
  email?: string
}

let failures = 0
let skipped = 0

function result(state: 'PASS' | 'FAIL' | 'SKIP', label: string, detail = ''): void {
  if (state === 'FAIL') failures++
  if (state === 'SKIP') skipped++
  console.log(`  ${state}  ${label}${detail ? ` — ${detail}` : ''}`)
}

/** Reads `--flag value` pairs. No positional arguments: a bare phone number on the
 *  command line is too easy to paste into the wrong script. */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}

/** Which channels have credentials. Mirrors each provider's own requirements rather
 *  than guessing — a channel with half its variables set must not report ready. */
function credentialsFor(channel: Channel): string[] {
  switch (channel) {
    case 'whatsapp':
      return ['META_ACCESS_TOKEN', 'META_PHONE_NUMBER_ID']
    case 'email':
      return ['RESEND_API_KEY', 'RESEND_FROM_ADDRESS']
    case 'sms':
      return ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER']
    default:
      return []
  }
}

function missing(channel: Channel): string[] {
  return credentialsFor(channel).filter((k) => !process.env[k]?.trim())
}

function recipientFor(channel: Channel, target: Target): string | undefined {
  return channel === 'email' ? target.email : target.phone
}

async function exerciseChannel(channel: Channel, target: Target): Promise<void> {
  const absent = missing(channel)
  if (absent.length > 0) {
    result('SKIP', channel, `no credentials: ${absent.join(', ')}`)
    return
  }

  const to = recipientFor(channel, target)
  if (!to) {
    result('SKIP', channel, `no --to-${channel === 'email' ? 'email' : 'phone'} given`)
    return
  }

  /*
    A template rendered here rather than resolved from the database, so the script
    needs no Supabase session and tests the DELIVERY path alone. If this fails, the
    cause is the provider or the credential — never a missing template row.
  */
  const body = renderTemplate(
    'ZSMS delivery check for {{school}} at {{at}}. No action needed.',
    { school: 'ZSMS smoke test', at: new Date().toISOString() },
  )

  try {
    const outcome = await getChannel(channel).send({
      to,
      body,
      subject: 'ZSMS delivery check',
    } as Parameters<ReturnType<typeof getChannel>['send']>[0])

    const ok = (outcome as { status?: string })?.status !== 'failed'
    result(ok ? 'PASS' : 'FAIL', channel, JSON.stringify(outcome).slice(0, 160))
  } catch (error) {
    result('FAIL', channel, error instanceof Error ? error.message : String(error))
  }
}

/**
 * The fallback chain, which is the part no unit test can reach.
 *
 * `NOTIFICATIONS.md` specifies WhatsApp → email → SMS for critical messages only.
 * The property worth proving is not that the first channel works — the per-channel
 * checks above do that — but that a FAILING first channel hands on rather than
 * stopping, and that the outcome names which channel actually delivered. That
 * distinction is what a school's message log depends on.
 */
async function exerciseFallback(target: Target): Promise<void> {
  const usable = FALLBACK_CHAIN.filter(
    (c) => missing(c).length === 0 && recipientFor(c, target),
  )

  if (usable.length < 2) {
    result('SKIP', 'fallback chain', `needs two usable channels, have ${usable.length}`)
    return
  }

  try {
    const outcome = await sendWithFallback(
      {
        schoolId: null,
        templateKey: 'smoke_check',
        recipient: { phone: target.phone ?? null, email: target.email ?? null },
        variables: { school: 'ZSMS smoke test' },
      } as Parameters<typeof sendWithFallback>[0],
      { persist: false } as Parameters<typeof sendWithFallback>[1],
      usable,
    )

    const delivered = (outcome as { channel?: string }).channel
    result(
      delivered ? 'PASS' : 'FAIL',
      'fallback chain',
      delivered ? `delivered over ${delivered}` : JSON.stringify(outcome).slice(0, 160),
    )
  } catch (error) {
    result('FAIL', 'fallback chain', error instanceof Error ? error.message : String(error))
  }
}

async function main(): Promise<void> {
  const target: Target = {}
  const phone = arg('to-phone')
  const email = arg('to-email')
  if (phone) target.phone = phone
  if (email) target.email = email

  console.log('ZSMS notification delivery check\n')

  const provider = process.env['NOTIFICATION_PROVIDER']?.trim().toLowerCase()
  if (provider !== 'live') {
    console.log(
      `  Refusing to run: NOTIFICATION_PROVIDER is "${provider ?? '(unset)'}", not "live".\n\n` +
        '  Every channel would return MockChannel, which always succeeds. A green run\n' +
        '  against the mock is worse than no run — it reports delivery that did not happen.\n\n' +
        '  Set NOTIFICATION_PROVIDER=live in .env.local when real credentials exist.',
    )
    process.exit(1)
  }

  if (!target.phone && !target.email) {
    console.log(
      '  Refusing to run: no recipient.\n\n' +
        '  Pass --to-phone +260... and/or --to-email you@example.com.\n' +
        '  There is deliberately no default: a seeded fixture number belongs to a real\n' +
        '  handset, and this script sends real messages that cost real money.',
    )
    process.exit(1)
  }

  console.log('  This sends REAL messages to the addresses given above.\n')
  console.log('Channels')
  for (const channel of FALLBACK_CHAIN) {
    await exerciseChannel(channel, target)
  }

  console.log('\nChain')
  await exerciseFallback(target)

  console.log(
    `\n${failures === 0 ? 'OK' : 'FAILED'} — ${failures} failure(s), ${skipped} skipped.`,
  )
  if (skipped > 0 && failures === 0) {
    console.log(
      '  A skipped channel is not a passing one. Folder 12 of the documentation audit\n' +
        '  stays at its current score until every channel here has actually delivered.',
    )
  }
  process.exit(failures === 0 ? 0 : 1)
}

void main()
