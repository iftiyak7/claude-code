/**
 * Turns the pure notification plan into OS-scheduled local notifications.
 * Local notifications are fired by the OS itself — they work fully offline
 * and even when the app is closed.
 *
 * Strategy: on every data change (debounced) and on app foreground we
 * rebuild the plan for the next few days and diff it against what is
 * already scheduled, so only changed notifications are touched.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { buildPlan, type Channel, type PlannedNotification } from '@/domain/notifyPlan';
import { getT } from '@/i18n';
import { useData } from '@/store/data';

const VIBRATE_SOFT = [0, 250, 150, 250];
const VIBRATE_ALARM = [0, 800, 400, 800, 400, 800, 400, 1200];

export async function setupChannels() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS !== 'android') return;
  const t = getT(useData.getState().settings.language);
  const ch = (id: Channel, name: string, cfg: Partial<Notifications.NotificationChannelInput>) =>
    Notifications.setNotificationChannelAsync(id, {
      name,
      importance: Notifications.AndroidImportance.HIGH,
      enableVibrate: true,
      vibrationPattern: VIBRATE_SOFT,
      lightColor: '#0F6B4F',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      ...cfg,
    });
  await Promise.all([
    ch('reminder', t.reminders, { sound: 'default' }),
    ch('salah', t.salah, { sound: 'default' }),
    ch('medicine', t.medicine, { sound: 'default' }),
    ch('alarm', t.alarm, {
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      vibrationPattern: VIBRATE_ALARM,
      bypassDnd: true,
      audioAttributes: {
        usage: Notifications.AndroidAudioUsage.ALARM,
        contentType: Notifications.AndroidAudioContentType.SONIFICATION,
      },
    }),
  ]);
}

export async function notificationsGranted(): Promise<boolean> {
  const p = await Notifications.getPermissionsAsync();
  return p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

export async function requestNotificationPermission(): Promise<boolean> {
  const p = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return p.granted;
}

function toTrigger(n: PlannedNotification): Notifications.NotificationTriggerInput {
  const delivery = n.channel === 'alarm' || n.channel === 'medicine' ? 'alarmClock' : 'bestEffort';
  if (n.trigger.kind === 'daily') {
    return {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: n.trigger.hour,
      minute: n.trigger.minute,
      channelId: n.channel,
      delivery,
    };
  }
  return {
    type: Notifications.SchedulableTriggerInputTypes.DATE,
    date: n.trigger.at,
    channelId: n.channel,
    delivery,
  };
}

/** Content signature — reschedule only if something visible changed. */
const sig = (n: PlannedNotification) => `${n.title}|${n.body}|${n.channel}`;

let running: Promise<void> | null = null;
let again = false;

export function reschedule(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await rescheduleOnce();
      } while (again);
    } catch (e) {
      console.warn('[notifications] reschedule failed', e);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function rescheduleOnce() {
  if (!(await notificationsGranted())) return;
  const s = useData.getState();
  const t = getT(s.settings.language);
  const plan = buildPlan({
    now: new Date(),
    amals: Object.values(s.amals),
    tasks: Object.values(s.tasks),
    reminders: Object.values(s.reminders),
    medicines: Object.values(s.medicines),
    routines: Object.values(s.routines),
    logs: s.logs,
    settings: s.settings,
    text: {
      ...t.notif,
      prayerName: (p) => t.prayer[p as keyof typeof t.prayer] ?? p,
      meal: (m) => t.meal[m] ?? m,
    },
  });

  const existing = await Notifications.getAllScheduledNotificationsAsync();
  const existingById = new Map(existing.map((e) => [e.identifier, e]));
  const wanted = new Map(plan.map((n) => [n.key, n]));

  const cancels: Promise<void>[] = [];
  for (const e of existing) {
    const w = wanted.get(e.identifier);
    const same = w && e.content.data?.sig === sig(w);
    if (!same) cancels.push(Notifications.cancelScheduledNotificationAsync(e.identifier));
  }
  await Promise.all(cancels);

  for (const n of plan) {
    const e = existingById.get(n.key);
    if (e && e.content.data?.sig === sig(n)) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: n.key,
      content: {
        title: n.title,
        body: n.body,
        data: { ...n.data, sig: sig(n) },
        sound: 'default',
        vibrate: n.channel === 'alarm' ? VIBRATE_ALARM : VIBRATE_SOFT,
        priority: n.channel === 'alarm' ? Notifications.AndroidNotificationPriority.MAX : Notifications.AndroidNotificationPriority.HIGH,
        interruptionLevel: n.channel === 'alarm' ? 'timeSensitive' : 'active',
        color: '#0F6B4F',
      },
      trigger: toTrigger(n),
    });
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** Watch the store and reschedule (debounced) whenever data changes. */
export function startScheduler(): () => void {
  let lastRev = useData.getState().rev;
  const unsub = useData.subscribe((s) => {
    if (s.rev === lastRev) return;
    lastRev = s.rev;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void reschedule(), 1500);
  });
  void setupChannels().then(reschedule);
  return () => {
    unsub();
    if (timer) clearTimeout(timer);
  };
}
