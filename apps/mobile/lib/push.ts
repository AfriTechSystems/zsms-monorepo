/**
 * Registering this phone so ZSMS can reach it.
 *
 * Spec: `Official Documentation/12 Communication System/NOTIFICATIONS.md`
 *
 * ## Why this is the piece that was missing
 *
 * `register_push_token()` has been in the database since push was specified, and
 * `parent_push_tokens` held **zero rows**. Push was not blocked on Meta credentials —
 * it was blocked on nobody ever telling the server which devices exist. Without this
 * file, turning on a provider would still deliver to nobody.
 *
 * ## Permission is asked for at the right moment
 *
 * Not on first launch. A phone that asks for notifications before showing anything gets
 * "Don't allow", and on iOS that answer is close to final — the app can never ask again,
 * only send the person to Settings. So the ask happens after sign-in, when the app has
 * already shown what it is for.
 *
 * ## A refusal is not an error
 *
 * Somebody who declines notifications has made a choice. Every function here resolves
 * quietly rather than throwing, and the account screen says plainly what they will miss
 * and how to change their mind.
 */

import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
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
  /** A simulator, or a build without push credentials. */
  | 'unavailable'

/**
 * Foreground behaviour.
 *
 * A notice that arrives while somebody is marking a register should be visible but must
 * not steal the screen — losing a half-entered register to a banner tap is worse than
 * missing the notice.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
})

/** Whether this build can receive push at all, before anything is asked. */
export async function pushState(): Promise<PushState> {
  // A simulator has no push service. Checked first so the account screen explains that
  // rather than showing a control that silently does nothing.
  if (!Device.isDevice) return 'unavailable'

  const { status, canAskAgain } = await Notifications.getPermissionsAsync()
  if (status === 'granted') return 'on'
  if (!canAskAgain) return 'declined'
  return status === 'denied' ? 'declined' : 'unasked'
}

/**
 * Ask, then tell the server.
 *
 * Returns the state afterwards so a caller can render the outcome without asking again.
 */
export async function enablePush(
  getToken: () => Promise<string | null>,
): Promise<PushState> {
  if (!Device.isDevice) return 'unavailable'

  const existing = await Notifications.getPermissionsAsync()
  let granted = existing.status === 'granted'

  if (!granted) {
    if (!existing.canAskAgain) return 'declined'
    const asked = await Notifications.requestPermissionsAsync()
    granted = asked.status === 'granted'
  }

  if (!granted) return 'declined'

  /*
    Android needs a channel before anything can be delivered.

    Created every time rather than once: it is idempotent, and a channel deleted by the
    person in system settings otherwise never comes back.
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
    development build without EAS configured would otherwise throw here with a message
    that reads like a bug in ZSMS.
  */
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId

  let token: string
  try {
    const result = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    )
    token = result.data
  } catch {
    // No push credentials in this build. Not a failure the person can act on.
    return 'unavailable'
  }

  const sent = await api.post('/api/session/push-token', getToken, {
    token,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
  })

  // Permission is granted either way; only the server does not know yet. Reported as
  // `on` because the phone IS set up, and the next launch retries the registration.
  if (sent.error) return 'on'

  return 'on'
}

/**
 * Forget this device, on sign-out.
 *
 * A shared phone is ordinary in a Zambian school. Leaving a token registered means the
 * next notice for that person lands on a handset somebody else is holding, which is a
 * disclosure rather than an inconvenience.
 */
export async function retirePush(getToken: () => Promise<string | null>): Promise<void> {
  if (!Device.isDevice) return

  try {
    const { status } = await Notifications.getPermissionsAsync()
    if (status !== 'granted') return

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
    const result = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    )

    await api.delete('/api/session/push-token', getToken, { token: result.data })
  } catch {
    /*
      Never block a sign-out.

      Somebody signing out on a borrowed phone must get out, and a failed retirement is
      recoverable — the server drops tokens that stop accepting delivery.
    */
  }
}
