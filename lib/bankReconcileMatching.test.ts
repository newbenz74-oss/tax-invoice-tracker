import { describe, expect, it } from 'vitest';
import { runReconciliationMatch, toMatchBankRows, toMatchGLRows } from './bankReconcileMatching';
import type { MatchBankRow, MatchGLRow, NormalizedBankRow, NormalizedGLRow, RawFileTable } from '@/types/bankReconcile';

function makeBankRow(overrides: Partial<MatchBankRow> = {}): MatchBankRow {
  return {
    bank_row_id: 'bank-2',
    bank_date: '2026-07-15',
    bank_description: 'รายการทดสอบ Bank',
    bank_money_in: 1000,
    bank_money_out: 0,
    bank_amount: 1000,
    bank_balance: 5000,
    raw_bank_row: [],
    ...overrides,
  };
}

function makeGLRow(overrides: Partial<MatchGLRow> = {}): MatchGLRow {
  return {
    gl_row_id: 'gl-2',
    gl_date: '2026-07-15',
    gl_document_no: 'JV-001',
    gl_description: 'รายการทดสอบ GL',
    gl_debit: 1000,
    gl_credit: 0,
    gl_amount: 1000,
    raw_gl_row: [],
    ...overrides,
  };
}

describe('toMatchBankRows / toMatchGLRows', () => {
  it('แปลงฟิลด์ครบถ้วนตรงตามชื่อที่สเปกกำหนด และเก็บ raw_bank_row/raw_gl_row ถูกแถว', () => {
    const table: RawFileTable = {
      headers: ['วันที่', 'รายละเอียด', 'เงินเข้า', 'เงินออก', 'ยอดคงเหลือ'],
      rows: [
        ['15/07/2026', 'รับโอน', '1000', '', '1000'], // idx 0 -> rowNumber 2
        [], // idx 1 -> rowNumber 3 (แถวว่าง ถูกข้ามตอน normalize)
        ['16/07/2026', 'จ่ายเงิน', '', '500', '500'], // idx 2 -> rowNumber 4
      ],
    };
    const normalized: NormalizedBankRow[] = [
      { rowNumber: 2, transactionDate: '2026-07-15', description: 'รับโอน', moneyIn: 1000, moneyOut: 0, balance: 1000, signedAmount: 1000 },
      { rowNumber: 4, transactionDate: '2026-07-16', description: 'จ่ายเงิน', moneyIn: 0, moneyOut: 500, balance: 500, signedAmount: -500 },
    ];

    const result = toMatchBankRows(table, normalized);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      bank_row_id: 'bank-2',
      bank_date: '2026-07-15',
      bank_description: 'รับโอน',
      bank_money_in: 1000,
      bank_money_out: 0,
      bank_amount: 1000,
      bank_balance: 1000,
      raw_bank_row: table.rows[0],
    });
    // แถวที่สอง (rowNumber 4) ต้องชี้ไป table.rows[2] ถูกต้อง แม้จะมีแถวว่างคั่นอยู่ตรงกลาง (idx 1)
    expect(result[1].raw_bank_row).toBe(table.rows[2]);
    expect(result[1].bank_amount).toBe(-500); // เงินออก = ลบ (sign convention เดิมจากเฟส 1)
  });

  it('แปลง GL ครบถ้วน และ gl_amount ใช้ signedAmount เดิม (debit - credit) ตรงๆ', () => {
    const table: RawFileTable = {
      headers: ['วันที่', 'เลขที่เอกสาร', 'รายละเอียด', 'เดบิต', 'เครดิต'],
      rows: [['15/07/2026', 'JV-001', 'รับชำระ', '1000', '']],
    };
    const normalized: NormalizedGLRow[] = [
      { rowNumber: 2, date: '2026-07-15', docNo: 'JV-001', description: 'รับชำระ', debit: 1000, credit: 0, signedAmount: 1000 },
    ];

    const result = toMatchGLRows(table, normalized);

    expect(result[0]).toEqual({
      gl_row_id: 'gl-2',
      gl_date: '2026-07-15',
      gl_document_no: 'JV-001',
      gl_description: 'รับชำระ',
      gl_debit: 1000,
      gl_credit: 0,
      gl_amount: 1000,
      raw_gl_row: table.rows[0],
    });
  });
});

