'use client'

/**
 * Where the school wants to be paid.
 *
 * Spec: `Official Documentation/09 Fee and Financial Management/PAYMENTS.md`
 *
 * ## Why this screen exists
 *
 * `PAYMENTS.md` has a parent uploading proof of a bank or mobile-money payment, and
 * until `0212` the schema held nowhere for a school to publish the account to pay INTO.
 * A parent could record a claim while ZSMS could not tell them the account number, so
 * they telephoned the office — the thing this product exists to stop.
 *
 * ## It leads with whether a parent can see anything
 *
 * With no active account the parent fee page shows no "how to pay" card at all, and that
 * consequence is invisible from here. So the empty state is a warning rather than a
 * shrug, and the count of what parents can see is stated at the top.
 *
 * ## Nothing is deleted
 *
 * A closed bank account is deactivated. It stops being shown to parents while the
 * payments recorded against it keep their meaning — a delete would orphan that history.
 */

import type { JSX } from 'react'
import { use, useCallback, useMemo, useState } from 'react'
import { Landmark, Plus, Smartphone, Wallet } from 'lucide-react'

import { Alert } from '../../../../../components/ui/alert'
import { Badge } from '../../../../../components/ui/badge'
import { Button } from '../../../../../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../../../components/ui/card'
import { Dialog } from '../../../../../components/ui/dialog'
import { ErrorState, PageHeader, TableSkeleton } from '../../../../../components/ui/data-states'
import { EmptyState } from '../../../../../components/ui/empty-state'
import { Field, Input, Select, Textarea } from '../../../../../components/ui/field'
import { useToast } from '../../../../../components/ui/toast'
import { apiSend, useApi } from '../../../../../lib/use-api'

interface Account {
  id: string
  methodKind: string
  label: string
  bankName: string | null
  accountName: string | null
  accountNumber: string | null
  branch: string | null
  swiftCode: string | null
  provider: string | null
  phoneNumber: string | null
  gatewayName: string | null
  instructions: string | null
  isActive: boolean
  displayOrder: number
}

const KINDS = [
  { value: 'bank_account', label: 'Bank account', icon: Landmark },
  { value: 'mobile_money', label: 'Mobile money', icon: Smartphone },
  { value: 'cash_office', label: 'Cash at the school office', icon: Wallet },
  { value: 'other', label: 'Something else', icon: Wallet },
] as const

/** A blank account, ready for the dialog. */
function blank(): Account {
  return {
    id: '',
    methodKind: 'bank_account',
    label: '',
    bankName: null,
    accountName: null,
    accountNumber: null,
    branch: null,
    swiftCode: null,
    provider: null,
    phoneNumber: null,
    gatewayName: null,
    instructions: null,
    isActive: true,
    displayOrder: 0,
  }
}

