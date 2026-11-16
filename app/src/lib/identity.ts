// Gets an identity token from Apple or Google for the server to check.
//
// When the server runs AUTH_MODE=stub (testing, Expo Go), no real sign-in
// happens: this device gets a random id that stands in for the Apple/Google
// account. Live sign-in needs a development or store build, plus the client ids
// described in the README.

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export type Provider = 'apple' | 'google';

export class SignInCancelled extends Error {}

async function stubToken(provider: Provider): Promise<string> {
  const key = 'cys.stubDevice';
  let id = await SecureStore.getItemAsync(key);
  if (!id) {
    id = Array.from({ length: 24 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
    await SecureStore.setItemAsync(key, id);
  }
  return `stub-${provider}-${id}`;
}

async function appleToken(): Promise<{ idToken: string; email: string | null }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Apple = require('expo-apple-authentication') as typeof import('expo-apple-authentication');
  try {
    const cred = await Apple.signInAsync({
      requestedScopes: [Apple.AppleAuthenticationScope.EMAIL],
    });
    if (!cred.identityToken) throw new Error('No identity token from Apple');
    return { idToken: cred.identityToken, email: cred.email };
  } catch (err) {
    if ((err as { code?: string }).code === 'ERR_REQUEST_CANCELED') throw new SignInCancelled();
    throw err;
  }
}

async function googleToken(): Promise<{ idToken: string; email: string | null }> {
  let mod: typeof import('@react-native-google-signin/google-signin');
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('@react-native-google-signin/google-signin');
  } catch {
    throw new Error('Google sign-in needs a development or store build of the app.');
  }
  const { GoogleSignin } = mod;
  GoogleSignin.configure({
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  });
  if (Platform.OS === 'android') await GoogleSignin.hasPlayServices();
  const res = await GoogleSignin.signIn();
  if (res.type !== 'success') throw new SignInCancelled();
  if (!res.data.idToken) throw new Error('No identity token from Google');
  return { idToken: res.data.idToken, email: res.data.user.email };
}

/** Which buttons to show. Apple sign-in is iPhone-only in live mode. */
export function providersFor(mode: 'stub' | 'live'): Provider[] {
  if (mode === 'stub') return ['apple', 'google'];
  return Platform.OS === 'ios' ? ['apple', 'google'] : ['google'];
}

export async function getIdentityToken(provider: Provider, mode: 'stub' | 'live'): Promise<{ idToken: string; email: string | null }> {
  if (mode === 'stub') return { idToken: await stubToken(provider), email: null };
  return provider === 'apple' ? appleToken() : googleToken();
}
