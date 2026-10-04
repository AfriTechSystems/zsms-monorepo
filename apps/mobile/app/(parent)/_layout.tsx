/**
 * The parent app's shell.
 *
 * Spec: `Official Documentation/07 Students and Parents/PARENT_PORTAL.md`
 *
 * A drawer over the tabs, as in the teacher app. The selected child lives here rather
 * than in any one tab: every parent screen answers the same question about a different
 * subject, and a choice held per tab would let fees show Alice while results showed
 * Ben.
 *
 * `ChildProvider` wraps the whole drawer so the switcher keeps its answer across a tab
 * change, a drawer open, and a navigation into a detail screen.
 */

import 'react-native-gesture-handler'

import type { JSX } from 'react'
import { Redirect } from 'expo-router'
import { Drawer } from 'expo-router/drawer'

import { ParentDrawerContents } from '../../components/parent-drawer-contents'
import { Loading, Screen, usePalette } from '../../components/ui'
import { ChildProvider } from '../../lib/child'
import { useSession } from '../../lib/auth'

export default function ParentLayout(): JSX.Element {
  const c = usePalette()
  const { isLoaded, isSignedIn } = useSession()

  // Nothing renders until Clerk has read the token cache; redirecting sooner bounces a
  // signed-in parent to sign-in on every cold start.
  if (!isLoaded) {
    return (
      <Screen>
        <Loading />
      </Screen>
    )
  }

  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />

  return (
    <ChildProvider>
      <Drawer
        drawerContent={(props) => <ParentDrawerContents {...props} />}
        screenOptions={{
          // The tabs below render their own headers; a second here would stack two
          // title bars on every screen.
          headerShown: false,
          drawerType: 'front',
          drawerStyle: { backgroundColor: c.background, width: 300 },
          swipeEdgeWidth: 40,
        }}
      >
        <Drawer.Screen name="(tabs)" options={{ title: 'ZSMS' }} />
      </Drawer>
    </ChildProvider>
  )
}
