/**
 * Signing in on a phone.
 *
 * Spec: `Official Documentation/02 Authentication and Identity/AUTH.md`
 *       — email OTP only; SMS OTP is disabled
 *
 * ## Why a code and not a password
 *
 * `AUTH.md` fixes email OTP as the only factor, and on a phone that is the better half of
 * the bargain anyway: a teacher types six digits rather than recalling a password, and
 * there is no password to reset over WhatsApp at the start of term.
 *
 * ## Two steps, one screen
 *
 * The address and the code are the same flow, so moving between them must not feel like
 * navigating. The screen swaps its body and keeps everything else still — including the
 * address, which stays visible so somebody who mistyped it can see that they did.
 */

import type { JSX } from 'react'
import { useCallback, useState } from 'react'
import { useSignIn } from '@clerk/clerk-expo'
import { useRouter } from 'expo-router'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowLeft, ArrowRight, Mail, ShieldCheck } from 'lucide-react-native'

import { Body, Button, Caption, ErrorNote, Screen, Title, usePalette } from '../../components/ui'
import { Wordmark } from '../../components/wordmark'
import { RADIUS, SPACE, TAP, TYPE } from '../../theme'

export default function SignIn(): JSX.Element {
  const { signIn, setActive, isLoaded } = useSignIn()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const c = usePalette()

  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sendCode = useCallback(async () => {
    if (!isLoaded || !signIn) return
    setError(null)
    setBusy(true)
    try {
      const attempt = await signIn.create({ identifier: email.trim() })
      const factor = attempt.supportedFirstFactors?.find((f) => f.strategy === 'email_code')

      if (!factor || !('emailAddressId' in factor)) {
        // The address is not a ZSMS account. Said plainly rather than as "invalid", which
        // a teacher reads as "I typed it wrong" when the real answer is that their school
        // has not invited them yet.
        setError('No ZSMS account uses that address. Ask your school to invite you.')
        return
      }

      await signIn.prepareFirstFactor({
        strategy: 'email_code',
        emailAddressId: factor.emailAddressId,
      })
      setStage('code')
    } catch (err) {
      setError(readClerkError(err, 'That address could not be used to sign in.'))
    } finally {
      setBusy(false)
    }
  }, [isLoaded, signIn, email])

  const verify = useCallback(async () => {
    if (!isLoaded || !signIn) return
    setError(null)
    setBusy(true)
    try {
      const attempt = await signIn.attemptFirstFactor({
        strategy: 'email_code',
        code: code.trim(),
      })

      if (attempt.status === 'complete') {
        await setActive?.({ session: attempt.createdSessionId })
        router.replace('/(teacher)/(tabs)')
        return
      }

      // Clerk reports an incomplete attempt without throwing — a second factor, or a
      // step this build does not implement. Named rather than left as a silent no-op.
      setError('That sign-in needs another step the app cannot complete yet.')
    } catch (err) {
      setError(readClerkError(err, 'That code was not accepted.'))
    } finally {
      setBusy(false)
    }
  }, [isLoaded, signIn, code, setActive, router])

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            padding: SPACE.gutter,
            paddingTop: insets.top + SPACE.xl,
            paddingBottom: insets.bottom + SPACE.xl,
            gap: SPACE.xl,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ alignItems: 'center' }}>
            <Wordmark />
          </View>

          <View style={{ gap: SPACE.sm }}>
            <Title>{stage === 'email' ? 'Sign in' : 'Check your email'}</Title>
            <Body muted>
              {stage === 'email'
                ? 'Use the address your school has on file. We send a six-digit code — there is no password.'
                : `We sent a code to ${email.trim()}. It expires in ten minutes.`}
            </Body>
          </View>

          {error && <ErrorNote message={error} />}

          {stage === 'email' ? (
            <View style={{ gap: SPACE.md }}>
              <Field icon={Mail} label="Email address">
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="teacher@school.ac.zm"
                  placeholderTextColor={c.textSubtle}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  keyboardType="email-address"
                  inputMode="email"
                  returnKeyType="go"
                  onSubmitEditing={() => void sendCode()}
                  style={[TYPE.body, { color: c.text, flex: 1, minHeight: TAP }]}
                />
              </Field>

              <Button
                label="Send me a code"
                icon={ArrowRight}
                onPress={() => void sendCode()}
                busy={busy}
                disabled={!email.includes('@')}
                full
              />
            </View>
          ) : (
            <View style={{ gap: SPACE.md }}>
              <Field icon={ShieldCheck} label="Six-digit code">
                <TextInput
                  value={code}
                  onChangeText={setCode}
                  placeholder="000000"
                  placeholderTextColor={c.textSubtle}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  // The OS fills this from the email on iOS, which removes the
                  // app-switch a teacher would otherwise make mid-flow.
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  maxLength={6}
                  returnKeyType="go"
                  onSubmitEditing={() => void verify()}
                  style={[
                    TYPE.display,
                    { color: c.text, flex: 1, minHeight: TAP, letterSpacing: 8 },
                  ]}
                />
              </Field>

              <Button
                label="Sign in"
                icon={ArrowRight}
                onPress={() => void verify()}
                busy={busy}
                disabled={code.trim().length < 6}
                full
              />

              <Pressable
                onPress={() => {
                  setStage('email')
                  setCode('')
                  setError(null)
                }}
                style={{
                  minHeight: TAP,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: SPACE.sm,
                }}
              >
                <ArrowLeft size={16} color={c.textMuted} />
                <Text style={[TYPE.label, { color: c.textMuted }]}>Use a different address</Text>
              </Pressable>
            </View>
          )}

          <Caption>
            Teachers and school staff only. Parents use the ZSMS website.
          </Caption>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}

// ---------------------------------------------------------------------------

function Field({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Mail
  label: string
  children: JSX.Element
}): JSX.Element {
  const c = usePalette()
  return (
    <View style={{ gap: SPACE.xs }}>
      <Text style={[TYPE.label, { color: c.textMuted }]}>{label}</Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: SPACE.sm,
          paddingHorizontal: SPACE.md,
          borderRadius: RADIUS.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.border,
          backgroundColor: c.surface,
        }}
      >
        <Icon size={18} color={c.textSubtle} />
        {children}
      </View>
    </View>
  )
}

/**
 * Clerk's own message when there is one.
 *
 * Its errors are specific and useful — "incorrect code", "too many attempts" — and
 * replacing them with a generic line would throw away the only thing on screen that tells
 * a teacher what to do differently.
 */
function readClerkError(err: unknown, fallback: string): string {
  const errors = (err as { errors?: Array<{ longMessage?: string; message?: string }> })?.errors
  const first = errors?.[0]
  return first?.longMessage ?? first?.message ?? fallback
}
