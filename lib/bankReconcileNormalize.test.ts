import { describe, expect, it } from 'vitest';
import {
  buildBankRows,
  buildGLRows,
  isRowBlank,
  parseAmountMagnitude,
  parseDateCell,
  resolveDirectionAndAmount,
} from './bankReconcileNormalize';
import type { BankColumnMapping, GLColumnMapping, RawFileTable } from '@/types/bankReconcile';

describe('parseAmountMagnitude', () => {
  it('ค่าว่าง / null / undefined = 0', () => {
    expect(parseAmountMagnitude('')).toBe(0);
    expect(parseAmountMagnitude(null)).toBe(0);
    expect(parseAmountMagnitude(undefined)).toBe(0);
  });

  it('เครื่องหมาย "-" = 0', () => {
    expect(parseAmountMagnitude('-')).toBe(0);
  });

  it('ตัวเลขปกติ (number และ string)', () => {
    expect(parseAmountMagnitude(1234.5)).toBe(1234.5);
    expect(parseAmountMagnitude('500')).toBe(500);
  });

  it('ตัด comma คั่นหลักพันออกก่อนแปลงเป็นตัวเลข', () => {
    expect(parseAmountMagnitude('1,234.56')).toBe(1234.56);
    expect(parseAmountMagnitude('1,000,000')).toBe(1000000);
  });

  it('ตัดช่องว่างหน้า/หลัง/ภายในตัวเลขออกก่อนแปลง', () => {
    expect(parseAmountMagnitude('  1,234.56  ')).toBe(1234.56);
    expect(parseAmountMagnitude('1 234.56')).toBe(1234.56);
  });

  it('ตัดสัญลักษณ์สกุลเงินที่พบบ่อยออก (฿, $, บาท)', () => {
    expect(parseAmountMagnitude('฿1,234.56')).toBe(1234.56);
    expect(parseAmountMagnitude('$500')).toBe(500);
    expect(parseAmountMagnitude('1,234.56 บาท')).toBe(1234.56);
  });

  it('คืนค่าเป็น "ขนาด" เสมอ ไม่ติดลบ แม้เซลล์จะมีเครื่องหมายลบนำหน้า — ทิศทางมาจากคอลัมน์ ไม่ใช่เครื่องหมาย', () => {
    expect(parseAmountMagnitude('-500.25')).toBe(500.25);
  });

  it('วงเล็บถือเป็นค่าติดลบตามธรรมเนียมบัญชี แต่ผลลัพธ์ยังเป็นขนาดบวกเสมอ', () => {
    expect(parseAmountMagnitude('(1,234.56)')).toBe(1234.56);
  });

  it('ข้อความที่มีตัวอักษรปน ไม่ใช่ตัวเลขล้วนๆ = 0 (ห้ามหลุดเป็น NaN)', () => {
    expect(parseAmountMagnitude('12abc')).toBe(0);
    expect(parseAmountMagnitude('abc')).toBe(0);
    expect(parseAmountMagnitude('1,2,3,abc')).toBe(0);
  });

  it('ตัวเลขที่ไม่ finite (NaN/Infinity) = 0', () => {
    expect(parseAmountMagnitude(NaN)).toBe(0);
    expect(parseAmountMagnitude(Infinity)).toBe(0);
    expect(parseAmountMagnitude(-Infinity)).toBe(0);
  });

  it('ปัดเศษทศนิยมเป็น 2 ตำแหน่งเสมอ (กัน floating point error)', () => {
    expect(parseAmountMagnitude(0.1 + 0.2)).toBe(0.3);
  });
});

