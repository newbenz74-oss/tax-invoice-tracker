import { describe, expect, it } from 'vitest';
import {
  computeReconcileRowSummary,
  computeReconcileTabCounts,
  DEFAULT_RECONCILE_ROW_FILTERS,
  filterReconcileRows,
  formatGroupSummary,
  resolveAmountTolerance,
} from './bankReconcileManualMatchLogic';
import type { MatchBankRow, MatchGLRow, MatchGroup, ReconcileRow } from '@/types/bankReconcile';

function makeBankRow(overrides: Partial<MatchBankRow> = {}): MatchBankRow {
  return {
    bank_row_id: 'bank-2',
    bank_date: '2026-07-15',
    bank_description: 'รับโอนจากลูกค้า A',
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
    gl_description: 'รับชำระจากลูกค้า A',
    gl_debit: 1000,
    gl_credit: 0,
    gl_amount: 1000,
    raw_gl_row: [],
    ...overrides,
  };
}

function makeGroup(overrides: Partial<MatchGroup> = {}): MatchGroup {
  return {
    match_group_id: 'group-1',
    match_type: 'one_to_one',
    status: 'confirmed_manual',
    bank_transaction_ids: ['bank-2'],
    gl_transaction_ids: ['gl-2'],
    bank_total: 1000,
    gl_total: 1000,
    amount_difference: 0,
    date_difference_days: 0,
    manual_match: true,
    matched_by: 'user@example.com',
    matched_at: '2026-07-16T10:00:00.000Z',
    note: '',
    auto_match_score: 100,
    auto_match_reason: 'ยอดเงินตรงกัน และวันที่ตรงกัน',
    ...overrides,
  };
}

function makeRow(overrides: Partial<ReconcileRow> = {}): ReconcileRow {
  return {
    bank: makeBankRow(),
    status: 'matched_exact',
    matchedGL: makeGLRow(),
    matchedGLRows: [makeGLRow()],
    candidates: [],
    matchScore: 100,
    amountDifference: 0,
    dateDifferenceDays: 0,
    matchReason: 'ยอดเงินตรงกัน และวันที่ตรงกัน',
    matchGroup: null,
    reviewFlag: null,
    note: null,
    ...overrides,
  };
}

