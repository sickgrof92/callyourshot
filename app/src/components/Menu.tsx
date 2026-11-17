// The hamburger menu at the top left of every tab: a panel that slides in from
// the left with the places a player needs to get to from anywhere.

import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tap } from '../lib/haptics';
import { openPrivacy } from '../lib/links';
import { useSession } from '../lib/session';
import { colors, glow, space } from '../lib/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
interface Item {
  label: string;
  icon: IconName;
  color: string;
  go: () => void;
}

export function MenuButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => {
          tap();
          setOpen(true);
        }}
        hitSlop={12}
        style={{ marginLeft: 16 }}
        accessibilityRole="button"
        accessibilityLabel="Menu"
      >
        <Ionicons name="menu" size={28} color={colors.text} />
      </Pressable>
      <MenuPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function MenuPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me, signOut } = useSession();
  const insets = useSafeAreaInsets();
  const go = (fn: () => void) => () => {
    tap();
    onClose();
    fn();
  };

  const items: Item[] = [
    { label: 'Contests', icon: 'trophy', color: colors.accent, go: () => router.navigate('/') },
    { label: 'My profile & stats', icon: 'person-circle', color: colors.neon, go: () => me && router.push(`/player/${encodeURIComponent(me.displayName)}`) },
    { label: 'My picks', icon: 'list', color: colors.neon, go: () => router.navigate('/mypicks') },
    { label: 'Notification settings', icon: 'notifications', color: colors.neon, go: () => router.push('/notifications') },
    { label: 'How to play & FAQ', icon: 'help-circle', color: colors.pink, go: () => router.push('/howto') },
    { label: 'Rules', icon: 'document-text', color: colors.pink, go: () => router.push('/rules') },
    { label: 'Privacy policy', icon: 'shield-checkmark', color: colors.pink, go: openPrivacy },
    { label: 'Contact us', icon: 'chatbubbles', color: colors.purple, go: () => router.push('/contact') },
  ];

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={[styles.panel, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg }]}>
          <View style={styles.top}>
            <Text style={[styles.logo, glow(colors.accent, 12)]}>CALL YOUR SHOT</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close menu">
              <Ionicons name="close" size={26} color={colors.muted} />
            </Pressable>
          </View>
          {me && <Text style={styles.who}>Signed in as {me.displayName}</Text>}
          <ScrollView contentContainerStyle={{ gap: 4, paddingVertical: space.md }}>
            {items.map((it) => (
              <Pressable key={it.label} onPress={go(it.go)} style={({ pressed }) => [styles.row, pressed && styles.pressed]} accessibilityRole="button">
                <Ionicons name={it.icon} size={22} color={it.color} />
                <Text style={styles.label}>{it.label}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.border} />
              </Pressable>
            ))}
          </ScrollView>
          <Pressable
            onPress={go(async () => {
              await signOut();
              router.replace('/welcome');
            })}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Ionicons name="log-out-outline" size={22} color={colors.muted} />
            <Text style={[styles.label, { color: colors.muted }]}>Sign out</Text>
          </Pressable>
        </View>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close menu" />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  panel: {
    width: '82%',
    maxWidth: 340,
    backgroundColor: colors.card,
    borderRightWidth: 2,
    borderRightColor: colors.border,
    paddingHorizontal: space.lg,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(5,3,16,0.7)' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logo: { color: colors.accent, fontWeight: '900', fontSize: 20, letterSpacing: 1 },
  who: { color: colors.muted, marginTop: 4, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 14, paddingHorizontal: space.sm, borderRadius: 12 },
  pressed: { backgroundColor: colors.cardAlt },
  label: { color: colors.text, fontWeight: '800', fontSize: 17, flex: 1 },
});
