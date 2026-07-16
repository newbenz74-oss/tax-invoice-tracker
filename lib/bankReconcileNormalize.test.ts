import { describe, expect, it } from 'vitest';
import {
  isRowBlank,
  normalizeBankRows,
  normalizeGLRows,
  parseAmountCell,
  parseDateCell,
} from './bankReconcileNormalize';
import type { BankColumnMapping, GLColumnMapping, RawFileTable } from '@/types/bankReconcile';

describe('parseAmountCell', () => {
  it('ค่าว่าง / null / undefined = 0', () => {
    expect(parseAmountCell('')).toBe(0);
    expect(parseAmountCell(null)).toBe(0);
    expect(parseAmountCell(undefined)).toBe(0);
  });

  it('เครื่องหมาย "-" = 0', () => {
    expect(parseAmountCell('-')).toBe(0);
  });

  it('ตัวเลขปกติ (number และ string)', () => {
    expect(parseAmountCell(1234.5)).toBe(1234.5);
    expect(parseAmountCell('500')).toBe(500);
  });

  it('ตัด comma คั่นหลักพันออกก่อนแปลงเป็นตัวเลข', () => {
    expect(parseAmountCell('1,234.56')).toBe(1234.56);
    expect(parseAmountCell('1,000,000')).toBe(1000000);
  });

  it('ตัดช่องว่างหน้า/หลังออกก่อนแปลง', () => {
    expect(parseAmountCell('  1,234.56  ')).toBe(1234.56);
  });

  it('รองรับเครื่องหมายลบนำหน้า', () => {
    expect(parseAmountCell('-500.25')).toBe(-500.25);
  });

  it('ข้อความที่มีตัวอักษรปน ไม่ใช่ตัวเลขล้วนๆ = 0 (ห้ามหลุดเป็น NaN)', () => {
    expect(parseAmountCell('12abc')).toBe(0);
    expect(parseAmountCell('abc')).toBe(0);
    expect(parseAmountCell('1,2,3,abc')).toBe(0);
  });

  it('ตัวเลขที่ไม่ finite (NaN/Infinity) = 0', () => {
    expect(parseAmountCell(NaN)).toBe(0);
    expect(parseAmountCell(Infinity)).toBe(0);
    expect(parseAmountCell(-Infinity)).toBe(0);
  });
});

