import { describe, expect, it } from 'vitest';
import { computeReconcileSessionKpi } from './bankReconcileKpi';
import type { BankReconcileResultRow, BankRow, GLOnlyRow, GLRow, ReconcileMatchOutput } from '@/types/bankReconcile';

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
    description: 'รับชำระจากลูกค้า A',
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

function foundRow(bank: BankRow, gl: GLRow): BankReconcileResultRow {
  return { bank, status: 'found_in_gl', matchedGL: gl, difference: 0 };
}

function notFoundRow(bank: BankRow): BankReconcileResultRow {
  return { bank, status: 'not_found_in_gl', matchedGL: null, difference: bank.amount };
}

function glOnly(gl: GLRow): GLOnlyRow {
  return { gl, status: 'not_found_in_bank' };
}

describe('computeReconcileSessionKpi', () => {
  it('bank_row_count/gl_row_count/found_count/bank_not_found_count/gl_not_found_count นับถูกต้อง', () => {
    const bank1 = buildBankRow({ id: 'bank-1', direction: 'income', amount: 1000 });
    const gl1 = buildGLRow({ id: 'gl-1', direction: 'income', amount: 1000 });
    const bank2 = buildBankRow({ id: 'bank-2', direction: 'payment', amount: 500 });
    const gl2 = buildGLRow({ id: 'gl-2', direction: 'income', amount: 300 });

    const matchOutput: ReconcileMatchOutput = {
      bankResults: [foundRow(bank1, gl1), notFoundRow(bank2)],
      glOnlyResults: [glOnly(gl2)],
    };

    const kpi = computeReconcileSessionKpi(matchOutput);

    expect(kpi.bank_row_count).toBe(2);
    expect(kpi.gl_row_count).toBe(2); // GL ที่จับคู่แล้ว (gl1) + GL ที่เหลือค้าง (gl2)
    expect(kpi.found_count).toBe(1);
    expect(kpi.bank_not_found_count).toBe(1);
    expect(kpi.gl_not_found_count).toBe(1);
  });

  it('bank_income_total/bank_payment_total รวมทุกแถว Bank ที่ใช้งานได้ (ทั้งพบและไม่พบใน GL) แยกตามทิศทาง', () => {
    const bank1 = buildBankRow({ id: 'bank-1', direction: 'income', amount: 1000 });
    const gl1 = buildGLRow({ id: 'gl-1', direction: 'income', amount: 1000 });
    const bank2 = buildBankRow({ id: 'bank-2', direction: 'income', amount: 500 }); // not found
    const bank3 = buildBankRow({ id: 'bank-3', direction: 'payment', amount: 300 }); // not found

    const matchOutput: ReconcileMatchOutput = {
      bankResults: [foundRow(bank1, gl1), notFoundRow(bank2), notFoundRow(bank3)],
      glOnlyResults: [],
    };

    const kpi = computeReconcileSessionKpi(matchOutput);
    expect(kpi.bank_income_total).toBe(1500); // 1000 (พบ) + 500 (ไม่พบ) — รวมทั้งสองสถานะ
    expect(kpi.bank_payment_total).toBe(300);
  });

  it('gl_income_total/gl_payment_total รวมทั้ง GL ที่จับคู่ได้แล้วและ GL ที่เหลือค้าง (glOnlyResults)', () => {
    const bank1 = buildBankRow({ id: 'bank-1', direction: 'income', amount: 1000 });
    const gl1 = buildGLRow({ id: 'gl-1', direction: 'income', amount: 1000 });
    const gl2 = buildGLRow({ id: 'gl-2', direction: 'payment', amount: 200 }); // ค้างอยู่ ไม่ถูกจับคู่

    const matchOutput: ReconcileMatchOutput = {
      bankResults: [foundRow(bank1, gl1)],
      glOnlyResults: [glOnly(gl2)],
    };

    const kpi = computeReconcileSessionKpi(matchOutput);
    expect(kpi.gl_income_total).toBe(1000);
    expect(kpi.gl_payment_total).toBe(200);
    expect(kpi.gl_row_count).toBe(2);
  });

  it('income_difference/payment_difference = ยอด Bank ลบยอด GL แยกทิศทาง (มีเครื่องหมาย ไม่ใช่ค่าสัมบูรณ์)', () => {
    const bank1 = buildBankRow({ id: 'bank-1', direction: 'income', amount: 1000 });
    const bank2 = buildBankRow({ id: 'bank-2', direction: 'income', amount: 500 }); // not found -> bank income รวม 1500
    const gl1 = buildGLRow({ id: 'gl-1', direction: 'income', amount: 1000 }); // จับคู่แล้ว -> gl income รวม 1000

    const matchOutput: ReconcileMatchOutput = {
      bankResults: [foundRow(bank1, gl1), notFoundRow(bank2)],
      glOnlyResults: [],
    };

    const kpi = computeReconcileSessionKpi(matchOutput);
    expect(kpi.bank_income_total).toBe(1500);
    expect(kpi.gl_income_total).toBe(1000);
    expect(kpi.income_difference).toBe(500);
  });

  it('ไม่มีข้อมูลเลย (ทั้งสองไฟล์ว่างเปล่าหลัง filter) — ทุก KPI เป็น 0', () => {
    const matchOutput: ReconcileMatchOutput = { bankResults: [], glOnlyResults: [] };
    const kpi = computeReconcileSessionKpi(matchOutput);
    expect(kpi).toEqual({
      bank_row_count: 0,
      gl_row_count: 0,
      found_count: 0,
      bank_not_found_count: 0,
      gl_not_found_count: 0,
      bank_income_total: 0,
      bank_payment_total: 0,
      gl_income_total: 0,
      gl_payment_total: 0,
      income_difference: 0,
      payment_difference: 0,
    });
  });

  it('ปัดเศษทศนิยม 2 ตำแหน่งเสมอ (กันปัญหา floating point)', () => {
    const bank1 = buildBankRow({ id: 'bank-1', direction: 'income', amount: 0.1 });
    const bank2 = buildBankRow({ id: 'bank-2', direction: 'income', amount: 0.2 });
    const matchOutput: ReconcileMatchOutput = {
      bankResults: [notFoundRow(bank1), notFoundRow(bank2)],
      glOnlyResults: [],
    };
    const kpi = computeReconcileSessionKpi(matchOutput);
    expect(kpi.bank_income_total).toBe(0.3);
  });

  it('ธงตรวจสอบไม่มีผลต่อ KPI — ฟังก์ชันรับแค่ ReconcileMatchOutput ล้วนๆ ไม่มีพารามิเตอร์ธงตรวจสอบในซิกเนเจอร์เลย จึงคำนวณผลเดิมเสมอไม่ว่าจะเรียกกี่ครั้ง', () => {
    const bank1 = buildBankRow({ id: 'bank-1', direction: 'income', amount: 1000 });
    const matchOutput: ReconcileMatchOutput = { bankResults: [notFoundRow(bank1)], glOnlyResults: [] };
    expect(computeReconcileSessionKpi(matchOutput)).toEqual(computeReconcileSessionKpi(matchOutput));
  });
});