describe('runReconciliationMatch — MATCHING PRIORITY', () => {
  it('1. ยอดเงินและวันที่ตรงกันเป๊ะ มีผู้สมัครเดียว -> เรียบร้อย (matched_exact) คะแนน 100', () => {
    const bank = [makeBankRow({ bank_row_id: 'bank-2', bank_amount: 1000, bank_date: '2026-07-15' })];
    const gl = [makeGLRow({ gl_row_id: 'gl-2', gl_amount: 1000, gl_date: '2026-07-15' })];

    const { bankResults, glOnlyResults } = runReconciliationMatch(bank, gl, 3);

    expect(bankResults).toHaveLength(1);
    expect(bankResults[0].status).toBe('matched_exact');
    expect(bankResults[0].matchedGL?.gl_row_id).toBe('gl-2');
    expect(bankResults[0].matchScore).toBe(100);
    expect(bankResults[0].amountDifference).toBe(0);
    expect(bankResults[0].dateDifferenceDays).toBe(0);
    expect(bankResults[0].matchReason).toBe('ยอดเงินตรงกัน และวันที่ตรงกัน');
    expect(glOnlyResults).toHaveLength(0);
  });

  it('2. ยอดตรงกัน วันที่ต่างกัน 1 วัน (อยู่ใน tolerance) -> น่าจะตรงกัน (matched_tolerance) คะแนน 90', () => {
    const bank = [makeBankRow({ bank_amount: 1000, bank_date: '2026-07-15' })];
    const gl = [makeGLRow({ gl_amount: 1000, gl_date: '2026-07-16' })];

    const { bankResults } = runReconciliationMatch(bank, gl, 3);

    expect(bankResults[0].status).toBe('matched_tolerance');
    expect(bankResults[0].matchScore).toBe(90);
    expect(bankResults[0].dateDifferenceDays).toBe(1);
    expect(bankResults[0].matchReason).toBe('ยอดเงินตรงกัน แต่วันที่ต่างกัน 1 วัน');
  });

  it('3. ยอดตรงกัน วันที่ต่างกัน 3 วัน อยู่ใน tolerance ±3 -> น่าจะตรงกัน คะแนน 80', () => {
    const bank = [makeBankRow({ bank_amount: 1000, bank_date: '2026-07-15' })];
    const gl = [makeGLRow({ gl_amount: 1000, gl_date: '2026-07-18' })];

    const { bankResults } = runReconciliationMatch(bank, gl, 3);

    expect(bankResults[0].status).toBe('matched_tolerance');
    expect(bankResults[0].matchScore).toBe(80);
    expect(bankResults[0].dateDifferenceDays).toBe(3);
  });

  it('4. ยอดตรงกัน แต่วันที่ต่างกันเกินช่วง tolerance ที่เลือกไว้ -> รอตรวจสอบ คะแนน 70', () => {
    const bank = [makeBankRow({ bank_amount: 1000, bank_date: '2026-07-15' })];
    const gl = [makeGLRow({ gl_amount: 1000, gl_date: '2026-07-18' })]; // ต่างกัน 3 วัน

    const { bankResults } = runReconciliationMatch(bank, gl, 1); // tolerance ±1 เท่านั้น

    expect(bankResults[0].status).toBe('pending_review');
    expect(bankResults[0].matchScore).toBe(70);
    expect(bankResults[0].dateDifferenceDays).toBe(3);
    expect(bankResults[0].matchedGL).toBeNull();
    expect(bankResults[0].matchReason).toContain('เกินช่วงเวลาที่กำหนด');
  });

  it('5. ยอดตรงกันเป๊ะ วันที่ตรงเป๊ะทั้งคู่ มีผู้สมัคร GL 2 รายการ -> พบหลายรายการที่อาจตรงกัน', () => {
    const bank = [makeBankRow({ bank_amount: 1000, bank_date: '2026-07-15' })];
    const gl = [
      makeGLRow({ gl_row_id: 'gl-2', gl_amount: 1000, gl_date: '2026-07-15' }),
      makeGLRow({ gl_row_id: 'gl-3', gl_amount: 1000, gl_date: '2026-07-15' }),
    ];

    const { bankResults, glOnlyResults } = runReconciliationMatch(bank, gl, 3);

    expect(bankResults[0].status).toBe('ambiguous');
    expect(bankResults[0].matchedGL).toBeNull();
    expect(bankResults[0].matchScore).toBeNull();
    expect(bankResults[0].candidates).toHaveLength(2);
    // ไม่มีอะไรถูกเลือกอัตโนมัติ -> GL ทั้งสองแถวยังว่างอยู่ ปรากฏในส่วน "ไม่พบใน Bank" ด้วย (ยังไม่ถูกใช้จริง)
    expect(glOnlyResults).toHaveLength(2);
  });

  it('6. ไม่มียอดเงินที่ตรงกันใน GL เลย -> ไม่พบใน GL', () => {
    const bank = [makeBankRow({ bank_amount: 1000 })];
    const gl = [makeGLRow({ gl_amount: 2000 })];

    const { bankResults } = runReconciliationMatch(bank, gl, 3);

    expect(bankResults[0].status).toBe('not_found_in_gl');
    expect(bankResults[0].matchedGL).toBeNull();
    expect(bankResults[0].candidates).toHaveLength(0);
    expect(bankResults[0].matchScore).toBeNull();
    expect(bankResults[0].matchReason).toBe('ไม่พบยอดเงินที่ตรงกันใน GL');
  });

  it('7. แถว GL ที่ไม่มี Bank แถวใดจับคู่ด้วยเลย -> ปรากฏใน glOnlyResults', () => {
    const bank = [makeBankRow({ bank_amount: 1000, bank_date: '2026-07-15' })];
    const gl = [
      makeGLRow({ gl_row_id: 'gl-2', gl_amount: 1000, gl_date: '2026-07-15' }),
      makeGLRow({ gl_row_id: 'gl-3', gl_amount: 9999, gl_date: '2026-07-20' }),
    ];

    const { glOnlyResults } = runReconciliationMatch(bank, gl, 3);

    expect(glOnlyResults).toHaveLength(1);
    expect(glOnlyResults[0].gl.gl_row_id).toBe('gl-3');
    expect(glOnlyResults[0].status).toBe('not_found_in_bank');
  });

  it('8. Bank ซ้ำ 2 แถว vs GL ซ้ำ 2 แถว (ยอด+วันที่เหมือนกันทุกประการ) -> ทั้งคู่ต้องเป็นพบหลายรายการที่อาจตรงกัน (ไม่ deterministic)', () => {
    const bank = [
      makeBankRow({ bank_row_id: 'bank-2', bank_amount: 1000, bank_date: '2026-07-15' }),
      makeBankRow({ bank_row_id: 'bank-3', bank_amount: 1000, bank_date: '2026-07-15' }),
    ];
    const gl = [
      makeGLRow({ gl_row_id: 'gl-2', gl_amount: 1000, gl_date: '2026-07-15' }),
      makeGLRow({ gl_row_id: 'gl-3', gl_amount: 1000, gl_date: '2026-07-15' }),
    ];

    const { bankResults, glOnlyResults } = runReconciliationMatch(bank, gl, 3);

    expect(bankResults.map((r) => r.status)).toEqual(['ambiguous', 'ambiguous']);
    expect(bankResults.every((r) => r.matchedGL === null)).toBe(true);
    // ไม่มี GL แถวใดถูกใช้เลย -> ทั้งสองแถวยังปรากฏเป็น "ไม่พบใน Bank" รอการตรวจสอบด้วยตนเองในเฟสถัดไป
    expect(glOnlyResults).toHaveLength(2);
  });

  it('9. GL ซ้ำ 2 แถว vs Bank แถวเดียว -> พบหลายรายการที่อาจตรงกัน ไม่เลือกอัตโนมัติ', () => {
    const bank = [makeBankRow({ bank_amount: 1000, bank_date: '2026-07-15' })];
    const gl = [
      makeGLRow({ gl_row_id: 'gl-2', gl_amount: 1000, gl_date: '2026-07-15' }),
      makeGLRow({ gl_row_id: 'gl-3', gl_amount: 1000, gl_date: '2026-07-15' }),
    ];

    const { bankResults } = runReconciliationMatch(bank, gl, 3);
    expect(bankResults[0].status).toBe('ambiguous');
  });

  it('10. ห้ามใช้แถว GL ซ้ำ — 3 แถว Bank ยอด/วันที่เหมือนกันหมด มี GL ตรงแค่ 2 แถว -> ทั้ง 3 แถว Bank ต้องเป็น ambiguous (ไม่ใช่ 2 matched + 1 not_found)', () => {
    const bank = [
      makeBankRow({ bank_row_id: 'bank-2', bank_amount: 1000, bank_date: '2026-07-15' }),
      makeBankRow({ bank_row_id: 'bank-3', bank_amount: 1000, bank_date: '2026-07-15' }),
      makeBankRow({ bank_row_id: 'bank-4', bank_amount: 1000, bank_date: '2026-07-15' }),
    ];
    const gl = [
      makeGLRow({ gl_row_id: 'gl-2', gl_amount: 1000, gl_date: '2026-07-15' }),
      makeGLRow({ gl_row_id: 'gl-3', gl_amount: 1000, gl_date: '2026-07-15' }),
    ];

    const { bankResults, glOnlyResults } = runReconciliationMatch(bank, gl, 3);

    expect(bankResults.map((r) => r.status)).toEqual(['ambiguous', 'ambiguous', 'ambiguous']);
    expect(glOnlyResults).toHaveLength(2); // ไม่มี GL แถวใดถูกใช้เลยสักแถว
  });

  it('การจับคู่แบบ deterministic: Bank/GL ยอดเท่ากันแต่วันที่ต่างกันชัดเจน -> จับคู่ matched_exact ถูกคู่ ไม่ปนกัน ไม่ใช้ GL ซ้ำ', () => {
    const bank = [
      makeBankRow({ bank_row_id: 'bank-2', bank_amount: 1000, bank_date: '2026-07-15' }),
      makeBankRow({ bank_row_id: 'bank-3', bank_amount: 1000, bank_date: '2026-07-16' }),
    ];
    const gl = [
      makeGLRow({ gl_row_id: 'gl-2', gl_amount: 1000, gl_date: '2026-07-15' }),
      makeGLRow({ gl_row_id: 'gl-3', gl_amount: 1000, gl_date: '2026-07-16' }),
    ];

    const { bankResults, glOnlyResults } = runReconciliationMatch(bank, gl, 3);

    expect(bankResults[0].status).toBe('matched_exact');
    expect(bankResults[0].matchedGL?.gl_row_id).toBe('gl-2');
    expect(bankResults[1].status).toBe('matched_exact');
    expect(bankResults[1].matchedGL?.gl_row_id).toBe('gl-3');
    expect(glOnlyResults).toHaveLength(0);
  });

  it('11/12. money-in / money-out ผ่าน toMatchBankRows แปลงเครื่องหมายถูกต้องก่อนเข้าสู่การจับคู่', () => {
    const table: RawFileTable = { headers: [], rows: [[], []] };
    const normalized: NormalizedBankRow[] = [
      { rowNumber: 2, transactionDate: '2026-07-15', description: 'เงินเข้า', moneyIn: 1000, moneyOut: 0, balance: 1000, signedAmount: 1000 },
      { rowNumber: 3, transactionDate: '2026-07-16', description: 'เงินออก', moneyIn: 0, moneyOut: 500, balance: 500, signedAmount: -500 },
    ];
    const bank = toMatchBankRows(table, normalized);
    const gl = [
      makeGLRow({ gl_row_id: 'gl-2', gl_amount: 1000, gl_date: '2026-07-15' }),
      makeGLRow({ gl_row_id: 'gl-3', gl_amount: -500, gl_date: '2026-07-16' }),
    ];

    const { bankResults } = runReconciliationMatch(bank, gl, 3);
    expect(bankResults[0].status).toBe('matched_exact'); // เงินเข้า +1000 จับคู่กับ GL +1000
    expect(bankResults[1].status).toBe('matched_exact'); // เงินออก -500 จับคู่กับ GL -500
  });

  it('13. ยอดเงินทศนิยมจับคู่ได้ถูกต้อง', () => {
    const bank = [makeBankRow({ bank_amount: 1234.56, bank_date: '2026-07-15' })];
    const gl = [makeGLRow({ gl_amount: 1234.56, gl_date: '2026-07-15' })];

    const { bankResults } = runReconciliationMatch(bank, gl, 3);
    expect(bankResults[0].status).toBe('matched_exact');
  });

  it('เทียบยอดเงินที่ทศนิยม 2 ตำแหน่งอย่างปลอดภัย ไม่หลุดเพราะ floating point (เช่น 100.1 + 0.2)', () => {
    const bank = [makeBankRow({ bank_amount: 100.1 + 0.2, bank_date: '2026-07-15' })]; // = 100.30000000000001 ก่อนปัด
    const gl = [makeGLRow({ gl_amount: 100.3, gl_date: '2026-07-15' })];

    const { bankResults } = runReconciliationMatch(bank, gl, 3);
    expect(bankResults[0].status).toBe('matched_exact');
  });

  it('15. เปลี่ยน Date Tolerance แล้วรันใหม่ ผลลัพธ์เปลี่ยนตามจริง (สถานะเดิม -> เปลี่ยนสถานะ)', () => {
    const bank = [makeBankRow({ bank_amount: 1000, bank_date: '2026-07-15' })];
    const gl = [makeGLRow({ gl_amount: 1000, gl_date: '2026-07-17' })]; // ต่างกัน 2 วัน

    const strict = runReconciliationMatch(bank, gl, 0); // วันเดียวกันเท่านั้น
    expect(strict.bankResults[0].status).toBe('pending_review');

    const wide = runReconciliationMatch(bank, gl, 7); // ±7 วัน
    expect(wide.bankResults[0].status).toBe('matched_tolerance');
    expect(wide.bankResults[0].dateDifferenceDays).toBe(2);
  });

  it('แถว Bank ที่วันที่แปลงไม่ได้ (null) แต่ยอดตรงกับ GL -> รอตรวจสอบ ไม่ใช่การจับคู่อัตโนมัติ', () => {
    const bank = [makeBankRow({ bank_amount: 1000, bank_date: null })];
    const gl = [makeGLRow({ gl_amount: 1000, gl_date: '2026-07-15' })];

    const { bankResults } = runReconciliationMatch(bank, gl, 3);

    expect(bankResults[0].status).toBe('pending_review');
    expect(bankResults[0].dateDifferenceDays).toBeNull();
    expect(bankResults[0].amountDifference).toBeNull();
    expect(bankResults[0].matchReason).toBe('ยอดเงินตรงกัน แต่ไม่สามารถเทียบวันที่ได้');
  });

  it('ทุกแถว Bank ต้องปรากฏในผลลัพธ์เสมอ แม้ไม่มีไฟล์ GL เลย (Bank เป็น primary source of truth)', () => {
    const bank = [makeBankRow({ bank_row_id: 'bank-2' }), makeBankRow({ bank_row_id: 'bank-3' })];
    const { bankResults } = runReconciliationMatch(bank, [], 3);
    expect(bankResults).toHaveLength(2);
    expect(bankResults.every((r) => r.status === 'not_found_in_gl')).toBe(true);
  });

  it('candidates เก็บผู้สมัครที่ยอดตรงกันไว้เสมอ ไม่ใช่แค่ตอน ambiguous (ใช้กับ Modal "ดูรายการที่อาจตรงกัน")', () => {
    const bank = [makeBankRow({ bank_amount: 1000, bank_date: '2026-07-15' })];
    const gl = [makeGLRow({ gl_amount: 1000, gl_date: '2026-07-15' })];
    const { bankResults } = runReconciliationMatch(bank, gl, 3);
    expect(bankResults[0].status).toBe('matched_exact');
    expect(bankResults[0].candidates).toHaveLength(1);
  });
});