describe('parseDateCell', () => {
  it('Date object ที่ถูกต้อง', () => {
    expect(parseDateCell(new Date(2026, 6, 13))).toBe('2026-07-13');
  });

  it('Date object ที่ไม่ถูกต้อง (Invalid Date) = null ไม่ปล่อยหลุดออกไป', () => {
    expect(parseDateCell(new Date('ไม่ใช่วันที่'))).toBeNull();
  });

  it('เลข serial ของ Excel (ค่าเดียวกับที่ยืนยันแล้วใน lib/excelImport.test.ts: 46216 = 2026-07-13)', () => {
    expect(parseDateCell(46216)).toBe('2026-07-13');
  });

  it('string แบบ ISO YYYY-MM-DD', () => {
    expect(parseDateCell('2026-07-13')).toBe('2026-07-13');
  });

  it('string แบบ DD/MM/YYYY', () => {
    expect(parseDateCell('13/7/2026')).toBe('2026-07-13');
  });

  it('string แบบ DD-MM-YYYY (ตัวคั่นขีด — เพิ่มขึ้นมาจาก lib/excelImport.ts เพราะไฟล์ธนาคาร/CSV จริงมักใช้แบบนี้)', () => {
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

function bankTable(rows: unknown[][]): RawFileTable {
  return { headers: ['วันที่รายการ', 'รายละเอียด', 'เงินเข้า', 'เงินออก', 'ยอดคงเหลือ'], rows };
}

const FULL_BANK_MAPPING: BankColumnMapping = {
  transactionDate: 0,
  description: 1,
  moneyIn: 2,
  moneyOut: 3,
  balance: 4,
};

describe('normalizeBankRows', () => {
  it('คำนวณ signedAmount = เงินเข้า - เงินออก ถูกต้อง (เงินเข้ามากกว่า → บวก)', () => {
    const table = bankTable([['16/07/2026', 'รับเงิน', '1,500.00', '-', '10,000']]);
    const rows = normalizeBankRows(table, FULL_BANK_MAPPING);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      transactionDate: '2026-07-16',
      description: 'รับเงิน',
      moneyIn: 1500,
      moneyOut: 0,
      balance: 10000,
      signedAmount: 1500,
    });
  });

  it('เงินออกมากกว่าเงินเข้า → signedAmount ติดลบ', () => {
    const table = bankTable([['16/07/2026', 'จ่ายเงิน', '', '2,000', '8,000']]);
    const rows = normalizeBankRows(table, FULL_BANK_MAPPING);
    expect(rows[0].signedAmount).toBe(-2000);
  });

  it('ข้ามแถวว่างทั้งแถวไปอัตโนมัติ', () => {
    const table = bankTable([
      ['16/07/2026', 'A', '100', '', ''],
      ['', '', '', '', ''],
      ['17/07/2026', 'B', '200', '', ''],
    ]);
    const rows = normalizeBankRows(table, FULL_BANK_MAPPING);
    expect(rows).toHaveLength(2);
  });

  it('เลขแถว (rowNumber) อ้างอิงตำแหน่งจริงในไฟล์เสมอ (แถว 1 = header)', () => {
    const table = bankTable([
      ['16/07/2026', 'A', '100', '', ''],
      ['', '', '', '', ''],
      ['17/07/2026', 'B', '200', '', ''],
    ]);
    const rows = normalizeBankRows(table, FULL_BANK_MAPPING);
    expect(rows[0].rowNumber).toBe(2);
    expect(rows[1].rowNumber).toBe(4);
  });

  it('คอลัมน์ที่ไม่ได้จับคู่ (null) ให้ค่า default ที่ปลอดภัยเสมอ ไม่ throw', () => {
    const table = bankTable([['16/07/2026', 'A', '100', '', '']]);
    const rows = normalizeBankRows(table, {
      transactionDate: 0,
      description: null,
      moneyIn: null,
      moneyOut: null,
      balance: null,
    });
    expect(rows[0]).toMatchObject({ description: '', moneyIn: 0, moneyOut: 0, balance: 0, signedAmount: 0 });
  });
});

function glTable(rows: unknown[][]): RawFileTable {
  return { headers: ['วันที่', 'เลขที่เอกสาร', 'รายละเอียด', 'เดบิต', 'เครดิต'], rows };
}

const FULL_GL_MAPPING: GLColumnMapping = {
  date: 0,
  docNo: 1,
  description: 2,
  debit: 3,
  credit: 4,
};

describe('normalizeGLRows', () => {
  it('เดบิตมากกว่าเครดิต → signedAmount เป็นบวก (เงินเข้าบัญชีธนาคาร — บัญชีเงินสด/ธนาคารเป็นสินทรัพย์)', () => {
    const table = glTable([['16/07/2026', 'JV-001', 'รับชำระ', '1,500.00', '-']]);
    const rows = normalizeGLRows(table, FULL_GL_MAPPING);
    expect(rows[0].signedAmount).toBe(1500);
  });

  it('เครดิตมากกว่าเดบิต → signedAmount เป็นลบ (เงินออกจากบัญชีธนาคาร) — จุดสำคัญที่ต้องไม่กลับด้าน', () => {
    const table = glTable([['16/07/2026', 'JV-002', 'จ่ายค่าใช้จ่าย', '-', '2,000.00']]);
    const rows = normalizeGLRows(table, FULL_GL_MAPPING);
    expect(rows[0].signedAmount).toBe(-2000);
  });

  it('ข้ามแถวว่างทั้งแถวไปอัตโนมัติ', () => {
    const table = glTable([
      ['16/07/2026', 'JV-001', 'A', '100', ''],
      ['', '', '', '', ''],
    ]);
    const rows = normalizeGLRows(table, FULL_GL_MAPPING);
    expect(rows).toHaveLength(1);
  });

  it('ไม่บังคับเลขที่เอกสาร/รายละเอียด — ไม่ได้จับคู่ก็ไม่ error', () => {
    const table = glTable([['16/07/2026', 'JV-001', 'A', '100', '']]);
    const rows = normalizeGLRows(table, { date: 0, docNo: null, description: null, debit: 3, credit: 4 });
    expect(rows[0].docNo).toBe('');
    expect(rows[0].description).toBe('');
    expect(rows[0].signedAmount).toBe(100);
  });
});
