import { describe, expect, it } from 'vitest';
import {
  computeCompliance,
  defaultShift,
  pendingState,
  roundBadgeState,
  roundDisplayStatus,
  shiftWindowState,
  windowText,
  worstBadge,
  type RoundLike,
} from '@/lib/domain/schedule';
import { DISPLAY_STATUS } from '@/lib/domain/catalog';

const at = (hh: number, mm: number) => hh * 60 + mm;

describe('نافذة الجولة الصباحية 07:30–10:00 (توقيت الرياض)', () => {
  it('07:29 ← لم تبدأ (رفض البدء والإرسال)', () => {
    expect(shiftWindowState('am', at(7, 29))).toBe('before');
    expect(computeCompliance('am', at(7, 29))).toEqual({ ok: false, reason: 'not_open', start: '07:30' });
  });
  it('07:30 ← مفتوحة وملتزم تمامًا 100', () => {
    expect(shiftWindowState('am', at(7, 30))).toBe('open');
    expect(computeCompliance('am', at(7, 30))).toEqual({ ok: true, level: 'full', score: 100 });
  });
  it('09:30 ← ملتزم تمامًا 100', () => {
    expect(computeCompliance('am', at(9, 30))).toEqual({ ok: true, level: 'full', score: 100 });
  });
  it('09:45 ← متأخر 75', () => {
    expect(computeCompliance('am', at(9, 45))).toEqual({ ok: true, level: 'behind', score: 75 });
  });
  it('10:00 ← آخر دقيقة مسموحة (شاملة)', () => {
    expect(shiftWindowState('am', at(10, 0))).toBe('open');
    expect(computeCompliance('am', at(10, 0))).toEqual({ ok: true, level: 'non', score: 50 });
  });
  it('10:01 ← انتهت النافذة (رفض)', () => {
    expect(shiftWindowState('am', at(10, 1))).toBe('closed');
    expect(computeCompliance('am', at(10, 1))).toEqual({ ok: false, reason: 'deadline_passed', deadline: '10:00' });
  });
  it('التأخر يظهر تدريجيًا (09:31 بين 100 و75)', () => {
    const r = computeCompliance('am', at(9, 31));
    expect(r.ok && r.level).toBe('behind');
    expect(r.ok && r.score).toBeGreaterThan(75);
    expect(r.ok && r.score).toBeLessThan(100);
  });
});

describe('نافذة الجولة المسائية 12:00–14:30 (توقيت الرياض)', () => {
  it('11:59 ← لم تبدأ', () => {
    expect(shiftWindowState('pm', at(11, 59))).toBe('before');
    expect(computeCompliance('pm', at(11, 59))).toEqual({ ok: false, reason: 'not_open', start: '12:00' });
  });
  it('12:00 ← مفتوحة وملتزم تمامًا', () => {
    expect(computeCompliance('pm', at(12, 0))).toEqual({ ok: true, level: 'full', score: 100 });
  });
  it('14:30 ← آخر دقيقة مسموحة وملتزم تمامًا', () => {
    expect(computeCompliance('pm', at(14, 30))).toEqual({ ok: true, level: 'full', score: 100 });
  });
  it('14:31 ← انتهت النافذة (رفض)', () => {
    expect(shiftWindowState('pm', at(14, 31))).toBe('closed');
    expect(computeCompliance('pm', at(14, 31))).toEqual({ ok: false, reason: 'deadline_passed', deadline: '14:30' });
  });
  it('نص النافذة', () => {
    expect(windowText('am')).toBe('07:30–10:00');
    expect(windowText('pm')).toBe('12:00–14:30');
  });
});

