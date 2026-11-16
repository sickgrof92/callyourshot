import * as Haptics from 'expo-haptics';

// Haptics are a nice extra; never let a missing motor or web build throw.
export const tap = () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
export const thump = () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
export const success = () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
export const warn = () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
