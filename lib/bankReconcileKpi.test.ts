import { describe, expect, it } from 'vitest';
import { computeReconcileSessionKpi, RESOLVED_STATUSES, validateSessionCompletion } from './bankReconcileKpi';
import type { MatchBankRow, MatchGLRow, MatchGroup, ReconcileRow } from '@/types/bankReconcile';
import type { ReconcileSessionKpi } from '@/types/bankReconcileSession';

function makeBankRow(overrides: Partial<MatchBankRow> = {}): MatchBankRow {
  return {
    bank_row_id: 'bank-1',
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
    gl_row_id: 'gl-1',
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
    match_group_id: 'mg-1',
    match_type: 'one_to_one',
    status: 'confirmed_manual',
    bank_transaction_ids: ['bank-1'],
    gl_transaction_ids: ['gl-1'],
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

describe('computeReconcileSessionKpi', () => {
  it('นับจำนวน/ยอดรวมแยกฝั่งกระทบยอดแล้ว vs ยังไม่กระทบยอดถูกต้อง', () => {
    const rows: ReconcileRow[] = [
      makeRow({ bank: makeBankRow({ bank_row_id: 'bank-1', bank_amount: 1000 }), status: 'matched_exact' }),
      makeRow({ bank: makeBankRow({ bank_row_id: 'bank-2', bank_amount: -500 }), status: 'not_found_in_gl', matchedGL: null, matchedGLRows: [] }),
    ];
    const glRows: MatchGLRow[] = [makeGLRow({ gl_row_id: 'gl-1', gl_amount: 1000 }), makeGLRow({ gl_row_id: 'gl-2', gl_amount: 300 })];
    const groups: MatchGroup[] = [makeGroup({ bank_transaction_ids: ['bank-1'], gl_transaction_ids: ['gl-1'] })];

    const kpi = computeReconcileSessionKpi(rows, glRows, groups);

    expect(kpi.bank_row_count).toBe(2);
    expect(kpi.gl_row_count).toBe(2);
    expect(kpi.matched_count).toBe(1);
    expect(kpi.unmatched_bank_count).toBe(1);
    expect(kpi.unmatched_gl_count).toBe(1);
    expect(kpi.bank_total).toBe(500); // 1000 + (-500)
    expect(kpi.matched_bank_total).toBe(1000);
    expect(kpi.unmatched_bank_total).toBe(-500);
    expect(kpi.gl_total).toBe(1300);
    expect(kpi.matched_gl_total).toBe(1000);
    expect(kpi.unmatched_gl_total).toBe(300);
  });

  it('suggested_count นับเฉพาะ matched_tolerance/pending_review (สถานะที่มีปุ่ม "ยืนยันว่าตรงกัน")', () => {
    const rows: ReconcileRow[] = [
      makeRow({ bank: makeBankRow({ bank_row_id: 'bank-1' }), status: 'matched_tolerance' }),
      makeRow({ bank: makeBankRow({ bank_row_id: 'bank-2' }), status: 'pending_review' }),
      makeRow({ bank: makeBankRow({ bank_row_id: 'bank-3' }), status: 'ambiguous', matchedGL: null, matchedGLRows: [] }),
    ];
    const kpi = computeReconcileSessionKpi(rows, [], []);
    expect(kpi.suggested_count).toBe(2);
  });

  it('manual_match_count/review_count นับจาก matchGroup/reviewFlag ของแถวโดยตรง', () => {
    const rows: ReconcileRow[] = [
      makeRow({ bank: makeBankRow({ bank_row_id: 'bank-1' }), status: 'confirmed_manual', matchGroup: makeGroup() }),
      makeRow({
        bank: makeBankRow({ bank_row_id: 'bank-2' }),
        status: 'pending_review',
        reviewFlag: { review_required: true, reviewed_by: 'x@example.com', reviewed_at: '2026-07-16T00:00:00.000Z' },
      }),
    ];
    const kpi = computeReconcileSessionKpi(rows, [], []);
    expect(kpi.manual_match_count).toBe(1);
    expect(kpi.review_count).toBe(1);
  });

  it('RESOLVED_STATUSES รวมครบ 5 สถานะตามที่ถือว่ากระทบยอดแล้ว', () => {
    expect(RESOLVED_STATUSES).toEqual(
      expect.arrayContaining(['matched_exact', 'matched_tolerance', 'confirmed_manual', 'confirmed_tolerance', 'confirmed_variance'])
    );
    expect(RESOLVED_STATUSES).toHaveLength(5);
  });

  it('net_difference = unmatched_bank_total - unmatched_gl_total + ผลรวมผลต่างของกลุ่มที่ยืนยันแล้ว (แบบมีเครื่องหมาย)', () => {
    const rows: ReconcileRow[] = [
      makeRow({ bank: makeBankRow({ bank_row_id: 'bank-1', bank_amount: 1000 }), status: 'not_found_in_gl', matchedGL: null, matchedGLRows: [] }),
    ];
    const glRows: MatchGLRow[] = [makeGLRow({ gl_row_id: 'gl-1', gl_amount: -1000 })];
    // กลุ่มจับคู่นี้ต้องอ้างอิงถึง bank/gl id อื่นที่ไม่ใช่ 'bank-1'/'gl-1' (ที่ตั้งใจให้ยังไม่จับคู่ในเทสต์นี้)
    // ไม่เช่นนั้น gl-1 จะถูกนับเป็น "จับคู่แล้ว" (ใช้ gl_transaction_ids ตัดสิน) ทำให้ unmatched_gl_total ผิดไป
    const groups: MatchGroup[] = [makeGroup({ bank_transaction_ids: ['bank-other'], gl_transaction_ids: ['gl-other'], amount_difference: 50 })];
    const kpi = computeReconcileSessionKpi(rows, glRows, groups);
    // unmatched_bank_total = 1000, unmatched_gl_total = -1000, ผลต่างกลุ่ม = 50
    // net = 1000 - (-1000) + 50 = 2050
    expect(kpi.unmatched_bank_total).toBe(1000);
    expect(kpi.unmatched_gl_total).toBe(-1000);
    expect(kpi.net_difference).toBe(2050);
  });

  it('รายการไม่จับคู่ที่หักล้างกันพอดี (บวก/ลบเท่ากัน) ให้ net_difference = 0 ไม่ใช่ผลรวมค่าสัมบูรณ์', () => {
    const rows: ReconcileRow[] = [
      makeRow({ bank: makeBankRow({ bank_row_id: 'bank-1', bank_amount: 1000 }), status: 'not_found_in_gl', matchedGL: null, matchedGLRows: [] }),
      makeRow({ bank: makeBankRow({ bank_row_id: 'bank-2', bank_amount: -1000 }), status: 'not_found_in_gl', matchedGL: null, matchedGLRows: [] }),
    ];
    const kpi = computeReconcileSessionKpi(rows, [], []);
    expect(kpi.unmatched_bank_total).toBe(0);
    expect(kpi.net_difference).toBe(0);
  });

  it('ปัดเศษทศนิยม 2 ตำแหน่งเสมอ (กันปัญหา floating point)', () => {
    const rows: ReconcileRow[] = [
      makeRow({ bank: makeBankRow({ bank_row_id: 'bank-1', bank_amount: 0.1 }), status: 'not_found_in_gl', matchedGL: null, matchedGLRows: [] }),
      makeRow({ bank: makeBankRow({ bank_row_id: 'bank-2', bank_amount: 0.2 }), status: 'not_found_in_gl', matchedGL: null, matchedGLRows: [] }),
    ];
    const kpi = computeReconcileSessionKpi(rows, [], []);
    expect(kpi.unmatched_bank_total).toBe(0.3);
  });
});

function makeKpi(overrides: Partial<ReconcileSessionKpi> = {}): ReconcileSessionKpi {
  return {
    bank_row_count: 1,
    gl_row_count: 1,
    matched_count: 1,
    suggested_count: 0,
    manual_match_count: 0,
    review_count: 0,
    unmatched_bank_count: 0,
    unmatched_gl_count: 0,
    bank_total: 1000,
    gl_total: 1000,
    matched_bank_total: 1000,
    matched_gl_total: 1000,
    unmatched_bank_total: 0,
    unmatched_gl_total: 0,
    net_difference: 0,
    ...overrides,
  };
}

describe('validateSessionCompletion', () => {
  const baseParams = () => ({
    reconcileRows: [makeRow({ bank: makeBankRow({ bank_row_id: 'bank-1' }) })],
    matchGLRows: [makeGLRow({ gl_row_id: 'gl-1' })],
    matchGroups: [makeGroup({ bank_transaction_ids: ['bank-1'], gl_transaction_ids: ['gl-1'] })],
    bankFileName: 'statement.xlsx',
    glFileName: 'gl.xlsx',
    kpi: makeKpi(),
  });

  it('ผ่านการตรวจสอบเมื่อข้อมูลครบถ้วนถูกต้อง ไม่มีปัญหาใดๆ', () => {
    const result = validateSessionCompletion(baseParams());
    expect(result.canComplete).toBe(true);
    expect(result.blockingErrors).toEqual([]);
    expect(result.requiresNote).toBe(false);
  });

  it('บล็อกเมื่อไม่มีชื่อไฟล์ต้นฉบับ (Bank หรือ GL)', () => {
    const result = validateSessionCompletion({ ...baseParams(), bankFileName: '' });
    expect(result.canComplete).toBe(false);
    expect(result.blockingErrors.some((e) => e.includes('ไฟล์ต้นฉบับ'))).toBe(true);
  });

  it('บล็อกเมื่อมีกลุ่มจับคู่อ้างอิงรายการ Bank/GL ที่ถูกลบไปแล้ว', () => {
    const params = baseParams();
    params.matchGroups = [makeGroup({ bank_transaction_ids: ['bank-deleted'], gl_transaction_ids: ['gl-1'] })];
    const result = validateSessionCompletion(params);
    expect(result.canComplete).toBe(false);
    expect(result.blockingErrors.some((e) => e.includes('อ้างอิงรายการที่ถูกลบไปแล้ว'))).toBe(true);
  });

  it('บล็อกเมื่อ GL แถวเดียวถูกใช้ในมากกว่า 1 กลุ่มจับคู่พร้อมกัน', () => {
    const params = baseParams();
    params.matchGroups = [
      makeGroup({ match_group_id: 'mg-1', bank_transaction_ids: ['bank-1'], gl_transaction_ids: ['gl-1'] }),
      makeGroup({ match_group_id: 'mg-2', bank_transaction_ids: ['bank-1'], gl_transaction_ids: ['gl-1'] }),
    ];
    const result = validateSessionCompletion(params);
    expect(result.canComplete).toBe(false);
    expect(result.blockingErrors.some((e) => e.includes('จับคู่ซ้ำ'))).toBe(true);
  });

  it('บล็อกเมื่อกลุ่มมีผลต่างยอดเงิน (≠0) แต่ไม่มีหมายเหตุกำกับ', () => {
    const params = baseParams();
    params.matchGroups = [makeGroup({ amount_difference: 50, note: '' })];
    const result = validateSessionCompletion(params);
    expect(result.canComplete).toBe(false);
    expect(result.blockingErrors.some((e) => e.includes('ยังไม่ได้กรอกหมายเหตุ'))).toBe(true);
  });

  it('ไม่บล็อกเมื่อกลุ่มมีผลต่างยอดเงินแต่มีหมายเหตุกำกับแล้ว', () => {
    const params = baseParams();
    params.matchGroups = [makeGroup({ amount_difference: 50, note: 'ผลต่างค่าธรรมเนียมธนาคาร' })];
    const result = validateSessionCompletion(params);
    expect(result.blockingErrors.some((e) => e.includes('ยังไม่ได้กรอกหมายเหตุ'))).toBe(false);
  });

  it('บล็อกเมื่อค่า KPI มีตัวเลขที่ไม่ถูกต้อง (Infinity/NaN)', () => {
    const params = baseParams();
    params.kpi = makeKpi({ net_difference: NaN });
    const result = validateSessionCompletion(params);
    expect(result.canComplete).toBe(false);
    expect(result.blockingErrors.some((e) => e.includes('คำนวณสรุปผลไม่สำเร็จ'))).toBe(true);
  });

  it('แจ้งเตือน (warning ไม่ใช่ blocking) เมื่อยังมีรายการไม่พบใน GL หรือ GL ไม่พบใน Bank', () => {
    const params = baseParams();
    params.kpi = makeKpi({ unmatched_bank_count: 5, unmatched_gl_count: 2 });
    const result = validateSessionCompletion(params);
    expect(result.canComplete).toBe(true);
    expect(result.warnings).toContain('ยังมีรายการไม่พบใน GL จำนวน 5 รายการ');
    expect(result.warnings).toContain('รายการ GL ไม่พบใน Bank จำนวน 2 รายการ');
  });

  it('requiresNote เป็นจริงเมื่อผลต่างสุทธิ ≠ 0 หรือมีรายการค้าง/รอตรวจสอบ', () => {
    expect(validateSessionCompletion({ ...baseParams(), kpi: makeKpi({ net_difference: 10 }) }).requiresNote).toBe(true);
    expect(validateSessionCompletion({ ...baseParams(), kpi: makeKpi({ unmatched_bank_count: 1 }) }).requiresNote).toBe(true);
    expect(validateSessionCompletion({ ...baseParams(), kpi: makeKpi({ unmatched_gl_count: 1 }) }).requiresNote).toBe(true);
    expect(validateSessionCompletion({ ...baseParams(), kpi: makeKpi({ review_count: 1 }) }).requiresNote).toBe(true);
  });

  it('requiresNote เป็นเท็จเมื่อไม่มีเงื่อนไขใดๆ ข้างต้นเลย', () => {
    expect(validateSessionCompletion(baseParams()).requiresNote).toBe(false);
  });
});
