/**
 * Light / System / Dark, for a mobile account screen.
 *
 * The app followed the operating system and offered no choice, so a teacher whose
 * phone is in dark mode could not read a mark sheet in light — which is a real
 * request in a school, where a phone is often held beside printed paper.
 *
 * `System` stays the default and is what most people should keep; the two overrides
 * exist for the cases where the phone's setting is wrong for the task rather than
 * wrong in general.
 */

import type { JSX } from 'react'
import { Pressable, Text, View } from 'react-native'
import { Monitor, Moon, Sun } from 'lucide-react-native'

import { usePalette } from './ui'
import { RADIUS, SPACE, TYPE } from '../theme'
import { useThemePreference, type ThemeChoice } from '../theme/preference'

const OPTIONS: Array<{ value: ThemeChoice; label: string; Icon: typeof Sun }> = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'dark', label: 'Dark', Icon: Moon },
]

export function ThemeChoiceRow(): JSX.Element {
  const c = usePalette()
  const { choice, setChoice } = useThemePreference()

  return (
    <View style={{ gap: SPACE.sm }}>
      <Text style={{ ...TYPE.label, fontWeight: '600', color: c.text }}>
        Appearance
      </Text>

      <View
        // `radiogroup` so the three read as one control with one answer, rather than
        // as three independent buttons a screen reader announces separately.
        accessibilityRole="radiogroup"
        style={{
          flexDirection: 'row',
          borderRadius: RADIUS.md,
          borderWidth: 1,
          borderColor: c.border,
          padding: 2,
          backgroundColor: c.background,
        }}
      >
        {OPTIONS.map(({ value, label, Icon }) => {
          const on = choice === value
          return (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={label}
              onPress={() => setChoice(value)}
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                // 44 high: the minimum a thumb can hit reliably, which matters more
                // here than the control looking compact.
                minHeight: 44,
                borderRadius: RADIUS.sm,
                backgroundColor: on ? c.primary : 'transparent',
              }}
            >
              <Icon size={14} color={on ? c.onPrimary : c.textMuted} />
              <Text
                style={{
                  ...TYPE.caption,
                  color: on ? c.onPrimary : c.textMuted,
                  fontWeight: on ? '600' : '400',
                }}
              >
                {label}
              </Text>
            </Pressable>
          )
        })}
      </View>

      <Text style={{ ...TYPE.caption, color: c.textMuted }}>
        System follows your phone&rsquo;s setting.
      </Text>
    </View>
  )
}
