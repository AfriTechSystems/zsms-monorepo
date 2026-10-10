/**
 * The app shell.
 *
 * Spec: `Official Documentation/02 Authentication and Identity/AUTH.md`
 *       ADR-032 — the auth provider is wrapped, never imported directly by features
 *
 * ## Clerk is imported HERE and in the sign-in screen, nowhere else
 *
 * ADR-032 keeps Clerk behind `@zsms/auth-provider` so Keycloak can replace it for a
 * self-hosted deployment. That package wraps Clerk's **web** SDK; `@clerk/clerk-expo` is a
 * different SDK with native token storage, so it cannot be the same wrapper.
 *
 * Rather than pretend otherwise, the dependency is confined to two files — this one and
 * the sign-in screen — and every feature screen reaches auth through `useAuth()` from
 * `../lib/auth`. Swapping providers means rewriting those two files, which is the same
 * promise ADR-032 makes on the web.
 *
 * ## The token cache is SecureStore, not AsyncStorage
 *
 * A session token is a bearer credential: anything holding it can act as the teacher until
 * it expires. `AsyncStorage` is plain text on disk and readable by any process on a rooted
 * device; `SecureStore` is the Keychain on iOS and EncryptedSharedPreferences on Android.
 * Clerk's own examples show both, and only one is right for a token that reaches pupil
 * records.
 */

import type { JSX } from 'react'
import { ClerkProvider } from '@clerk/clerk-expo'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SecureStore from 'expo-secure-store'
import { useColorScheme } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { DARK, LIGHT } from '../theme'

const PUBLISHABLE_KEY = process.env['EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY'] ?? ''

/**
 * Failures are swallowed on purpose.
 *
 * A device with no secure enclave, or a keychain locked mid-read, must degrade to "signed
 * out" rather than crash on launch — a teacher cannot recover from a white screen, and can
 * recover from signing in again.
 */
const tokenCache = {
  async getToken(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key)
    } catch {
      return null
    }
  },
  async saveToken(key: string, value: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(key, value)
    } catch {
      // Nothing to do. The session stays in memory for this launch.
    }
  },
}

export default function RootLayout(): JSX.Element {
  const scheme = useColorScheme()
  const c = scheme === 'dark' ? DARK : LIGHT

  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <SafeAreaProvider>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: c.surface },
            headerTintColor: c.text,
            headerTitleStyle: { fontWeight: '600' },
            // A back control a thumb can reach, and no shadow — the border on the content
            // below already separates them, and two dividers read as a rendering fault.
            headerShadowVisible: false,
            contentStyle: { backgroundColor: c.background },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)/sign-in" options={{ headerShown: false }} />
          <Stack.Screen name="(teacher)" options={{ headerShown: false }} />
        </Stack>
      </SafeAreaProvider>
    </ClerkProvider>
  )
}
