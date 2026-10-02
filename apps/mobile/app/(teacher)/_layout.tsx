/**
 * The teacher's tabs.
 *
 * Spec: `Official Documentation/10 Attendance/ATTENDANCE.md`
 *       ADR-004 — offline-first attendance is the reason this app exists
 *
 * ## Three tabs, not five
 *
 * The web sidebar has eleven destinations because a bursar and a principal share it. A
 * teacher standing in front of a class has three jobs: mark the register, enter marks, and
 * find a pupil. Anything else belongs on the web, and putting it here would bury the one
 * screen that has to be reachable in a second.
 *
 * ## Icons carry the labels
 *
 * Mobile shows a fraction of the web's text, so the icon is the label rather than
 * decoration. They come from `lucide-react-native` — the same set the web draws from — so
 * a symbol means the same thing in both places.
 */

import type { JSX } from 'react'
import { Redirect, Tabs } from 'expo-router'
import { CalendarCheck, ClipboardList, Users } from 'lucide-react-native'

import { useSession } from '../../lib/auth'
import { Loading, Screen, usePalette } from '../../components/ui'
import { TAP } from '../../theme'

export default function TeacherLayout(): JSX.Element {
  const { isLoaded, isSignedIn } = useSession()
  const c = usePalette()

  // Nothing is rendered until Clerk has read the token cache: redirecting before then
  // bounces a signed-in teacher to sign-in on every cold start.
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
          // Taller than the default: this is tapped with a thumb while holding a
          // register in the other hand.
          height: TAP + 34,
          paddingTop: 6,
          paddingBottom: 10,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Today',
          tabBarLabel: 'Today',
          tabBarIcon: ({ color, focused }) => (
            <CalendarCheck size={23} color={color} strokeWidth={focused ? 2.4 : 1.9} />
          ),
        }}
      />
      <Tabs.Screen
        name="marks"
        options={{
          title: 'Marks',
          tabBarLabel: 'Marks',
          tabBarIcon: ({ color, focused }) => (
            <ClipboardList size={23} color={color} strokeWidth={focused ? 2.4 : 1.9} />
          ),
        }}
      />
      <Tabs.Screen
        name="pupils"
        options={{
          title: 'Pupils',
          tabBarLabel: 'Pupils',
          tabBarIcon: ({ color, focused }) => (
            <Users size={23} color={color} strokeWidth={focused ? 2.4 : 1.9} />
          ),
        }}
      />
      {/* The register is reached from Today, not from the bar: it always belongs to a
          class, and a tab that needs a class chosen first is a tab that opens empty. */}
      <Tabs.Screen name="register/[classId]" options={{ href: null, title: 'Register' }} />
    </Tabs>
  )
}
