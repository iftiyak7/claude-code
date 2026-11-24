import { addDays, today as todayFn } from './dates';
import { inRange, occursOn } from './recurrence';
import type { Amal, ISODate, Log, LogRef, Medicine, Task } from './types';

export const logId = (date: ISODate, ref: LogRef, refId: string, slot?: string) =>
  `${date}|${ref}|${refId}${slot ? `|${slot}` : ''}`;

/** Logs keyed by their deterministic id. */
export type LogIndex = Record<string, Log>;

export function countFor(idx: LogIndex, date: ISODate, ref: LogRef, refId: string, slot?: string): number {
  const l = idx[logId(date, ref, refId, slot)];
  return l && !l.deleted ? l.count : 0;
}

export function amalDueOn(a: Amal, date: ISODate): boolean {
  return !a.deleted && !a.archived && inRange(date, a.startDate, a.endDate) && occursOn(a.recurrence, date);
}

export function medicineDueOn(m: Medicine, date: ISODate): boolean {
  return !m.deleted && m.enabled && inRange(date, m.startDate, m.endDate) && occursOn(m.recurrence, date);
}

/** Points earned for one amal on one day. Count-based amal earn proportionally. */
export function amalPoints(a: Amal, count: number): number {
  if (count <= 0) return 0;
  const ratio = Math.min(1, count / Math.max(1, a.target));
  return a.target <= 1 ? (ratio >= 1 ? a.points : 0) : Math.floor(a.points * ratio);
}

export const POINTS = {
  medicineDose: 1,
  waterGoal: 5,
  task: 2,
};

export interface DayStats {
  date: ISODate;
  due: number;
  done: number;
  points: number;
  salahDone: number;
  salahDue: number;
}

export function dayStats(
  date: ISODate,
  amals: Amal[],
  meds: Medicine[],
  tasks: Task[],
  idx: LogIndex,
  waterGoalMl: number,
): DayStats {
  let due = 0;
  let done = 0;
  let points = 0;
  let salahDone = 0;
  let salahDue = 0;
  for (const a of amals) {
    if (!amalDueOn(a, date)) continue;
    const c = countFor(idx, date, 'amal', a.id);
    due++;
    const complete = c >= a.target;
    if (complete) done++;
    if (a.kind === 'salah') {
      salahDue++;
      if (complete) salahDone++;
    }
    points += amalPoints(a, c);
  }
  for (const m of meds) {
    if (!medicineDueOn(m, date)) continue;
    for (const t of m.times) if (countFor(idx, date, 'medicine', m.id, t) > 0) points += POINTS.medicineDose;
  }
  if (countFor(idx, date, 'water', 'water') >= waterGoalMl) points += POINTS.waterGoal;
  for (const t of tasks) {
    if (!t.deleted && t.done && t.doneAt && isoOf(t.doneAt) === date) points += POINTS.task;
  }
  return { date, due, done, points, salahDone, salahDue };
}

function isoOf(ms: number): ISODate {
  const d = new Date(ms);
  const p = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Total points across every day that has any log or completed task. */
export function totalPoints(
  amals: Amal[],
  meds: Medicine[],
  tasks: Task[],
  idx: LogIndex,
  waterGoalMl: number,
): number {
  const days = new Set<ISODate>();
  for (const l of Object.values(idx)) if (!l.deleted && l.count > 0) days.add(l.date);
  for (const t of tasks) if (t.done && t.doneAt && !t.deleted) days.add(isoOf(t.doneAt));
  let sum = 0;
  for (const d of days) sum += dayStats(d, amals, meds, tasks, idx, waterGoalMl).points;
  return sum;
}

/**
 * Consecutive days ending today (or yesterday, if today isn't finished yet)
 * on which `qualifies(date)` holds.
 */
export function streak(qualifies: (d: ISODate) => boolean, end: ISODate = todayFn(), max = 3650): number {
  let d = qualifies(end) ? end : addDays(end, -1);
  let n = 0;
  while (n < max && qualifies(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

export const LEVELS = [
  { min: 0, bn: 'মুবতাদি', en: 'Beginner' },
  { min: 150, bn: 'সালিক', en: 'Seeker' },
  { min: 500, bn: 'মুজতাহিদ', en: 'Striver' },
  { min: 1200, bn: 'মুহসিন', en: 'Excellent' },
  { min: 3000, bn: 'মুত্তাকি', en: 'God-conscious' },
  { min: 7000, bn: 'সাবির', en: 'Steadfast' },
  { min: 15000, bn: 'সিদ্দিক', en: 'Truthful' },
];

export function levelFor(points: number) {
  let i = 0;
  while (i + 1 < LEVELS.length && points >= LEVELS[i + 1].min) i++;
  const cur = LEVELS[i];
  const next = LEVELS[i + 1];
  const progress = next ? (points - cur.min) / (next.min - cur.min) : 1;
  return { index: i, level: cur, next, progress };
}
