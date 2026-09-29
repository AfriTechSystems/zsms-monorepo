/**
 * `/legal/terms` and `/legal/privacy`.
 *
 * Spec: `Official Documentation/01 Foundation Layer/COMPLIANCE.md`
 *
 * ## These are honest placeholders, and they say so
 *
 * The registration flow requires a visitor to accept both documents, and `0150` records the
 * timestamps as evidence of that consent. A checkbox linking to a 404 would make the consent
 * meaningless and the evidence worthless.
 *
 * So the pages exist and state plainly that the final text has not been published yet. What they do
 * **not** do is contain invented legal terms. Drafting the agreement a school is bound by is not
 * engineering work, and a plausible-looking paragraph written here would be worse than an absence —
 * somebody would ship it.
 *
 * What is on them is only what is already true and documented: who the controller is, which law
 * applies, where the data lives, and how to ask. `COMPLIANCE.md` is the source for every line.
 *
 * Tracked in CLAUDE.md. Real text is required before commercial launch, and it is a business
 * deliverable with a lawyer's name on it.
 */

import type { JSX } from 'react'
import { notFound } from 'next/navigation'
import Link from 'next/link'

const DOCUMENTS = {
  terms: {
    title: 'Terms of Service',
    intent:
      'The agreement between your school and AfriTech Systems Limited — what ZSMS provides, what ' +
      'it costs, how either side ends it, and who is responsible for what.',
  },
  privacy: {
    title: 'Privacy Policy',
    intent:
      'How ZSMS handles personal data — your staff’s, and your pupils’ and their ' +
      'parents’ — what is collected, where it is stored, who can reach it, and how long it ' +
      'is kept.',
  },
} as const

type DocumentKey = keyof typeof DOCUMENTS

export function generateStaticParams(): Array<{ document: DocumentKey }> {
  return [{ document: 'terms' }, { document: 'privacy' }]
}

export default async function LegalPage({
  params,
}: {
  params: Promise<{ document: string }>
}): Promise<JSX.Element> {
  const { document } = await params
  if (!(document in DOCUMENTS)) notFound()
  const doc = DOCUMENTS[document as DocumentKey]

  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-2xl flex-col gap-cards px-gutter py-10"
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{doc.title}</h1>
        <p className="text-sm text-muted-foreground">{doc.intent}</p>
      </header>

      <div
        role="note"
        className="rounded-lg border border-warning/30 bg-warning/5 p-card text-sm"
      >
        <p className="font-medium">This document is still being prepared.</p>
        <p className="mt-2 text-muted-foreground">
          ZSMS has not launched commercially, and the final {doc.title.toLowerCase()} has not been
          published. Rather than show you approximate wording, this page says so. A school
          registering during the pilot will be sent the agreement for signature, and nothing here is
          a substitute for it.
        </p>
      </div>

      <section className="flex flex-col gap-stack text-sm">
        <h2 className="text-lg font-semibold tracking-tight">What is settled today</h2>
        <dl className="flex flex-col gap-stack">
          <div>
            <dt className="font-medium">Who runs ZSMS</dt>
            <dd className="text-muted-foreground">
              AfriTech Systems Limited, registered in Zambia. ZSMS is its product.
            </dd>
          </div>
          <div>
            <dt className="font-medium">Which law applies</dt>
            <dd className="text-muted-foreground">
              The Zambia Data Protection Act 2021. AfriTech is registered with ZICTA and is bound by
              its 72-hour breach notification requirement.
            </dd>
          </div>
          <div>
            <dt className="font-medium">Who is responsible for pupil data</dt>
            <dd className="text-muted-foreground">
              Your school. AfriTech processes it on your instruction — you decide what is collected
              and who at your school may see it. That is why registration asks you to accept this
              explicitly rather than burying it.
            </dd>
          </div>
          <div>
            <dt className="font-medium">Where the data is kept</dt>
            <dd className="text-muted-foreground">
              Pupil, staff and financial records are stored in South Africa (
              <span className="font-mono">af-south-1</span>), inside an adequacy arrangement the Act
              recognises. Only login credentials are handled outside the region, by our
              authentication provider, under a data processing agreement.
            </dd>
          </div>
          <div>
            <dt className="font-medium">What happens to your data if you stop paying</dt>
            <dd className="text-muted-foreground">
              It is not deleted. A school whose trial or subscription lapses keeps full read access
              and can export its records; only new entries are blocked. Deletion is never automatic.
            </dd>
          </div>
        </dl>
      </section>

      <p className="text-sm text-muted-foreground">
        Questions before the final text is out? Ask AfriTech directly — we would rather answer than
        have you guess.
      </p>

      <Link href="/register" className="text-sm underline">
        Back to registration
      </Link>
    </main>
  )
}
