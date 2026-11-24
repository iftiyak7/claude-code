import { useEffect, useMemo, useState } from 'react';
import { addDays, toISODate } from '@/domain/dates';
import { prayerTimesFor } from '@/domain/prayer';
import { useData } from '@/store/data';

/** Re-render every `ms` (for countdowns / day rollover). */
export function useNow(ms = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Today's ISO date, updating at midnight. */
export function useToday(): string {
  // a string, so consumers only re-render when the calendar date actually changes
  return toISODate(useNow(60_000));
}

export function usePrayerTimes(date: string) {
  const location = useData((s) => s.settings.location);
  const calcMethod = useData((s) => s.settings.calcMethod);
  const madhab = useData((s) => s.settings.madhab);
  return useMemo(() => {
    const s = { location, calcMethod, madhab };
    return { today: prayerTimesFor(date, s), tomorrow: prayerTimesFor(addDays(date, 1), s) };
  }, [date, location, calcMethod, madhab]);
}

export function useLogCount(ref: 'amal' | 'medicine' | 'water' | 'routine', refId: string, date: string, slot?: string) {
  const id = `${date}|${ref}|${refId}${slot ? `|${slot}` : ''}`;
  return useData((s) => {
    const l = s.logs[id];
    return l && !l.deleted ? l.count : 0;
  });
}

export function formatCountdown(ms: number, lang: 'bn' | 'en'): string {
  const total = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (lang === 'bn') return h > 0 ? `${h} ঘণ্টা ${m} মিনিট` : `${m} মিনিট`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function formatClock(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m < 10 ? '0' : ''}${m} ${h < 12 ? 'AM' : 'PM'}`;
}

export function hijriDate(d: Date, lang: 'bn' | 'en'): string | null {
  try {
    return new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD-u-ca-islamic-umalqura' : 'en-u-ca-islamic-umalqura', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
      .format(d)
      .replace(/\s*(যুগ|AH|এএইচ)$/u, lang === 'bn' ? ' হিজরি' : ' AH');
  } catch {
    return null;
  }
}

export function gregorianDate(d: Date, lang: 'bn' | 'en'): string {
  try {
    return new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
  } catch {
    return d.toDateString();
  }
}
