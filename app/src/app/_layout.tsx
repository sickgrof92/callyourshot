import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { NotificationRouter } from '../components/NotificationRouter';
import { ContestsProvider } from '../lib/contests';
import { SessionProvider } from '../lib/session';
import { colors } from '../lib/theme';

export default function RootLayout() {
  return (
    <SessionProvider>
      <ContestsProvider>
      <NotificationRouter />
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '900' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="welcome" options={{ headerShown: false }} />
        <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
        <Stack.Screen name="player/[name]" options={{ title: 'Player' }} />
        <Stack.Screen name="claim/[id]" options={{ title: 'Claim your prize' }} />
        <Stack.Screen name="contest/[id]" options={{ title: 'Contest', headerBackTitle: 'Contests' }} />
        <Stack.Screen name="rules" options={{ title: 'How it works', presentation: 'modal' }} />
      </Stack>
      </ContestsProvider>
    </SessionProvider>
  );
}
