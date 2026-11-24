import { diffDays, parseISODate, weekday } from './dates';
import type { ISODate, Recurrence } from './types';

/** Does a recurring item occur on `date`? */
export function occursOn(r: Recurrence, date: ISODate): boolean {
  switch (r.type) {
    case 'daily':
      return true;
    case 'weekly':
      return r.days.length === 0 || r.days.includes(weekday(date));
    case 'once':
      return r.date === date;
    case 'everyNDays': {
      const d = diffDays(r.start, date);
      return d >= 0 && d % Math.max(1, r.every) === 0;
    }
    case 'monthly': {
      const d = parseISODate(date);
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      // a "31st" rule falls on the last day of shorter months
      return d.getDate() === Math.min(r.day, lastDay);
    }
  }
}

export function inRange(date: ISODate, start?: ISODate, end?: ISODate): boolean {
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}
