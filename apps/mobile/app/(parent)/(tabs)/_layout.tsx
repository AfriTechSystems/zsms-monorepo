/**
 * The parent app's bottom navigation.
 *
 * Spec: `Official Documentation/07 Students and Parents/PARENT_PORTAL.md`
 *
 * ## The same shape as the teacher app, on purpose
 *
 * Home in the centre and larger, four surrounding tabs, a drawer behind the header.
 * One address is often a parent AND a teacher in a small Zambian school, and somebody
 * who switches portal should not have to learn a second set of habits — the content
 * changes, the shape does not.
 *
 * ## Which four
 *
 * Fees, attendance, results and notices: the four questions a parent opens the app to
 * answer. Anything else lives on the Home grid, which lists every feature including the
 * ones not built, so the bar never reshuffles as things ship.
 */

import type { JSX } from 'react'
import { View } from 'react-native'
import { Tabs } from 'expo-router'
import { DrawerToggleButton } from 'expo-router/drawer'
import {
  CalendarCheck,
  GraduationCap,
  LayoutGrid,
  Megaphone,
  Wallet,
} from 'lucide-react-native'

import { usePalette } from '../../../components/ui'
import { RADIUS, TAP } from '../../../theme'

export default function ParentTabs(): JSX.Element {
  const c = usePalette()

  // `DrawerToggleButton` from `expo-router/drawer` — the public entry. The internal
  // path resolves and then fails to initialise on device, which cost three sessions.
  const drawerButton = (): JSX.Element => <DrawerToggleButton tintColor={c.text} />

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: c.surface },
        headerTintColor: c.text,
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '600' },
        headerLeft: drawerButton,
        tabBarActiveTintColor: c.primaryText,
        tabBarInactiveTintColor: c.textSubtle,
        tabBarStyle: {
          backgroundColor: c.surface,
          borderTopColor: c.border,
          height: TAP + 34,
          paddingTop: 6,
          paddingBottom: 10,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="fees"
        options={{
          title: 'Fees',
          tabBarIcon: ({ color, focused }) => (
            <Wallet size={22} color={color} strokeWidth={focused ? 2.4 : 1.9} />
          ),
        }}
      />
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
        name="index"
        options={{
          title: 'Home',
          tabBarLabel: 'Home',
          // The centre tab, drawn as a filled target rather than a glyph — on a bar of
          // five it is the one a thumb finds without looking.
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
        name="results"
        options={{
          title: 'Results',
          tabBarIcon: ({ color, focused }) => (
            <GraduationCap size={22} color={color} strokeWidth={focused ? 2.4 : 1.9} />
          ),
        }}
      />
      <Tabs.Screen
        name="notices"
        options={{
          title: 'Notices',
          tabBarIcon: ({ color, focused }) => (
            <Megaphone size={22} color={color} strokeWidth={focused ? 2.4 : 1.9} />
          ),
        }}
      />

      {/* Reachable from the Home grid and the drawer, not from the bar. Five is the
          most a phone bar holds before the labels stop being readable. */}
      <Tabs.Screen name="account" options={{ href: null, title: 'Account' }} />
      <Tabs.Screen name="children" options={{ href: null, title: 'My children' }} />
    </Tabs>
  )
}
