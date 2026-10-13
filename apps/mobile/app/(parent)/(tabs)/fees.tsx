/**
 * What this child owes, and what has been paid.
 *
 * Spec: `Official Documentation/09 Fee Management/FEES.md`
 *
 * ## The balance is the headline
 *
 * A parent opening this screen has one question. The statement and the payment history
 * are below it, because a figure somebody has to assemble from a table is a figure they
 * will get wrong and then argue with the school about.
 *
 * ## Paying is not here, and says so
 *
 * No gateway exists yet. A screen that showed a disabled "Pay" button would read as a
 * fault; stating where payment is actually made is the honest version.
 */

import type { JSX } from 'react'
import { useState } from 'react'
import { RefreshControl, ScrollView, Text, View } from 'react-native'
import { Receipt } from 'lucide-react-native'

import { ChildSwitcher } from '../../../components/child-switcher'
import {
  PayFeesSheet,
  type OutstandingRecord,
  type SchoolAccount,
} from '../../../components/pay-fees-sheet'
import {
  Badge,
  Body,
  Caption,
  Card,
  Empty,
  Button,
  ErrorNote,
  Loading,
  Row,
  Screen,
  usePalette,
} from '../../../components/ui'
import { ProgressBar } from '../../../components/stats'
import { childQuery, useChild, type Child } from '../../../lib/child'
import { useApi } from '../../../lib/use-api'
import { NUMERIC, SPACE, TYPE } from '../../../theme'

interface Payment {
  id: string
  amount: number
  payment_method: string | null
  status: string
  receipt_number: string | null
  created_at: string
  verified_at: string | null
}

interface StatementRow {
  id?: string
  fee_name?: string | null
  amount?: number | null
  amount_paid?: number | null
  due_date?: string | null
  status?: string | null
}

interface Payload {
  children: Child[]
  balance: { outstanding?: number | null; total_billed?: number | null; total_paid?: number | null } | null
  statement: StatementRow[]
  payments: Payment[]
  /** Per-term balances, so a parent can say which term they are paying for. */
  records?: OutstandingRecord[]
  /** Where the school wants to be paid (`0212`). */
  accounts?: SchoolAccount[]
}

