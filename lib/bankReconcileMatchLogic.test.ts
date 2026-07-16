import { describe, expect, it } from 'vitest';
import {
  computeGLOnlyTotal,
  computeReconcileSummary,
  computeStatusCounts,
  DEFAULT_RECONCILE_FILTERS,
  filterBankResults,
  type ReconcileFilters,
} from './bankReconcileMatchLogic';
import type { BankMatchResult, GLOnlyResult, MatchBankRow, MatchGLRow } from '@/types/bankReconcile';

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

function makeResult(overrides: Partial<BankMatchResult> = {}): BankMatchResult {
  return {
    bank: makeBankRow(),
    status: 'matched_exact',
    matchedGL: makeGLRow(),
    candidates: [makeGLRow()],
    matchScore: 100,
    amountDifference: 0,
    dateDifferenceDays: 0,
    matchReason: 'ยอดเงินตรงกัน และวันที่ตรงกัน',
    ...overrides,
  };
}

function makeGLOnly(overrides: Partial<GLOnlyResult> = {}): GLOnlyResult {
  return { gl: makeGLRow(), status: 'not_found_in_bank', ...overrides };
}

describe('filterBankResults', () => {
  const base: ReconcileFilters = DEFAULT_RECONCILE_FILTERS;

  it("status='all' ไม่กรองอะไรเลย", () => {
    const results = [makeResult({ status: 'matched_exact' }), makeResult({ status: 'not_found_in_gl' })];
    expect(filterBankResults(results, base)).toHaveLength(2);
  });

  it('กรองตาม status ตรงตัว', () => {
    const results = [makeResult({ status: 'matched_exact' }), makeResult({ status: 'ambiguous' })];
    const filtered = filterBankResults(results, { ...base, status: 'ambiguous' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].status).toBe('ambiguous');
  });

  it('ค้นหาด้วยรายละเอียด Bank', () => {
    const results = [makeResult({ bank: makeBankRow({ bank_description: 'ค่าเช่าสำนักงาน' }) })];
    expect(filterBankResults(results, { ...base, search: 'เช่า' })).toHaveLength(1);
    expect(filterBankResults(results, { ...base, search: 'ไม่มีทางเจอ' })).toHaveLength(0);
  });

  it('ค้นหาด้วยเลขที่เอกสาร GL', () => {
    const results = [makeResult({ matchedGL: makeGLRow({ gl_document_no: 'JV-999' }) })];
    expect(filterBankResults(results, { ...base, search: 'jv-999' })).toHaveLength(1); // ไม่สนตัวพิมพ์เล็ก/ใหญ่
  });

  it('ค้นหาด้วยรายละเอียด GL', () => {
    const results = [makeResult({ matchedGL: makeGLRow({ gl_description: 'ค่าน้ำค่าไฟ' }) })];
    expect(filterBankResults(results, { ...base, search: 'น้ำ' })).toHaveLength(1);
  });

  it('ค้นหาด้วยจำนวนเงิน', () => {
    const results = [makeResult({ bank: makeBankRow({ bank_amount: 15000 }) })];
    expect(filterBankResults(results, { ...base, search: '15000' })).toHaveLength(1);
    expect(filterBankResults(results, { ...base, search: '15000.00' })).toHaveLength(1);
  });

  it('ค้นหาไม่พบเมื่อไม่มี matchedGL (ไม่ error กับ null)', () => {
    const results = [makeResult({ matchedGL: null, status: 'not_found_in_gl' })];
    expect(() => filterBankResults(results, { ...base, search: 'JV' })).not.toThrow();
    expect(filterBankResults(results, { ...base, search: 'JV' })).toHaveLength(0);
  });

  it('กรองช่วงวันที่ — แถวที่ไม่มีวันที่ถือว่าไม่ตรงเงื่อนไขเมื่อเลือกช่วงไว้', () => {
    const withDate = makeResult({ bank: makeBankRow({ bank_date: '2026-07-15' }) });
    const noDate = makeResult({ bank: makeBankRow({ bank_date: null }) });
    const filtered = filterBankResults([withDate, noDate], { ...base, dateFrom: '2026-07-01', dateTo: '2026-07-31' });
    expect(filtered).toHaveLength(1);

    const outOfRange = filterBankResults([withDate], { ...base, dateFrom: '2026-08-01', dateTo: '2026-08-31' });
    expect(outOfRange).toHaveLength(0);
  });

  it('กรองช่วงจำนวนเงินโดยใช้ค่าสัมบูรณ์ (ไม่สนเครื่องหมายเงินเข้า/เงินออก)', () => {
    const moneyOut = makeResult({ bank: makeBankRow({ bank_amount: -15000 }) });
    expect(filterBankResults([moneyOut], { ...base, amountMin: 10000, amountMax: 20000 })).toHaveLength(1);
    expect(filterBankResults([moneyOut], { ...base, amountMin: 20000, amountMax: 30000 })).toHaveLength(0);
  });

  it('ตัวกรองทั้งหมดทำงานร่วมกันแบบ AND', () => {
    const target = makeResult({
      status: 'matched_exact',
      bank: makeBankRow({ bank_description: 'ค่าเช่า', bank_amount: 15000, bank_date: '2026-07-15' }),
    });
    const wrongStatus = makeResult({
      status: 'ambiguous',
      bank: makeBankRow({ bank_description: 'ค่าเช่า', bank_amount: 15000, bank_date: '2026-07-15' }),
    });
    const filters: ReconcileFilters = {
      search: 'เช่า',
      status: 'matched_exact',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      amountMin: 10000,
      amountMax: 20000,
    };
    expect(filterBankResults([target, wrongStatus], filters)).toHaveLength(1);
  });
});

