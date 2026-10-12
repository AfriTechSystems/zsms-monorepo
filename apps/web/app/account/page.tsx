'use client'

/**
 * Your account — who you are to ZSMS, your data, and leaving.
 *
 * Spec: `Official Documentation/01 Foundation Layer/COMPLIANCE.md`
 *       Zambia Data Protection Act 2021 — access, portability, erasure
 *
 * ## Why one page for every portal
 *
 * These rights belong to a PERSON, not to a role. The same account can be a parent at
 * one school, a teacher at another and a Hub subscriber, and all three are one data
 * subject with one set of rights. Every function behind this page resolves the caller
 * from their token and takes no identifier, so one page is not a convenience — it is
 * the accurate shape.
 *
 * It also replaces a "My data" button that sat in the top bar of every portal. A
 * download that erases nothing and a request that erases everything should not be one
 * click apart from "Switch portal", and neither deserved to be explained in a tooltip.
 *
 * ## Saying plainly what will not be erased
 *
 * A school must keep payment records for six years whatever anybody asks — the Zambia
 * Revenue Authority requires it. Burying that in terms somebody agreed to two years ago
 * is how a person discovers it at the worst moment, so it is on the page, above the
 * button, before they commit.
 */

import type { JSX } from 'react'
import { useCallback, useState } from 'react'
import { useUser } from '@zsms/auth-provider/react'
import { AlertTriangle, ArrowLeft, Download, ShieldCheck, Trash2, Undo2 } from 'lucide-react'
import Link from 'next/link'

import { Alert } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { ErrorState, PageHeader, TableSkeleton } from '../../components/ui/data-states'
import { Field, Input } from '../../components/ui/field'
import { useToast } from '../../components/ui/toast'
import { apiSend, useApi } from '../../lib/use-api'
import { StaffProfileSection } from '../../components/account/staff-profile'
import { SectionTabs, useSectionTabs } from '../../components/ui/section-tabs'

interface Erasure {
  pending: boolean
  requestedAt: string | null
  actionAfter: string | null
  canRequest: boolean
  blockedWhy: string | null
  retainYears: number
}

const longDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

