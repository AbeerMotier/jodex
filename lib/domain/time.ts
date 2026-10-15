/**
 * أدوات الوقت بتوقيت الرياض (Asia/Riyadh).
 * كل القواعد الزمنية تُحسب من وقت الخادم ثم تُحوَّل لتوقيت الرياض هنا،
 * ولا يُعتمد على المنطقة الزمنية لجهاز المستخدم أو للخادم نفسه.
 */
export const TIME_ZONE = 'Asia/Riyadh';

export interface RiyadhParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = الأحد … 6 = السبت */
  weekday: number;
}

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
});

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function riyadhParts(date: Date): RiyadhParts {
  const parts: Record<string, string> = {};
  for (const p of partsFormatter.formatToParts(date)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday] ?? 0,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** التاريخ بصيغة YYYY-MM-DD بتوقيت الرياض */
export function riyadhDate(date: Date): string {
  const p = riyadhParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** الدقيقة من منتصف الليل بتوقيت الرياض (0-1439) — دقة القواعد الزمنية هي الدقيقة */
export function riyadhMinuteOfDay(date: Date): number {
  const p = riyadhParts(date);
  return p.hour * 60 + p.minute;
}

export function riyadhWeekday(date: Date): number {
  return riyadhParts(date).weekday;
}

/** يحوّل تاريخًا ودقيقةً بتوقيت الرياض إلى لحظة زمنية مطلقة */
export function riyadhToInstant(date: string, minuteOfDay = 0): Date {
  const [y, m, d] = date.split('-').map(Number);
  // الرياض UTC+3 بلا توقيت صيفي؛ نتحقق ونصحّح احتياطًا عبر Intl
  let guess = Date.UTC(y, m - 1, d, 0, minuteOfDay) - 3 * 60 * 60 * 1000;
  for (let i = 0; i < 2; i++) {
    const p = riyadhParts(new Date(guess));
    const actual = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const wanted = Date.UTC(y, m - 1, d, 0, minuteOfDay);
    const diff = wanted - actual;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function weekdayOfDate(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function minutesToHHMM(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export type Period = 'today' | 'week' | 'month';
export const PERIODS: Period[] = ['today', 'week', 'month'];

export interface DateRange {
  from: string; // شامل
  to: string; // شامل
  /** بداية الفترة كلحظة مطلقة (منتصف ليل الرياض) */
  fromInstant: Date;
  /** نهاية الفترة (منتصف ليل اليوم التالي، غير شامل) */
  toInstantExclusive: Date;
}

/** اليوم = اليوم الحالي، أسبوع = آخر 7 أيام شاملة اليوم، شهر = آخر 30 يومًا شاملة اليوم */
export function periodRange(period: Period, today: string): DateRange {
  const days = period === 'today' ? 1 : period === 'week' ? 7 : 30;
  const from = addDays(today, -(days - 1));
  return {
    from,
    to: today,
    fromInstant: riyadhToInstant(from, 0),
    toInstantExclusive: riyadhToInstant(addDays(today, 1), 0),
  };
}

export function isPeriod(value: unknown): value is Period {
  return value === 'today' || value === 'week' || value === 'month';
}
