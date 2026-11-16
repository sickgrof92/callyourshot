import { router } from 'expo-router';
import { useEffect } from 'react';
import { api } from '../lib/api';
import { enablePush, onNotificationTap, osPermission, setUpNotifications, TURN_OFF } from '../lib/notifications';
import { useSession } from '../lib/session';

/** Handles taps on notifications: "Turn these off" switches that kind off; a normal tap opens the right screen. */
export function NotificationRouter() {
  const { token } = useSession();

  useEffect(() => {
    void setUpNotifications();
  }, []);

  // Keep this phone's push token current once the player has allowed notifications.
  useEffect(() => {
    if (!token) return;
    osPermission()
      .then((p) => (p === 'granted' ? enablePush(token) : null))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!token) return;
    return onNotificationTap((kind, action, data) => {
      if (action === TURN_OFF && kind) {
        api
          .setNotifyPrefs(token, { [kind]: false })
          .catch(() => {})
          .finally(() => router.push(`/notifications?off=${kind}`));
        return;
      }
      if (kind === 'results' || kind === 'gameStart') router.push('/mypicks');
      else if (data.contestId) router.push(`/contest/${data.contestId}`);
      else router.push('/contests');
    });
  }, [token]);

  return null;
}
