import { describe, expect, it } from 'vitest';
import { runSimpleReconciliation } from './bankReconcileMatching';
import type { BankRow, GLRow } from '@/types/bankReconcile';

function buildBankRow(overrides: Partial<BankRow> = {}): BankRow {
  return {
    id: 'bank-1',
    rowNumber: 2,
    date: '2026-07-15',
    description: 'รายการทดสอบ Bank',
    moneyInRaw: 1000,
    moneyOutRaw: 0,
    direction: 'income',
    amount: 1000,
    balance: 5000,
    accountNo: '',
    rawRow: [],
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
    description: 'รายการทดสอบ GL',
    moneyInRaw: 1000,
    moneyOutRaw: 0,
    direction: 'income',
    amount: 1000,
    docNo: 'JV-001',
    accountCode: '',
    rawRow: [],
    excluded: false,
    errors: [],
    ...overrides,
  };
}

describe('runSimpleReconciliation — พื้นฐาน', () => {
  it('ทิศทาง+จำนวนเงินตรงกันเป๊ะ = found_in_gl, difference = 0', () => {
    const bank = [buildBankRow({ id: 'bank-1', direction: 'income', amount: 1000 })];
    const gl = [buildGLRow({ id: 'gl-1', direction: 'income', amount: 1000 })];

    const { bankResults, glOnlyResults } = runSimpleReconciliation(bank, gl);

    expect(bankResults).toHaveLength(1);
    expect(bankResults[0].status).toBe('found_in_gl');
    expect(bankResults[0].matchedGL?.id).toBe('gl-1');
    expect(bankResults[0].difference).toBe(0);
    expect(glOnlyResults).toHaveLength(0);
  });

  it('ไม่มียอด+ทิศทางที่ตรงกันเลยใน GL = not_found_in_gl, difference = ยอดของ Bank แถวนั้น', () => {
    const bank = [buildBankRow({ id: 'bank-1', direction: 'income', amount: 1000 })];
    const gl = [buildGLRow({ id: 'gl-1', direction: 'income', amount: 2000 })];

    const { bankResults } = runSimpleReconciliation(bank, gl);

    expect(bankResults[0].status).toBe('not_found_in_gl');
    expect(bankResults[0].matchedGL).toBeNull();
    expect(bankResults[0].difference).toBe(1000);
  });

  it('ยอดเท่ากันแต่ทิศทางต่างกัน (income vs payment) = ไม่จับคู่กันเด็ดขาด — ห้ามเทียบข้ามทิศทาง', () => {
    const bank = [buildBankRow({ id: 'bank-1', direction: 'income', amount: 1000 })];
    const gl = [buildGLRow({ id: 'gl-1', direction: 'payment', amount: 1000 })];

    const { bankResults, glOnlyResults } = runSimpleReconciliation(bank, gl);

    expect(bankResults[0].status).toBe('not_found_in_gl');
    expect(glOnlyResults).toHaveLength(1);
    expect(glOnlyResults[0].gl.id).toBe('gl-1');
  });

  it('ไม่มี tolerance ใดๆ — ยอดต่างกันแม้แค่ 0.01 ก็ไม่จับคู่กัน', () => {
    const bank = [buildBankRow({ id: 'bank-1', direction: 'income', amount: 1000 })];
    const gl = [buildGLRow({ id: 'gl-1', direction: 'income', amount: 1000.01 })];

    const { bankResults } = runSimpleReconciliation(bank, gl);
    expect(bankResults[0].status).toBe('not_found_in_gl');
  });

  it('เทียบยอดเงินทศนิยมอย่างปลอดภัย ไม่หลุดเพราะ floating point (เช่น 100.1 + 0.2)', () => {
    const bank = [buildBankRow({ id: 'bank-1', direction: 'income', amount: 100.1 + 0.2 })]; // = 100.30000000000001 ก่อนปัด
    const gl = [buildGLRow({ id: 'gl-1', direction: 'income', amount: 100.3 })];

    const { bankResults } = runSimpleReconciliation(bank, gl);
    expect(bankResults[0].status).toBe('found_in_gl');
  });

  it('วันที่ไม่มีผลต่อการจับคู่เลย — Bank/GL วันที่ต่างกันมาก แต่ทิศทาง+ยอดตรงกัน ก็ยังจับคู่ได้ปกติ', () => {
    const bank = [buildBankRow({ id: 'bank-1', direction: 'income', amount: 1000, date: '2026-01-01' })];
    const gl = [buildGLRow({ id: 'gl-1', direction: 'income', amount: 1000, date: '2026-12-31' })];

    const { bankResults } = runSimpleReconciliation(bank, gl);
    expect(bankResults[0].status).toBe('found_in_gl');
  });

  it('วันที่เป็น null (แปลงไม่ได้) ก็ไม่กระทบการจับคู่เช่นกัน', () => {
    const bank = [buildBankRow({ id: 'bank-1', direction: 'income', amount: 1000, date: null })];
    const gl = [buildGLRow({ id: 'gl-1', direction: 'income', amount: 1000, date: null })];

    const { bankResults } = runSimpleReconciliation(bank, gl);
    expect(bankResults[0].status).toBe('found_in_gl');
  });

  it('รายละเอียด/เลขที่เอกสารต่างกันโดยสิ้นเชิง ก็ไม่มีผลต่อการจับคู่ — ใช้แค่ทิศทาง+จำนวนเงินเท่านั้น', () => {
    const bank = [buildBankRow({ id: 'bank-1', direction: 'income', amount: 1000, description: 'ก' })];
    const gl = [buildGLRow({ id: 'gl-1', direction: 'income', amount: 1000, description: 'ข', docNo: 'ไม่เกี่ยวกัน' })];

    const { bankResults } = runSimpleReconciliation(bank, gl);
    expect(bankResults[0].status).toBe('found_in_gl');
  });
});

