/**
 * The app chrome, as the reference designs draw it.
 *
 * Spec: `Official Documentation/19 Design System/` — the four mockups
 *         (Teacher App Dashboard Flow, Teacher Attendance Workflow,
 *          Parent Dashboard Showcase, Fees Payment Journey)
 *       `.claude/skills/zsms-ui/SKILL.md` → §7 mobile
 *
 * ## Why these six and not more
 *
 * `ui.tsx` holds the twelve primitives a screen is *made of* — Screen, Card, Button,
 * Badge and so on. This file holds the six patterns every one of the four reference
 * screens *repeats*, which were being open-coded on each screen instead:
 *
 *   * the header bar (mark, school, bell with a count, avatar)
 *   * the greeting block
 *   * a section heading with a "View All" on the right
 *   * the tinted icon tile that fronts almost every row and grid cell
 *   * the list row built from that tile
 *   * the segmented control
 *
 * The icon tile is the one that matters most. It appears in the teacher's action grid,
 * the timetable's lesson cards, the parent's fee breakdown, the notification list and
 * the payment-method picker — five different screens drawing the same rounded tinted
 * square. Open-coded, those drift in size and radius, which is exactly what makes an
 * app look assembled rather than designed.
 *
 * ## The tones are the token roles, and there is no sixth
 *
 * The mockups show roughly six pastels across the teacher's grid. The token package
 * has five usable hue roles — primary, success, warning, danger, accent — and `anchor`
 * for a neutral. This file offers exactly those. A sixth hue invented to match a
 * mockup pixel-for-pixel would be a colour no school can theme, that no contrast check
 * has measured, and that the web has no counterpart for. The skill is explicit that
 * the images are suggestion and not specification.
 */

import type { JSX, ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import type { LucideIcon } from 'lucide-react-native'
import { Bell, ChevronRight } from 'lucide-react-native'

import { RADIUS, SPACE, TAP, TYPE, type Palette } from '../theme'
import { usePalette } from './ui'

/** The hue roles a tile or chip may take. Token roles only — see the header. */
export type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'accent' | 'neutral'

export function toneColours(c: Palette, tone: Tone): { tint: string; mark: string; text: string } {
  switch (tone) {
    case 'success':
      return { tint: c.successTint, mark: c.success, text: c.successText }
    case 'warning':
      return { tint: c.warningTint, mark: c.warning, text: c.warningText }
    case 'danger':
      return { tint: c.dangerTint, mark: c.danger, text: c.dangerText }
    case 'accent':
      return { tint: c.accentTint, mark: c.accent, text: c.accentText }
    case 'neutral':
      return { tint: c.surfaceSunken, mark: c.textSubtle, text: c.textMuted }
    default:
      return { tint: c.primaryTint, mark: c.primaryMark, text: c.primaryText }
  }
}

// ---------------------------------------------------------------------------

/**
 * The rounded tinted square that fronts almost every row and grid cell.
 *
 * `mark` rather than the 600 fill for the icon: `mark` is the step derived to clear
 * 3:1 against its own 100 tint, which is the ground the icon actually sits on. Amber
 * at 500 measures 1.80 there — the reason that step exists at all.
 */
export function IconTile({
  icon: Icon,
  tone = 'primary',
  size = 40,
  muted,
}: {
  icon: LucideIcon
  tone?: Tone
  size?: number
  /** Drawn in the neutral tint regardless of `tone` — for an unavailable item. */
  muted?: boolean
}): JSX.Element {
  const c = usePalette()
  const t = toneColours(c, muted ? 'neutral' : tone)

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size >= 44 ? RADIUS.lg : RADIUS.md,
        backgroundColor: t.tint,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon size={Math.round(size * 0.5)} color={t.mark} strokeWidth={2} />
    </View>
  )
}

// ---------------------------------------------------------------------------

/**
 * The bar at the top of a home screen: mark, school, bell, avatar.
 *
 * The bell carries a count rather than a dot. "You have something" and "you have nine
 * things" are different messages, and a parent deciding whether to open the app now or
 * after work is answering the second question.
 */
export function AppHeader({
  schoolName,
  unread = 0,
  onPressBell,
  onPressAvatar,
  left,
  avatar,
}: {
  schoolName?: string | null
  unread?: number
  onPressBell?: () => void
  onPressAvatar?: () => void
  /** The mark. Passed in so this file imports no artwork. */
  left: ReactNode
  avatar: ReactNode
}): JSX.Element {
  const c = usePalette()

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACE.md,
        paddingHorizontal: SPACE.gutter,
        paddingBottom: SPACE.md,
      }}
    >
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
        {left}
        {schoolName ? (
          <Text numberOfLines={1} style={[TYPE.caption, { color: c.textMuted, flexShrink: 1 }]}>
            {schoolName}
          </Text>
        ) : null}
      </View>

      {onPressBell && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={unread > 0 ? `Notices, ${unread} unread` : 'Notices'}
          onPress={onPressBell}
          hitSlop={8}
          style={({ pressed }) => ({
            width: TAP,
            height: TAP,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <BellWithCount count={unread} />
        </Pressable>
      )}

      {onPressAvatar ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Your account"
          onPress={onPressAvatar}
          hitSlop={8}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          {avatar}
        </Pressable>
      ) : (
        avatar
      )}
    </View>
  )
}

