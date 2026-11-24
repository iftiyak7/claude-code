import { addDays, at, hmToMinutes, minutesToHM, toISODate } from './dates';
import { prayerTimesFor } from './prayer';
import { amalDueOn, countFor, medicineDueOn, type LogIndex } from './progress';
import { inRange, occursOn } from './recurrence';
import type { Amal, HM, ISODate, Medicine, Reminder, ReminderRule, RoutineBlock, Settings, Task } from './types';

export type Channel = 'reminder' | 'alarm' | 'salah' | 'medicine';

export interface PlannedNotification {
  /** Deterministic identifier — lets us diff against what is already scheduled. */
  key: string;
  title: string;
  body: string;
  channel: Channel;
  /** One-shot at a date, or a repeating daily trigger (survives app not being opened). */
  trigger: { kind: 'date'; at: number } | { kind: 'daily'; hour: number; minute: number };
  data: { route: string; ref?: string; id?: string };
}

export interface PlanInput {
  now: Date;
  amals: Amal[];
  tasks: Task[];
  reminders: Reminder[];
  medicines: Medicine[];
  routines: RoutineBlock[];
  logs: LogIndex;
  settings: Settings;
  /** i18n strings the plan needs (keeps this module pure & testable). */
  text: PlanText;
}

export interface PlanText {
  salahTitle: (prayer: string) => string;
  salahBody: string;
  zikrBody: (done: number, target: number, unit: string) => string;
  amalBody: string;
  medicineTitle: (name: string) => string;
  medicineBody: (dose: string, meal: string) => string;
  waterTitle: string;
  waterBody: (done: number, goal: number) => string;
  taskTitle: string;
  routineTitle: (title: string) => string;
  prayerName: (p: string) => string;
  meal: (m: string) => string;
}

/** iOS keeps at most 64 pending local notifications; stay below that. */
export const MAX_PENDING = 60;
/** One-shot notifications are planned this many days ahead and refreshed on every app open / data change. */
export const HORIZON_DAYS = 3;
/** Dated tasks get scheduled further ahead since they are one-off. */
export const TASK_HORIZON_DAYS = 30;

function intervalSlots(rule: ReminderRule): HM[] {
  const start = hmToMinutes(rule.windowStart);
  let end = hmToMinutes(rule.windowEnd);
  if (end <= start) end += 1440;
  const step = Math.max(15, rule.intervalMinutes);
  const out: HM[] = [];
  for (let m = start; m <= end && out.length < 96; m += step) out.push(minutesToHM(m));
  return out;
}

function isPlainDaily(r: { type: string }, start?: ISODate, end?: ISODate) {
  return r.type === 'daily' && !end && !start;
}