export default function AccountPage(): JSX.Element {
  const { user } = useUser()
  const { toast } = useToast()
  const { data, loading, error, code, reload } = useApi<Erasure>('/api/session/erasure')

  const [downloading, setDownloading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)

  /**
   * The portability right, as a file.
   *
   * Fetched rather than linked so a failure is a message on this page instead of a
   * browser tab showing raw JSON or an error nobody can read.
   */
  const download = useCallback(async () => {
    setDownloading(true)
    try {
      const response = await fetch('/api/session/my-data')
      if (!response.ok) {
        toast('Your data could not be prepared. Please try again.', 'danger')
        return
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `zsms-my-data-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast('Downloaded.', 'success')
    } catch {
      toast('Could not reach the server.', 'danger')
    } finally {
      setDownloading(false)
    }
  }, [toast])

  const requestErasure = useCallback(async () => {
    setBusy(true)
    try {
      const result = await apiSend('/api/session/erasure', 'POST', { reason: reason.trim() })
      if (result.error) {
        toast(result.error, 'danger')
        return
      }
      setConfirming(false)
      setReason('')
      setTyped('')
      reload()
    } finally {
      setBusy(false)
    }
  }, [reason, toast, reload])

  const withdraw = useCallback(async () => {
    setBusy(true)
    try {
      const result = await apiSend('/api/session/erasure', 'DELETE', {})
      if (result.error) {
        toast(result.error, 'danger')
        return
      }
      toast('Withdrawn. Nothing will be erased.', 'success')
      reload()
    } finally {
      setBusy(false)
    }
  }, [toast, reload])

  /*
    Which section is showing. `useSectionTabs` reads a `?section=` hint and ignores
    anything not in the list, so the account menu's "Privacy & your data" link opens
    the right one and a hand-edited URL cannot land on a tab that does not exist.
  */
  const [section, setSection] = useSectionTabs<'profile' | 'details' | 'privacy'>(
    'profile',
    ['profile', 'details', 'privacy'],
  )

  // After the hooks, never before: a hook below an early return changes the hook
  // order between a loading and a loaded render.
  if (loading) return <TableSkeleton rows={6} columns={2} />
  if (error) return <ErrorState message={error} code={code} onRetry={reload} />

  const retain = data?.retainYears ?? 6

  return (
    <div className="mx-auto max-w-3xl px-gutter py-cards">
      <Link
        href="/welcome"
        className="mb-stack inline-flex min-h-tap items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back
      </Link>

      <PageHeader
        title="Your account"
        description="Who you are to ZSMS, the data we hold about you, and how to leave."
      />

      {/* ---------------- Who you are ---------------- */}
      {/*
        Staff details first, because they are the ones somebody comes here to CHANGE —
        the sections below are rights (export, erasure) exercised rarely. Renders
        nothing at all for an account that is not staff anywhere.
      */}
      {/*
        Four sections, switched rather than scrolled past.

        This page was one column roughly 180 lines tall, and "Download your data" sat
        between a profile form and an erasure request — so the two most consequential
        controls in the product were separated by a form somebody was mid-way through
        filling in. Switching also means the erasure section is reached deliberately
        rather than met by accident while scrolling.

        `privacy` is linked directly from the account menu, which is why the hint is
        read from the query string.
      */}
      <SectionTabs
        tabs={[
          { key: 'profile', label: 'Profile' },
          { key: 'details', label: 'Your details' },
          { key: 'privacy', label: 'Privacy & your data' },
        ]}
        active={section}
        onChange={setSection}
      />

      {section === 'profile' && (
      <div className="mb-cards">
        <StaffProfileSection />
      </div>
      )}

      {section === 'details' && (
      <Card className="mb-cards">
        <CardHeader>
          <CardTitle>Your details</CardTitle>
          <CardDescription>
            Your name and email come from how you sign in. Change them where you sign in,
            not here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-stack sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted-foreground">Name</dt>
              <dd className="font-medium">{user?.fullName ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Email</dt>
              <dd className="font-medium">
                {user?.primaryEmailAddress?.emailAddress ?? '—'}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
      )}

      {section === 'privacy' && (
        <>
      <Card className="mb-cards">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download aria-hidden="true" className="size-5 text-primary" />
            Download your data
          </CardTitle>
          <CardDescription>
            Everything ZSMS holds about you, as a file you keep.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-stack">
          <p className="text-sm text-muted-foreground">
            The file is JSON — readable in any text editor, and the format most other
            systems can import. It covers your own record and, if you are a parent, your
            children&rsquo;s attendance, results and fee history at every school you are
            linked to. Nothing is sent anywhere; the file downloads straight to this
            device.
          </p>
          <p className="text-sm text-muted-foreground">
            This is the right of access and portability under the Zambia Data Protection
            Act. Downloading changes nothing and deletes nothing.
          </p>
          <Button onClick={() => void download()} disabled={downloading} className="self-start">
            <Download aria-hidden="true" />
            {downloading ? 'Preparing…' : 'Download my data'}
          </Button>
        </CardContent>
      </Card>

      {/* ---------------- Erasure ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trash2 aria-hidden="true" className="size-5 text-danger" />
            Delete your data
          </CardTitle>
          <CardDescription>
            Ask ZSMS to erase you. Some financial records must be kept — the detail is
            below.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-cards">
          {data?.pending ? (
            <>
              <Alert variant="warning" title="Your request is waiting">
                You asked on {data.requestedAt ? longDate(data.requestedAt) : 'a recent date'}.
                Nothing is erased before{' '}
                <strong>{data.actionAfter ? longDate(data.actionAfter) : 'the review date'}</strong>,
                so you can still change your mind.
              </Alert>
              <Button variant="outline" onClick={() => void withdraw()} disabled={busy} className="self-start">
                <Undo2 aria-hidden="true" />
                {busy ? 'Withdrawing…' : 'Withdraw my request'}
              </Button>
            </>
          ) : !data?.canRequest ? (
            /* A school owner is told before filling anything in, with the remedy. */
            <Alert variant="info" title="You cannot delete this account yet">
              {data?.blockedWhy ??
                'This account cannot be erased from here. Please contact AfriTech.'}
            </Alert>
          ) : (
            <>
              <div className="rounded-md border border-border bg-sunken p-card">
                <p className="mb-2 flex items-center gap-1.5 font-medium">
                  <ShieldCheck aria-hidden="true" className="size-4 text-primary-text" />
                  What happens
                </p>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
                  <li>
                    Your name, contact details and account are erased, and you can no
                    longer sign in.
                  </li>
                  <li>
                    <strong>Payment records are kept for {retain} years</strong>, with
                    your name removed. The Zambia Revenue Authority requires schools to
                    keep business records, and a receipt that cannot be matched to a
                    payment is not a record of anything. Only the pupil number already
                    printed on it remains.
                  </li>
                  <li>
                    Marks and attendance your child&rsquo;s school recorded belong to the
                    school&rsquo;s own register and stay with the school, not with your
                    account.
                  </li>
                  <li>
                    Nothing happens immediately. You have a week to change your mind, and
                    this page will show you the date.
                  </li>
                </ul>
              </div>

              <Alert variant="danger" title="This cannot be undone once it is actioned">
                Download your data first if you want to keep a copy — afterwards there
                will be nothing to download.
              </Alert>

              {confirming ? (
                <div className="flex flex-col gap-stack rounded-md border border-danger p-card">
                  <Field
                    id="erase-reason"
                    label="Why are you leaving? (optional)"
                    hint="Not required, and it will not change the outcome. It helps us understand why people go."
                  >
                    {(props) => (
                      <Input
                        {...props}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        maxLength={1000}
                      />
                    )}
                  </Field>

                  <Field
                    id="erase-confirm"
                    label="Type DELETE to confirm"
                    required
                    hint="Deliberately awkward. This is the last step before the request is recorded."
                  >
                    {(props) => (
                      <Input
                        {...props}
                        value={typed}
                        onChange={(e) => setTyped(e.target.value)}
                        autoComplete="off"
                      />
                    )}
                  </Field>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="destructive"
                      disabled={busy || typed !== 'DELETE'}
                      onClick={() => void requestErasure()}
                    >
                      <AlertTriangle aria-hidden="true" />
                      {busy ? 'Recording…' : 'Request deletion'}
                    </Button>
                    <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="outline" onClick={() => setConfirming(true)} className="self-start">
                  <Trash2 aria-hidden="true" />
                  Delete my data
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>
        </>
      )}
    </div>
  )
}
