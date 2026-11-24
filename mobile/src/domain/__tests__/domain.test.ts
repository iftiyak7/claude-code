import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDays, diffDays, isValidHM, isValidISODate } from '../dates';
import { DEFAULT_SETTINGS, noReminder, seedAmals } from '../defaults';
import { buildPlan, MAX_PENDING, type PlanText } from '../notifyPlan';
import { prayerTimesFor } from '../prayer';
import { amalPoints, dayStats, levelFor, logId, streak } from '../progress';
import { occursOn } from '../recurrence';
import type { Amal, Log } from '../types';

const text: PlanText = {
  salahTitle: (p) => `salah ${p}`,
  salahBody: 'b',
  zikrBody: (d, t) => `${d}/${t}`,
  amalBody: 'a',
  medicineTitle: (n) => n,
  medicineBody: (d) => d,
  waterTitle: 'w',
  waterBody: () => 'w',
  taskTitle: 't',
  routineTitle: (t) => t,
  prayerName: (p) => p,
  meal: (m) => m,
};

test('dates', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(diffDays('2026-01-01', '2026-12-31'), 364);
  assert.ok(isValidHM('23:59') && !isValidHM('24:00'));
  assert.ok(isValidISODate('2026-11-24') && !isValidISODate('2026-02-30'));
});

test('recurrence', () => {
  assert.ok(occursOn({ type: 'daily' }, '2026-11-24'));
  // 2026-11-27 is a Friday (5)
  assert.ok(occursOn({ type: 'weekly', days: [5] }, '2026-11-27'));
  assert.ok(!occursOn({ type: 'weekly', days: [5] }, '2026-11-26'));
  assert.ok(occursOn({ type: 'everyNDays', every: 3, start: '2026-11-01' }, '2026-11-07'));
  assert.ok(!occursOn({ type: 'everyNDays', every: 3, start: '2026-11-01' }, '2026-11-08'));
  assert.ok(!occursOn({ type: 'everyNDays', every: 3, start: '2026-11-10' }, '2026-11-07'));
  assert.ok(occursOn({ type: 'monthly', day: 31 }, '2026-02-28'), '31st falls back to last day');
  assert.ok(occursOn({ type: 'once', date: '2026-12-01' }, '2026-12-01'));
});

const zikr = (over: Partial<Amal> = {}): Amal => ({
  id: 'z',
  updatedAt: 1,
  kind: 'zikr',
  title: 'Zikr',
  target: 200,
  recurrence: { type: 'daily' },
  reminder: { ...noReminder(), mode: 'interval', intervalMinutes: 60, windowStart: '08:00', windowEnd: '22:00' },
  points: 20,
  color: '#000',
  icon: 'leaf',
  order: 0,
  ...over,
});

const log = (date: string, refId: string, count: number): Log => ({ id: logId(date, 'amal', refId), updatedAt: 1, date, ref: 'amal', refId, count });

test('points are proportional for counted amal and all-or-nothing for single', () => {
  assert.equal(amalPoints(zikr(), 100), 10);
  assert.equal(amalPoints(zikr(), 500), 20);
  assert.equal(amalPoints(zikr({ target: 1, points: 10 }), 1), 10);
  assert.equal(amalPoints(zikr({ target: 1, points: 10 }), 0), 0);
  assert.equal(levelFor(0).index, 0);
  assert.equal(levelFor(600).index, 2);
});

test('day stats + streak', () => {
  const amals = seedAmals(1);
  const logs: Record<string, Log> = {};
  for (const d of ['2026-11-22', '2026-11-23', '2026-11-24']) {
    for (const a of amals.filter((x) => x.kind === 'salah')) logs[logId(d, 'amal', a.id)] = log(d, a.id, 1);
  }
  const s = dayStats('2026-11-24', amals, [], [], logs, 2500);
  assert.equal(s.salahDone, 5);
  assert.equal(s.salahDue, 5);
  assert.equal(s.points, 50);
  const q = (d: string) => dayStats(d, amals, [], [], logs, 2500).salahDone === 5;
  assert.equal(streak(q, '2026-11-24'), 3);
  assert.equal(streak(q, '2026-11-25'), 3, 'unfinished today does not break the streak');
});

test('prayer times are computed offline and ordered', () => {
  const p = prayerTimesFor('2026-11-24', DEFAULT_SETTINGS);
  assert.ok(p.fajr < p.sunrise && p.sunrise < p.dhuhr && p.dhuhr < p.asr && p.asr < p.maghrib && p.maghrib < p.isha);
});

test('hourly zikr reminders stop once the daily target is met', () => {
  const now = new Date(2026, 10, 24, 7, 0);
  const base = { now, tasks: [], reminders: [], medicines: [], routines: [], settings: { ...DEFAULT_SETTINGS, waterReminder: noReminder() }, text };
  const plan = buildPlan({ ...base, amals: [zikr()], logs: {} });
  const today = plan.filter((n) => n.key.includes('@2026-11-24'));
  assert.equal(today.length, 15, '08:00..22:00 hourly');
  assert.equal(today[0].body, '0/200');

  const done = buildPlan({ ...base, amals: [zikr()], logs: { [logId('2026-11-24', 'amal', 'z')]: log('2026-11-24', 'z', 200) } });
  assert.equal(done.filter((n) => n.key.includes('@2026-11-24')).length, 0);
  assert.ok(done.some((n) => n.key.includes('@2026-11-25')), 'tomorrow still scheduled');
});

test('plan respects the OS pending-notification cap and prioritises dailies', () => {
  const now = new Date(2026, 10, 24, 0, 0);
  const many = Array.from({ length: 10 }, (_, i) => zikr({ id: `z${i}`, reminder: { ...zikr().reminder, intervalMinutes: 30 } }));
  const plan = buildPlan({
    now,
    amals: many,
    tasks: [],
    reminders: [{ id: 'r', updatedAt: 1, title: 'R', recurrence: { type: 'daily' }, times: ['23:30'], alarm: true, enabled: true, icon: 'x', color: '#000' }],
    medicines: [],
    routines: [],
    logs: {},
    settings: DEFAULT_SETTINGS,
    text,
  });
  assert.equal(plan.length, MAX_PENDING);
  assert.equal(plan[0].trigger.kind, 'daily');
  assert.equal(plan[0].channel, 'alarm');
});

test('salah reminder follows prayer time and skips past prayers', () => {
  const now = new Date(2026, 10, 24, 13, 0);
  const plan = buildPlan({ now, amals: seedAmals(1), tasks: [], reminders: [], medicines: [], routines: [], logs: {}, settings: { ...DEFAULT_SETTINGS, waterReminder: noReminder() }, text });
  const todaySalah = plan.filter((n) => n.key.startsWith('amal:seed-salah') && n.key.endsWith('2026-11-24'));
  assert.deepEqual(todaySalah.map((n) => n.title).sort(), ['salah asr', 'salah isha', 'salah maghrib']);
});
