import { CalculationMethod, Coordinates, Madhab, PrayerTimes, Qibla, SunnahTimes } from 'adhan';
import { parseISODate } from './dates';
import type { ISODate, PrayerName, Settings } from './types';

/** Dhaka — used until the user grants location or picks a city. */
export const DEFAULT_LOCATION = { lat: 23.8103, lng: 90.4125, label: 'Dhaka' };

export const PRAYERS: PrayerName[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

export interface DayPrayerTimes {
  fajr: Date;
  sunrise: Date;
  dhuhr: Date;
  asr: Date;
  maghrib: Date;
  isha: Date;
  lastThird: Date;
}

const cache = new Map<string, DayPrayerTimes>();

/** Fully offline astronomical calculation — no network needed. */
export function prayerTimesFor(date: ISODate, s: Pick<Settings, 'location' | 'calcMethod' | 'madhab'>): DayPrayerTimes {
  const loc = s.location ?? DEFAULT_LOCATION;
  const key = `${date}|${loc.lat.toFixed(3)}|${loc.lng.toFixed(3)}|${s.calcMethod}|${s.madhab}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const coords = new Coordinates(loc.lat, loc.lng);
  const params = (CalculationMethod[s.calcMethod] ?? CalculationMethod.Karachi)();
  params.madhab = s.madhab === 'hanafi' ? Madhab.Hanafi : Madhab.Shafi;
  const d = parseISODate(date);
  d.setHours(12); // noon avoids DST edge cases in the library
  const pt = new PrayerTimes(coords, d, params);
  const sunnah = new SunnahTimes(pt);
  const out: DayPrayerTimes = {
    fajr: pt.fajr,
    sunrise: pt.sunrise,
    dhuhr: pt.dhuhr,
    asr: pt.asr,
    maghrib: pt.maghrib,
    isha: pt.isha,
    lastThird: sunnah.lastThirdOfTheNight,
  };
  if (cache.size > 64) cache.clear();
  cache.set(key, out);
  return out;
}

/** Next upcoming fard prayer after `now` (rolls over to tomorrow's Fajr). */
export function nextPrayer(
  todayTimes: DayPrayerTimes,
  tomorrowFajr: Date,
  now = new Date(),
): { name: PrayerName; time: Date } {
  for (const p of PRAYERS) {
    if (todayTimes[p] > now) return { name: p, time: todayTimes[p] };
  }
  return { name: 'fajr', time: tomorrowFajr };
}

/** The prayer whose time window we are currently in, if any. */
export function currentPrayer(t: DayPrayerTimes, now = new Date()): PrayerName | null {
  if (now < t.fajr) return null;
  if (now < t.sunrise) return 'fajr';
  if (now < t.dhuhr) return null;
  if (now < t.asr) return 'dhuhr';
  if (now < t.maghrib) return 'asr';
  if (now < t.isha) return 'maghrib';
  return 'isha';
}

export function qiblaDirection(s: Pick<Settings, 'location'>): number {
  const loc = s.location ?? DEFAULT_LOCATION;
  return Qibla(new Coordinates(loc.lat, loc.lng));
}
