// Rewarded video ads via Google AdMob (react-native-google-mobile-ads).
//
// The server decides the mode: when it runs with AD_PROVIDER=stub, the Earn
// screen shows a fake 5-second ad instead, so the app works in Expo Go and
// without any ad account. Real ads need a development or store build.
//
// Points are granted by the server only after AdMob's signed server-side
// verification callback arrives; the app never grants points itself.

import { Platform } from 'react-native';

type AdsModule = typeof import('react-native-google-mobile-ads');

let mod: AdsModule | null | undefined;
function adsModule(): AdsModule | null {
  if (mod !== undefined) return mod;
  try {
    // Throws in Expo Go, where the native module is not available.
    mod = require('react-native-google-mobile-ads') as AdsModule;
  } catch {
    mod = null;
  }
  return mod;
}

export function realAdsAvailable(): boolean {
  return adsModule() !== null;
}

let initialized: Promise<unknown> | null = null;

function rewardedUnitId(m: AdsModule): string {
  const fromEnv = Platform.select({
    ios: process.env.EXPO_PUBLIC_ADMOB_REWARDED_IOS,
    android: process.env.EXPO_PUBLIC_ADMOB_REWARDED_ANDROID,
  });
  // Google's test unit until real ids are configured.
  return __DEV__ || !fromEnv ? m.TestIds.REWARDED : fromEnv;
}

/** Shows one rewarded ad. Resolves true if the viewer earned the reward. */
export async function showRewardedAd(sessionId: string, userId: string): Promise<boolean> {
  const m = adsModule();
  if (!m) throw new Error('Ads are not available in this build');
  initialized ??= m.default().initialize();
  await initialized;
  const ad = m.RewardedAd.createForAdRequest(rewardedUnitId(m), {
    serverSideVerificationOptions: { userId, customData: sessionId },
  });
  return new Promise<boolean>((resolve, reject) => {
    let earned = false;
    const subs: (() => void)[] = [];
    const done = () => subs.forEach((u) => u());
    subs.push(ad.addAdEventListener(m.RewardedAdEventType.LOADED, () => void ad.show()));
    subs.push(ad.addAdEventListener(m.RewardedAdEventType.EARNED_REWARD, () => (earned = true)));
    subs.push(
      ad.addAdEventListener(m.AdEventType.CLOSED, () => {
        done();
        resolve(earned);
      }),
    );
    subs.push(
      ad.addAdEventListener(m.AdEventType.ERROR, (err) => {
        done();
        reject(err);
      }),
    );
    ad.load();
  });
}
