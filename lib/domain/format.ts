/** تنسيق التواريخ والأرقام للعرض (بتوقيت الرياض، أرقام لاتينية، ساعة 24) */
import { riyadhDate, riyadhParts, weekdayOfDate } from './time';

export const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
export const WEEKDAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

const pad = (n: number) => String(n).padStart(2, '0');

/** «الأربعاء 14 أكتوبر» من تاريخ YYYY-MM-DD */
export function dayLabel(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${WEEKDAYS_AR[weekdayOfDate(date)]} ${d} ${MONTHS_AR[m - 1]}`;
}

/** «الأربعاء 14 أكتوبر 2026» */
export function fullDayLabel(date: string): string {
  return `${dayLabel(date)} ${date.slice(0, 4)}`;
}

/** «14/10/2026» */
export function shortDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

export function instantDate(iso: string | Date): string {
  return riyadhDate(typeof iso === 'string' ? new Date(iso) : iso);
}

/** «HH:MM» بتوقيت الرياض */
export function timeHM(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const p = riyadhParts(typeof iso === 'string' ? new Date(iso) : iso);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function instantDayLabel(iso: string | Date): string {
  return dayLabel(instantDate(iso));
}

/** نسبة مئوية للعرض: «—» عند عدم توفر بيانات، عدد صحيح إن أمكن وإلا خانة عشرية واحدة */
export function fmtPct(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const rounded = digits === 0 ? Math.round(value) : Math.round(value * 10 ** digits) / 10 ** digits;
  return `${rounded}%`;
}

export function fmtNum(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const p = 10 ** digits;
  const r = Math.round(value * p) / p;
  return Number.isInteger(r) ? String(r) : r.toFixed(digits);
}

/** لون حلقة/شريط النتيجة: ≥90 أخضر، ≥75 أصفر، أقل برتقالي، بلا بيانات رمادي */
export function scoreColor(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '#D3DED8';
  if (value >= 90) return '#55957A';
  if (value >= 75) return '#E3C068';
  return '#E37452';
}

export function initial(name: string): string {
  return name.trim().charAt(0) || '؟';
}

/**
 * اسم دورة المياه المعروض في كل الموقع: «دورة مياه» بلا رقم ولا «رجال/نساء» (طلب الجهة)،
 * والتمييز بينها بالترميز. الاسم المخزّن يبقى كما هو ويظهر فقط في صفحة إدارة دورات المياه.
 */
export function restroomLabel(name: string | null | undefined): string {
  if (!name) return 'دورة مياه';
  const short = name
    .replace(/\s*رقم\s*[0-9٠-٩]+/g, '')
    .replace(/\s*(رجال|نساء|للرجال|للنساء)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return /^دورة\s+مياه/.test(short) || !short ? 'دورة مياه' : short;
}
