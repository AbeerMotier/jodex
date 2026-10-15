/** أوقات الرياض للاختبارات (UTC+3 ثابت بلا توقيت صيفي) */
import { addDays, weekdayOfDate } from '../../lib/domain/time';

/** لحظة زمنية لتاريخ ووقت بتوقيت الرياض، مثل at('2040-01-02', '09:30') */
export function at(date: string, hhmm: string, seconds = 0): string {
  const [h, m] = hhmm.split(':').map(Number);
  const ms = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), h - 3, m, seconds);
  return new Date(ms).toISOString();
}

/** أول تاريخ ابتداءً من start يحقق الشرط على يوم الأسبوع (0=الأحد) */
export function nextDate(start: string, predicate: (weekday: number) => boolean): string {
  let d = start;
  for (let i = 0; i < 14; i++, d = addDays(d, 1)) if (predicate(weekdayOfDate(d))) return d;
  throw new Error('no date');
}

export { addDays, weekdayOfDate };