describe('parseDateCell', () => {
  it('Date object ที่ถูกต้อง', () => {
    expect(parseDateCell(new Date(2026, 6, 13))).toBe('2026-07-13');
  });

  it('Date object ที่ไม่ถูกต้อง (Invalid Date) = null ไม่ปล่อยหลุดออกไป', () => {
    expect(parseDateCell(new Date('ไม่ใช่วันที่'))).toBeNull();
  });

  it('เลข serial ของ Excel (46216 = 2026-07-13)', () => {
    expect(parseDateCell(46216)).toBe('2026-07-13');
  });

  it('string แบบ ISO YYYY-MM-DD', () => {
    expect(parseDateCell('2026-07-13')).toBe('2026-07-13');
  });

  it('string แบบ DD/MM/YYYY', () => {
    expect(parseDateCell('13/7/2026')).toBe('2026-07-13');
  });

  it('string แบบ DD-MM-YYYY (ตัวคั่นขีด — ไฟล์ธนาคาร/CSV จริงมักใช้แบบนี้)', () => {
    expect(parseDateCell('13-07-2026')).toBe('2026-07-13');
  });

  it('ค่าว่าง / null / undefined / "-" = null', () => {
    expect(parseDateCell('')).toBeNull();
    expect(parseDateCell(null)).toBeNull();
    expect(parseDateCell(undefined)).toBeNull();
    expect(parseDateCell('-')).toBeNull();
  });

  it('วันที่ที่ไม่มีอยู่จริง = null (ไม่ปล่อยเป็น Invalid Date แบบเงียบๆ)', () => {
    expect(parseDateCell('2026-13-99')).toBeNull();
    expect(parseDateCell('35/13/2026')).toBeNull();
    expect(parseDateCell('30/2/2026')).toBeNull();
    expect(parseDateCell('30-02-2026')).toBeNull();
  });

  it('ข้อความที่ไม่ใช่วันที่เลย = null', () => {
    expect(parseDateCell('ไม่ใช่วันที่')).toBeNull();
  });
});

describe('isRowBlank', () => {
  it('ทุกเซลล์ว่างเปล่า (string ว่าง/เว้นวรรค/null/undefined) = true', () => {
    expect(isRowBlank(['', '  ', null, undefined])).toBe(true);
  });

  it('มีเซลล์ที่เป็นเลข 0 อย่างชัดเจน — ไม่ถือว่าแถวว่าง (0 คือค่าจริงที่มีความหมาย)', () => {
    expect(isRowBlank(['', 0, ''])).toBe(false);
  });

  it('มีข้อความอย่างน้อยหนึ่งเซลล์ — ไม่ถือว่าแถวว่าง', () => {
    expect(isRowBlank(['', 'มีข้อมูล', ''])).toBe(false);
  });

  it('แถวว่างสนิท (array ว่างเปล่า) = true', () => {
    expect(isRowBlank([])).toBe(true);
  });
});

describe('resolveDirectionAndAmount', () => {
  it('มีแต่เงินเข้า (>0) = direction income, amount = เงินเข้า', () => {
    const result = resolveDirectionAndAmount('1,500.00', '');
    expect(result).toMatchObject({ direction: 'income', amount: 1500, moneyIn: 1500, moneyOut: 0, errors: [] });
  });

  it('มีแต่เงินออก (>0) = direction payment, amount = เงินออก', () => {
    const result = resolveDirectionAndAmount('', '2,000.00');
    expect(result).toMatchObject({ direction: 'payment', amount: 2000, moneyIn: 0, moneyOut: 2000, errors: [] });
  });

  it('มีทั้งเงินเข้าและเงินออกพร้อมกัน (>0 ทั้งคู่) = หาทิศทางไม่ได้ ต้อง error', () => {
    const result = resolveDirectionAndAmount('100', '200');
    expect(result.direction).toBeNull();
    expect(result.amount).toBe(0);
    expect(result.errors).toEqual(['พบทั้งเงินเข้าและเงินออกในแถวเดียวกัน กรุณาตรวจสอบ']);
  });

  it('ทั้งสองคอลัมน์เป็น 0 พร้อมกัน = ไม่มีจำนวนเงินให้กระทบยอด ต้อง error', () => {
    const result = resolveDirectionAndAmount('', '');
    expect(result.direction).toBeNull();
    expect(result.amount).toBe(0);
    expect(result.errors).toEqual(['ไม่พบจำนวนเงินเข้าหรือเงินออกในแถวนี้']);
  });

  it('เครื่องหมายลบในเซลล์ไม่มีผลต่อทิศทาง — ทิศทางมาจากคอลัมน์ที่มีค่าเท่านั้น (ตามตัวอย่างสเปก "-5,000.00 payment")', () => {
    // สมมติว่าเซลล์ "เงินออก" มีค่า -5,000.00 (ธนาคารบางแห่งใส่เครื่องหมายลบในคอลัมน์เงินออกเอง) — ผลลัพธ์ต้อง
    // เหมือนกับใส่ 5,000.00 ธรรมดาทุกประการ เพราะ parseAmountMagnitude ตัดเครื่องหมายทิ้งเป็นขนาดอยู่แล้ว
    const result = resolveDirectionAndAmount('', '-5,000.00');
    expect(result).toMatchObject({ direction: 'payment', amount: 5000 });
  });
});

