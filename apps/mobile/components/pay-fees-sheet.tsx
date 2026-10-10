/**
 * Recording a fee payment, on a phone.
 *
 * Spec: `Official Documentation/09 Fee and Financial Management/PAYMENTS.md`
 *       → *Parent-submitted payment*
 *
 * ## Why the phone is the primary place for this
 *
 * Confirmed on 2026-10-06. A parent pays by mobile money ON their phone, and the
 * confirmation message is already in their hand — so photographing it and recording the
 * payment is one continuous action here and two devices on the web. The parent app was
 * read-only until now, which made the common case the hard one.
 *
 * ## It says "Pay", and the checkbox says "claim"
 *
 * A parent looks for the word pay. But ZSMS takes no money: the school's own account
 * details are shown, the parent pays those directly, and what gets recorded is a
 * DECLARATION the school then checks. The confirmation text says so in the parent's own
 * words before they can submit, rather than leaving them to discover it from a
 * rejection.
 *
 * ## The confirmation timestamp is captured when the box is ticked
 *
 * Not at submit. `allocate_payment()` refuses one older than ten minutes, so a form left
 * open cannot be submitted on somebody else's tick — which matters more on a shared phone
 * than on a shared desktop.
 */

import type { JSX } from 'react'
import { useCallback, useState } from 'react'
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native'

import { Badge, Body, Button, Caption, Card, Title, usePalette } from './ui'
import { api } from '../lib/api'
import { useSession } from '../lib/auth'
import { NUMERIC, SPACE, TYPE } from '../theme'

export interface OutstandingRecord {
  id: string
  fee_label?: string | null
  academic_year?: string | null
  term_number?: number | null
  outstanding?: number | null
}

export interface SchoolAccount {
  id: string
  method_kind: string
  label: string
  bank_name?: string | null
  account_name?: string | null
  account_number?: string | null
  provider?: string | null
  phone_number?: string | null
  instructions?: string | null
}

const METHODS = [
  { value: 'bank_deposit', label: 'Bank deposit or transfer' },
  { value: 'cash', label: 'Cash at the school office' },
  { value: 'cheque', label: 'Cheque' },
] as const