describe('حالات الجولة غير المرسلة', () => {
  const today = '2026-10-15';
  it('07:00 ← لم تبدأ', () => {
    const s = pendingState('am', today, today, at(7, 0));
    expect(s).toBe('not_started');
    expect(DISPLAY_STATUS[s].label).toBe('لم تبدأ');
  });
  it('09:00 ← لم تكتمل', () => {
    const s = pendingState('am', today, today, at(9, 0));
    expect(s).toBe('in_progress');
    expect(DISPLAY_STATUS[s].label).toBe('لم تكتمل');
  });
  it('09:45 ← متأخرة · لم تكتمل', () => {
    const s = pendingState('am', today, today, at(9, 45));
    expect(s).toBe('late');
    expect(DISPLAY_STATUS[s].label).toBe('متأخرة · لم تكتمل');
  });
  it('بعد نهاية النافذة ← فائتة', () => {
    expect(pendingState('am', today, today, at(10, 1))).toBe('missed');
    expect(pendingState('pm', today, today, at(14, 31))).toBe('missed');
  });
  it('أيام سابقة غير مرسلة = فائتة', () => {
    expect(pendingState('pm', '2026-10-14', today, at(8, 0))).toBe('missed');
  });
  it('المسائية صباحًا = لم تبدأ', () => {
    expect(pendingState('pm', today, today, at(11, 0))).toBe('not_started');
  });
});

describe('شارة الالتزام في رأس صفحة المراقب = أسوأ حالة', () => {
  const today = '2026-10-15';
  const r = (shift: 'am' | 'pm', status: RoundLike['status'], level: RoundLike['compliance_level'] = null): RoundLike => ({
    shift,
    status,
    round_date: today,
    compliance_level: level,
  });
  it('صباحية ملتزمة + مسائية لم تبدأ = ضمن الوقت', () => {
    expect(worstBadge([roundBadgeState(r('am', 'submitted', 'full'), today, at(9, 0)), roundBadgeState(r('pm', 'pending'), today, at(9, 0))])).toBe('on_time');
  });
  it('جولتان ملتزمتان تمامًا = ملتزم تمامًا', () => {
    expect(worstBadge([roundBadgeState(r('am', 'submitted', 'full'), today, at(15, 0)), roundBadgeState(r('pm', 'submitted', 'full'), today, at(15, 0))])).toBe('full');
  });
  it('متأخرة + ملتزمة = متأخر عن الخطة', () => {
    expect(worstBadge([roundBadgeState(r('am', 'submitted', 'behind'), today, at(12, 0)), roundBadgeState(r('pm', 'pending'), today, at(12, 0))])).toBe('behind');
  });
  it('فائتة = غير ملتزم بالخطة', () => {
    expect(worstBadge([roundBadgeState(r('am', 'missed'), today, at(12, 0)), roundBadgeState(r('pm', 'pending'), today, at(12, 0))])).toBe('non');
  });
  it('pending بعد ملتزم تمامًا حتى = متأخر عن الخطة', () => {
    expect(roundBadgeState(r('am', 'pending'), today, at(9, 45))).toBe('behind');
  });
  it('حالة العرض للمرسلة = مستوى الالتزام', () => {
    expect(roundDisplayStatus(r('am', 'submitted', 'non'), today, at(12, 0))).toBe('non');
  });
});

describe('الجولة المعروضة افتراضيًا', () => {
  it('الصباحية قبل 12:00 (بداية المسائية)', () => {
    expect(defaultShift(at(11, 59), [{ shift: 'am', status: 'pending' }, { shift: 'pm', status: 'pending' }])).toBe('am');
  });
  it('المسائية من 12:00', () => {
    expect(defaultShift(at(12, 0), [{ shift: 'am', status: 'submitted' }, { shift: 'pm', status: 'pending' }])).toBe('pm');
  });
  it('إن كانت الصباحية مُرسلة تُعرض المسائية', () => {
    expect(defaultShift(at(9, 0), [{ shift: 'am', status: 'submitted' }, { shift: 'pm', status: 'pending' }])).toBe('pm');
  });
  it('إن كانت المسائية مُرسلة تُعرض الصباحية', () => {
    expect(defaultShift(at(15, 0), [{ shift: 'am', status: 'missed' }, { shift: 'pm', status: 'submitted' }])).toBe('am');
  });
});