function bankTable(rows: unknown[][]): RawFileTable {
  return { headers: ['วันที่รายการ', 'รายละเอียด', 'เงินเข้า', 'เงินออก', 'ยอดคงเหลือ'], rows };
}

const FULL_BANK_MAPPING: BankColumnMapping = {
  transactionDate: 0,
  description: 1,
  moneyIn: 2,
  moneyOut: 3,
  balance: 4,
  accountNo: null,
};

describe('buildBankRows', () => {
  it('แถวเงินเข้า — direction=income, amount=เงินเข้า, errors ว่างเปล่า', () => {
    const table = bankTable([['16/07/2026', 'รับเงิน', '1,500.00', '-', '10,000']]);
    const rows = buildBankRows(table, FULL_BANK_MAPPING);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date: '2026-07-16',
      description: 'รับเงิน',
      direction: 'income',
      amount: 1500,
      moneyInRaw: 1500,
      moneyOutRaw: 0,
      balance: 10000,
      errors: [],
    });
  });

  it('แถวเงินออก — direction=payment, amount=เงินออก', () => {
    const table = bankTable([['16/07/2026', 'จ่ายเงิน', '', '2,000', '8,000']]);
    const rows = buildBankRows(table, FULL_BANK_MAPPING);
    expect(rows[0]).toMatchObject({ direction: 'payment', amount: 2000 });
  });

  it('แถวที่มีทั้งเงินเข้า/เงินออกพร้อมกัน — direction เป็น null และมี errors (สถานะ invalid ที่ต้องแก้ไข/ยกเว้น)', () => {
    const table = bankTable([['16/07/2026', 'ผิดปกติ', '100', '200', '']]);
    const rows = buildBankRows(table, FULL_BANK_MAPPING);
    expect(rows[0].direction).toBeNull();
    expect(rows[0].errors.length).toBeGreaterThan(0);
  });

  it('ข้ามแถวว่างทั้งแถวไปอัตโนมัติ — ไม่สร้าง BankRow ให้เลย', () => {
    const table = bankTable([
      ['16/07/2026', 'A', '100', '', ''],
      ['', '', '', '', ''],
      ['17/07/2026', 'B', '200', '', ''],
    ]);
    const rows = buildBankRows(table, FULL_BANK_MAPPING);
    expect(rows).toHaveLength(2);
  });

  it('เลขแถว (rowNumber) และ id อ้างอิงตำแหน่งจริงในไฟล์เสมอ (แถว 1 = header, ข้ามแถวว่างไม่กระทบเลขแถวถัดไป)', () => {
    const table = bankTable([
      ['16/07/2026', 'A', '100', '', ''],
      ['', '', '', '', ''],
      ['17/07/2026', 'B', '200', '', ''],
    ]);
    const rows = buildBankRows(table, FULL_BANK_MAPPING);
    expect(rows[0].rowNumber).toBe(2);
    expect(rows[0].id).toBe('bank-2');
    expect(rows[1].rowNumber).toBe(4);
    expect(rows[1].id).toBe('bank-4');
  });

  it('คอลัมน์ที่ไม่ได้จับคู่ (null) ให้ค่า default ที่ปลอดภัยเสมอ ไม่ throw — balance เป็น null (ไม่ใช่ 0) เมื่อไม่ได้จับคู่', () => {
    const table = bankTable([['16/07/2026', 'A', '100', '', '']]);
    const rows = buildBankRows(table, {
      transactionDate: 0,
      description: null,
      moneyIn: 2,
      moneyOut: null,
      balance: null,
      accountNo: null,
    });
    expect(rows[0]).toMatchObject({ description: '', balance: null, accountNo: '' });
  });

  it('แถวใหม่ทุกแถวเริ่มต้น excluded=false เสมอ', () => {
    const table = bankTable([['16/07/2026', 'A', '100', '', '']]);
    const rows = buildBankRows(table, FULL_BANK_MAPPING);
    expect(rows[0].excluded).toBe(false);
  });
});