describe('filterReconcileRows', () => {
  const rows: ReconcileRow[] = [
    makeRow({ bank: makeBankRow({ bank_row_id: 'bank-2' }), status: 'matched_exact' }),
    makeRow({
      bank: makeBankRow({ bank_row_id: 'bank-3', bank_description: 'จ่ายค่าเช่า', bank_date: '2026-07-16' }),
      status: 'ambiguous',
      matchedGL: null,
      matchedGLRows: [],
    }),
    makeRow({
      bank: makeBankRow({ bank_row_id: 'bank-4', bank_amount: 2000 }),
      status: 'confirmed_variance',
      matchGroup: makeGroup({ match_group_id: 'g-4', bank_transaction_ids: ['bank-4'], note: 'ผลต่างค่าธรรมเนียม' }),
    }),
    makeRow({
      bank: makeBankRow({ bank_row_id: 'bank-5' }),
      status: 'pending_review',
      reviewFlag: { review_required: true, reviewed_by: 'user@example.com', reviewed_at: '2026-07-16T00:00:00.000Z' },
    }),
  ];

  it('tab "all" คืนทุกแถว', () => {
    expect(filterReconcileRows(rows, DEFAULT_RECONCILE_ROW_FILTERS)).toHaveLength(4);
  });

  it('tab สถานะปกติ กรองตาม status ตรงๆ', () => {
    const result = filterReconcileRows(rows, { ...DEFAULT_RECONCILE_ROW_FILTERS, tab: 'matched_exact' });
    expect(result.map((r) => r.bank.bank_row_id)).toEqual(['bank-2']);
  });

  it('tab "confirmed" กรองทุกแถวที่มี matchGroup ไม่ว่าจะเป็นสถานะย่อยไหน', () => {
    const result = filterReconcileRows(rows, { ...DEFAULT_RECONCILE_ROW_FILTERS, tab: 'confirmed' });
    expect(result.map((r) => r.bank.bank_row_id)).toEqual(['bank-4']);
  });

  it('tab "review_required" กรองตาม reviewFlag โดยไม่สนสถานะ (คนละแกนกับ status)', () => {
    const result = filterReconcileRows(rows, { ...DEFAULT_RECONCILE_ROW_FILTERS, tab: 'review_required' });
    expect(result.map((r) => r.bank.bank_row_id)).toEqual(['bank-5']);
  });

  it('ค้นหาจับคู่รายละเอียด Bank', () => {
    const result = filterReconcileRows(rows, { ...DEFAULT_RECONCILE_ROW_FILTERS, search: 'เช่า' });
    expect(result.map((r) => r.bank.bank_row_id)).toEqual(['bank-3']);
  });

  it('ค้นหาจับคู่หมายเหตุของกลุ่ม (ผ่าน getRowNote)', () => {
    const result = filterReconcileRows(rows, { ...DEFAULT_RECONCILE_ROW_FILTERS, search: 'ค่าธรรมเนียม' });
    expect(result.map((r) => r.bank.bank_row_id)).toEqual(['bank-4']);
  });

  it('ค้นหาจับคู่ผู้ยืนยัน (matched_by)', () => {
    const result = filterReconcileRows(rows, { ...DEFAULT_RECONCILE_ROW_FILTERS, search: 'user@example.com' });
    expect(result.map((r) => r.bank.bank_row_id)).toEqual(['bank-4']);
  });

  it('ตัวกรองช่วงวันที่', () => {
    const result = filterReconcileRows(rows, { ...DEFAULT_RECONCILE_ROW_FILTERS, dateFrom: '2026-07-16', dateTo: '2026-07-16' });
    expect(result.map((r) => r.bank.bank_row_id)).toEqual(['bank-3']);
  });

  it('ตัวกรองช่วงจำนวนเงิน', () => {
    const result = filterReconcileRows(rows, { ...DEFAULT_RECONCILE_ROW_FILTERS, amountMin: 1500, amountMax: 2500 });
    expect(result.map((r) => r.bank.bank_row_id)).toEqual(['bank-4']);
  });

  it('รวมตัวกรองหลายเงื่อนไขพร้อมกัน (AND)', () => {
    const result = filterReconcileRows(rows, { ...DEFAULT_RECONCILE_ROW_FILTERS, tab: 'confirmed', search: 'ค่าธรรมเนียม' });
    expect(result).toHaveLength(1);
    const noMatch = filterReconcileRows(rows, { ...DEFAULT_RECONCILE_ROW_FILTERS, tab: 'confirmed', search: 'ไม่มีจริง' });
    expect(noMatch).toHaveLength(0);
  });
});

describe('computeReconcileTabCounts', () => {
  const rows: ReconcileRow[] = [
    makeRow({ status: 'matched_exact' }),
    makeRow({ status: 'confirmed_manual', matchGroup: makeGroup({ match_group_id: 'g1' }) }),
    makeRow({ status: 'confirmed_tolerance', matchGroup: makeGroup({ match_group_id: 'g2', status: 'confirmed_tolerance' }) }),
    makeRow({
      status: 'pending_review',
      reviewFlag: { review_required: true, reviewed_by: 'x', reviewed_at: '2026-07-16T00:00:00.000Z' },
    }),
  ];

  it('all = จำนวนแถวทั้งหมด', () => {
    expect(computeReconcileTabCounts(rows).all).toBe(4);
  });

  it('confirmed รวมทั้ง confirmed_manual และ confirmed_tolerance เข้าด้วยกัน', () => {
    expect(computeReconcileTabCounts(rows).confirmed).toBe(2);
  });

  it('review_required นับแยกจาก status ปกติได้ (ซ้อนกับ pending_review ได้)', () => {
    const counts = computeReconcileTabCounts(rows);
    expect(counts.review_required).toBe(1);
    expect(counts.pending_review).toBe(1);
  });

  it('matched_exact นับถูกต้อง', () => {
    expect(computeReconcileTabCounts(rows).matched_exact).toBe(1);
  });
});