export default function FeeAccountsPage({
  params,
}: {
  params: Promise<{ schoolCode: string }>
}): JSX.Element {
  // Read so the route's dynamic segment is consumed; the API resolves the school from
  // the session rather than from this value, which must never be trusted for scoping.
  use(params)

  const { toast } = useToast()
  const { data, loading, error, code, reload } = useApi<{
    accounts: Account[]
    visibleToParents: number
  }>('/api/school/payment-details')

  const [editing, setEditing] = useState<Account | null>(null)
  const [busy, setBusy] = useState(false)

  const accounts = useMemo(() => data?.accounts ?? [], [data])

  const save = useCallback(async () => {
    if (!editing) return
    setBusy(true)
    try {
      const result = await apiSend<{ message: string }>(
        '/api/school/payment-details',
        'PATCH',
        {
          action: 'save',
          id: editing.id || undefined,
          methodKind: editing.methodKind,
          label: editing.label,
          bankName: editing.bankName,
          accountName: editing.accountName,
          accountNumber: editing.accountNumber,
          branch: editing.branch,
          swiftCode: editing.swiftCode,
          provider: editing.provider,
          phoneNumber: editing.phoneNumber,
          instructions: editing.instructions,
          displayOrder: editing.displayOrder,
        },
      )
      if (result.error) {
        toast(result.error, 'danger')
        return
      }
      setEditing(null)
      toast(result.data?.message ?? 'Saved.', 'success')
      reload()
    } finally {
      setBusy(false)
    }
  }, [editing, toast, reload])

  const setActive = useCallback(
    async (id: string, isActive: boolean) => {
      setBusy(true)
      try {
        const result = await apiSend<{ message: string }>(
          '/api/school/payment-details',
          'PATCH',
          { action: 'setActive', id, isActive },
        )
        if (result.error) {
          toast(result.error, 'danger')
          return
        }
        toast(result.data?.message ?? 'Updated.', 'success')
        reload()
      } finally {
        setBusy(false)
      }
    },
    [toast, reload],
  )

  if (loading && !data) return <TableSkeleton rows={3} columns={3} />
  if (error) return <ErrorState message={error} code={code} onRetry={reload} />

  return (
    <>
      <PageHeader
        title="Where parents pay"
        description="The accounts shown to parents on their fee page."
        note="ZSMS does not take the money. A parent pays you directly using these details, then records it so you can confirm it against your statement."
      />

      {/* The consequence of an empty list is invisible from here, so it is stated. */}
      {(data?.visibleToParents ?? 0) === 0 && (
        <Alert variant="warning" title="Parents cannot see how to pay you" className="mb-cards">
          With no active account, the fee page shows no payment details at all and a
          parent has to telephone the office to ask where to send money.
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
          <CardDescription>
            {data?.visibleToParents ?? 0} visible to parents
            {accounts.length !== (data?.visibleToParents ?? 0) &&
              `, ${accounts.length - (data?.visibleToParents ?? 0)} switched off`}
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-cards">
          {accounts.length === 0 ? (
            <EmptyState
              icon={Landmark}
              title="No accounts yet"
              description="Add the bank account or mobile money number parents should pay into."
            />
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {accounts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2 p-stack">
                  <span className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-2 font-medium">
                      {a.label}
                      {!a.isActive && <Badge variant="neutral">Hidden from parents</Badge>}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {a.bankName && `${a.bankName} · `}
                      {/* The number a parent will copy by hand. Monospaced, because a
                          transposed digit sends the fees to a stranger. */}
                      {a.accountNumber && (
                        <span data-numeric className="font-mono">
                          {a.accountNumber}
                        </span>
                      )}
                      {a.provider && `${a.provider} · `}
                      {a.phoneNumber && (
                        <span data-numeric className="font-mono">
                          {a.phoneNumber}
                        </span>
                      )}
                    </span>
                  </span>

                  <span className="ml-auto flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(a)}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => void setActive(a.id, !a.isActive)}
                    >
                      {a.isActive ? 'Hide' : 'Show'}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <Button variant="outline" className="self-start" onClick={() => setEditing(blank())}>
            <Plus aria-hidden="true" />
            Add an account
          </Button>
        </CardContent>
      </Card>

      <Dialog
        open={editing !== null}
        title={editing?.id ? 'Edit account' : 'Add an account'}
        description="Parents see exactly what you enter here, so check the number."
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button disabled={busy || !editing?.label.trim()} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </>
        }
      >
        {editing && (
          <div className="flex flex-col gap-stack">
            <Field id="a-kind" label="What kind of account" required>
              {(props) => (
                <Select
                  {...props}
                  value={editing.methodKind}
                  onChange={(e) => setEditing({ ...editing, methodKind: e.target.value })}
                >
                  {KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              id="a-label"
              label="What a parent sees"
              required
              hint="Zanaco — Main Account, Airtel Money, Pay at the office"
            >
              {(props) => (
                <Input
                  {...props}
                  value={editing.label}
                  maxLength={120}
                  onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                />
              )}
            </Field>

            {/* Only the fields the chosen kind actually needs. A mobile money row asked
                for a SWIFT code would be a form that looks broken. */}
            {editing.methodKind === 'bank_account' && (
              <>
                <Field id="a-bank" label="Bank">
                  {(props) => (
                    <Input
                      {...props}
                      value={editing.bankName ?? ''}
                      maxLength={120}
                      onChange={(e) => setEditing({ ...editing, bankName: e.target.value })}
                    />
                  )}
                </Field>
                <Field id="a-name" label="Account name">
                  {(props) => (
                    <Input
                      {...props}
                      value={editing.accountName ?? ''}
                      maxLength={160}
                      onChange={(e) => setEditing({ ...editing, accountName: e.target.value })}
                    />
                  )}
                </Field>
                <Field id="a-number" label="Account number" required>
                  {(props) => (
                    <Input
                      {...props}
                      value={editing.accountNumber ?? ''}
                      maxLength={60}
                      onChange={(e) =>
                        setEditing({ ...editing, accountNumber: e.target.value })
                      }
                    />
                  )}
                </Field>
                <Field id="a-branch" label="Branch">
                  {(props) => (
                    <Input
                      {...props}
                      value={editing.branch ?? ''}
                      maxLength={120}
                      onChange={(e) => setEditing({ ...editing, branch: e.target.value })}
                    />
                  )}
                </Field>
              </>
            )}

            {editing.methodKind === 'mobile_money' && (
              <>
                <Field id="a-provider" label="Provider" hint="Airtel Money, MTN MoMo, Zamtel">
                  {(props) => (
                    <Input
                      {...props}
                      value={editing.provider ?? ''}
                      maxLength={60}
                      onChange={(e) => setEditing({ ...editing, provider: e.target.value })}
                    />
                  )}
                </Field>
                <Field id="a-phone" label="Number" required>
                  {(props) => (
                    <Input
                      {...props}
                      value={editing.phoneNumber ?? ''}
                      maxLength={30}
                      inputMode="tel"
                      onChange={(e) => setEditing({ ...editing, phoneNumber: e.target.value })}
                    />
                  )}
                </Field>
              </>
            )}

            <Field
              id="a-instructions"
              label="Anything a parent should know"
              hint="Quote the pupil's name as the reference. Bring the slip to the office."
            >
              {(props) => (
                <Textarea
                  {...props}
                  rows={2}
                  value={editing.instructions ?? ''}
                  maxLength={600}
                  onChange={(e) => setEditing({ ...editing, instructions: e.target.value })}
                />
              )}
            </Field>
          </div>
        )}
      </Dialog>
    </>
  )
}
