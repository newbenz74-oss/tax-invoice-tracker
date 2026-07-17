import { describe, expect, it } from 'vitest';
import {
  buildBankTransactionPayload,
  buildGLTransactionPayload,
  extractBankReviewFlags,
  extractGLReviewFlags,
  mapDbRowsToSessionCore,
  mapDbRowToBankRow,
  mapDbRowToGLRow,
} from './bankReconcileSessionMapping';
import { DEFAULT_BANK_REVIEW_FLAGS, DEFAULT_GL_REVIEW_FLAGS } from '@/types/bankReconcile';
import type { BankReviewFlags, BankRow, GLReviewFlags, GLRow } from '@/types/bankReconcile';
import type { BankTransactionDbRow, GLTransactionDbRow } from '@/types/bankReconcileSession';

function buildBankRow(overrides: Partial<BankRow> = {}): BankRow {
  return {
    id: 'bank-1',
    rowNumber: 2,
    date: '2026-07-15',
    description: 'รับโอนจากลูกค้า A',
    moneyInRaw: 1000,
    moneyOutRaw: 0,
    direction: 'income',
    amount: 1000,
    balance: 5000,
    accountNo: '123-4-56789-0',
    rawRow: ['15/07/2026', 'รับโอนจากลูกค้า A', '1000', '', '5000'],
    excluded: false,
    errors: [],
    ...overrides,
  };
}

function buildGLRow(overrides: Partial<GLRow> = {}): GLRow {
  return {
    id: 'gl-1',
    rowNumber: 2,
    date: '2026-07-15',
    description: 'รับชำระจากลูกค้า A',
    moneyInRaw: 1000,
    moneyOutRaw: 0,
    direction: 'income',
    amount: 1000,
    docNo: 'JV-001',
    accountCode: '1100',
    rawRow: ['15/07/2026', 'JV-001', 'รับชำระจากลูกค้า A', '1000', ''],
    excluded: false,
    errors: [],
    ...overrides,
  };
}

function buildBankDbRow(overrides: Partial<BankTransactionDbRow> = {}): BankTransactionDbRow {
  return {
    id: 'uuid-bank-1',
    session_id: 'session-1',
    row_number: 2,
    transaction_date: '2026-07-15',
    description: 'รับโอนจากลูกค้า A',
    money_in: 1000,
    money_out: 0,
    direction: 'income',
    amount: 1000,
    balance: 5000,
    account_no: '123-4-56789-0',
    raw_row: ['15/07/2026', 'รับโอนจากลูกค้า A', '1000', '', '5000'],
    excluded: false,
    row_errors: [],
    needs_gl_entry: false,
    reviewed: false,
    review_note: '',
    created_at: '2026-07-16T00:00:00.000Z',
    ...overrides,
  };
}