describe('runSimpleReconciliation — การจัดการจำนวนซ้ำ (สเปกส่วน "6. DUPLICATE AMOUNTS")', () => {
  it('ตัวอย่างที่ 1: Bank รับเงิน 1,000 จำนวน 3 รายการ, GL รับเงิน 1,000 จำนวน 2 รายการ -> Bank 2 พบ + 1 ไม่พบ, GL เหลือ 0', () => {
    const bank = [
      buildBankRow({ id: 'bank-1', direction: 'income', amount: 1000 }),
      buildBankRow({ id: 'bank-2', direction: 'income', amount: 1000 }),
      buildBankRow({ id: 'bank-3', direction: 'income', amount: 1000 }),
    ];
    const gl = [
      buildGLRow({ id: 'gl-1', direction: 'income', amount: 1000 }),
      buildGLRow({ id: 'gl-2', direction: 'income', amount: 1000 }),
    ];

    const { bankResults, glOnlyResults } = runSimpleReconciliation(bank, gl);

    expect(bankResults.map((r) => r.status)).toEqual(['found_in_gl', 'found_in_gl', 'not_found_in_gl']);
    expect(glOnlyResults).toHaveLength(0);
  });

  it('ตัวอย่างที่ 2: Bank จ่ายเงิน 500 จำนวน 1 รายการ, GL จ่ายเงิน 500 จำนวน 3 รายการ -> Bank 1 พบ, GL เหลือค้าง 2', () => {
    const bank = [buildBankRow({ id: 'bank-1', direction: 'payment', amount: 500 })];
    const gl = [
      buildGLRow({ id: 'gl-1', direction: 'payment', amount: 500 }),
      buildGLRow({ id: 'gl-2', direction: 'payment', amount: 500 }),
      buildGLRow({ id: 'gl-3', direction: 'payment', amount: 500 }),
    ];

    const { bankResults, glOnlyResults } = runSimpleReconciliation(bank, gl);

    expect(bankResults).toHaveLength(1);
    expect(bankResults[0].status).toBe('found_in_gl');
    expect(glOnlyResults).toHaveLength(2);
    expect(glOnlyResults.map((r) => r.gl.id).sort()).toEqual(['gl-2', 'gl-3']);
  });

  it('จับคู่แบบ FIFO ตามลำดับเดิมในไฟล์ GL เสมอ — Bank แถวแรกต้องได้ GL แถวแรกสุดที่ยังไม่ถูกใช้', () => {
    const bank = [
      buildBankRow({ id: 'bank-1', direction: 'income', amount: 1000 }),
      buildBankRow({ id: 'bank-2', direction: 'income', amount: 1000 }),
    ];
    const gl = [
      buildGLRow({ id: 'gl-first', direction: 'income', amount: 1000 }),
      buildGLRow({ id: 'gl-second', direction: 'income', amount: 1000 }),
    ];

    const { bankResults } = runSimpleReconciliation(bank, gl);
    expect(bankResults[0].matchedGL?.id).toBe('gl-first');
    expect(bankResults[1].matchedGL?.id).toBe('gl-second');
  });

  it('ห้ามใช้ GL แถวเดียวกันซ้ำสองครั้งเด็ดขาด — จับคู่ไปแล้วต้องไม่ปรากฏเป็นตัวเลือกให้ Bank แถวถัดไปอีก', () => {
    const bank = [
      buildBankRow({ id: 'bank-1', direction: 'income', amount: 1000 }),
      buildBankRow({ id: 'bank-2', direction: 'income', amount: 1000 }),
    ];
    const gl = [buildGLRow({ id: 'gl-1', direction: 'income', amount: 1000 })];

    const { bankResults } = runSimpleReconciliation(bank, gl);
    const matchedIds = bankResults.map((r) => r.matchedGL?.id).filter(Boolean);
    expect(matchedIds).toEqual(['gl-1']); // ใช้แค่ครั้งเดียว แถวที่สองต้อง not_found
    expect(bankResults[1].status).toBe('not_found_in_gl');
  });

  it('ไม่มีการรวม/merge แถวซ้ำเข้าด้วยกัน — ทุกแถว Bank ยังคงเป็นแถวอิสระในผลลัพธ์เสมอ (จำนวนแถวผลลัพธ์ = จำนวนแถว Bank ที่ใช้งานได้)', () => {
    const bank = [
      buildBankRow({ id: 'bank-1', direction: 'income', amount: 1000 }),
      buildBankRow({ id: 'bank-2', direction: 'income', amount: 1000 }),
      buildBankRow({ id: 'bank-3', direction: 'income', amount: 1000 }),
    ];
    const { bankResults } = runSimpleReconciliation(bank, []);
    expect(bankResults).toHaveLength(3);
  });
});

