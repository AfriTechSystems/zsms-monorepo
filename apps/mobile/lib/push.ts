/**
 * Registering this phone so ZSMS can reach it.
 *
 * Spec: `Official Documentation/12 Communication System/NOTIFICATIONS.md`
 *
 * ## Why this is the piece that was missing
 *
 * `register_push_token()` has been in the database since push was specified and
 * `parent_push_tokens` held ZERO rows. Push was never blocked on Meta credentials — it
 * was blocked on nobody telling the server which devices exist.
 *
 * ## Nothing here is imported until it is used, and that is the whole design
 *
 * `expo-notifications` calls `requireNativeModule('ExpoNotificationsHandlerModule')` at
 * the top of its own module. **Expo Go has not shipped that module since SDK 53**, when
 * push was removed from it — so merely IMPORTING the package throws there, before any
 * function of ours runs.
 *
 * The first version of this file imported it statically and called
 * `setNotificationHandler()` at module scope. `lib/auth.ts` imports this file for
 * sign-out, every layout uses `useSession`, and so a package that cannot load in Expo
 * Go took the entire app down before the first screen rendered — reported as "undefined
 * is not a function" and an app stuck on the splash.
 *
 * So: no static import, no module-scope side effects, and a load that is allowed to
 * fail. A phone that cannot do push gets an app that works without it.
 *
 * ## Why try/catch rather than checking for Expo Go
 *
 * `Constants.executionEnvironment` reports `storeClient` for Expo Go AND for a
 * development build made with `expo-dev-client` — and the second one CAN do push. The
 * deprecated `appOwnership` separates them, but a flag that is already deprecated is a
 * poor thing to gate a whole feature on. Asking the module whether it loads answers the
 * real question for every case, now and later.
 */

import { Platform } from 'react-native'
import Constants from 'expo-constants'

import { api } from './api'

export type PushState =
  /** Registered; notices can reach this phone. */
  | 'on'
  /** Asked and declined, or declined previously. */
  | 'declined'
  /** Not asked yet. */
  | 'unasked'
  /** A simulator, Expo Go, or a build with no push credentials. */
  | 'unavailable'

/** The two modules, or null when this build cannot load them. */
interface PushModules {
  Notifications: typeof import('expo-notifications')
  Device: typeof import('expo-device')
}

let cached: PushModules | null | undefined
let handlerInstalled = false

/**
 * Load the native-backed packages, once, and never throw.
 *
 * `undefined` means not yet tried; `null` means tried and unavailable. Caching the
 * failure matters: in Expo Go this fails every time, and retrying on each call would
 * pay the cost of a throw on every screen that asks.
 */
async function load(): Promise<PushModules | null> {
  if (cached !== undefined) return cached

  try {
    const [Notifications, Device] = await Promise.all([
      import('expo-notifications'),
      import('expo-device'),
    ])
    cached = { Notifications, Device }
  } catch {
    // Expo Go since SDK 53, or any build without the native module. Not an error the
    // person can act on, and not a reason for anything else to stop working.
    cached = null
  }

  return cached
}

/**
 * How a notice behaves while the app is open.
 *
 * Installed on first use rather than at import. A notice arriving while somebody is
 * marking a register should be visible but must not steal the screen — losing a
 * half-entered register to a banner tap is worse than missing the notice.
 */
function installHandler(Notifications: PushModules['Notifications']): void {
  if (handlerInstalled) return
  handlerInstalled = true

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: true,
    }),
  })
}

/**
 * Whether this build can receive push at all, before anything is asked.
 *
 * Safe to call from a screen's `useEffect` on any device — it resolves rather than
 * throwing, whatever is or is not installed.
 */
export async function pushState(): Promise<PushState> {
  const mods = await load()
  if (!mods) return 'unavailable'

  // A simulator has no push service. Checked after the load so the account screen can
  // tell the two apart if it ever needs to.
  if (!mods.Device.isDevice) return 'unavailable'

  try {
    const { status, canAskAgain } = await mods.Notifications.getPermissionsAsync()
    if (status === 'granted') return 'on'
    if (!canAskAgain) return 'declined'
    return status === 'denied' ? 'declined' : 'unasked'
  } catch {
    return 'unavailable'
  }
}

/**
 * Why push is not available, in words a person can act on.
 *
 * Distinguishing Expo Go from a simulator matters only to whoever is testing, and that
 * is exactly who needs to be told — "not available on this device" would send somebody
 * looking for a fault in the app.
 */
export async function pushUnavailableReason(): Promise<string> {
  const mods = await load()
  if (!mods) {
    return Constants.executionEnvironment === 'storeClient'
      ? 'Notifications need the installed ZSMS app. They do not work in Expo Go — Expo removed push from it in SDK 53.'
      : 'This build does not include notifications.'
  }
  if (!mods.Device.isDevice) return 'Notifications do not work on a simulator.'
  return 'Notifications are not available on this device.'
}

/**
 * Ask, then tell the server.
 *
 * Returns the state afterwards so a caller can render the outcome without asking again.
 */
export async function enablePush(
  getToken: () => Promise<string | null>,
): Promise<PushState> {
  const mods = await load()
  if (!mods || !mods.Device.isDevice) return 'unavailable'

  const { Notifications } = mods

  try {
    const existing = await Notifications.getPermissionsAsync()
    let granted = existing.status === 'granted'

    if (!granted) {
      if (!existing.canAskAgain) return 'declined'
      const asked = await Notifications.requestPermissionsAsync()
      granted = asked.status === 'granted'
    }

    if (!granted) return 'declined'

    installHandler(Notifications)

    /*
      Android needs a channel before anything can be delivered.

      Created every time rather than once: it is idempotent, and a channel the person
      deleted in system settings otherwise never comes back.
    */
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'School notices',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 250, 250, 250],
      })
    }

    /*
      The project id is required for a token in any build that is not Expo Go.

      Read from the manifest rather than hardcoded, and its absence is handled: a
      development build without EAS configured would otherwise throw with a message
      that reads like a bug in ZSMS.
    */
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId

    const result = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    )

    const sent = await api.post('/api/session/push-token', getToken, {
      token: result.data,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
    })

    // Permission is granted either way; only the server does not know yet. Reported as
    // `on` because the phone IS set up, and the next launch retries the registration.
    if (sent.error) return 'on'

    return 'on'
  } catch {
    // No push credentials in this build, or the service refused. Not something the
    // person can act on, and never a reason to break the screen they are looking at.
    return 'unavailable'
  }
}

/**
 * Forget this device, on sign-out.
 *
 * A shared phone is ordinary in a Zambian school. Leaving a token registered means the
 * next notice for that person lands on a handset somebody else is holding, which is a
 * disclosure rather than an untidiness.
 *
 * Never throws and never blocks: somebody signing out on a borrowed phone must get out.
 */
export async function retirePush(getToken: () => Promise<string | null>): Promise<void> {
  const mods = await load()
  if (!mods || !mods.Device.isDevice) return

  try {
    const { status } = await mods.Notifications.getPermissionsAsync()
    if (status !== 'granted') return

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
    const result = await mods.Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    )

    await api.delete('/api/session/push-token', getToken, { token: result.data })
  } catch {
    /*
      A failed retirement is recoverable — the server drops tokens that stop accepting
      delivery — and a sign-out that fails is not.
    */
  }
}
