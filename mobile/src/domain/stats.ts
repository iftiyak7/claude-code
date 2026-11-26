/**
 * Long-range statistics for the profile: is the user's amal rising or
 * falling? Everything is derived from the same day logs as the points, on
 * the device; nothing leaves the phone.
 */
import { addDays, lastNDays } from './dates';
import { amalDueOn, countFor, dayStats, type DayStats, type LogIndex } from './progress';
import type { Amal, ISODate, Medicine, PrayerName, Task } from './types';

export interface StatsInput {
  amals: Amal[];
  meds: Medicine[];
  tasks: Task[];
  logs: LogIndex;
  waterGoalMl: number;
}

export type Trend = 'up' | 'down' | 'same';

export interface Period {
  points: number;
  due: number;
  done: number;
  rate: number; // 0..1 completion rate
}

export interface AmalTrend {
  amal: Amal;
  thisWeek: number; // days completed in the last 7 days
  lastWeek: number; // days completed in the 7 days before
  due: number; // days it was due in the last 7 days
  trend: Trend;
  /** last 14 days, oldest first: true = completed, false = missed, null = not due */
  dots: (boolean | null)[];
}

export interface Stats {
  days: DayStats[];
  thisWeek: Period;
  lastWeek: Period;
  /** relative change of points this week vs last week, in % (null when last week had none) */
  pointsChange: number | null;
  trend: Trend;
  salah: { prayer: PrayerName; rate: number; done: number; due: number }[];
  perAmal: AmalTrend[];
  best: DayStats | null;
  activeDays: number;
  longestStreak: number;
  currentStreak: number;
  avgPoints: number;
}

function period(days: DayStats[]): Period {
  const points = days.reduce((s, d) => s + d.points, 0);
  const due = days.reduce((s, d) => s + d.due, 0);
  const done = days.reduce((s, d) => s + d.done, 0);
  return { points, due, done, rate: due ? done / due : 0 };
}

const trendOf = (now: number, before: number, tolerance = 0.05): Trend => {
  if (now === before) return 'same';
  const base = Math.max(Math.abs(before), 1);
  if (Math.abs(now - before) / base < tolerance) return 'same';
  return now > before ? 'up' : 'down';
};

export function computeStats(input: StatsInput, end: ISODate, range: number): Stats {
  const { amals, meds, tasks, logs, waterGoalMl } = input;
  const stat = (d: ISODate) => dayStats(d, amals, meds, tasks, logs, waterGoalMl);
  const span = Math.max(range, 14);
  const all = lastNDays(span, end).map(stat); // oldest first
  const days = all.slice(-range);
  const thisWeek = period(all.slice(-7));
  const lastWeek = period(all.slice(-14, -7));
  const pointsChange = lastWeek.points > 0 ? Math.round(((thisWeek.points - lastWeek.points) / lastWeek.points) * 100) : null;
  const trend = thisWeek.points === 0 && lastWeek.points === 0 ? 'same' : trendOf(thisWeek.points, lastWeek.points);

  // regularity of each fard prayer over the selected range
  const salah = (['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as PrayerName[]).map((prayer) => {
    const a = amals.find((x) => x.kind === 'salah' && x.prayer === prayer && !x.deleted);
    let due = 0;
    let done = 0;
    if (a) {
      for (const d of days) {
        if (!amalDueOn(a, d.date)) continue;
        due++;
        if (countFor(logs, d.date, 'amal', a.id) >= a.target) done++;
      }
    }
    return { prayer, rate: due ? done / due : 0, done, due };
  });

  const last14 = lastNDays(14, end);
  const perAmal: AmalTrend[] = amals
    .filter((a) => !a.deleted && !a.archived)
    .map((a) => {
      const dots = last14.map((d) => (amalDueOn(a, d) ? countFor(logs, d, 'amal', a.id) >= a.target : null));
      const thisW = dots.slice(7).filter((x) => x === true).length;
      const lastW = dots.slice(0, 7).filter((x) => x === true).length;
      const due = dots.slice(7).filter((x) => x !== null).length;
      return { amal: a, thisWeek: thisW, lastWeek: lastW, due, trend: trendOf(thisW, lastW, 0.01), dots };
    })
    .filter((x) => x.due > 0 || x.lastWeek > 0)
    .sort((x, y) => x.amal.order - y.amal.order);

  let best: DayStats | null = null;
  let activeDays = 0;
  let run = 0;
  let longestStreak = 0;
  for (const d of days) {
    if (d.points > 0) {
      activeDays++;
      run++;
      longestStreak = Math.max(longestStreak, run);
      if (!best || d.points > best.points) best = d;
    } else run = 0;
  }
  // current streak: consecutive active days ending today (or yesterday if today is still empty)
  let currentStreak = 0;
  let cursor = stat(end).points > 0 ? end : addDays(end, -1);
  while (currentStreak < 3650 && stat(cursor).points > 0) {
    currentStreak++;
    cursor = addDays(cursor, -1);
  }
  longestStreak = Math.max(longestStreak, currentStreak);
  const avgPoints = days.length ? Math.round(days.reduce((s, d) => s + d.points, 0) / days.length) : 0;

  return { days, thisWeek, lastWeek, pointsChange, trend, salah, perAmal, best, activeDays, longestStreak, currentStreak, avgPoints };
}