const kwacha = (n: number): string =>
  `K${n.toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function PayFeesSheet({
  open,
  onClose,
  childId,
  childName,
  outstanding,
  accounts,
  onRecorded,
}: {
  open: boolean
  onClose: () => void
  childId: string
  childName: string
  outstanding: OutstandingRecord[]
  accounts: SchoolAccount[]
  onRecorded: () => void
}): JSX.Element {
  const c = usePalette()
  const { getToken } = useSession()

  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<string>('bank_deposit')
  const [reference, setReference] = useState('')
  const [chosen, setChosen] = useState<string[]>([])

  const [confirmed, setConfirmed] = useState(false)
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null)

  const [proof, setProof] = useState<{ path: string; fileName: string } | null>(null)
  const [uploading, setUploading] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const num = (s: string): number => {
    const n = Number(s.replace(/[^0-9.]/g, ''))
    return Number.isFinite(n) ? n : 0
  }

  const reset = useCallback(() => {
    setAmount('')
    setReference('')
    setChosen([])
    setConfirmed(false)
    setConfirmedAt(null)
    setProof(null)
    setError(null)
  }, [])

  /**
   * Pick the confirmation photograph.
   *
   * `expo-image-picker` is imported DYNAMICALLY. A static import of a native module runs
   * at module load, and this app has already been taken down twice that way — once by
   * `expo-notifications`, whose module-scope call left every screen on the splash. A
   * dynamic import fails here, where it can be reported, rather than before the app
   * renders.
   */
  const pickProof = useCallback(async () => {
    setUploading(true)
    setError(null)
    try {
      const picker = await import('expo-image-picker').catch(() => null)
      if (!picker) {
        setError('This build cannot open your photos. Record the payment without a photo.')
        return
      }

      const permission = await picker.requestMediaLibraryPermissionsAsync()
      if (!permission.granted) {
        // Named plainly: a silent no-op after tapping reads as the app being broken.
        setError('ZSMS needs permission to read your photos to attach a payment confirmation.')
        return
      }

      const result = await picker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
      })
      if (result.canceled || !result.assets[0]) return

      const asset = result.assets[0]
      const body = new FormData()
      /*
        React Native's FormData takes a {uri, name, type} object rather than a Blob.
        Casting is unavoidable: the web `FormData` types do not describe this, and
        constructing a Blob would mean reading the whole image into JS memory on a phone.
      */
      body.append(
        'file',
        {
          uri: asset.uri,
          name: asset.fileName ?? 'payment-confirmation.jpg',
          type: asset.mimeType ?? 'image/jpeg',
        } as unknown as Blob,
      )
      body.append('childId', childId)

      const uploaded = await api.postForm<{ path: string; fileName: string }>(
        '/api/parent/fees/proof',
        getToken,
        body,
      )
      // `api` returns a result rather than throwing, so the error is checked, not caught.
      if (uploaded.error || !uploaded.data) {
        setError(uploaded.error ?? 'That photo could not be uploaded.')
        return
      }
      setProof(uploaded.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That photo could not be uploaded.')
    } finally {
      setUploading(false)
    }
  }, [childId, getToken])

  const submit = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      const result = await api.post<{ message?: string }>('/api/parent/fees', getToken, {
        childId,
        amount: num(amount),
        paymentMethod: method,
        reference: reference.trim() || undefined,
        proofPath: proof?.path,
        confirmedAt: confirmedAt ?? new Date().toISOString(),
        /*
          Only when the parent chose. Omitted means oldest-first, which clears arrears
          before the current term — the right default for a parent who just wants to pay
          what they owe.
        */
        allocations:
          chosen.length > 0
            ? chosen
                .map((id) => {
                  const rec = outstanding.find((r) => r.id === id)
                  return { feeRecordId: id, amount: Number(rec?.outstanding ?? 0) }
                })
                .filter((a) => a.amount > 0)
            : undefined,
      })

      if (result.error) {
        setError(result.error)
        return
      }

      reset()
      onRecorded()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That payment could not be recorded.')
    } finally {
      setSaving(false)
    }
  }, [
    amount,
    method,
    reference,
    proof,
    confirmedAt,
    chosen,
    outstanding,
    childId,
    getToken,
    reset,
    onRecorded,
    onClose,
  ])

  const canSubmit = confirmed && num(amount) > 0 && !saving && !uploading

  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <ScrollView contentContainerStyle={{ padding: SPACE.gutter, gap: SPACE.card }}>
          <Title>Pay {childName}&apos;s fees</Title>

          {/* Where to pay, FIRST. A parent opening this to pay needs the number before
              the form; one opening it to record a payment already has it. */}
          {accounts.length > 0 && (
            <Card>
              <Text style={[TYPE.body, { color: c.text, fontWeight: '600' }]}>Pay the school directly</Text>
              <Caption>ZSMS does not take the money.</Caption>

              {accounts.map((a) => (
                <View key={a.id} style={{ marginTop: SPACE.stack }}>
                  <Text style={[TYPE.body, { color: c.text, fontWeight: '600' }]}>{a.label}</Text>
                  {a.bank_name ? <Caption>{a.bank_name}</Caption> : null}
                  {a.account_number ? (
                    <Text style={[TYPE.body, NUMERIC, { color: c.text, letterSpacing: 1 }]}>
                      {a.account_number}
                    </Text>
                  ) : null}
                  {a.provider ? <Caption>{a.provider}</Caption> : null}
                  {a.phone_number ? (
                    <Text style={[TYPE.body, NUMERIC, { color: c.text, letterSpacing: 1 }]}>
                      {a.phone_number}
                    </Text>
                  ) : null}
                  {a.instructions ? <Caption>{a.instructions}</Caption> : null}
                </View>
              ))}
            </Card>
          )}

          <Card>
            <Text style={[TYPE.body, { color: c.text, fontWeight: '600' }]}>How much you paid</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={c.textSubtle}
              style={{
                ...TYPE.body,
                color: c.text,
                borderWidth: 1,
                borderColor: c.border,
                borderRadius: 8,
                padding: SPACE.stack,
                marginTop: 6,
              }}
            />

            <Text style={[TYPE.body, { color: c.text, fontWeight: '600', marginTop: SPACE.card }]}>How you paid</Text>
            <View style={{ gap: 6, marginTop: 6 }}>
              {METHODS.map((m) => (
                <Pressable
                  key={m.value}
                  onPress={() => setMethod(m.value)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    minHeight: 44,
                  }}
                >
                  <View
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 10,
                      borderWidth: 2,
                      borderColor: method === m.value ? c.primary : c.border,
                      backgroundColor: method === m.value ? c.primary : 'transparent',
                    }}
                  />
                  <Body>{m.label}</Body>
                </Pressable>
              ))}
            </View>

            <Text style={[TYPE.body, { color: c.text, fontWeight: '600', marginTop: SPACE.card }]}>
              Reference number
            </Text>
            <Caption>
              The mobile money confirmation or bank slip number. Helps the school find it.
            </Caption>
            <TextInput
              value={reference}
              onChangeText={setReference}
              autoCapitalize="characters"
              placeholder="MP250106.1234.ABCD"
              placeholderTextColor={c.textSubtle}
              style={{
                ...TYPE.body,
                color: c.text,
                borderWidth: 1,
                borderColor: c.border,
                borderRadius: 8,
                padding: SPACE.stack,
                marginTop: 6,
              }}
            />
          </Card>

          {/* Which terms. Only when there is a real choice to make. */}
          {outstanding.length > 1 && (
            <Card>
              <Text style={[TYPE.body, { color: c.text, fontWeight: '600' }]}>What is this payment for?</Text>
              <Caption>
                Leave these alone and the school puts it against your oldest balance first,
                which clears arrears before this term.
              </Caption>

              <View style={{ gap: 6, marginTop: SPACE.stack }}>
                {outstanding.map((r, i) => (
                  <Pressable
                    key={r.id}
                    onPress={() =>
                      setChosen((prev) =>
                        prev.includes(r.id)
                          ? prev.filter((x) => x !== r.id)
                          : [...prev, r.id],
                      )
                    }
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                      minHeight: 44,
                    }}
                  >
                    <View
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 4,
                        borderWidth: 2,
                        borderColor: chosen.includes(r.id) ? c.primary : c.border,
                        backgroundColor: chosen.includes(r.id) ? c.primary : 'transparent',
                      }}
                    />
                    <View style={{ flex: 1 }}>
                      <Body>
                        {r.fee_label ?? 'Fees'} — Term {r.term_number}, {r.academic_year}
                      </Body>
                      <Text style={[TYPE.caption, NUMERIC, { color: c.textSubtle }]}>
                        {kwacha(Number(r.outstanding ?? 0))} owing
                      </Text>
                    </View>
                    {/* The newest record is this term, since the list arrives ordered by
                        due date. */}
                    {i === outstanding.length - 1 ? <Badge label="This term" tone="primary" /> : null}
                  </Pressable>
                ))}
              </View>
            </Card>
          )}

          <Card>
            <Text style={[TYPE.body, { color: c.text, fontWeight: '600' }]}>Proof of payment</Text>
            <Caption>
              A photo of your mobile money message or the bank slip. Not needed if you paid
              cash at the office.
            </Caption>

            <View style={{ marginTop: SPACE.stack }}>
              <Button
                label={
                  uploading ? 'Uploading…' : proof ? 'Choose a different photo' : 'Add a photo'
                }
                onPress={() => void pickProof()}
                tone="outline"
                disabled={uploading}
              />
            </View>

            {proof ? (
              <Text style={[TYPE.caption, { color: c.success, marginTop: 6 }]}>
                {proof.fileName} attached
              </Text>
            ) : null}
          </Card>

          {/* The declaration. */}
          <Pressable
            onPress={() => {
              const next = !confirmed
              setConfirmed(next)
              // Stamped when TICKED, not at submit — see the header.
              setConfirmedAt(next ? new Date().toISOString() : null)
            }}
            style={{ flexDirection: 'row', gap: 10, paddingVertical: SPACE.stack }}
          >
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 4,
                borderWidth: 2,
                marginTop: 2,
                borderColor: confirmed ? c.primary : c.border,
                backgroundColor: confirmed ? c.primary : 'transparent',
              }}
            />
            <Text style={[TYPE.body, { color: c.text, flex: 1 }]}>
              I confirm that this payment has been made and the information provided is
              accurate. I understand this is a claim the school will check against their
              records, and that false submissions may result in account suspension.
            </Text>
          </Pressable>

          {error ? (
            <Card>
              <Text style={[TYPE.body, { color: c.danger }]}>{error}</Text>
            </Card>
          ) : null}

          <Button
            label={saving ? 'Recording…' : 'Record this payment'}
            onPress={() => void submit()}
            disabled={!canSubmit}
          />
          <Button label="Cancel" onPress={onClose} tone="outline" />
        </ScrollView>
      </View>
    </Modal>
  )
}
