import { describe, expect, it } from 'vitest';
import {
  THAI_MONTHS,
  buddhistYearOptions,
  currentBuddhistYear,
  currentMonth,
  formatMonthLabel,
  thaiMonthName,
} from './thaiDate';

describe('thaiMonthName', () => {
  it('คืนชื่อเดือนไทยที่ถูกต้องสำหรับเดือน 1-12', () => {
    expect(thaiMonthName(1)).toBe('มกราคม');
    expect(thaiMonthName(7)).toBe('กรกฎาคม');
    expect(thaiMonthName(12)).toBe('ธันวาคม');
  });

  it('คืน "-" เมื่อเลขเดือนไม่ถูกต้อง', () => {
    expect(thaiMonthName(0)).toBe('-');
    expect(thaiMonthName(13)).toBe('-');
    expect(thaiMonthName(-1)).toBe('-');
  });

  it('มีครบ 12 เดือนใน THAI_MONTHS', () => {
    expect(THAI_MONTHS).toHaveLength(12);
  });
});

describe('formatMonthLabel', () => {
  it('แปลง YYYY-MM เป็น "เดือน ปี" ภาษาไทย', () => {
    expect(formatMonthLabel('2026-07')).toBe('กรกฎาคม 2026');
    expect(formatMonthLabel('2026-01')).toBe('มกราคม 2026');
  });
});

describe('currentBuddhistYear / currentMonth', () => {
  it('currentBuddhistYear มากกว่าปี ค.ศ. ปัจจุบันอยู่ 543 ปีเสมอ', () => {
    const gregorianYear = new Date().getFullYear();
    expect(currentBuddhistYear()).toBe(gregorianYear + 543);
  });

  it('currentMonth อยู่ในช่วง 1-12 เสมอ', () => {
    const m = currentMonth();
    expect(m).toBeGreaterThanOrEqual(1);
    expect(m).toBeLessThanOrEqual(12);
  });
});

describe('buddhistYearOptions', () => {
  it('เรียงปีล่าสุดขึ้นก่อนเสมอ (descending)', () => {
    const years = buddhistYearOptions(2);
    for (let i = 1; i < years.length; i++) {
      expect(years[i]).toBeLessThan(years[i - 1]);
    }
  });

  it('ครอบคลุมปีปัจจุบัน และมีปีถัดไปให้เลือกล่วงหน้า 1 ปี', () => {
    const current = currentBuddhistYear();
    const years = buddhistYearOptions(2);
    expect(years).toContain(current);
    expect(years).toContain(current + 1);
    expect(years).toContain(current - 2);
  });

  it('ควบคุมช่วงปีด้วย rangeYears ได้', () => {
    const years = buddhistYearOptions(0);
    expect(years).toEqual([currentBuddhistYear() + 1, currentBuddhistYear()]);
  });
});
