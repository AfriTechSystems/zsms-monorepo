/**
 * The ZSMS mark, drawn rather than loaded.
 *
 * Spec: `Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md`
 *
 * An SVG rather than the PNG in `packages/design-tokens/assets`: this appears on the
 * launch screen, where a bitmap that has not finished decoding is a blank rectangle on the
 * first thing a teacher sees. Geometry renders immediately and themes with the palette, so
 * the mark is legible in dark mode without a second file.
 */

import type { JSX } from 'react'
import { View, Text } from 'react-native'
import Svg, { Path, Rect } from 'react-native-svg'

import { RADIUS, SPACE, TYPE } from '../theme'
import { usePalette } from './ui'

export function Wordmark({ size = 56 }: { size?: number }): JSX.Element {
  const c = usePalette()

  return (
    <View style={{ alignItems: 'center', gap: SPACE.md }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: RADIUS.lg,
          backgroundColor: c.primary,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* A graduation cap: the one symbol that reads as "school" at 28px with no
            caption, which is the whole constraint on a launch screen. */}
        <Svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24" fill="none">
          <Path
            d="M2 8.5 L12 4 L22 8.5 L12 13 Z"
            fill={c.onPrimary}
          />
          <Path
            d="M6 10.6 V15.2 C6 15.2 8.4 17 12 17 C15.6 17 18 15.2 18 15.2 V10.6"
            stroke={c.onPrimary}
            strokeWidth={1.9}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          <Rect x="20.3" y="8.8" width="1.5" height="6.4" rx="0.75" fill={c.onPrimary} />
        </Svg>
      </View>

      <Text style={[TYPE.display, { color: c.text, letterSpacing: 1 }]}>ZSMS</Text>
    </View>
  )
}
