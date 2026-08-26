import { describe, expect, it } from 'vitest';
import {
  THAI_MONTHS,
  buddhistYearOptions,
  currentBuddhistYear,
  currentMonth,
  daysInMonth,
  formatBuddhistDateInput,
  formatMonthLabel,
  parseBuddhistDateInput,
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
  it('แปลง YYYY-MM (ค.ศ.) เป็น "เดือน ปี" ภาษาไทย โดยแสดงปีเป็น พ.ศ. เสมอ', () => {
    expect(formatMonthLabel('2026-07')).toBe('กรกฎาคม 2569');
    expect(formatMonthLabel('2026-01')).toBe('มกราคม 2569');
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

describe('daysInMonth', () => {
  it('คืนจำนวนวันที่ถูกต้องของเดือนปกติ', () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 4)).toBe(30);
  });

  it('คืน 29 วันสำหรับเดือนกุมภาพันธ์ปีอธิกสุรทิน (เช่น ค.ศ. 2024)', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
  });

  it('คืน 28 วันสำหรับเดือนกุมภาพันธ์ปีปกติ', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
  });
});

describe('formatBuddhistDateInput', () => {
  it('แปลง ISO ค.ศ. เป็น วว/ดด/ปปปป (ปี พ.ศ.)', () => {
    expect(formatBuddhistDateInput('2026-08-17')).toBe('17/08/2569');
    expect(formatBuddhistDateInput('2026-01-05')).toBe('05/01/2569');
  });

  it('คืนค่าว่างเมื่อ iso เป็นค่าว่าง', () => {
    expect(formatBuddhistDateInput('')).toBe('');
  });
});

describe('parseBuddhistDateInput', () => {
  it('แปลง วว/ดด/ปปปป (ปี พ.ศ.) กลับเป็น ISO ค.ศ. ได้ถูกต้อง', () => {
    expect(parseBuddhistDateInput('17/08/2569')).toEqual({ iso: '2026-08-17', looksLikeGregorian: false });
    expect(parseBuddhistDateInput('5/1/2569')).toEqual({ iso: '2026-01-05', looksLikeGregorian: false });
  });

  it('คืน iso เป็น null เมื่อรูปแบบผิด (เช่นใช้ตัวคั่นอื่น หรือพิมพ์ไม่ครบ)', () => {
    expect(parseBuddhistDateInput('17-08-2569').iso).toBeNull();
    expect(parseBuddhistDateInput('17/08/').iso).toBeNull();
    expect(parseBuddhistDateInput('').iso).toBeNull();
  });

  it('คืน iso เป็น null เมื่อวันที่ไม่มีจริง (เช่น 31 กุมภาพันธ์)', () => {
    expect(parseBuddhistDateInput('31/02/2569').iso).toBeNull();
  });

  it('คืน iso เป็น null เมื่อเดือนไม่ถูกต้อง', () => {
    expect(parseBuddhistDateInput('17/13/2569').iso).toBeNull();
  });

  it('เตือน looksLikeGregorian เมื่อพิมพ์ปี ค.ศ. เข้ามาแทน พ.ศ. (เช่น 2026 แทนที่จะเป็น 2569)', () => {
    const result = parseBuddhistDateInput('17/08/2026');
    expect(result.iso).toBeNull();
    expect(result.looksLikeGregorian).toBe(true);
  });

  it('ปีต่ำกว่า 2200 ทุกกรณีถือว่า looksLikeGregorian ไม่ใช่แค่ปีปัจจุบัน', () => {
    expect(parseBuddhistDateInput('01/01/1990').looksLikeGregorian).toBe(true);
    expect(parseBuddhistDateInput('01/01/2199').looksLikeGregorian).toBe(true);
  });

  it('ปี พ.ศ. จริง (>= 2200) ไม่ถูกเตือนว่า looksLikeGregorian', () => {
    expect(parseBuddhistDateInput('01/01/2569').looksLikeGregorian).toBe(false);
  });
});