function buildGLDbRow(overrides: Partial<GLTransactionDbRow> = {}): GLTransactionDbRow {
  return {
    id: 'uuid-gl-1',
    session_id: 'session-1',
    row_number: 2,
    transaction_date: '2026-07-15',
    description: 'รับชำระจากลูกค้า A',
    money_in: 1000,
    money_out: 0,
    direction: 'income',
    amount: 1000,
    doc_no: 'JV-001',
    account_code: '1100',
    raw_row: ['15/07/2026', 'JV-001', 'รับชำระจากลูกค้า A', '1000', ''],
    excluded: false,
    row_errors: [],
    needs_gl_review: false,
    reviewed: false,
    review_note: '',
    created_at: '2026-07-16T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildBankTransactionPayload', () => {
  it('แปลง BankRow + ธงตรวจสอบ เป็น payload ครบทุกฟิลด์ตรงชื่อคอลัมน์ฐานข้อมูล', () => {
    const row = buildBankRow();
    const flags: BankReviewFlags = { needsGlEntry: true, reviewed: true, reviewNote: 'ตรวจสอบแล้ว' };
    const payload = buildBankTransactionPayload(row, flags);
    expect(payload).toEqual({
      row_number: 2,
      transaction_date: '2026-07-15',
      description: 'รับโอนจากลูกค้า A',
      money_in: 1000,
      money_out: 0,
      direction: 'income',
      amount: 1000,
      balance: 5000,
      account_no: '123-4-56789-0',
      raw_row: row.rawRow,
      excluded: false,
      row_errors: [],
      needs_gl_entry: true,
      reviewed: true,
      review_note: 'ตรวจสอบแล้ว',
    });
  });

  it('ไม่มีธงตรวจสอบส่งมา (undefined) — ใช้ค่าเริ่มต้น DEFAULT_BANK_REVIEW_FLAGS แทน ไม่ throw', () => {
    const payload = buildBankTransactionPayload(buildBankRow(), undefined);
    expect(payload.needs_gl_entry).toBe(DEFAULT_BANK_REVIEW_FLAGS.needsGlEntry);
    expect(payload.reviewed).toBe(DEFAULT_BANK_REVIEW_FLAGS.reviewed);
    expect(payload.review_note).toBe(DEFAULT_BANK_REVIEW_FLAGS.reviewNote);
  });

  it('ไม่มี "id" ปนอยู่ใน payload เลย — ฐานข้อมูลสร้าง uuid ใหม่ให้ทุกแถวเสมอผ่าน full-snapshot replace', () => {
    const payload = buildBankTransactionPayload(buildBankRow(), undefined);
    expect(payload).not.toHaveProperty('id');
  });

  it('ยอดคงเหลือเป็น null เมื่อไม่ได้จับคู่คอลัมน์ไว้ — ส่งผ่านตรงๆ ไม่แปลงเป็น 0', () => {
    const payload = buildBankTransactionPayload(buildBankRow({ balance: null }), undefined);
    expect(payload.balance).toBeNull();
  });
});

describe('buildGLTransactionPayload', () => {
  it('แปลง GLRow + ธงตรวจสอบ เป็น payload ครบทุกฟิลด์ตรงชื่อคอลัมน์ฐานข้อมูล', () => {
    const row = buildGLRow();
    const flags: GLReviewFlags = { needsGlReview: true, reviewed: false, reviewNote: 'รอเอกสาร' };
    const payload = buildGLTransactionPayload(row, flags);
    expect(payload).toEqual({
      row_number: 2,
      transaction_date: '2026-07-15',
      description: 'รับชำระจากลูกค้า A',
      money_in: 1000,
      money_out: 0,
      direction: 'income',
      amount: 1000,
      doc_no: 'JV-001',
      account_code: '1100',
      raw_row: row.rawRow,
      excluded: false,
      row_errors: [],
      needs_gl_review: true,
      reviewed: false,
      review_note: 'รอเอกสาร',
    });
  });

  it('ไม่มีธงตรวจสอบส่งมา (undefined) — ใช้ค่าเริ่มต้น DEFAULT_GL_REVIEW_FLAGS แทน', () => {
    const payload = buildGLTransactionPayload(buildGLRow(), undefined);
    expect(payload.needs_gl_review).toBe(DEFAULT_GL_REVIEW_FLAGS.needsGlReview);
    expect(payload.reviewed).toBe(DEFAULT_GL_REVIEW_FLAGS.reviewed);
    expect(payload.review_note).toBe(DEFAULT_GL_REVIEW_FLAGS.reviewNote);
  });
});

describe('mapDbRowToBankRow / mapDbRowToGLRow', () => {
  it('แปลงแถวฐานข้อมูล Bank กลับเป็น BankRow ครบทุกฟิลด์ — id ใช้ uuid ถาวรจากฐานข้อมูลตรงๆ (ไม่ใช่ "bank-N" อีกต่อไป)', () => {
    const dbRow = buildBankDbRow({ id: 'uuid-real-1' });
    const row = mapDbRowToBankRow(dbRow);
    expect(row).toEqual({
      id: 'uuid-real-1',
      rowNumber: 2,
      date: '2026-07-15',
      description: 'รับโอนจากลูกค้า A',
      moneyInRaw: 1000,
      moneyOutRaw: 0,
      direction: 'income',
      amount: 1000,
      balance: 5000,
      accountNo: '123-4-56789-0',
      rawRow: dbRow.raw_row,
      excluded: false,
      errors: [],
    });
  });

  it('แปลงแถวฐานข้อมูล GL กลับเป็น GLRow ครบทุกฟิลด์', () => {
    const dbRow = buildGLDbRow({ id: 'uuid-real-2' });
    const row = mapDbRowToGLRow(dbRow);
    expect(row).toEqual({
      id: 'uuid-real-2',
      rowNumber: 2,
      date: '2026-07-15',
      description: 'รับชำระจากลูกค้า A',
      moneyInRaw: 1000,
      moneyOutRaw: 0,
      direction: 'income',
      amount: 1000,
      docNo: 'JV-001',
      accountCode: '1100',
      rawRow: dbRow.raw_row,
      excluded: false,
      errors: [],
    });
  });

  it('excluded=true และ row_errors ไม่ว่างเปล่า ก็แปลงกลับมาถูกต้องครบ (แถวที่เคยมีปัญหา/ถูกยกเว้นตอนบันทึกไว้)', () => {
    const dbRow = buildBankDbRow({ excluded: true, row_errors: ['พบทั้งเงินเข้าและเงินออกในแถวเดียวกัน กรุณาตรวจสอบ'], direction: null });
    const row = mapDbRowToBankRow(dbRow);
    expect(row.excluded).toBe(true);
    expect(row.errors).toEqual(['พบทั้งเงินเข้าและเงินออกในแถวเดียวกัน กรุณาตรวจสอบ']);
    expect(row.direction).toBeNull();
  });
});

describe('extractBankReviewFlags / extractGLReviewFlags', () => {
  it('ดึงธงตรวจสอบ Bank จากคอลัมน์ตรงบนแถวเดียวกันเลย (ไม่ใช่ join จากตารางแยก)', () => {
    const dbRow = buildBankDbRow({ needs_gl_entry: true, reviewed: true, review_note: 'บันทึกเพิ่มแล้ว' });
    expect(extractBankReviewFlags(dbRow)).toEqual({ needsGlEntry: true, reviewed: true, reviewNote: 'บันทึกเพิ่มแล้ว' });
  });

  it('ดึงธงตรวจสอบ GL จากคอลัมน์ตรงบนแถวเดียวกัน', () => {
    const dbRow = buildGLDbRow({ needs_gl_review: true, reviewed: false, review_note: 'รอตรวจสอบ' });
    expect(extractGLReviewFlags(dbRow)).toEqual({ needsGlReview: true, reviewed: false, reviewNote: 'รอตรวจสอบ' });
  });

  it('ค่าเริ่มต้น (ไม่เคยตั้งธงเลย) คืนค่า false/ว่างเปล่าตรงไปตรงมา', () => {
    expect(extractBankReviewFlags(buildBankDbRow())).toEqual({ needsGlEntry: false, reviewed: false, reviewNote: '' });
    expect(extractGLReviewFlags(buildGLDbRow())).toEqual({ needsGlReview: false, reviewed: false, reviewNote: '' });
  });
});

describe('mapDbRowsToSessionCore', () => {
  it('สร้าง bankRows/glRows/bankReviewFlags/glReviewFlags ครบทั้งสี่ค่าจากแถวฐานข้อมูลชุดเดียวกันในรอบเดียว', () => {
    const bankDbRows = [buildBankDbRow({ id: 'b-1' })];
    const glDbRows = [buildGLDbRow({ id: 'g-1' })];

    const result = mapDbRowsToSessionCore(bankDbRows, glDbRows);

    expect(result.bankRows).toHaveLength(1);
    expect(result.bankRows[0].id).toBe('b-1');
    expect(result.glRows).toHaveLength(1);
    expect(result.glRows[0].id).toBe('g-1');
    expect(result.bankReviewFlags['b-1']).toBeDefined();
    expect(result.glReviewFlags['g-1']).toBeDefined();
  });

  it('BankRow.id ที่ได้ตรงกับ key ของ bankReviewFlags เสมอโดยธรรมชาติ — ไม่มีขั้นตอน remap แยกต่างหากเหมือนโมเดลเดิม', () => {
    const bankDbRows = [buildBankDbRow({ id: 'uuid-A', needs_gl_entry: true, review_note: 'note-A' })];
    const result = mapDbRowsToSessionCore(bankDbRows, []);
    const rowId = result.bankRows[0].id;
    expect(result.bankReviewFlags[rowId]).toEqual({ needsGlEntry: true, reviewed: false, reviewNote: 'note-A' });
  });

  it('GLRow.id ตรงกับ key ของ glReviewFlags เช่นเดียวกัน', () => {
    const glDbRows = [buildGLDbRow({ id: 'uuid-B', needs_gl_review: true, review_note: 'note-B' })];
    const result = mapDbRowsToSessionCore([], glDbRows);
    const rowId = result.glRows[0].id;
    expect(result.glReviewFlags[rowId]).toEqual({ needsGlReview: true, reviewed: false, reviewNote: 'note-B' });
  });

  it('เรียงลำดับแถว Bank ตาม rowNumber เสมอ (ไม่พึ่งลำดับ SELECT จากฐานข้อมูล)', () => {
    const bankDbRows = [buildBankDbRow({ id: 'b-2', row_number: 4 }), buildBankDbRow({ id: 'b-1', row_number: 2 })];
    const result = mapDbRowsToSessionCore(bankDbRows, []);
    expect(result.bankRows.map((r) => r.id)).toEqual(['b-1', 'b-2']);
  });

  it('เรียงลำดับแถว GL ตาม rowNumber เช่นเดียวกัน', () => {
    const glDbRows = [buildGLDbRow({ id: 'g-2', row_number: 5 }), buildGLDbRow({ id: 'g-1', row_number: 3 })];
    const result = mapDbRowsToSessionCore([], glDbRows);
    expect(result.glRows.map((r) => r.id)).toEqual(['g-1', 'g-2']);
  });

  it('ไม่มีแถวเลยทั้งสองฝั่ง — คืนค่าว่างเปล่าทั้งสี่ค่าโดยไม่ error', () => {
    const result = mapDbRowsToSessionCore([], []);
    expect(result.bankRows).toEqual([]);
    expect(result.glRows).toEqual([]);
    expect(result.bankReviewFlags).toEqual({});
    expect(result.glReviewFlags).toEqual({});
  });
});
