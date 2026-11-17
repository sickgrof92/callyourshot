// Push notifications. Four kinds, each switchable on its own (see the
// Notifications screen, one tap from the bell in every tab's header). Every
// notification also has a "Turn these off" button that switches off just
// that kind.
//
// We ask for the phone's permission in context (after a first pick or join),
// never at first launch.

import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { api, type NotifyKind } from './api';

type N = typeof import('expo-notifications');
let mod: N | null | undefined;
function notifications(): N | null {
  if (mod !== undefined) return mod;
  // Push is phone-only; the web build (used for previews) has no notifications.
  if (Platform.OS === 'web') return (mod = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('expo-notifications') as N;
  } catch {
    mod = null;
  }
  return mod;
}

export const KINDS: { kind: NotifyKind; title: string; detail: string }[] = [
  { kind: 'results', title: 'Pick results', detail: 'When a pick wins, loses or pushes' },
  { kind: 'gameStart', title: 'Game starting', detail: 'When a game you picked is about to start' },
  { kind: 'contestStart', title: 'Contest starting', detail: 'When a contest you joined begins' },
  { kind: 'newContests', title: 'New contests', detail: "When a new contest opens that you haven't joined" },
];

export const TURN_OFF = 'turn_off';

/** Show notifications while the app is open too, and add the "Turn these off" button to each kind. */
export async function setUpNotifications(): Promise<void> {
  const n = notifications();
  if (!n) return;
  n.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
  if (Platform.OS === 'android') {
    await n.setNotificationChannelAsync('default', { name: 'Call Your Shot', importance: n.AndroidImportance.DEFAULT }).catch(() => {});
  }
  for (const k of KINDS) {
    await n
      .setNotificationCategoryAsync(k.kind, [{ identifier: TURN_OFF, buttonTitle: `Turn off ${k.title.toLowerCase()}`, options: { opensAppToForeground: true } }])
      .catch(() => {});
  }
}

export type EnableResult = 'on' | 'denied' | 'unavailable';

/** Ask the phone for permission (if needed) and register this device with our server. */
export async function enablePush(sessionToken: string): Promise<EnableResult> {
  const n = notifications();
  if (!n) return 'unavailable';
  let perm = await n.getPermissionsAsync();
  if (!perm.granted && perm.canAskAgain) perm = await n.requestPermissionsAsync();
  if (!perm.granted) return 'denied';
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
  try {
    const { data } = await n.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await api.setPushToken(sessionToken, data);
    return 'on';
  } catch {
    // No EAS project id yet, or no push support in this build (e.g. Expo Go on Android).
    return 'unavailable';
  }
}

export async function osPermission(): Promise<'granted' | 'denied' | 'undetermined' | 'unavailable'> {
  const n = notifications();
  if (!n) return 'unavailable';
  const p = await n.getPermissionsAsync();
  return p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
}

const ASKED_KEY = 'cys.pushAsked';
/** True the first time only: used to offer notifications once, after a first pick or join. */
export async function shouldOfferPush(): Promise<boolean> {
  if (!notifications()) return false;
  const asked = await SecureStore.getItemAsync(ASKED_KEY).catch(() => '1');
  if (asked) return false;
  if ((await osPermission()) === 'granted') return false;
  await SecureStore.setItemAsync(ASKED_KEY, '1').catch(() => {});
  return true;
}

/** Calls back with taps on notifications, including the "Turn these off" button. */
export function onNotificationTap(cb: (kind: NotifyKind | null, action: string, data: Record<string, string>) => void): () => void {
  const n = notifications();
  if (!n) return () => {};
  const handle = (r: import('expo-notifications').NotificationResponse) => {
    const data = (r.notification.request.content.data ?? {}) as Record<string, string>;
    cb((data.kind as NotifyKind) ?? null, r.actionIdentifier, data);
  };
  try {
    const last = n.getLastNotificationResponse();
    if (last) handle(last);
  } catch {
    // Not available on this platform or build.
  }
  const sub = n.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}