function glTable(rows: unknown[][]): RawFileTable {
  return { headers: ['วันที่', 'เลขที่เอกสาร', 'รายละเอียด', 'ฝั่งรับเงิน', 'ฝั่งจ่ายเงิน'], rows };
}

const FULL_GL_MAPPING: GLColumnMapping = {
  date: 0,
  docNo: 1,
  description: 2,
  moneyIn: 3,
  moneyOut: 4,
  accountCode: null,
};

describe('buildGLRows', () => {
  it('ฝั่งรับเงินมีค่า → direction=income (ผู้ใช้เป็นคนกำหนดทิศทางเองผ่านการจับคู่คอลัมน์ ระบบไม่เดาจากเดบิต/เครดิต)', () => {
    const table = glTable([['16/07/2026', 'JV-001', 'รับชำระ', '1,500.00', '-']]);
    const rows = buildGLRows(table, FULL_GL_MAPPING);
    expect(rows[0]).toMatchObject({ direction: 'income', amount: 1500, docNo: 'JV-001' });
  });

  it('ฝั่งจ่ายเงินมีค่า → direction=payment', () => {
    const table = glTable([['16/07/2026', 'JV-002', 'จ่ายค่าใช้จ่าย', '-', '2,000.00']]);
    const rows = buildGLRows(table, FULL_GL_MAPPING);
    expect(rows[0]).toMatchObject({ direction: 'payment', amount: 2000 });
  });

  it('ข้ามแถวว่างทั้งแถวไปอัตโนมัติ', () => {
    const table = glTable([
      ['16/07/2026', 'JV-001', 'A', '100', ''],
      ['', '', '', '', ''],
    ]);
    const rows = buildGLRows(table, FULL_GL_MAPPING);
    expect(rows).toHaveLength(1);
  });

  it('ไม่บังคับเลขที่เอกสาร/รหัสบัญชี — ไม่ได้จับคู่ก็ไม่ error และได้ค่าว่างเป็นค่าเริ่มต้น', () => {
    const table = glTable([['16/07/2026', 'JV-001', 'A', '100', '']]);
    const rows = buildGLRows(table, { date: 0, docNo: null, description: null, moneyIn: 3, moneyOut: 4, accountCode: null });
    expect(rows[0].docNo).toBe('');
    expect(rows[0].description).toBe('');
    expect(rows[0].direction).toBe('income');
    expect(rows[0].amount).toBe(100);
  });

  it('id ของแถว GL ใช้ prefix "gl-" ต่างจาก Bank ("bank-")', () => {
    const table = glTable([['16/07/2026', 'JV-001', 'A', '100', '']]);
    const rows = buildGLRows(table, FULL_GL_MAPPING);
    expect(rows[0].id).toBe('gl-2');
  });
});
