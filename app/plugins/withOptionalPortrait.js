// The app stays portrait-locked ("orientation": "portrait" in app.json), but
// Android then treats a portrait screen as a required hardware feature, and
// Play hides the app from devices that don't report one (many tablets,
// Chromebooks, XR). Marking the feature optional keeps those devices eligible.
const { withAndroidManifest } = require('expo/config-plugins');

const FEATURE = 'android.hardware.screen.portrait';

module.exports = function withOptionalPortrait(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$ = { ...manifest.$, 'xmlns:tools': manifest.$?.['xmlns:tools'] ?? 'http://schemas.android.com/tools' };
    const features = (manifest['uses-feature'] ??= []);
    const existing = features.find((f) => f.$?.['android:name'] === FEATURE);
    if (existing) {
      existing.$['android:required'] = 'false';
      existing.$['tools:replace'] = 'android:required';
    } else {
      features.push({ $: { 'android:name': FEATURE, 'android:required': 'false', 'tools:replace': 'android:required' } });
    }
    return cfg;
  });
};
