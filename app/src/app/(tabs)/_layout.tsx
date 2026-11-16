import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, Tabs } from 'expo-router';
import { ActivityIndicator, Text, View, type ColorValue } from 'react-native';
import { useSession } from '../../lib/session';
import { colors } from '../../lib/theme';

function Balance() {
  const { me } = useSession();
  return <Text style={{ color: colors.accent, fontWeight: '800', marginRight: 16 }}>{me?.balance ?? 0} pts</Text>;
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
        headerTintColor: colors.text,
        headerRight: () => <Balance />,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Games', tabBarIcon: icon('american-football') }} />
      <Tabs.Screen name="earn" options={{ title: 'Earn', tabBarIcon: icon('play-circle') }} />
      <Tabs.Screen name="leaderboard" options={{ title: 'Leaders', tabBarIcon: icon('trophy') }} />
      <Tabs.Screen name="mypicks" options={{ title: 'My Picks', tabBarIcon: icon('list') }} />
    </Tabs>
  );
}