describe('runSimpleReconciliation — ลำดับผลลัพธ์และการกรองแถวที่ใช้งานไม่ได้', () => {
  it('ลำดับผลลัพธ์ bankResults ต้องตรงกับลำดับแถว Bank ต้นฉบับเป๊ะ ("Bank Statement order must remain the same as the source file")', () => {
    const bank = [
      buildBankRow({ id: 'bank-3', rowNumber: 4, direction: 'payment', amount: 300 }),
      buildBankRow({ id: 'bank-1', rowNumber: 2, direction: 'income', amount: 1000 }),
      buildBankRow({ id: 'bank-2', rowNumber: 3, direction: 'income', amount: 500 }),
    ];
    const { bankResults } = runSimpleReconciliation(bank, []);
    expect(bankResults.map((r) => r.bank.id)).toEqual(['bank-3', 'bank-1', 'bank-2']);
  });

  it('แถว Bank ที่ถูกยกเว้น (excluded) ไม่ปรากฏในผลลัพธ์เลย ไม่ว่าสถานะไหน', () => {
    const bank = [
      buildBankRow({ id: 'bank-1', direction: 'income', amount: 1000, excluded: true }),
      buildBankRow({ id: 'bank-2', direction: 'income', amount: 500 }),
    ];
    const { bankResults } = runSimpleReconciliation(bank, []);
    expect(bankResults).toHaveLength(1);
    expect(bankResults[0].bank.id).toBe('bank-2');
  });

  it('แถว Bank ที่ยังมี error ค้างอยู่ (หาทิศทางไม่ได้) ไม่ปรากฏในผลลัพธ์เลย', () => {
    const bank = [buildBankRow({ id: 'bank-1', direction: null, amount: 0, errors: ['พบทั้งเงินเข้าและเงินออกในแถวเดียวกัน กรุณาตรวจสอบ'] })];
    const { bankResults } = runSimpleReconciliation(bank, []);
    expect(bankResults).toHaveLength(0);
  });

  it('แถว GL ที่ถูกยกเว้นหรือมี error ค้าง จะไม่ถูกนำมาเป็นตัวเลือกจับคู่ และไม่ปรากฏใน glOnlyResults', () => {
    const bank = [buildBankRow({ id: 'bank-1', direction: 'income', amount: 1000 })];
    const gl = [
      buildGLRow({ id: 'gl-excluded', direction: 'income', amount: 1000, excluded: true }),
      buildGLRow({ id: 'gl-invalid', direction: null, amount: 0, errors: ['ไม่พบจำนวนเงินเข้าหรือเงินออกในแถวนี้'] }),
    ];
    const { bankResults, glOnlyResults } = runSimpleReconciliation(bank, gl);
    expect(bankResults[0].status).toBe('not_found_in_gl'); // ยกเว้น/invalid แล้ว จับคู่ด้วยไม่ได้
    expect(glOnlyResults).toHaveLength(0); // ก็ไม่ถูกนับเป็น "เหลือค้าง" ด้วยเช่นกัน (ไม่ใช่ส่วนหนึ่งของรอบนี้)
  });

  it('ไม่มีไฟล์ GL เลย (array ว่าง) — ทุกแถว Bank ที่ใช้งานได้เป็น not_found_in_gl หมด (Bank คือแหล่งข้อมูลหลักเสมอ)', () => {
    const bank = [buildBankRow({ id: 'bank-1' }), buildBankRow({ id: 'bank-2', rowNumber: 3 })];
    const { bankResults } = runSimpleReconciliation(bank, []);
    expect(bankResults).toHaveLength(2);
    expect(bankResults.every((r) => r.status === 'not_found_in_gl')).toBe(true);
  });

  it('ไม่มีไฟล์ Bank เลย (array ว่าง) — glOnlyResults ครอบคลุม GL ที่ใช้งานได้ทั้งหมด, bankResults ว่างเปล่า', () => {
    const gl = [buildGLRow({ id: 'gl-1' }), buildGLRow({ id: 'gl-2', rowNumber: 3 })];
    const { bankResults, glOnlyResults } = runSimpleReconciliation([], gl);
    expect(bankResults).toHaveLength(0);
    expect(glOnlyResults).toHaveLength(2);
  });

  it('รับเงิน/จ่ายเงินปนกันในไฟล์ Bank ไม่ทำให้ GL ผิดคิว — แต่ละทิศทางมีคิวของตัวเองแยกกันเด็ดขาด', () => {
    const bank = [
      buildBankRow({ id: 'bank-income', direction: 'income', amount: 1000 }),
      buildBankRow({ id: 'bank-payment', direction: 'payment', amount: 1000 }), // ยอดเท่ากันแต่คนละทิศทาง
    ];
    const gl = [
      buildGLRow({ id: 'gl-income', direction: 'income', amount: 1000 }),
      buildGLRow({ id: 'gl-payment', direction: 'payment', amount: 1000 }),
    ];

    const { bankResults } = runSimpleReconciliation(bank, gl);
    expect(bankResults[0].matchedGL?.id).toBe('gl-income');
    expect(bankResults[1].matchedGL?.id).toBe('gl-payment');
  });
});
