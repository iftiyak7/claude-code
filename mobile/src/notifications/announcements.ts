/**
 * Notifications sent from the admin panel.
 *
 *  1. Polling (always works, no push setup): on app open/foreground and from
 *     a background task, fetch new announcements and show each once as a
 *     local notification on the vibrating "announcement" channel.
 *  2. Instant push (once the build has an Expo project id + FCM key): the
 *     device registers its Expo push token; then the server pushes directly
 *     and polling only fills the in-app inbox (no duplicates).
 */
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { storage } from '@/db/storage';
import { API_URL } from '@/sync/api';

export interface Announcement {
  id: string;
  title: string;
  body: string;
  url: string;
  createdAt: string;
}

const INBOX = 'ann.inbox';
const SINCE = 'ann.since';
const SEEN = 'ann.seen';
const READ_AT = 'ann.readAt';
const PUSH_OK = 'push.ok';

const read = <T>(k: string, d: T): T => {
  try {
    const v = storage.kvGet(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};

export const useInbox = create<{ items: Announcement[]; readAt: number }>(() => ({
  items: read<Announcement[]>(INBOX, []),
  readAt: Number(storage.kvGet(READ_AT)) || 0,
}));

export function markInboxRead() {
  const now = Date.now();
  storage.kvSet(READ_AT, String(now));
  useInbox.setState({ readAt: now });
}

export const unreadCount = (s: { items: Announcement[]; readAt: number }) =>
  s.items.filter((a) => new Date(a.createdAt).getTime() > s.readAt).length;

let running: Promise<number> | null = null;

/** Fetch new announcements; show unseen ones as notifications. Returns how many were new. */
export function checkAnnouncements(): Promise<number> {
  if (running) return running;
  running = (async () => {
    // first ever check: only announcements from now on (no flood of old ones)
    let since = storage.kvGet(SINCE);
    if (!since) {
      since = new Date(Date.now() - 60_000).toISOString();
      storage.kvSet(SINCE, since);
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(`${API_URL}/v1/announcements?after=${encodeURIComponent(since)}`, { signal: ctrl.signal });
      if (!res.ok) return 0;
      const { announcements = [] } = (await res.json()) as { announcements?: Announcement[] };
      const seen = new Set(read<string[]>(SEEN, []));
      const fresh = announcements.filter((a) => a?.id && !seen.has(a.id));
      if (fresh.length === 0) return 0;

      const pushActive = storage.kvGet(PUSH_OK) === '1';
      if (Platform.OS !== 'web' && !pushActive) {
        const perm = await Notifications.getPermissionsAsync();
        if (perm.granted) {
          for (const a of fresh.slice(0, 3).reverse()) {
            await Notifications.scheduleNotificationAsync({
              identifier: `ann:${a.id}`,
              content: {
                title: a.title,
                body: a.body,
                sound: 'default',
                vibrate: [0, 300, 200, 300],
                data: { route: a.url.startsWith('/') ? a.url : '/inbox', announcementId: a.id },
                color: '#F2703F',
              },
              trigger: Platform.OS === 'android' ? { channelId: 'announcement' } : null,
            });
          }
        }
      }

      const inbox = [...fresh, ...useInbox.getState().items.filter((x) => !fresh.some((f) => f.id === x.id))].slice(0, 50);
      storage.kvSet(INBOX, JSON.stringify(inbox));
      storage.kvSet(SEEN, JSON.stringify([...seen, ...fresh.map((a) => a.id)].slice(-300)));
      const newest = fresh.reduce((m, a) => (a.createdAt > m ? a.createdAt : m), since);
      storage.kvSet(SINCE, newest);
      useInbox.setState({ items: inbox });
      return fresh.length;
    } catch {
      return 0;
    } finally {
      clearTimeout(timer);
      running = null;
    }
  })();
  return running;
}

/** Register for instant push when this build supports it (needs an EAS project id). */
export async function registerForPush(): Promise<void> {
  if (Platform.OS === 'web') return;
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  if (!projectId) return; // push not configured yet → polling covers it
  try {
    if (!(await Notifications.getPermissionsAsync()).granted) return;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const res = await fetch(`${API_URL}/v1/push/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, platform: Platform.OS }),
    });
    if (res.ok) storage.kvSet(PUSH_OK, '1');
  } catch {
    /* no FCM credentials / offline — keep polling */
  }
}
