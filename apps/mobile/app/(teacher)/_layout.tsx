/**
 * The drawer — every feature, grouped, from anywhere.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *
 * ## Why a drawer as well as tabs
 *
 * Five tabs carry the five things a teacher does most. A school portal has closer to
 * twenty features, and the rest need a home that is reachable without first navigating to
 * a screen that lists them — which is what a drawer is for and a "More" tab only
 * approximates.
 *
 * The tabs stay: a drawer is two gestures away from the register, and marking attendance
 * is the thing this app exists to make fast.
 *
 * ## The contents are the same catalogue the Home grid renders
 *
 * `lib/features.ts` is the single list, so a feature cannot appear in one place and not
 * the other, and gating is decided once. Linking to a school ungates entries rather than
 * adding them, which is why the drawer looks the same either way.
 *
 * ## Gesture handler must be imported before anything renders
 *
 * `react-native-gesture-handler` patches the touch system at import time on Android. The
 * import belongs at the top of the first module that loads, which for a drawer route is
 * this file — missing it produces a drawer that opens by button and never by swipe, with
 * no error anywhere.
 */

import 'react-native-gesture-handler'

import type { JSX } from 'react'
import { Redirect } from 'expo-router'
import { Drawer } from 'expo-router/drawer'

import { useSession } from '../../lib/auth'
import { Loading, Screen, usePalette } from '../../components/ui'
import { DrawerContents } from '../../components/drawer-contents'

export default function TeacherDrawer(): JSX.Element {
  const { isLoaded, isSignedIn } = useSession()
  const c = usePalette()

  // Nothing renders until Clerk has read the token cache; redirecting sooner bounces a
  // signed-in teacher to sign-in on every cold start.
  if (!isLoaded) {
    return (
      <Screen>
        <Loading />
      </Screen>
    )
  }

  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />

  return (
    <Drawer
      // Our own contents rather than the generated route list: the drawer shows a
      // CATALOGUE with groups and gating, which has no relationship to the file tree.
      drawerContent={(props) => <DrawerContents {...props} />}
      screenOptions={{
        // The tabs below render their own headers, so a second one here would stack two
        // title bars on every screen.
        headerShown: false,
        drawerType: 'front',
        drawerStyle: { backgroundColor: c.background, width: 300 },
        swipeEdgeWidth: 40,
      }}
    >
      <Drawer.Screen name="(tabs)" options={{ title: 'ZSMS' }} />
    </Drawer>
  )
}