const kwacha = (n: number): string =>
  `K${n.toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-ZM', { day: 'numeric', month: 'short', year: 'numeric' })

export default function ParentFees(): JSX.Element {
  const c = usePalette()
  const { childId, setChildId } = useChild()
  const [paying, setPaying] = useState(false)

  const { data, loading, error, reload } = useApi<Payload>(
    `/api/parent/fees${childQuery(childId)}`,
  )

  /*
    Which child this is for.

    `childId` is null until the switcher has resolved one, in which case the first child
    is the one on screen — the same rule the API applies when no `childId` is sent.
  */
  const chosen = (data?.children ?? []).find((x) => x.id === childId) ?? data?.children?.[0]

  const outstanding = data?.balance?.outstanding ?? 0

  /*
    Verified payments only — that is what the balance nets. A parent who uploaded
    proof this morning sees it below as a claim and not in this bar, which is the same
    distinction the school side draws and the reason the two never disagree.
  */
  const billed = data?.balance?.total_billed ?? 0
  const paidPercent =
    billed > 0 ? ((data?.balance?.total_paid ?? 0) / billed) * 100 : undefined

  return (
    <Screen>
      <ChildSwitcher children={data?.children ?? []} selectedId={childId} onSelect={setChildId} />

      <ScrollView
        contentContainerStyle={{ padding: SPACE.gutter, gap: SPACE.md, paddingBottom: SPACE.xxl }}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={reload} tintColor={c.primary} />
        }
      >
        {chosen && (
          <PayFeesSheet
            open={paying}
            onClose={() => setPaying(false)}
            childId={chosen.id}
            childName={chosen.firstName ?? 'your child'}
            /* Only terms with something owing: a settled term is not a choice. */
            outstanding={(data?.records ?? []).filter((r) => Number(r.outstanding ?? 0) > 0)}
            accounts={data?.accounts ?? []}
            onRecorded={reload}
          />
        )}

        {error && <ErrorNote message={error} onRetry={reload} />}
        {loading && !data && <Loading label="Loading fees" />}

        {data && (
          <>
            <Card>
              <Caption>Outstanding</Caption>
              <Text
                style={[TYPE.display, NUMERIC, { color: outstanding > 0 ? c.danger : c.success }]}
                // One line. Zambian school fees reach six figures and a wrapped
                // figure makes the card taller than the one beside it.
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {kwacha(outstanding)}
              </Text>

              {/*
                How far through the term's fees this parent is.

                The outstanding figure alone does not say whether they are nearly done
                or have barely started, which is the thing somebody actually wants to
                know before deciding what to pay today. Shown only when there is a
                billed total to be a proportion of — otherwise a school that has not
                billed yet would show a full bar reading as "paid up".
              */}
              {paidPercent !== undefined && (
                <View style={{ gap: 4, marginTop: SPACE.sm }}>
                  <ProgressBar value={paidPercent} tone="success" />
                  <Caption>
                    {`${Math.round(paidPercent)}% of ${kwacha(billed)} paid`}
                  </Caption>
                </View>
              )}
              {/*
                The action, immediately under the number it acts on.

                A parent opens this tab to find out what they owe and then to pay it, so
                the button belongs beside the figure rather than below a statement they
                have to scroll past.
              */}
              <View style={{ marginTop: SPACE.stack }}>
                <Button
                  label="Pay school fees"
                  onPress={() => setPaying(true)}
                  disabled={!chosen}
                />
              </View>

              <Row gap={SPACE.lg}>
                <View>
                  <Caption>Billed</Caption>
                  <Text style={[TYPE.body, NUMERIC, { color: c.text }]}>
                    {kwacha(data.balance?.total_billed ?? 0)}
                  </Text>
                </View>
                <View>
                  <Caption>Paid</Caption>
                  <Text style={[TYPE.body, NUMERIC, { color: c.text }]}>
                    {kwacha(data.balance?.total_paid ?? 0)}
                  </Text>
                </View>
              </Row>
            </Card>

            {/* Said rather than discovered at a disabled button. */}
            <Body muted>
              Payment is made at the school office or by the arrangement your school has
              told you about. Paying inside ZSMS is still being built.
            </Body>

            {data.statement.length > 0 && (
              <View style={{ gap: SPACE.sm }}>
                <Caption>What has been charged</Caption>
                {data.statement.map((row, i) => (
                  <Card key={row.id ?? i}>
                    <Row gap={SPACE.sm}>
                      <Text style={[TYPE.body, { flex: 1, color: c.text, fontWeight: '600' }]}>
                        {row.fee_name ?? 'Fee'}
                      </Text>
                      <Text style={[TYPE.body, NUMERIC, { color: c.text }]}>
                        {kwacha(Number(row.amount ?? 0))}
                      </Text>
                    </Row>
                    <Row gap={SPACE.sm}>
                      {row.due_date && <Caption>Due {shortDate(row.due_date)}</Caption>}
                      {row.status && (
                        <Badge
                          label={row.status}
                          tone={row.status === 'paid' ? 'success' : 'warning'}
                        />
                      )}
                    </Row>
                  </Card>
                ))}
              </View>
            )}

            <View style={{ gap: SPACE.sm }}>
              <Caption>Payments received</Caption>
              {data.payments.length === 0 ? (
                <Empty
                  icon={Receipt}
                  title="No payments recorded"
                  body="Payments your school records will appear here."
                />
              ) : (
                data.payments.map((p) => (
                  <Card key={p.id}>
                    <Row gap={SPACE.sm}>
                      <Text style={[TYPE.body, NUMERIC, { flex: 1, color: c.text }]}>
                        {kwacha(Number(p.amount))}
                      </Text>
                      {/* A recorded payment is not a verified one, and a parent who
                          assumes otherwise is surprised at the worst moment. */}
                      <Badge
                        label={p.verified_at ? 'Verified' : p.status}
                        tone={p.verified_at ? 'success' : 'warning'}
                      />
                    </Row>
                    <Caption>
                      {shortDate(p.created_at)}
                      {p.receipt_number ? ` · ${p.receipt_number}` : ''}
                      {p.payment_method ? ` · ${p.payment_method.replace(/_/g, ' ')}` : ''}
                    </Caption>
                  </Card>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  )
}
