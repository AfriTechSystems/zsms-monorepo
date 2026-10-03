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

import { api } from '../lib/api'
import { useSession } from '../lib/auth'
import { Loading, Screen, usePalette } from '../components/ui'
import { SPACE } from '../theme'
import { Wordmark } from '../components/wordmark'

export default function Index(): JSX.Element {
  const { isLoaded, isSignedIn, getToken } = useSession()
  const router = useRouter()
  const c = usePalette()

  useEffect(() => {
    // Nothing to do until Clerk has read the token cache; redirecting before then would
    // bounce a signed-in teacher to the sign-in screen on every cold start.
    if (!isLoaded || !isSignedIn) return

    /*
      Ask when there is a choice, the same rule as the web.

      One address is often a parent, a teacher AND a school owner at once. Routing on
      the first match is the bug `/welcome` had: an owner who was also a parent never
      learned the parent portal existed.

      The count comes from the same `/api/session/portals` enumeration the web uses, so
      the two cannot disagree about how many portals somebody has. A failure here falls
      through to the teacher app rather than stranding anybody on a splash screen.
    */
    void api
      .get<{ count: number }>('/api/session/portals', getToken)
      .then((result) => {
        router.replace((result.data?.count ?? 1) > 1 ? '/portal' : '/(teacher)')
      })
      .catch(() => router.replace('/(teacher)'))
  }, [isLoaded, isSignedIn, router, getToken])

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