export function buildPlan(input: PlanInput): PlannedNotification[] {
  const { now, settings: s, logs, text } = input;
  const nowMs = now.getTime();
  const todayIso = toISODate(now);
  const days: ISODate[] = Array.from({ length: HORIZON_DAYS }, (_, i) => addDays(todayIso, i));
  const out: PlannedNotification[] = [];

  const oneShot = (
    key: string,
    date: ISODate,
    hm: HM,
    p: Omit<PlannedNotification, 'key' | 'trigger'>,
  ) => {
    const when = at(date, hm).getTime();
    if (when <= nowMs + 5_000) return;
    out.push({ ...p, key: `${key}@${date}T${hm}`, trigger: { kind: 'date', at: when } });
  };

  const daily = (key: string, hm: HM, p: Omit<PlannedNotification, 'key' | 'trigger'>) => {
    const [hour, minute] = hm.split(':').map(Number);
    out.push({ ...p, key: `${key}@daily${hm}`, trigger: { kind: 'daily', hour, minute } });
  };

  // ── Amal (salah, zikr, custom) ───────────────────────────────────────
  for (const a of input.amals) {
    if (a.deleted || a.archived) continue;
    const channel: Channel = a.reminder.alarm ? 'alarm' : a.kind === 'salah' ? 'salah' : 'reminder';
    const route = a.kind === 'zikr' ? `/zikr/${a.id}` : '/';
    for (const date of days) {
      if (!amalDueOn(a, date)) continue;
      const count = countFor(logs, date, 'amal', a.id);
      if (a.reminder.stopWhenDone && count >= a.target) continue;

      if (a.kind === 'salah' && a.prayer && a.reminder.mode !== 'none') {
        const pt = prayerTimesFor(date, s);
        const t = new Date(pt[a.prayer].getTime() + (a.prayerOffset ?? 0) * 60_000);
        if (t.getTime() > nowMs + 5_000) {
          out.push({
            key: `amal:${a.id}@${date}`,
            title: text.salahTitle(text.prayerName(a.prayer)),
            body: text.salahBody,
            channel,
            trigger: { kind: 'date', at: t.getTime() },
            data: { route, ref: 'amal', id: a.id },
          });
        }
        continue;
      }

      const body =
        a.target > 1
          ? text.zikrBody(count, a.target, a.unit ?? '')
          : text.amalBody;
      const slots =
        a.reminder.mode === 'times' ? a.reminder.times : a.reminder.mode === 'interval' ? intervalSlots(a.reminder) : [];
      for (const hm of slots) {
        oneShot(`amal:${a.id}`, date, hm, {
          title: a.title,
          body,
          channel,
          data: { route, ref: 'amal', id: a.id },
        });
      }
    }
  }

  // ── Medicine ──────────────────────────────────────────────────────────
  for (const m of input.medicines) {
    if (m.deleted || !m.enabled) continue;
    const channel: Channel = m.alarm ? 'alarm' : 'medicine';
    const content = {
      title: text.medicineTitle(m.name),
      body: text.medicineBody(m.dose, text.meal(m.meal)),
      channel,
      data: { route: '/health', ref: 'medicine', id: m.id },
    };
    if (isPlainDaily(m.recurrence, undefined, m.endDate) && m.startDate <= todayIso) {
      for (const hm of m.times) daily(`med:${m.id}`, hm, content);
      continue;
    }
    for (const date of days) {
      if (!medicineDueOn(m, date)) continue;
      for (const hm of m.times) {
        if (countFor(logs, date, 'medicine', m.id, hm) > 0) continue; // already taken
        oneShot(`med:${m.id}`, date, hm, content);
      }
    }
  }

  // ── Water ─────────────────────────────────────────────────────────────
  if (s.waterReminder.mode !== 'none') {
    const slots = s.waterReminder.mode === 'times' ? s.waterReminder.times : intervalSlots(s.waterReminder);
    for (const date of days) {
      const ml = countFor(logs, date, 'water', 'water');
      if (s.waterReminder.stopWhenDone && ml >= s.waterGoalMl) continue;
      for (const hm of slots) {
        oneShot('water', date, hm, {
          title: text.waterTitle,
          body: text.waterBody(ml, s.waterGoalMl),
          channel: s.waterReminder.alarm ? 'alarm' : 'reminder',
          data: { route: '/health', ref: 'water' },
        });
      }
    }
  }

  // ── Universal reminders ───────────────────────────────────────────────
  for (const r of input.reminders) {
    if (r.deleted || !r.enabled) continue;
    const content = {
      title: r.title,
      body: r.note ?? '',
      channel: (r.alarm ? 'alarm' : 'reminder') as Channel,
      data: { route: '/plan', ref: 'reminder', id: r.id },
    };
    if (r.recurrence.type === 'daily') {
      for (const hm of r.times) daily(`rem:${r.id}`, hm, content);
      continue;
    }
    if (r.recurrence.type === 'once') {
      // one-off reminders may be far ahead; schedule directly
      for (const hm of r.times) oneShot(`rem:${r.id}`, r.recurrence.date, hm, content);
      continue;
    }
    for (const date of days) {
      if (!occursOn(r.recurrence, date)) continue;
      for (const hm of r.times) oneShot(`rem:${r.id}`, date, hm, content);
    }
  }

  // ── Routine blocks ────────────────────────────────────────────────────
  for (const b of input.routines) {
    if (b.deleted || !b.remind) continue;
    const content = {
      title: text.routineTitle(b.title),
      body: `${b.start} – ${b.end}`,
      channel: 'reminder' as Channel,
      data: { route: '/plan', ref: 'routine', id: b.id },
    };
    if (b.days.length === 0 || b.days.length === 7) {
      daily(`rt:${b.id}`, b.start, content);
      continue;
    }
    for (const date of days) {
      if (!occursOn({ type: 'weekly', days: b.days }, date)) continue;
      oneShot(`rt:${b.id}`, date, b.start, content);
    }
  }

  // ── Tasks ─────────────────────────────────────────────────────────────
  const taskLimit = addDays(todayIso, TASK_HORIZON_DAYS);
  for (const t of input.tasks) {
    if (t.deleted || t.done || !t.remind || !t.date || !t.time) continue;
    if (!inRange(t.date, undefined, taskLimit)) continue;
    oneShot(`task:${t.id}`, t.date, t.time, {
      title: text.taskTitle,
      body: t.title,
      channel: t.alarm ? 'alarm' : 'reminder',
      data: { route: '/plan', ref: 'task', id: t.id },
    });
  }

  return prioritise(out);
}

/** Repeating dailies first (they cost one slot forever), then soonest one-shots. */
function prioritise(list: PlannedNotification[]): PlannedNotification[] {
  const seen = new Set<string>();
  const uniq = list.filter((n) => (seen.has(n.key) ? false : (seen.add(n.key), true)));
  const dailies = uniq.filter((n) => n.trigger.kind === 'daily');
  const shots = uniq
    .filter((n) => n.trigger.kind === 'date')
    .sort((a, b) => (a.trigger as { at: number }).at - (b.trigger as { at: number }).at);
  return [...dailies, ...shots].slice(0, MAX_PENDING);
}
