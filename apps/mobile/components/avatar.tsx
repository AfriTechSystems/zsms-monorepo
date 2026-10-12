/**
 * A face, or initials — the phone counterpart of `components/ui/avatar.tsx`.
 *
 * Read-only on mobile, by decision. A parent sets their photograph on the web portal
 * and a school sets a pupil's; adding an uploader here would mean a second code path
 * for the 2MB cap, the format allow-list and the magic-byte check, and the one place
 * that decides what an acceptable image is should stay one place.
 *
 * The initials fallback is designed first, because it is what almost every row shows:
 * very few schools will have photographed their roll.
 */

import type { JSX } from 'react'
import { Image, Text, View } from 'react-native'

import { usePalette } from './ui'

const SIZES = { sm: 28, md: 40, lg: 64 } as const

/**
 * A stable tint per person.
 *
 * Deterministic from the name, so the same pupil is the same colour on every screen
 * and in every session — a colour that changed between renders would read as a
 * status that keeps changing.
 */
function tintIndex(name: string, buckets: number): number {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0
  return Math.abs(hash) % buckets
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase()
}

export function Avatar({
  name,
  src,
  size = 'md',
}: {
  name: string
  src?: string | null
  size?: keyof typeof SIZES
}): JSX.Element {
  const c = usePalette()
  const px = SIZES[size]

  /*
    Three tints, not four. The palette has no accent tone on mobile, and inventing a
    fourth colour here would put a value in the app that no theme controls — so a
    school's branding could never reach it.
  */
  const tints = [c.primaryTint, c.successTint, c.warningTint]
  const marks = [c.primaryMark, c.successText, c.warningText]
  const i = tintIndex(name, tints.length)

  if (src) {
    return (
      <Image
        source={{ uri: src }}
        // The name, not "photo of". A screen reader already says "image".
        accessibilityLabel={name}
        style={{ width: px, height: px, borderRadius: px / 2, backgroundColor: c.surfaceSunken }}
      />
    )
  }

  return (
    <View
      accessibilityLabel={name}
      style={{
        width: px,
        height: px,
        borderRadius: px / 2,
        backgroundColor: tints[i],
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          fontSize: px * 0.38,
          fontWeight: '600',
          color: marks[i],
        }}
      >
        {initialsOf(name)}
      </Text>
    </View>
  )
}