describe('computeReconcileRowSummary', () => {
  it('สถานะที่ยืนยันด้วยตนเองแล้วทั้ง 3 แบบ (รวม confirmed_variance) ไม่นับเป็นผลต่างค้าง', () => {
    const rows: ReconcileRow[] = [
      makeRow({ bank: makeBankRow({ bank_row_id: 'bank-2', bank_amount: 500 }), status: 'confirmed_manual', matchGroup: makeGroup() }),
      makeRow({
        bank: makeBankRow({ bank_row_id: 'bank-3', bank_amount: 700 }),
        status: 'confirmed_variance',
        matchGroup: makeGroup({ match_group_id: 'g2', status: 'confirmed_variance' }),
      }),
    ];
    const summary = computeReconcileRowSummary(rows, 0, 0);
    expect(summary.totalDifference).toBe(0);
    expect(summary.confirmedManual).toBe(2);
  });

  it('สถานะที่ยังไม่กระทบยอด (ambiguous/pending_review/not_found_in_gl) นับเป็นผลต่างค้างตามยอดสัมบูรณ์', () => {
    const rows: ReconcileRow[] = [
      makeRow({ bank: makeBankRow({ bank_row_id: 'bank-2', bank_amount: -300 }), status: 'not_found_in_gl', matchedGL: null, matchedGLRows: [] }),
    ];
    const summary = computeReconcileRowSummary(rows, 1, 150);
    // |−300| (ยังไม่กระทบยอด) + 150 (GL ค้าง) = 450
    expect(summary.totalDifference).toBe(450);
    expect(summary.notFoundInBank).toBe(1);
  });
});

describe('formatGroupSummary', () => {
  it('จัดรูปแบบ 1 Bank : 1 GL', () => {
    expect(formatGroupSummary({ bank_transaction_ids: ['bank-2'], gl_transaction_ids: ['gl-2'] })).toBe('1 Bank : 1 GL');
  });

  it('จัดรูปแบบ 1 Bank : 2 GL', () => {
    expect(formatGroupSummary({ bank_transaction_ids: ['bank-2'], gl_transaction_ids: ['gl-2', 'gl-3'] })).toBe('1 Bank : 2 GL');
  });

  it('จัดรูปแบบ 2 Bank : 1 GL', () => {
    expect(formatGroupSummary({ bank_transaction_ids: ['bank-2', 'bank-3'], gl_transaction_ids: ['gl-2'] })).toBe('2 Bank : 1 GL');
  });
});

describe('resolveAmountTolerance', () => {
  it('ตัวเลือกสำเร็จรูป zero/small/one คืนค่าตรงตามที่กำหนด', () => {
    expect(resolveAmountTolerance('zero', 0)).toBe(0);
    expect(resolveAmountTolerance('small', 0)).toBe(0.01);
    expect(resolveAmountTolerance('one', 0)).toBe(1);
  });

  it('custom คืนค่าที่ผู้ใช้กรอกเองเมื่อเป็นตัวเลขที่ถูกต้อง', () => {
    expect(resolveAmountTolerance('custom', 25.5)).toBe(25.5);
  });

  it('custom fallback เป็น 0 เมื่อค่าที่กรอกเป็น NaN หรือติดลบ', () => {
    expect(resolveAmountTolerance('custom', NaN)).toBe(0);
    expect(resolveAmountTolerance('custom', -5)).toBe(0);
  });
});

