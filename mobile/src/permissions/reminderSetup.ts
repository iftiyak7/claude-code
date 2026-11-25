/**
 * Everything a phone needs so reminders and alarms fire on time, even when
 * the app is closed. Each item can be checked and requested from inside the
 * app — the user only taps "Allow" on the system prompt.
 */
import * as Battery from 'expo-battery';
import Constants from 'expo-constants';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';
import { storage } from '@/db/storage';
import { today } from '@/domain/dates';
import { reschedule } from '@/notifications/scheduler';

export type SetupItem = 'notifications' | 'exactAlarm' | 'battery';
export type SetupStatus = Record<SetupItem, boolean>;

const PKG = (Constants.expoConfig?.android?.package as string | undefined) ?? 'com.tadbeerdaily.app';
const isAndroid = Platform.OS === 'android';

export const SETUP_ITEMS: SetupItem[] = isAndroid ? ['notifications', 'exactAlarm', 'battery'] : ['notifications'];

export async function getSetupStatus(): Promise<SetupStatus> {
  if (Platform.OS === 'web') return { notifications: true, exactAlarm: true, battery: true };
  const [n, a, b] = await Promise.all([
    Notifications.getPermissionsAsync().then((p) => p.granted).catch(() => false),
    isAndroid ? Notifications.getExactAlarmPermissionsAsync().then((p) => p.granted).catch(() => true) : true,
    isAndroid ? Battery.isBatteryOptimizationEnabledAsync().then((on) => !on).catch(() => true) : true,
  ]);
  return { notifications: n, exactAlarm: a, battery: b };
}

export const allGranted = (s: SetupStatus) => SETUP_ITEMS.every((k) => s[k]);

/** Shows the system prompt / screen for one item. Resolves once the user is back. */
export async function requestSetupItem(item: SetupItem): Promise<void> {
  if (item === 'notifications') {
    const p = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
    // denied permanently → only the app's settings page can turn it back on
    if (!p.granted && !p.canAskAgain) await Linking.openSettings();
  } else if (item === 'exactAlarm') {
    await Notifications.requestExactAlarmPermissionsAsync().catch(() =>
      IntentLauncher.startActivityAsync('android.settings.REQUEST_SCHEDULE_EXACT_ALARM', { data: `package:${PKG}` }),
    );
  } else {
    try {
      await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, { data: `package:${PKG}` });
    } catch {
      await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS).catch(() => undefined);
    }
  }
  // new permissions may upgrade deliveries (e.g. exact alarms) — rebuild schedule
  void reschedule();
}

const ASKED_KEY = 'setup.askedOn';

/** Prompt automatically at most once per day while something is missing. */
export async function shouldAutoPrompt(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (storage.kvGet(ASKED_KEY) === today()) return false;
  return !allGranted(await getSetupStatus());
}

export function markAutoPrompted() {
  storage.kvSet(ASKED_KEY, today());
}