function BellWithCount({ count }: { count: number }): JSX.Element {
  const c = usePalette()

  return (
    <View>
      <Bell size={22} color={c.text} strokeWidth={2} />
      {count > 0 && (
        <View
          style={{
            position: 'absolute',
            top: -4,
            right: -6,
            minWidth: 18,
            height: 18,
            paddingHorizontal: 4,
            borderRadius: RADIUS.full,
            backgroundColor: c.danger,
            alignItems: 'center',
            justifyContent: 'center',
            // A ring in the page colour, so the badge reads as separate from the bell
            // rather than merged into it on a busy header.
            borderWidth: 2,
            borderColor: c.background,
          }}
        >
          <Text style={{ fontSize: 10, fontWeight: '700', color: '#FFFFFF' }}>
            {count > 9 ? '9+' : count}
          </Text>
        </View>
      )}
    </View>
  )
}

// ---------------------------------------------------------------------------

/**
 * "Good morning, / **Ms. Chanda** / Here's your teaching overview for today."
 *
 * The time-of-day word is computed locally, which is the point: a greeting that says
 * "Good morning" at four in the afternoon is the first thing a user notices and the
 * last thing they trust afterwards.
 */
export function Greeting({ name, subtitle }: { name: string; subtitle?: string }): JSX.Element {
  const c = usePalette()
  const hour = new Date().getHours()
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <View style={{ paddingHorizontal: SPACE.gutter, gap: 2 }}>
      <Text style={[TYPE.body, { color: c.textMuted }]}>{part},</Text>
      <Text style={[TYPE.display, { color: c.text }]} numberOfLines={1}>
        {name}
      </Text>
      {subtitle ? <Text style={[TYPE.body, { color: c.textMuted }]}>{subtitle}</Text> : null}
    </View>
  )
}

// ---------------------------------------------------------------------------

/** A section heading with an optional action on the right — the mockups' "View All". */
export function SectionHeader({
  title,
  actionLabel,
  onPressAction,
}: {
  title: string
  actionLabel?: string
  onPressAction?: () => void
}): JSX.Element {
  const c = usePalette()

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: SPACE.md,
      }}
    >
      <Text style={[TYPE.heading, { color: c.text }]}>{title}</Text>
      {actionLabel && onPressAction && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${actionLabel}, ${title}`}
          onPress={onPressAction}
          hitSlop={10}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Text style={[TYPE.label, { color: c.primaryText }]}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  )
}

// ---------------------------------------------------------------------------

/**
 * Icon tile, title, subtitle, optional right-hand slot, chevron.
 *
 * The shape behind the notification list, the fee breakdown, the payment methods and
 * the "what next" lists on the success screens. Rendered as one component so the tile
 * size, the gap and the chevron are decided once.
 */
export function ListRow({
  icon,
  tone = 'primary',
  title,
  subtitle,
  right,
  onPress,
  unread,
  style,
}: {
  icon: LucideIcon
  tone?: Tone
  title: string
  subtitle?: string | null
  /** A badge, an amount, anything that belongs before the chevron. */
  right?: ReactNode
  onPress?: () => void
  /** Draws the unread dot the mockups put beside a notification's title. */
  unread?: boolean
  style?: StyleProp<ViewStyle>
}): JSX.Element {
  const c = usePalette()

  const inner = (
    <>
      <IconTile icon={icon} tone={tone} />
      <View style={{ flex: 1, gap: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text numberOfLines={1} style={[TYPE.heading, { color: c.text, flexShrink: 1 }]}>
            {title}
          </Text>
          {unread && (
            <View
              accessibilityLabel="Unread"
              style={{ width: 7, height: 7, borderRadius: RADIUS.full, backgroundColor: c.danger }}
            />
          )}
        </View>
        {subtitle ? (
          <Text numberOfLines={2} style={[TYPE.caption, { color: c.textMuted }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {onPress && <ChevronRight size={18} color={c.textSubtle} strokeWidth={2} />}
    </>
  )

  const base: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    minHeight: TAP + 8,
    paddingVertical: SPACE.sm,
  }

  if (!onPress) return <View style={[base, style]}>{inner}</View>

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      onPress={onPress}
      style={({ pressed }) => [base, { opacity: pressed ? 0.6 : 1 }, style]}
    >
      {inner}
    </Pressable>
  )
}

/** A hairline between rows, inset past the icon tile so it reads as one list. */
export function RowDivider(): JSX.Element {
  const c = usePalette()
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: c.border,
        marginLeft: 40 + SPACE.md,
      }}
    />
  )
}

// ---------------------------------------------------------------------------

/**
 * The pill tab strip — Today / Week, Students / Summary, All / Notices / Messages.
 *
 * Switches a view. It is not navigation, and it does not scroll to a section: the
 * same rule the web carries for `SectionTabs`.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ value: T; label: string }>
  value: T
  onChange: (next: T) => void
}): JSX.Element {
  const c = usePalette()

  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        gap: SPACE.xs,
        padding: SPACE.xs,
        borderRadius: RADIUS.full,
        backgroundColor: c.surfaceSunken,
      }}
    >
      {options.map((option) => {
        const on = option.value === value
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 36,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: RADIUS.full,
              backgroundColor: on ? c.primary : 'transparent',
              opacity: pressed && !on ? 0.6 : 1,
            })}
          >
            <Text
              style={[
                TYPE.label,
                { color: on ? c.onPrimary : c.textMuted, fontWeight: on ? '600' : '500' },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}