describe('computeStatusCounts', () => {
  it('นับจำนวนแยกตามสถานะถูกต้อง ครบทุกสถานะแม้จะเป็น 0', () => {
    const results = [
      makeResult({ status: 'matched_exact' }),
      makeResult({ status: 'matched_exact' }),
      makeResult({ status: 'ambiguous' }),
      makeResult({ status: 'not_found_in_gl' }),
    ];
    const counts = computeStatusCounts(results);
    expect(counts.matched_exact).toBe(2);
    expect(counts.ambiguous).toBe(1);
    expect(counts.not_found_in_gl).toBe(1);
    expect(counts.matched_tolerance).toBe(0);
    expect(counts.pending_review).toBe(0);
  });

  it('ผลรวมของทุกสถานะเท่ากับจำนวนแถวทั้งหมดเสมอ (ใช้เป็นตัวเลข "ทั้งหมด" ของ Segmented Control)', () => {
    const results = [
      makeResult({ status: 'matched_exact' }),
      makeResult({ status: 'matched_tolerance' }),
      makeResult({ status: 'ambiguous' }),
      makeResult({ status: 'pending_review' }),
      makeResult({ status: 'not_found_in_gl' }),
    ];
    const counts = computeStatusCounts(results);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(results.length);
  });
});

describe('computeReconcileSummary', () => {
  it('คำนวณ KPI ทั้งหมดถูกต้องตามตัวอย่างที่กำหนดเอง', () => {
    const bankResults: BankMatchResult[] = [
      makeResult({ status: 'matched_exact', bank: makeBankRow({ bank_amount: 1000 }) }),
      makeResult({ status: 'matched_tolerance', bank: makeBankRow({ bank_amount: 2000 }) }),
      makeResult({ status: 'ambiguous', bank: makeBankRow({ bank_amount: 3000 }), matchedGL: null }),
      makeResult({ status: 'pending_review', bank: makeBankRow({ bank_amount: -500 }), matchedGL: null }),
      makeResult({ status: 'not_found_in_gl', bank: makeBankRow({ bank_amount: 700 }), matchedGL: null }),
    ];
    const glOnlyResults: GLOnlyResult[] = [makeGLOnly({ gl: makeGLRow({ gl_amount: 250 }) })];

    const summary = computeReconcileSummary(bankResults, glOnlyResults);

    expect(summary.totalBank).toBe(5);
    expect(summary.matchedExact).toBe(1);
    expect(summary.matchedTolerance).toBe(1);
    expect(summary.ambiguous).toBe(1);
    expect(summary.pendingReview).toBe(1);
    expect(summary.notFoundInGL).toBe(1);
    expect(summary.notFoundInBank).toBe(1);
    // ผลต่างรวม = |3000| + |-500| + |700| (ทุกแถว Bank ที่ยังไม่กระทบยอด) + |250| (GL ที่เหลือค้าง) = 4450
    expect(summary.totalDifference).toBe(4450);
  });

  it('matched_exact/matched_tolerance ไม่ถูกนับใน totalDifference', () => {
    const bankResults: BankMatchResult[] = [
      makeResult({ status: 'matched_exact', bank: makeBankRow({ bank_amount: 100000 }) }),
      makeResult({ status: 'matched_tolerance', bank: makeBankRow({ bank_amount: 50000 }) }),
    ];
    const summary = computeReconcileSummary(bankResults, []);
    expect(summary.totalDifference).toBe(0);
  });
});

describe('computeGLOnlyTotal', () => {
  it('รวมยอดเงินค่าสัมบูรณ์ของ GL ที่เหลือค้างทั้งหมด', () => {
    const rows = [makeGLOnly({ gl: makeGLRow({ gl_amount: 1000 }) }), makeGLOnly({ gl: makeGLRow({ gl_amount: -500.5 }) })];
    expect(computeGLOnlyTotal(rows)).toBe(1500.5);
  });

  it('ไม่มีรายการเหลือค้าง = 0', () => {
    expect(computeGLOnlyTotal([])).toBe(0);
  });
});
