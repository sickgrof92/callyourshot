import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { GameButton } from '../components/GameButton';
import { api, type NotifyKind, type NotifyPrefs } from '../lib/api';
import { tap } from '../lib/haptics';
import { enablePush, KINDS, osPermission } from '../lib/notifications';
import { useSession } from '../lib/session';
import { colors, space } from '../lib/theme';

/** Four switches, one per kind of notification. Each saves the moment it's flipped. */
export default function NotificationSettings() {
  const { token } = useSession();
  const { off } = useLocalSearchParams<{ off?: string }>();
  const [prefs, setPrefs] = useState<NotifyPrefs | null>(null);
  const [os, setOs] = useState<string>('undetermined');
  const [msg, setMsg] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      api.notifyPrefs(token).then(setPrefs).catch(() => {});
      osPermission().then(setOs).catch(() => {});
    }, [token]),
  );

  async function flip(kind: NotifyKind, value: boolean) {
    if (!token || !prefs) return;
    tap();
    const before = prefs;
    setPrefs({ ...prefs, [kind]: value }); // instant
    try {
      setPrefs(await api.setNotifyPrefs(token, { [kind]: value }));
    } catch {
      setPrefs(before);
      setMsg("Couldn't save that. Check your connection and try again.");
    }
  }

  async function turnOn() {
    if (!token) return;
    const r = await enablePush(token);
    setOs(await osPermission());
    if (r === 'on') setPrefs(await api.notifyPrefs(token));
    else if (r === 'denied') setMsg('Notifications are off for Call Your Shot in your phone settings.');
    else setMsg("This version of the app can't receive notifications yet. They work in the full app build.");
  }

  const offName = KINDS.find((k) => k.kind === off)?.title;

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Stack.Screen options={{ title: 'Notifications' }} />
      {offName && <Text style={styles.banner}>Done: "{offName}" notifications are off. Flip it back on anytime.</Text>}
      {prefs && !prefs.pushEnabled && (
        <View style={styles.card}>
          <Text style={styles.title}>Notifications are off on this phone</Text>
          {os === 'denied' ? (
            <GameButton title="Open phone settings" variant="neon" icon="settings" onPress={() => void Linking.openSettings()} />
          ) : (
            <GameButton title="Turn on notifications" variant="neon" icon="notifications" onPress={turnOn} />
          )}
        </View>
      )}
      <Text style={styles.sub}>Pick exactly what you want to hear about. Changes save instantly.</Text>
      {KINDS.map((k) => (
        <View key={k.kind} style={[styles.row, off === k.kind && styles.rowHi]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{k.title}</Text>
            <Text style={styles.rowDetail}>{k.detail}</Text>
          </View>
          <Switch
            value={prefs?.[k.kind] ?? true}
            disabled={!prefs}
            onValueChange={(v) => void flip(k.kind, v)}
            trackColor={{ false: colors.border, true: colors.win }}
            thumbColor={colors.text}
            accessibilityLabel={k.title}
          />
        </View>
      ))}
      {msg && <Text style={styles.msg}>{msg}</Text>}
      <Text style={styles.fine}>Every notification also has a button to turn off that kind right from the notification.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space.xl, gap: space.md },
  banner: { backgroundColor: 'rgba(61,255,143,0.12)', color: colors.win, padding: space.md, borderRadius: 12, fontWeight: '800' },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: space.lg, gap: space.md, borderWidth: 2, borderColor: colors.neon },
  title: { color: colors.text, fontWeight: '900', fontSize: 17 },
  sub: { color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.card, borderRadius: 16, padding: space.lg, borderWidth: 2, borderColor: colors.border },
  rowHi: { borderColor: colors.win },
  rowTitle: { color: colors.text, fontWeight: '900', fontSize: 17 },
  rowDetail: { color: colors.muted, marginTop: 2 },
  msg: { color: colors.accent, fontWeight: '700' },
  fine: { color: colors.muted, fontSize: 12, textAlign: 'center' },
});
