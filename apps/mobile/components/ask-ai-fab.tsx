/**
 * The "Ask AI" button, floating over whichever tab is open.
 *
 * ## Why a floating button rather than a header action
 *
 * The phone app has five tabs and each screen draws its own header, so a header action
 * would be five copies that drift — the same mistake the parent child-picker and the Hub
 * signed-out branch were. Mounted once in the tab layout, it appears on every tab
 * including any added later.
 *
 * ## Why it sits where it does
 *
 * Above the tab bar and on the right, which is where a thumb rests. `bottom: 88` clears
 * the tab bar on every handset we have seen; below that it becomes a button people press
 * by accident while switching tabs.
 */

import type { JSX } from 'react'
import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { Sparkles } from 'lucide-react-native'

import { AskAiSheet } from './ask-ai-sheet'
import { usePalette } from './ui'

export function AskAiFab({ audience }: { audience: 'teacher' | 'parent' }): JSX.Element {
  const c = usePalette()
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* `pointerEvents="box-none"` so the overlay does not swallow taps meant for the
          screen behind it — without it the whole app stops responding. */}
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', right: 16, bottom: 88 }}
      >
        <Pressable
          onPress={() => setOpen(true)}
          accessibilityLabel="Ask AI"
          accessibilityRole="button"
          style={{
            width: 52,
            height: 52,
            borderRadius: 26,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: c.primary,
            // A shadow, so it reads as floating above the content rather than printed on
            // it. Both platforms, because elevation alone does nothing on iOS.
            elevation: 4,
            shadowColor: '#000',
            shadowOpacity: 0.2,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 2 },
          }}
        >
          <Sparkles size={22} color={c.onPrimary} />
        </Pressable>
      </View>

      <AskAiSheet open={open} onClose={() => setOpen(false)} audience={audience} />
    </>
  )
}
