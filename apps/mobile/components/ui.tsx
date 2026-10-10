/**
 * The mobile primitives.
 *
 * Spec: `Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md`
 *
 * Small on purpose. The web has thirty components because a dashboard has thirty jobs; a
 * teacher's phone has about six, and every one added here is one more thing to keep in
 * step with the web for no user benefit.
 *
 * Icons come from `lucide-react-native` — the same set the web draws from, so a mark icon
 * means the same thing on both. Mobile carries far less text than the web, which makes the
 * icon the label rather than decoration, and a second icon family would mean two visual
 * vocabularies for one product.
 */

import type { JSX, ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  useColorScheme,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import type { LucideIcon } from 'lucide-react-native'

import { DARK, LIGHT, RADIUS, SPACE, TAP, TYPE, type Palette } from '../theme'

/** The palette for the device's current appearance. */
export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? DARK : LIGHT
}

// ---------------------------------------------------------------------------

export function Screen({
  children,
  style,
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
}): JSX.Element {
  const c = usePalette()
  return (
    <View style={[{ flex: 1, backgroundColor: c.background }, style]}>{children}</View>
  )
}

export function Card({
  children,
  style,
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
}): JSX.Element {
  const c = usePalette()
  return (
    <View
      style={[
        {
          backgroundColor: c.surface,
          borderColor: c.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: RADIUS.lg,
          padding: SPACE.card,
        },
        style,
      ]}
    >
      {children}
    </View>
  )
}

export function Title({ children }: { children: ReactNode }): JSX.Element {
  const c = usePalette()
  return <Text style={[TYPE.title, { color: c.text }]}>{children}</Text>
}

export function Body({
  children,
  muted,
  numberOfLines,
}: {
  children: ReactNode
  muted?: boolean
  numberOfLines?: number
}): JSX.Element {
  const c = usePalette()
  return (
    <Text numberOfLines={numberOfLines} style={[TYPE.body, { color: muted ? c.textMuted : c.text }]}>
      {children}
    </Text>
  )
}

export function Caption({ children }: { children: ReactNode }): JSX.Element {
  const c = usePalette()
  return <Text style={[TYPE.caption, { color: c.textMuted }]}>{children}</Text>
}

// ---------------------------------------------------------------------------

type ButtonTone = 'primary' | 'outline' | 'ghost' | 'danger'

export function Button({
  label,
  onPress,
  tone = 'primary',
  icon: Icon,
  disabled,
  busy,
  full,
}: {
  label: string
  onPress: () => void
  tone?: ButtonTone
  icon?: LucideIcon
  disabled?: boolean
  busy?: boolean
  full?: boolean
}): JSX.Element {
  const c = usePalette()

  const palettes: Record<ButtonTone, { bg: string; fg: string; border: string }> = {
    primary: { bg: c.primary, fg: c.onPrimary, border: c.primary },
    outline: { bg: 'transparent', fg: c.text, border: c.border },
    ghost: { bg: 'transparent', fg: c.primaryText, border: 'transparent' },
    danger: { bg: c.dangerTint, fg: c.dangerText, border: c.dangerTint },
  }
  const p = palettes[tone]
  const off = disabled || busy

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy }}
      onPress={onPress}
      disabled={off}
      // `pressed` rather than a hover state: a phone has no hover, and the feedback a
      // thumb needs is immediate and while held.
      style={({ pressed }) => ({
        minHeight: TAP,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: SPACE.sm,
        paddingHorizontal: SPACE.lg,
        borderRadius: RADIUS.md,
        backgroundColor: p.bg,
        borderWidth: tone === 'outline' ? StyleSheet.hairlineWidth : 0,
        borderColor: p.border,
        opacity: off ? 0.5 : pressed ? 0.85 : 1,
        alignSelf: full ? 'stretch' : 'flex-start',
      })}
    >
      {busy ? (
        <ActivityIndicator size="small" color={p.fg} />
      ) : (
        Icon && <Icon size={18} color={p.fg} strokeWidth={2.2} />
      )}
      <Text style={[TYPE.label, { color: p.fg, fontSize: 15 }]}>{label}</Text>
    </Pressable>
  )
}

// ---------------------------------------------------------------------------

export function Badge({
  label,
  tone = 'neutral',
}: {
  label: string
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'primary'
}): JSX.Element {
  const c = usePalette()
  const tones = {
    neutral: { bg: c.surfaceSunken, fg: c.textMuted },
    success: { bg: c.successTint, fg: c.successText },
    warning: { bg: c.warningTint, fg: c.warningText },
    danger: { bg: c.dangerTint, fg: c.dangerText },
    primary: { bg: c.primaryTint, fg: c.primaryText },
  }
  const t = tones[tone]
  return (
    <View
      style={{
        backgroundColor: t.bg,
        borderRadius: RADIUS.full,
        paddingHorizontal: 10,
        paddingVertical: 3,
      }}
    >
      <Text style={[TYPE.caption, { color: t.fg, fontWeight: '600' }]}>{label}</Text>
    </View>
  )
}

/**
 * Nothing here.
 *
 * Takes an icon rather than an illustration: the web's drawings are tuned for a 160px
 * panel on a wide screen, and a phone's empty state is a third of that. A large icon in a
 * tinted circle reads at this size where a scene does not.
 */
export function Empty({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon
  title: string
  body?: string
  action?: ReactNode
}): JSX.Element {
  const c = usePalette()
  return (
    <View style={{ alignItems: 'center', paddingVertical: SPACE.xxl, paddingHorizontal: SPACE.xl }}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: RADIUS.full,
          backgroundColor: c.surfaceSunken,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: SPACE.lg,
        }}
      >
        <Icon size={28} color={c.textSubtle} strokeWidth={1.8} />
      </View>
      <Text style={[TYPE.heading, { color: c.text, textAlign: 'center' }]}>{title}</Text>
      {body && (
        <Text
          style={[TYPE.body, { color: c.textMuted, textAlign: 'center', marginTop: SPACE.xs }]}
        >
          {body}
        </Text>
      )}
      {action && <View style={{ marginTop: SPACE.lg }}>{action}</View>}
    </View>
  )
}

/**
 * Something failed.
 *
 * Always carries the cause and, when retrying could help, a way to. `OFFLINE` gets a
 * different word from a server fault because the action a teacher should take differs:
 * one means walk to the window, the other means it is not their problem.
 */
export function ErrorNote({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}): JSX.Element {
  const c = usePalette()
  return (
    <View
      style={{
        backgroundColor: c.dangerTint,
        borderRadius: RADIUS.md,
        padding: SPACE.card,
        gap: SPACE.sm,
      }}
    >
      <Text style={[TYPE.body, { color: c.dangerText }]}>{message}</Text>
      {onRetry && <Button label="Try again" tone="outline" onPress={onRetry} />}
    </View>
  )
}

export function Loading({ label }: { label?: string }): JSX.Element {
  const c = usePalette()
  return (
    <View style={{ paddingVertical: SPACE.xxl, alignItems: 'center', gap: SPACE.md }}>
      <ActivityIndicator color={c.primary} />
      {label && <Caption>{label}</Caption>}
    </View>
  )
}

export function Row({
  children,
  gap = SPACE.sm,
  style,
}: {
  children: ReactNode
  gap?: number
  style?: StyleProp<ViewStyle>
}): JSX.Element {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>
  )
}
