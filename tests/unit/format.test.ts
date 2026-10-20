import { describe, expect, it } from 'vitest';
import { restroomLabel } from '@/lib/domain/format';

describe('اسم دورة المياه المعروض', () => {
  it('«دورة مياه» فقط بلا رقم ولا رجال/نساء', () => {
    expect(restroomLabel('دورة مياه رقم 1 رجال')).toBe('دورة مياه');
    expect(restroomLabel('دورة مياه رقم 2 نساء')).toBe('دورة مياه');
    expect(restroomLabel('دورة مياه رقم ١٢ للنساء')).toBe('دورة مياه');
    expect(restroomLabel('دورة مياه الاختبار أ')).toBe('دورة مياه');
    expect(restroomLabel(null)).toBe('دورة مياه');
  });
});
