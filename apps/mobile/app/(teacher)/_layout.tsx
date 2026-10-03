/**
 * The teacher shell.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *
 * ## The bar is generic and does not change with link state
 *
 * Five tabs, the same five whether or not a teacher belongs to a school. Linking
 * **ungates** features on the Home grid rather than rearranging navigation, so somebody
 * who joins a school in March still recognises the app they used in February.
 *
 * An earlier version swapped the tabs by state. That is worse than it sounds: the thing a
 * user builds muscle memory on is position, and moving it is the one change they cannot
 * learn around.
 *
 * ## Home is centre, and larger
 *
 * At an edge it is the hardest tab to reach with the thumb of the hand holding the phone,
 * and it is the one a teacher returns to between every other screen. The centre of five
 * is the easiest point to hit.
 *
 * ## "More" is the sidebar
 *
 * A full-screen categorised menu rather than a drawer. On a phone it carries the same
 * content with no nested navigator, no gesture handler, and no edge-swipe competing with
 * the register's horizontal controls.
 */

import type { JSX } from 'react'
import { Redirect, Tabs } from 'expo-router'
import {
  CalendarCheck,
  FolderOpen,
  LayoutGrid,
  Menu,
  WandSparkles,
} from 'lucide-react-native'
import { View } from 'react-native'

import { useSession } from '../../lib/auth'
import { Loading, Screen, usePalette } from '../../components/ui'
import { RADIUS, TAP } from '../../theme'

export default function TeacherLayout(): JSX.Element {
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
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: c.surface },
        headerTintColor: c.text,
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '600' },
        tabBarActiveTintColor: c.primaryText,
        tabBarInactiveTintColor: c.textSubtle,
        tabBarStyle: {
          backgroundColor: c.surface,
          borderTopColor: c.border,
          // Taller than default: tapped with a thumb while holding a register.
          height: TAP + 34,
          paddingTop: 6,
          paddingBottom: 10,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="attendance"
        options={{
          title: 'Attendance',
          tabBarIcon: ({ color, focused }) => (
            <CalendarCheck size={22} color={color} strokeWidth={focused ? 2.4 : 1.9} />
          ),
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: 'Create',
          tabBarIcon: ({ color, focused }) => (
            <WandSparkles size={22} color={color} strokeWidth={focused ? 2.4 : 1.9} />
          ),
        }}
      />

      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarLabel: 'Home',
          // The centre tab, drawn as a filled target rather than a glyph — on a bar of
          // five it is the one a thumb goes to without looking.
          tabBarIcon: ({ color, focused }) => (
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: RADIUS.full,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: focused ? c.primary : c.surfaceSunken,
              }}
            >
              <LayoutGrid
                size={20}
                color={focused ? c.onPrimary : color}
                strokeWidth={focused ? 2.4 : 2}
              />
            </View>
          ),
        }}
      />

      <Tabs.Screen
        name="library"
        options={{
          title: 'Library',
          tabBarIcon: ({ color, focused }) => (
            <FolderOpen size={22} color={color} strokeWidth={focused ? 2.4 : 1.9} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarIcon: ({ color, focused }) => (
            <Menu size={22} color={color} strokeWidth={focused ? 2.4 : 1.9} />
          ),
        }}
      />

      {/* Reached from a screen, never the bar: each needs something chosen first, and a
          tab that opens empty is a tab nobody presses twice. */}
      <Tabs.Screen name="register/[classId]" options={{ href: null, title: 'Register' }} />
      <Tabs.Screen name="pupils" options={{ href: null, title: 'Pupils' }} />
      <Tabs.Screen name="marks" options={{ href: null, title: 'Marks' }} />
      <Tabs.Screen name="account" options={{ href: null, title: 'Account' }} />
    </Tabs>
  )
}
