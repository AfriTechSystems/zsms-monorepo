/**
 * A grid of everything a portal offers, including what is not built.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *       `Official Documentation/07 Students and Parents/PARENT_PORTAL.md`
 *
 * ## Why unbuilt features are shown, greyed
 *
 * Agreed for the teacher app and kept for the parent one: somebody seeing "Pay fees —
 * soon" learns what the product will do, and the grid stops reshuffling every time
 * something ships. Hiding them makes each release move every icon, which is worse than
 * an honest placeholder.
 *
 * ## Why it is shared
 *
 * It lived inside the teacher home screen until the parent app needed the same thing.
 * Two copies would have drifted on the first change, and the drift would be invisible
 * — nobody opens both portals side by side.
 *
 * The caller supplies already-resolved states, so this component makes no judgement
 * about what "unavailable" means. A teacher's reason is "needs a school" and a
 * parent's is "needs a child linked"; both are the caller's to name.
 */

import type { JSX } from 'react'
import { useMemo } from 'react'
import { Pressable, Text, View } from 'react-native'
import type { LucideIcon } from 'lucide-react-native'

import { usePalette } from './ui'
import { IconTile, type Tone } from './shell'
import { RADIUS, SPACE, TAP, TYPE } from '../theme'

export type GridState = 'ready' | 'locked' | 'coming'

export interface GridFeature {
  key: string
  label: string
  icon: LucideIcon
  href: string | null
  /** 'ready' | 'coming' | anything else is treated as locked. */
  state: string
  /**
   * The tile's hue.
   *
   * Every tile was `primaryTint` until 2026-10-18, so the grid read as one blue
   * block — the reference designs give each action its own pastel, and that is most
   * of what makes the mockup's grid scannable rather than uniform. Assigned per
   * feature in `lib/features.ts`, by what the feature IS, never by its position:
   * colour follows the entity, not its rank, so re-ordering or gating the grid never
   * repaints the survivors.
   */
  tone?: Tone
}

export function FeatureGrid({
  features,
  onPress,
  lockedLabel,
}: {
  features: GridFeature[]
  onPress: (href: string) => void
  /** What "locked" means here — "Needs school", "Needs a child linked". */
  lockedLabel: string
}): JSX.Element {
  const c = usePalette()

  /*
    Anything unavailable sinks to the bottom, whatever its group.

    A grid whose first row is greyed out reads as a broken app, and the first row is
    what somebody judges the product by.
  */
  const ordered = useMemo(
    () => [...features].sort((a, b) => Number(a.state !== 'ready') - Number(b.state !== 'ready')),
    [features],
  )

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm }}>
      {ordered.map((feature) => {
        const available = feature.state === 'ready'
        const coming = feature.state === 'coming'
        const Icon = feature.icon

        return (
          <Pressable
            key={feature.key}
            disabled={!available}
            accessibilityRole="button"
            accessibilityState={{ disabled: !available }}
            accessibilityLabel={
              available
                ? feature.label
                : `${feature.label}, ${coming ? 'coming soon' : lockedLabel.toLowerCase()}`
            }
            onPress={() => feature.href && onPress(feature.href)}
            style={({ pressed }) => ({
              // Three across on a phone, with the gutter and two gaps removed.
              width: '31.5%',
              minHeight: TAP + 34,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              paddingVertical: SPACE.md,
              borderRadius: RADIUS.lg,
              backgroundColor: c.surface,
              borderWidth: 1,
              borderColor: c.border,
              opacity: available ? (pressed ? 0.7 : 1) : 0.45,
            })}
          >
            <IconTile icon={Icon} tone={feature.tone ?? 'primary'} size={38} muted={!available} />

            <Text
              numberOfLines={2}
              style={[
                TYPE.caption,
                {
                  color: available ? c.text : c.textSubtle,
                  textAlign: 'center',
                  fontWeight: '600',
                  paddingHorizontal: 4,
                },
              ]}
            >
              {feature.label}
            </Text>

            {/* Which kind of unavailable. Somebody can act on one and not the other,
                so they must not look the same. */}
            {!available && (
              <Text style={[TYPE.caption, { fontSize: 10, color: c.textSubtle }]}>
                {coming ? 'Soon' : lockedLabel}
              </Text>
            )}
          </Pressable>
        )
      })}
    </View>
  )
}
