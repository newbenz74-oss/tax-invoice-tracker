import { describe, expect, it } from 'vitest';
import {
  allRowsReadyForReconciliation,
  countDataRows,
  isBankMappingComplete,
  isGLMappingComplete,
  validateFileType,
  validateParsedTable,
} from './bankReconcileValidation';
import type { BankColumnMapping, BankRow, GLColumnMapping, GLRow, RawFileTable } from '@/types/bankReconcile';

describe('validateFileType', () => {
  it('ยอมรับ .xlsx / .xls / .csv / .pdf', () => {
    expect(validateFileType('a.xlsx')).toBeNull();
    expect(validateFileType('a.xls')).toBeNull();
    expect(validateFileType('a.csv')).toBeNull();
    expect(validateFileType('a.pdf')).toBeNull();
  });

  it('ปฏิเสธนามสกุลอื่น พร้อมข้อความแจ้งเตือนภาษาไทยที่บอกนามสกุลที่รองรับ', () => {
    const error = validateFileType('a.txt');
    expect(error).not.toBeNull();
    expect(error).toContain('.xlsx');
    expect(error).toContain('.csv');
    expect(error).toContain('.pdf');
  });
});

describe('validateParsedTable', () => {
  it('ไฟล์ว่างเปล่าสนิท (ไม่มีทั้งหัวคอลัมน์และแถวข้อมูล) — invalid พร้อม error เดียว', () => {
    const result = validateParsedTable({ headers: [], rows: [] });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('ว่างเปล่า');
  });

  it('headers เป็น array ว่างเปล่าจริงๆ (ไม่มีคอลัมน์เลย) แต่มีแถวข้อมูล — invalid เพราะไม่พบโครงสร้างคอลัมน์', () => {
    const result = validateParsedTable({ headers: [], rows: [['a', 'b', 'c']] });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('โครงสร้างคอลัมน์'))).toBe(true);
  });

  it('headers ทุกเซลล์เป็นสตริงว่าง แต่ยังมีความกว้างคอลัมน์ (headers.length > 0) — valid เสมอ เพราะ headers.length คือตัวตัดสิน ไม่ใช่เนื้อหาข้อความ (รองรับไฟล์ PDF ที่แปลงมาไม่มี header แถวจริง)', () => {
    const result = validateParsedTable({ headers: ['', '', ''], rows: [['a', 'b', 'c']] });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
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

  it('ไม่มีทั้งโครงสร้างคอลัมน์ (headers ว่างเปล่าจริง) และแถวข้อมูลที่ใช้ได้ (แต่ไม่ใช่ไฟล์ว่างเปล่าสนิท เพราะมีแถวอยู่) — สะสม error ทั้งสองข้อพร้อมกัน ไม่ return แค่ข้อแรก', () => {
    const result = validateParsedTable({ headers: [], rows: [['']] });
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

// ครบทั้ง 6 ฟิลด์ตาม BankColumnKey — required: transactionDate/description/moneyIn/moneyOut,
// optional (แต่ยังต้องระบุ null ใน object literal เพราะเป็น Record บังคับ key ครบ): balance/accountNo
const EMPTY_BANK: BankColumnMapping = {
  transactionDate: null,
  description: null,
  moneyIn: null,
  moneyOut: null,
  balance: null,
  accountNo: null,
};

// ครบทั้ง 6 ฟิลด์ตาม GLColumnKey — required: date/description/moneyIn/moneyOut, optional: docNo/accountCode
const EMPTY_GL: GLColumnMapping = {
  date: null,
  docNo: null,
  description: null,
  moneyIn: null,
  moneyOut: null,
  accountCode: null,
};

describe('isBankMappingComplete', () => {
  // โมเดลใหม่บังคับครบทั้ง 4 ฟิลด์ (วันที่รายการ/รายละเอียด/เงินเข้า/เงินออก) พร้อมกันเสมอ ตามสเปกส่วน
  // "10. COLUMN MAPPING" เป๊ะ — ต่างจากโมเดลเดิมที่ยอมให้มีแค่เงินเข้า "หรือ" เงินออกอย่างใดอย่างหนึ่งก็พอ
  it('ไม่ได้จับคู่อะไรเลย = false', () => {
    expect(isBankMappingComplete(EMPTY_BANK)).toBe(false);
  });

  it('มีครบวันที่รายการ + รายละเอียด + เงินเข้า + เงินออก = true', () => {
    expect(
      isBankMappingComplete({ ...EMPTY_BANK, transactionDate: 0, description: 1, moneyIn: 2, moneyOut: 3 })
    ).toBe(true);
  });

  it('มีเงินเข้าอย่างเดียว ไม่มีเงินออก = false — บังคับทั้งคู่พร้อมกัน (ต่างจากโมเดลเดิม)', () => {
    expect(isBankMappingComplete({ ...EMPTY_BANK, transactionDate: 0, description: 1, moneyIn: 2 })).toBe(false);
  });

  it('มีเงินออกอย่างเดียว ไม่มีเงินเข้า = false', () => {
    expect(isBankMappingComplete({ ...EMPTY_BANK, transactionDate: 0, description: 1, moneyOut: 3 })).toBe(false);
  });

  it('มีเงินเข้า/เงินออกครบ แต่ไม่มีวันที่รายการ = false', () => {
    expect(isBankMappingComplete({ ...EMPTY_BANK, description: 1, moneyIn: 2, moneyOut: 3 })).toBe(false);
  });

  it('มีเงินเข้า/เงินออก/วันที่ครบ แต่ไม่มีรายละเอียด = false', () => {
    expect(isBankMappingComplete({ ...EMPTY_BANK, transactionDate: 0, moneyIn: 2, moneyOut: 3 })).toBe(false);
  });

  it('ยอดคงเหลือและเลขที่บัญชีไม่บังคับ — ไม่จับคู่เลยก็ยัง true ได้ถ้าฟิลด์บังคับ 4 ตัวครบ', () => {
    expect(
      isBankMappingComplete({
        transactionDate: 0,
        description: 1,
        moneyIn: 2,
        moneyOut: 3,
        balance: null,
        accountNo: null,
      })
    ).toBe(true);
  });
});

describe('isGLMappingComplete', () => {
  it('ไม่ได้จับคู่อะไรเลย = false', () => {
    expect(isGLMappingComplete(EMPTY_GL)).toBe(false);
  });

  it('มีครบวันที่ + รายละเอียด + เงินเข้า(ฝั่งรับเงิน) + เงินออก(ฝั่งจ่ายเงิน) = true', () => {
    expect(isGLMappingComplete({ ...EMPTY_GL, date: 0, description: 1, moneyIn: 2, moneyOut: 3 })).toBe(true);
  });

  it('มีฝั่งรับเงินอย่างเดียว ไม่มีฝั่งจ่ายเงิน = false — บังคับทั้งคู่พร้อมกัน', () => {
    expect(isGLMappingComplete({ ...EMPTY_GL, date: 0, description: 1, moneyIn: 2 })).toBe(false);
  });

  it('มีฝั่งจ่ายเงินอย่างเดียว ไม่มีฝั่งรับเงิน = false', () => {
    expect(isGLMappingComplete({ ...EMPTY_GL, date: 0, description: 1, moneyOut: 3 })).toBe(false);
  });

  it('มีวันที่แต่ไม่มีเงินเข้า/เงินออกเลย = false', () => {
    expect(isGLMappingComplete({ ...EMPTY_GL, date: 0, description: 1 })).toBe(false);
  });

  it('เลขที่เอกสารและรหัสบัญชีไม่บังคับ', () => {
    expect(
      isGLMappingComplete({ date: 0, description: 1, moneyIn: 2, moneyOut: 3, docNo: null, accountCode: null })
    ).toBe(true);
  });
});

/** สร้าง BankRow ที่ใช้ได้ (usable) เป็นค่าเริ่มต้น — override เฉพาะฟิลด์ที่ต้องการทดสอบ */
function buildBankRow(overrides: Partial<BankRow> = {}): BankRow {
  return {
    id: 'bank-1',
    rowNumber: 2,
    date: '2026-07-16',
    description: 'ค่าสินค้า',
    moneyInRaw: 1000,
    moneyOutRaw: 0,
    direction: 'income',
    amount: 1000,
    balance: null,
    accountNo: '',
    rawRow: [],
    excluded: false,
    errors: [],
    ...overrides,
  };
}

/** สร้าง GLRow ที่ใช้ได้ (usable) เป็นค่าเริ่มต้น — override เฉพาะฟิลด์ที่ต้องการทดสอบ */
function buildGLRow(overrides: Partial<GLRow> = {}): GLRow {
  return {
    id: 'gl-1',
    rowNumber: 2,
    date: '2026-07-16',
    description: 'รับชำระค่าสินค้า',
    moneyInRaw: 1000,
    moneyOutRaw: 0,
    direction: 'income',
    amount: 1000,
    docNo: '',
    accountCode: '',
    rawRow: [],
    excluded: false,
    errors: [],
    ...overrides,
  };
}

describe('allRowsReadyForReconciliation', () => {
  it('ไม่มีแถวเลย = true (vacuously — ไม่มีอะไรกั้น)', () => {
    expect(allRowsReadyForReconciliation([])).toBe(true);
  });

  it('ทุกแถว usable ทั้งหมด = true', () => {
    expect(allRowsReadyForReconciliation([buildBankRow(), buildGLRow()])).toBe(true);
  });

  it('มีแถวที่ error ค้างอยู่ (ไม่ถูกยกเว้น) = false — ต้องแก้ไขหรือยกเว้นก่อนเริ่มกระทบยอด', () => {
    expect(
      allRowsReadyForReconciliation([buildBankRow({ direction: null, errors: ['หาทิศทางไม่ได้'] })])
    ).toBe(false);
  });

  it('แถว error ที่ถูกยกเว้น (excluded) แล้ว = ไม่นับเป็นตัวกั้น — true', () => {
    expect(
      allRowsReadyForReconciliation([
        buildBankRow({ direction: null, errors: ['หาทิศทางไม่ได้'], excluded: true }),
      ])
    ).toBe(true);
  });

  it('แถวที่ยกเว้นแต่ไม่มี error เลย ก็ยังถือว่าพร้อม (excluded ชนะเงื่อนไขอื่นเสมอ)', () => {
    expect(allRowsReadyForReconciliation([buildBankRow({ excluded: true })])).toBe(true);
  });

  it('ผสม Bank และ GL ในลิสต์เดียวกัน — ต้องพร้อมทุกแถวไม่ว่าจะเป็นฝั่งไหน', () => {
    expect(
      allRowsReadyForReconciliation([
        buildBankRow(),
        buildGLRow({ direction: null, errors: ['หาทิศทางไม่ได้'] }),
      ])
    ).toBe(false);
  });
});
