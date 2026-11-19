// Turns off R8 code shrinking/obfuscation and resource shrinking in Android
// release builds. Expo's template turns minify on by default; if R8 strips a
// class that a native library (AdMob, Google Sign-In, Expo modules) finds by
// reflection, the store build crashes at launch while Expo Go works fine.
// The app is a bit bigger without it, which is fine for now.
const { withGradleProperties } = require('expo/config-plugins');

const SETTINGS = {
  'android.enableMinifyInReleaseBuilds': 'false',
  'android.enableShrinkResourcesInReleaseBuilds': 'false',
};

module.exports = function withNoR8(config) {
  return withGradleProperties(config, (cfg) => {
    for (const [key, value] of Object.entries(SETTINGS)) {
      const item = cfg.modResults.find((p) => p.type === 'property' && p.key === key);
      if (item) item.value = value;
      else cfg.modResults.push({ type: 'property', key, value });
    }
    return cfg;
  });
};
