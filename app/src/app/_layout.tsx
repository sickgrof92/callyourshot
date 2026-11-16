import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider } from '../lib/session';
import { colors } from '../lib/theme';

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="welcome" options={{ headerShown: false }} />
        <Stack.Screen name="rules" options={{ title: 'How it works', presentation: 'modal' }} />
      </Stack>
    </SessionProvider>
  );
}
