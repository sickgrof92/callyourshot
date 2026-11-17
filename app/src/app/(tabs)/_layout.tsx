import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, router, Tabs } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, View, type ColorValue } from 'react-native';
import { MenuButton } from '../../components/Menu';
import { PointsCounter } from '../../components/PointsCounter';
import { useContests } from '../../lib/contests';
import { useSession } from '../../lib/session';
import { colors, glow } from '../../lib/theme';

function Balance() {
  const { active } = useContests();
  if (!active) return null;
  return (
    <View style={styles.pill}>
      <Ionicons name="flash" size={14} color={colors.accent} />
      <PointsCounter value={active.mine?.balance ?? 0} suffix=" pts" style={[styles.pillText, glow(colors.accent, 6)]} />
    </View>
  );
}

/** One tap to the notification switches, from every tab. */
function Bell() {
  return (
    <Pressable onPress={() => router.push('/notifications')} hitSlop={12} style={{ marginRight: 14 }} accessibilityLabel="Notification settings">
      <Ionicons name="notifications" size={22} color={colors.neon} />
    </Pressable>
  );
}

function HeaderRight() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Bell />
      <Balance />
    </View>
  );
}

type IconName = React.ComponentProps<typeof Ionicons>['name'];
const icon =
  (name: IconName) =>
  ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} color={color as string} size={size} />;

export default function TabsLayout() {
  const { ready, me } = useSession();
  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (!me) return <Redirect href="/welcome" />;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTitleStyle: { fontWeight: '900', letterSpacing: 1 },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        headerRight: () => <HeaderRight />,
        headerLeft: () => <MenuButton />,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border, borderTopWidth: 2, height: 64, paddingTop: 6 },
        tabBarLabelStyle: { fontWeight: '800', fontSize: 11 },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      {/* Contests is the home screen. */}
      <Tabs.Screen name="index" options={{ title: 'Contests', headerTitle: '', tabBarIcon: icon('trophy') }} />
      <Tabs.Screen name="games" options={{ title: 'Games', tabBarIcon: icon('american-football') }} />
      <Tabs.Screen name="earn" options={{ title: 'Points', tabBarIcon: icon('flash') }} />
      <Tabs.Screen name="mypicks" options={{ title: 'My Picks', tabBarIcon: icon('list') }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginRight: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.accent,
    backgroundColor: 'rgba(255,225,77,0.1)',
  },
  pillText: { color: colors.accent, fontWeight: '900' },
});
