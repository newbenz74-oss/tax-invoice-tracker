import { describe, expect, it } from 'vitest';
import {
  countDataRows,
  isBankMappingComplete,
  isGLMappingComplete,
  validateFileType,
  validateParsedTable,
} from './bankReconcileValidation';
import type { BankColumnMapping, GLColumnMapping, RawFileTable } from '@/types/bankReconcile';

describe('validateFileType', () => {
  it('ยอมรับ .xlsx / .xls / .csv', () => {
    expect(validateFileType('a.xlsx')).toBeNull();
    expect(validateFileType('a.xls')).toBeNull();
    expect(validateFileType('a.csv')).toBeNull();
  });

  it('ปฏิเสธนามสกุลอื่น พร้อมข้อความแจ้งเตือนภาษาไทยที่บอกนามสกุลที่รองรับ', () => {
    const error = validateFileType('a.txt');
    expect(error).not.toBeNull();
    expect(error).toContain('.xlsx');
    expect(error).toContain('.csv');
  });
});

describe('validateParsedTable', () => {
  it('ไฟล์ว่างเปล่าสนิท (ไม่มีทั้งหัวคอลัมน์และแถวข้อมูล) — invalid พร้อม error เดียว', () => {
    const result = validateParsedTable({ headers: [], rows: [] });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('ว่างเปล่า');
  });

  it('ทุกเซลล์ในแถวหัวคอลัมน์ว่างเปล่า แต่มีแถวข้อมูล — invalid เพราะไม่พบหัวคอลัมน์', () => {
    const result = validateParsedTable({ headers: ['', '', ''], rows: [['a', 'b', 'c']] });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('หัวคอลัมน์'))).toBe(true);
  });

  it('มีหัวคอลัมน์ แต่ทุกแถวข้อมูลว่างเปล่าทั้งหมด — invalid เพราะไม่พบแถวข้อมูล', () => {
    const result = validateParsedTable({
      headers: ['วันที่', 'จำนวนเงิน'],
      rows: [
        ['', ''],
        ['', ''],
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('แถวข้อมูล'))).toBe(true);
  });

  it('ไม่มีทั้งหัวคอลัมน์และแถวข้อมูลที่ใช้ได้ (แต่ไม่ใช่ไฟล์ว่างเปล่าสนิท) — สะสม error ทั้งสองข้อพร้อมกัน ไม่ return แค่ข้อแรก', () => {
    const result = validateParsedTable({ headers: [''], rows: [['']] });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });

  it('มีทั้งหัวคอลัมน์และแถวข้อมูลอย่างน้อย 1 แถว — valid ไม่มี error', () => {
    const result = validateParsedTable({ headers: ['วันที่', 'จำนวนเงิน'], rows: [['16/07/2026', '100']] });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe('countDataRows', () => {
  it('นับเฉพาะแถวที่ไม่ว่างเปล่า', () => {
    const table: RawFileTable = { headers: ['a'], rows: [['1'], ['', ''], ['2']] };
    expect(countDataRows(table)).toBe(2);
  });

  it('ไม่มีแถวข้อมูลเลย = 0', () => {
    expect(countDataRows({ headers: [], rows: [] })).toBe(0);
  });
});

const EMPTY_BANK: BankColumnMapping = {
  transactionDate: null,
  description: null,
  moneyIn: null,
  moneyOut: null,
  balance: null,
};
const EMPTY_GL: GLColumnMapping = { date: null, docNo: null, description: null, debit: null, credit: null };

describe('isBankMappingComplete', () => {
  it('ไม่ได้จับคู่อะไรเลย = false', () => {
    expect(isBankMappingComplete(EMPTY_BANK)).toBe(false);
  });

  it('มีวันที่รายการ แต่ไม่มีเงินเข้า/เงินออกเลย = false', () => {
    expect(isBankMappingComplete({ ...EMPTY_BANK, transactionDate: 0 })).toBe(false);
  });

  it('มีวันที่รายการ + เงินเข้า = true', () => {
    expect(isBankMappingComplete({ ...EMPTY_BANK, transactionDate: 0, moneyIn: 2 })).toBe(true);
  });

  it('มีวันที่รายการ + เงินออก (ไม่มีเงินเข้า) = true — ไม่บังคับทั้งคู่พร้อมกัน', () => {
    expect(isBankMappingComplete({ ...EMPTY_BANK, transactionDate: 0, moneyOut: 3 })).toBe(true);
  });

  it('มีเงินเข้าแต่ไม่มีวันที่รายการ = false', () => {
    expect(isBankMappingComplete({ ...EMPTY_BANK, moneyIn: 2 })).toBe(false);
  });
});

describe('isGLMappingComplete', () => {
  it('ไม่ได้จับคู่อะไรเลย = false', () => {
    expect(isGLMappingComplete(EMPTY_GL)).toBe(false);
  });

  it('มีวันที่ + เดบิต = true', () => {
    expect(isGLMappingComplete({ ...EMPTY_GL, date: 0, debit: 3 })).toBe(true);
  });

  it('มีวันที่ + เครดิต (ไม่มีเดบิต) = true — ไม่บังคับทั้งคู่พร้อมกัน', () => {
    expect(isGLMappingComplete({ ...EMPTY_GL, date: 0, credit: 4 })).toBe(true);
  });

  it('มีวันที่แต่ไม่มีเดบิต/เครดิตเลย = false', () => {
    expect(isGLMappingComplete({ ...EMPTY_GL, date: 0 })).toBe(false);
  });
});
