/**
 * Core data model. Every synced entity is a `Rec` — it carries a stable UUID,
 * a client-side `updatedAt` (ms) used for last-write-wins merging, and a
 * soft-delete flag so deletions propagate through sync.
 */

export type ISODate = string; // 'YYYY-MM-DD' (local calendar date)
export type HM = string; // 'HH:mm' 24h local time

export interface Rec {
  id: string;
  updatedAt: number;
  deleted?: boolean;
}

/** How often something happens. */
export type Recurrence =
  | { type: 'daily' }
  | { type: 'weekly'; days: number[] } // 0 = Sunday … 6 = Saturday
  | { type: 'once'; date: ISODate }
  | { type: 'everyNDays'; every: number; start: ISODate }
  | { type: 'monthly'; day: number }; // day of month 1..31

/** When to nudge the user. */
export interface ReminderRule {
  /** none = no notification, times = at fixed clock times, interval = every N minutes within a window */
  mode: 'none' | 'times' | 'interval';
  times: HM[];
  intervalMinutes: number;
  windowStart: HM;
  windowEnd: HM;
  /** Alarm = exact delivery, alarm sound channel, strong vibration. */
  alarm: boolean;
  /** Stop nagging once today's target is reached. */
  stopWhenDone: boolean;
}

export type PrayerName = 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';

export type AmalKind = 'salah' | 'zikr' | 'quran' | 'sadaqah' | 'fasting' | 'dua' | 'custom';

export interface Amal extends Rec {
  kind: AmalKind;
  title: string;
  arabic?: string;
  meaning?: string;
  /** Daily target count (e.g. 200 for zikr, 1 for a salah). */
  target: number;
  unit?: string;
  recurrence: Recurrence;
  reminder: ReminderRule;
  /** Linked fard prayer — reminder follows the computed prayer time. */
  prayer?: PrayerName;
  /** Minutes after prayer start time to remind (salah only). */
  prayerOffset?: number;
  points: number;
  color: string;
  icon: string;
  order: number;
  archived?: boolean;
  /** Optional date range for time-bound amal (e.g. Ramadan). */
  startDate?: ISODate;
  endDate?: ISODate;
}

export interface Task extends Rec {
  title: string;
  note?: string;
  date?: ISODate;
  time?: HM;
  priority: 1 | 2 | 3;
  done: boolean;
  doneAt?: number;
  remind: boolean;
  alarm: boolean;
  tag?: string;
}

/** Universal reminder: anything, any schedule. */
export interface Reminder extends Rec {
  title: string;
  note?: string;
  recurrence: Recurrence;
  times: HM[];
  alarm: boolean;
  enabled: boolean;
  icon: string;
  color: string;
}

export interface Medicine extends Rec {
  name: string;
  dose: string;
  /** e.g. 'before' | 'after' meal */
  meal: 'before' | 'after' | 'with' | 'any';
  times: HM[];
  recurrence: Recurrence;
  startDate: ISODate;
  endDate?: ISODate;
  alarm: boolean;
  enabled: boolean;
  stock?: number;
  color: string;
}

export interface RoutineBlock extends Rec {
  title: string;
  start: HM;
  end: HM;
  days: number[]; // weekdays it applies to; empty = every day
  color: string;
  icon: string;
  remind: boolean;
}

export type LogRef = 'amal' | 'medicine' | 'water' | 'routine';

/**
 * A day's progress for one item. The id is deterministic
 * (`date|ref|refId|slot`) so the same day+item converges across devices.
 */
export interface Log extends Rec {
  date: ISODate;
  ref: LogRef;
  refId: string;
  slot?: string; // medicine time slot 'HH:mm'
  count: number;
}

export interface Settings {
  language: 'bn' | 'en';
  theme: 'system' | 'light' | 'dark';
  name: string;
  waterGoalMl: number;
  glassMl: number;
  waterReminder: ReminderRule;
  location?: { lat: number; lng: number; label?: string };
  calcMethod: 'Karachi' | 'MuslimWorldLeague' | 'UmmAlQura' | 'Egyptian' | 'NorthAmerica' | 'Dubai' | 'Qatar' | 'Singapore' | 'Turkey';
  madhab: 'hanafi' | 'shafi';
  appLock: boolean;
  haptics: boolean;
  onboarded: boolean;
  zikrSound: boolean;
  /** One switch that silences every notification, alarm and vibration. */
  muteAll: boolean;
  quran: QuranPrefs;
}

export type MushafId = 'hafs' | 'indopak' | 'tajweed' | 'warsh' | 'qaloon';
export type TranslationId = 'zakaria' | 'muhiuddin' | 'none';

export interface QuranPrefs {
  mushaf: MushafId;
  translation: TranslationId;
  fontSize: number;
  lastRead?: { surah: number; ayah: number; page?: number; at: number };
  bookmarks: string[]; // "surah:ayah"
}

export type CollectionName = 'amals' | 'tasks' | 'reminders' | 'medicines' | 'routines' | 'logs';

export interface Collections {
  amals: Amal;
  tasks: Task;
  reminders: Reminder;
  medicines: Medicine;
  routines: RoutineBlock;
  logs: Log;
}

export const COLLECTIONS: CollectionName[] = ['amals', 'tasks', 'reminders', 'medicines', 'routines', 'logs'];
