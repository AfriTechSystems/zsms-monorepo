/**
 * The dispatcher.
 *
 * Spec: `Official Documentation/02 Authentication and Identity/AUTH.md`
 *
 * The same job `/welcome` does on the web: decide where a signed-in person belongs rather
 * than assuming. On the phone the answer is simpler — this build serves teachers — but the
 * decision stays in one place so a parent build has somewhere to branch.
 *
 * It renders a holding screen rather than nothing. A redirect that takes a moment on a
 * cold start looks like a crash if the screen behind it is blank.
 */

import type { JSX } from 'react'
import { useEffect } from 'react'
import { Redirect, useRouter } from 'expo-router'
import { View } from 'react-native'

import { useSession } from '../lib/auth'
import { Loading, Screen, usePalette } from '../components/ui'
import { SPACE } from '../theme'
import { Wordmark } from '../components/wordmark'

export default function Index(): JSX.Element {
  const { isLoaded, isSignedIn } = useSession()
  const router = useRouter()
  const c = usePalette()

  useEffect(() => {
    // Nothing to do until Clerk has read the token cache; redirecting before then would
    // bounce a signed-in teacher to the sign-in screen on every cold start.
    if (!isLoaded) return
    if (isSignedIn) router.replace('/(teacher)')
  }, [isLoaded, isSignedIn, router])

  if (isLoaded && !isSignedIn) return <Redirect href="/(auth)/sign-in" />

  return (
    <Screen>
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: SPACE.xl,
          backgroundColor: c.background,
        }}
      >
        <Wordmark />
        <Loading />
      </View>
    </Screen>
  )
}
