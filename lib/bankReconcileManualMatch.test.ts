import { describe, expect, it } from 'vitest';
import {
  buildMatchGroup,
  classifyManualStatus,
  computeGroupTotals,
  deriveMatchType,
  describeGLCandidate,
  getRowNote,
  mergeManualMatches,
  resolveSuggestedCandidate,
  undoMatchGroup,
  validateManualMatch,
} from './bankReconcileManualMatch';
import { runReconciliationMatch } from './bankReconcileMatching';
import type { MatchBankRow, MatchGLRow, MatchGroup, ReconcileRow, RowNote } from '@/types/bankReconcile';

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

describe('computeGroupTotals', () => {
  it('รวมยอด Bank/GL แถวเดียวถูกต้อง และผลต่าง = 0 เมื่อยอดเท่ากัน', () => {
    const result = computeGroupTotals([makeBankRow({ bank_amount: 1000 })], [makeGLRow({ gl_amount: 1000 })]);
    expect(result).toEqual({ bankTotal: 1000, glTotal: 1000, amountDifference: 0 });
  });

  it('รวมยอดหลายแถวฝั่ง GL ถูกต้อง (กรณี 1 Bank : หลาย GL)', () => {
    const result = computeGroupTotals(
      [makeBankRow({ bank_amount: 10700 })],
      [makeGLRow({ gl_row_id: 'gl-2', gl_amount: 10000 }), makeGLRow({ gl_row_id: 'gl-3', gl_amount: 700 })]
    );
    expect(result).toEqual({ bankTotal: 10700, glTotal: 10700, amountDifference: 0 });
  });

  it('รวมยอดหลายแถวฝั่ง Bank ถูกต้อง (กรณีหลาย Bank : 1 GL)', () => {
    const result = computeGroupTotals(
      [makeBankRow({ bank_row_id: 'bank-2', bank_amount: 5000 }), makeBankRow({ bank_row_id: 'bank-3', bank_amount: 5700 })],
      [makeGLRow({ gl_amount: 10700 })]
    );
    expect(result).toEqual({ bankTotal: 10700, glTotal: 10700, amountDifference: 0 });
  });

  it('คำนวณผลต่างเป็นค่าสัมบูรณ์เสมอ ไม่ว่ายอดฝั่งไหนจะมากกว่า', () => {
    const result = computeGroupTotals([makeBankRow({ bank_amount: 100 })], [makeGLRow({ gl_amount: 150 })]);
    expect(result.amountDifference).toBe(50);
  });

  it('ปัดเศษทศนิยมป้องกันปัญหา floating point (0.1 + 0.2 ต้องไม่ใช่ 0.30000000000000004)', () => {
    const result = computeGroupTotals(
      [makeBankRow({ bank_amount: 0.1 }), makeBankRow({ bank_row_id: 'bank-3', bank_amount: 0.2 })],
      [makeGLRow({ gl_amount: 0.3 })]
    );
    expect(result.bankTotal).toBe(0.3);
    expect(result.amountDifference).toBe(0);
  });
});

describe('classifyManualStatus', () => {
  it('ผลต่าง 0 พอดี -> confirmed_manual เสมอไม่ว่าค่าคลาดเคลื่อนจะเป็นเท่าไหร่', () => {
    expect(classifyManualStatus(0, 0)).toBe('confirmed_manual');
    expect(classifyManualStatus(0, 5)).toBe('confirmed_manual');
  });

  it('ผลต่าง > 0 แต่ไม่เกินค่าคลาดเคลื่อน -> confirmed_tolerance', () => {
    expect(classifyManualStatus(0.5, 1)).toBe('confirmed_tolerance');
  });

  it('ผลต่างเท่ากับค่าคลาดเคลื่อนพอดี (ขอบเขต) -> confirmed_tolerance (<=)', () => {
    expect(classifyManualStatus(1, 1)).toBe('confirmed_tolerance');
  });

  it('ผลต่างเกินค่าคลาดเคลื่อน -> confirmed_variance', () => {
    expect(classifyManualStatus(1.01, 1)).toBe('confirmed_variance');
  });

  it('ค่าคลาดเคลื่อน = 0 (ค่าเริ่มต้นตามสเปก) ผลต่างใดๆ ที่ไม่ใช่ 0 ต้องเป็น confirmed_variance', () => {
    expect(classifyManualStatus(0.01, 0)).toBe('confirmed_variance');
  });
});

describe('deriveMatchType', () => {
  it('1 Bank : 1 GL จาก flow ยืนยันรายการที่แนะนำ -> one_to_one', () => {
    expect(deriveMatchType(1, 1, 'suggested')).toBe('one_to_one');
  });

  it('1 Bank : 1 GL จาก flow เลือกเอง -> manual_override', () => {
    expect(deriveMatchType(1, 1, 'manual')).toBe('manual_override');
  });

  it('1 Bank : หลาย GL -> one_to_many ไม่ว่าที่มาจะเป็น flow ไหน', () => {
    expect(deriveMatchType(1, 2, 'manual')).toBe('one_to_many');
    expect(deriveMatchType(1, 3, 'suggested')).toBe('one_to_many');
  });

  it('หลาย Bank : 1 GL -> many_to_one', () => {
    expect(deriveMatchType(2, 1, 'manual')).toBe('many_to_one');
  });

  it('หลาย Bank : หลาย GL (กรณีไม่ได้ระบุในสเปกตรงๆ) -> manual_override เป็นค่า fallback ที่ปลอดภัย', () => {
    expect(deriveMatchType(2, 2, 'manual')).toBe('manual_override');
  });
});

describe('buildMatchGroup', () => {
  it('สร้างกลุ่ม 1:1 ครบทุกฟิลด์ รวม date_difference_days ที่คำนวณได้จริง', () => {
    const group = buildMatchGroup({
      matchGroupId: 'group-9',
      matchType: 'one_to_one',
      bankRows: [makeBankRow({ bank_date: '2026-07-15', bank_amount: 1000 })],
      glRows: [makeGLRow({ gl_date: '2026-07-17', gl_amount: 1000 })],
      matchedBy: 'user@example.com',
      matchedAt: '2026-07-16T09:00:00.000Z',
      note: 'ตรวจสอบแล้ว',
      amountTolerance: 0,
      autoMatchScore: 80,
      autoMatchReason: 'ยอดเงินตรงกัน แต่วันที่ต่างกัน 2 วัน',
    });

    expect(group.match_group_id).toBe('group-9');
    expect(group.match_type).toBe('one_to_one');
    expect(group.status).toBe('confirmed_manual');
    expect(group.bank_transaction_ids).toEqual(['bank-2']);
    expect(group.gl_transaction_ids).toEqual(['gl-2']);
    expect(group.bank_total).toBe(1000);
    expect(group.gl_total).toBe(1000);
    expect(group.amount_difference).toBe(0);
    expect(group.date_difference_days).toBe(2);
    expect(group.manual_match).toBe(true);
    expect(group.matched_by).toBe('user@example.com');
    expect(group.note).toBe('ตรวจสอบแล้ว');
    expect(group.auto_match_score).toBe(80);
  });

  it('กลุ่ม 1 ต่อ หลาย -> date_difference_days เป็น null เสมอ (ไม่มีนิยามเดียวที่ชัดเจน)', () => {
    const group = buildMatchGroup({
      matchGroupId: 'group-10',
      matchType: 'one_to_many',
      bankRows: [makeBankRow({ bank_amount: 10700 })],
      glRows: [makeGLRow({ gl_row_id: 'gl-2', gl_amount: 10000 }), makeGLRow({ gl_row_id: 'gl-3', gl_amount: 700 })],
      matchedBy: 'user@example.com',
      matchedAt: '2026-07-16T09:00:00.000Z',
      note: '',
      amountTolerance: 0,
      autoMatchScore: null,
      autoMatchReason: null,
    });
    expect(group.date_difference_days).toBeNull();
    expect(group.gl_transaction_ids).toEqual(['gl-2', 'gl-3']);
    expect(group.status).toBe('confirmed_manual');
  });

  it('กลุ่มหลาย Bank ต่อ 1 GL ที่มีผลต่างเกินค่าคลาดเคลื่อน -> status confirmed_variance', () => {
    const group = buildMatchGroup({
      matchGroupId: 'group-11',
      matchType: 'many_to_one',
      bankRows: [makeBankRow({ bank_row_id: 'bank-2', bank_amount: 5000 }), makeBankRow({ bank_row_id: 'bank-3', bank_amount: 5690 })],
      glRows: [makeGLRow({ gl_amount: 10700 })],
      matchedBy: 'user@example.com',
      matchedAt: '2026-07-16T09:00:00.000Z',
      note: 'ผลต่างจากค่าธรรมเนียมธนาคาร',
      amountTolerance: 1,
      autoMatchScore: null,
      autoMatchReason: null,
    });
    expect(group.amount_difference).toBe(10);
    expect(group.status).toBe('confirmed_variance');
    expect(group.date_difference_days).toBeNull();
  });
});

describe('undoMatchGroup', () => {
  it('ลบกลุ่มที่ระบุออก เหลือกลุ่มอื่นครบ', () => {
    const groups = [makeGroup({ match_group_id: 'g1' }), makeGroup({ match_group_id: 'g2' })];
    const result = undoMatchGroup(groups, 'g1');
    expect(result.map((g) => g.match_group_id)).toEqual(['g2']);
  });

  it('ลบ id ที่ไม่มีอยู่จริง -> ไม่มีผลใดๆ (no-op)', () => {
    const groups = [makeGroup({ match_group_id: 'g1' })];
    const result = undoMatchGroup(groups, 'not-exist');
    expect(result).toHaveLength(1);
  });
});

describe('describeGLCandidate', () => {
  it('ยอดและวันที่ตรงกันเป๊ะ -> ผลต่างยอด 0, คะแนน 100', () => {
    const result = describeGLCandidate(
      { bank_date: '2026-07-15', bank_amount: 1000 },
      { gl_date: '2026-07-15', gl_amount: 1000 }
    );
    expect(result).toEqual({ dateDiffDays: 0, matchScore: 100, amountDifference: 0 });
  });

  it('ยอดต่างกัน -> คำนวณผลต่างยอดถูกต้อง (ไม่ใช่ 0 เหมือน candidates ของเฟส 2 ที่ยอดตรงกันเสมอ)', () => {
    const result = describeGLCandidate(
      { bank_date: '2026-07-15', bank_amount: 1000 },
      { gl_date: '2026-07-15', gl_amount: 850 }
    );
    expect(result.amountDifference).toBe(150);
  });
});

describe('resolveSuggestedCandidate', () => {
  it('ไม่มีผู้สมัครเลย -> null', () => {
    expect(resolveSuggestedCandidate(makeBankRow(), [])).toBeNull();
  });

  it('มีผู้สมัครเดียว -> เลือกตัวนั้น', () => {
    const gl = makeGLRow();
    expect(resolveSuggestedCandidate(makeBankRow(), [gl])).toBe(gl);
  });

  it('หลายผู้สมัคร -> เลือกคะแนนสูงสุด (วันที่ใกล้ Bank ที่สุด)', () => {
    const bank = makeBankRow({ bank_date: '2026-07-15' });
    const far = makeGLRow({ gl_row_id: 'gl-far', gl_date: '2026-07-10' }); // ห่าง 5 วัน
    const close = makeGLRow({ gl_row_id: 'gl-close', gl_date: '2026-07-16' }); // ห่าง 1 วัน
    expect(resolveSuggestedCandidate(bank, [far, close])).toBe(close);
  });

  it('คะแนนเท่ากันพอดี -> เลือกวันที่ใกล้ที่สุดเป็นตัวตัดสิน', () => {
    const bank = makeBankRow({ bank_date: '2026-07-15' });
    // ทั้งคู่ห่าง 2-3 วัน (คะแนนเท่ากันที่ 80 ตามสูตร) แต่ b ใกล้กว่า a
    const a = makeGLRow({ gl_row_id: 'gl-a', gl_date: '2026-07-18' }); // ห่าง 3 วัน
    const b = makeGLRow({ gl_row_id: 'gl-b', gl_date: '2026-07-17' }); // ห่าง 2 วัน
    expect(resolveSuggestedCandidate(bank, [a, b])).toBe(b);
  });
});

describe('getRowNote', () => {
  const baseRow: ReconcileRow = {
    bank: makeBankRow(),
    status: 'not_found_in_gl',
    matchedGL: null,
    matchedGLRows: [],
    candidates: [],
    matchScore: null,
    amountDifference: null,
    dateDifferenceDays: null,
    matchReason: '',
    matchGroup: null,
    reviewFlag: null,
    note: null,
  };

  it('ไม่มีทั้งกลุ่มและหมายเหตุ -> คืนสตริงว่าง', () => {
    expect(getRowNote(baseRow)).toBe('');
  });

  it('มีหมายเหตุเดี่ยว (ยังไม่ได้จับคู่) -> คืนค่าจาก RowNote', () => {
    const note: RowNote = { note: 'รอตรวจสอบเพิ่มเติม', updated_by: 'user@example.com', updated_at: '2026-07-16T00:00:00.000Z' };
    expect(getRowNote({ ...baseRow, note })).toBe('รอตรวจสอบเพิ่มเติม');
  });

  it('อยู่ในกลุ่มจับคู่แล้ว -> คืนค่าจาก MatchGroup.note เสมอ แม้จะมี RowNote เดี่ยวค้างอยู่ก็ตาม', () => {
    const note: RowNote = { note: 'หมายเหตุเก่าก่อนจับคู่', updated_by: 'user@example.com', updated_at: '2026-07-16T00:00:00.000Z' };
    const group = makeGroup({ note: 'หมายเหตุของกลุ่ม' });
    expect(getRowNote({ ...baseRow, note, matchGroup: group })).toBe('หมายเหตุของกลุ่ม');
  });
});

describe('validateManualMatch', () => {
  const emptySets = { consumedBankIds: new Set<string>(), consumedGLIds: new Set<string>(), autoUsedGLIds: new Set<string>() };

  it('ไม่ได้เลือก Bank เลย -> error', () => {
    const result = validateManualMatch({
      selectedBankIds: [],
      selectedGLIds: ['gl-2'],
      ...emptySets,
      amountDifference: 0,
      amountTolerance: 0,
      overrideConfirmed: false,
      note: '',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('Bank');
  });

  it('ไม่ได้เลือก GL เลย -> error', () => {
    const result = validateManualMatch({
      selectedBankIds: ['bank-2'],
      selectedGLIds: [],
      ...emptySets,
      amountDifference: 0,
      amountTolerance: 0,
      overrideConfirmed: false,
      note: '',
    });
    expect(result.valid).toBe(false);
  });

  it('เลือกแถว Bank ที่ถูกใช้ในกลุ่มอื่นแล้ว -> error กันซ้ำ', () => {
    const result = validateManualMatch({
      selectedBankIds: ['bank-2'],
      selectedGLIds: ['gl-2'],
      consumedBankIds: new Set(['bank-2']),
      consumedGLIds: new Set(),
      autoUsedGLIds: new Set(),
      amountDifference: 0,
      amountTolerance: 0,
      overrideConfirmed: false,
      note: '',
    });
    expect(result.valid).toBe(false);
  });

  it('เลือกแถว GL ที่ถูกใช้ในกลุ่มด้วยตนเองอื่นแล้ว -> error', () => {
    const result = validateManualMatch({
      selectedBankIds: ['bank-2'],
      selectedGLIds: ['gl-2'],
      consumedBankIds: new Set(),
      consumedGLIds: new Set(['gl-2']),
      autoUsedGLIds: new Set(),
      amountDifference: 0,
      amountTolerance: 0,
      overrideConfirmed: false,
      note: '',
    });
    expect(result.valid).toBe(false);
  });

  it('เลือกแถว GL ที่เอนจินอัตโนมัติใช้ไปแล้ว -> error (concurrency safety)', () => {
    const result = validateManualMatch({
      selectedBankIds: ['bank-2'],
      selectedGLIds: ['gl-2'],
      consumedBankIds: new Set(),
      consumedGLIds: new Set(),
      autoUsedGLIds: new Set(['gl-2']),
      amountDifference: 0,
      amountTolerance: 0,
      overrideConfirmed: false,
      note: '',
    });
    expect(result.valid).toBe(false);
  });

  it('ผลต่าง 0 พอดี -> ผ่านทันที ไม่ต้อง override/หมายเหตุ', () => {
    const result = validateManualMatch({
      selectedBankIds: ['bank-2'],
      selectedGLIds: ['gl-2'],
      ...emptySets,
      amountDifference: 0,
      amountTolerance: 0,
      overrideConfirmed: false,
      note: '',
    });
    expect(result).toMatchObject({ valid: true, requiresOverride: false, requiresNote: false });
  });

  it('ผลต่างอยู่ในค่าคลาดเคลื่อน -> ผ่านโดยไม่ต้อง override/หมายเหตุ', () => {
    const result = validateManualMatch({
      selectedBankIds: ['bank-2'],
      selectedGLIds: ['gl-2'],
      ...emptySets,
      amountDifference: 0.5,
      amountTolerance: 1,
      overrideConfirmed: false,
      note: '',
    });
    expect(result).toMatchObject({ valid: true, requiresOverride: false, requiresNote: false });
  });

  it('ผลต่างเกินค่าคลาดเคลื่อน ยังไม่ได้กด override -> ไม่ผ่าน และบอก requiresOverride', () => {
    const result = validateManualMatch({
      selectedBankIds: ['bank-2'],
      selectedGLIds: ['gl-2'],
      ...emptySets,
      amountDifference: 5,
      amountTolerance: 1,
      overrideConfirmed: false,
      note: '',
    });
    expect(result.valid).toBe(false);
    expect(result.requiresOverride).toBe(true);
    expect(result.requiresNote).toBe(true);
  });

  it('ผลต่างเกินค่าคลาดเคลื่อน กด override แล้วแต่ไม่กรอกหมายเหตุ -> ไม่ผ่าน', () => {
    const result = validateManualMatch({
      selectedBankIds: ['bank-2'],
      selectedGLIds: ['gl-2'],
      ...emptySets,
      amountDifference: 5,
      amountTolerance: 1,
      overrideConfirmed: true,
      note: '   ',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('หมายเหตุ'))).toBe(true);
  });

  it('ผลต่างเกินค่าคลาดเคลื่อน กด override + กรอกหมายเหตุครบ -> ผ่าน', () => {
    const result = validateManualMatch({
      selectedBankIds: ['bank-2'],
      selectedGLIds: ['gl-2'],
      ...emptySets,
      amountDifference: 5,
      amountTolerance: 1,
      overrideConfirmed: true,
      note: 'ผลต่างจากค่าธรรมเนียมโอนเงิน',
    });
    expect(result.valid).toBe(true);
  });
});

describe('mergeManualMatches', () => {
  const bankRows: MatchBankRow[] = [
    makeBankRow({ bank_row_id: 'bank-2', bank_date: '2026-07-15', bank_amount: 1000, bank_money_in: 1000, bank_money_out: 0 }),
    makeBankRow({ bank_row_id: 'bank-3', bank_date: '2026-07-16', bank_amount: -500, bank_money_in: 0, bank_money_out: 500 }),
    makeBankRow({ bank_row_id: 'bank-4', bank_date: '2026-07-20', bank_amount: 2000, bank_money_in: 2000, bank_money_out: 0 }),
  ];
  const glRows: MatchGLRow[] = [
    makeGLRow({ gl_row_id: 'gl-2', gl_date: '2026-07-15', gl_document_no: 'JV-001', gl_amount: 1000, gl_debit: 1000, gl_credit: 0 }),
    makeGLRow({ gl_row_id: 'gl-3', gl_date: '2026-07-17', gl_document_no: 'JV-002', gl_amount: -500, gl_debit: 0, gl_credit: 500 }),
    makeGLRow({ gl_row_id: 'gl-4', gl_date: '2026-07-18', gl_document_no: 'JV-003', gl_amount: -9999, gl_debit: 0, gl_credit: 9999 }),
  ];

  it('ไม่มีการจับคู่ด้วยตนเองเลย -> ผลลัพธ์ต้องเหมือน runReconciliationMatch() ตรงๆ ทุกประการ', () => {
    const direct = runReconciliationMatch(bankRows, glRows, 3);
    const merged = mergeManualMatches({
      matchBankRows: bankRows,
      matchGLRows: glRows,
      toleranceDays: 3,
      matchGroups: [],
      reviewFlags: {},
      notes: {},
    });

    expect(merged.rows.map((r) => r.status)).toEqual(direct.bankResults.map((r) => r.status));
    expect(merged.rows.map((r) => r.matchedGL?.gl_row_id ?? null)).toEqual(
      direct.bankResults.map((r) => r.matchedGL?.gl_row_id ?? null)
    );
    expect(merged.glOnlyResults.map((r) => r.gl.gl_row_id)).toEqual(direct.glOnlyResults.map((r) => r.gl.gl_row_id));
    expect(merged.rows.every((r) => r.matchGroup === null)).toBe(true);
  });

  it('กลุ่มยืนยัน 1:1 หนึ่งกลุ่ม -> แถวนั้นได้สถานะ/matchedGL จากกลุ่ม แถวอื่นจับคู่อัตโนมัติตามปกติ และ GL ที่ใช้แล้วไม่ถูกเสนอซ้ำ', () => {
    const group = buildMatchGroup({
      matchGroupId: 'group-1',
      matchType: 'one_to_one',
      bankRows: [bankRows[0]],
      glRows: [glRows[0]],
      matchedBy: 'user@example.com',
      matchedAt: '2026-07-16T09:00:00.000Z',
      note: '',
      amountTolerance: 0,
      autoMatchScore: 100,
      autoMatchReason: 'ยอดเงินตรงกัน และวันที่ตรงกัน',
    });

    const merged = mergeManualMatches({
      matchBankRows: bankRows,
      matchGLRows: glRows,
      toleranceDays: 3,
      matchGroups: [group],
      reviewFlags: {},
      notes: {},
    });

    const row1 = merged.rows.find((r) => r.bank.bank_row_id === 'bank-2')!;
    expect(row1.status).toBe('confirmed_manual');
    expect(row1.matchedGL?.gl_row_id).toBe('gl-2');
    expect(row1.matchGroup).toBe(group);

    // แถวอื่นยังคำนวณตามปกติ (bank-3 จับคู่กับ gl-3 แบบ tolerance เหมือนเดิม เพราะยังไม่ถูกใครใช้)
    const row2 = merged.rows.find((r) => r.bank.bank_row_id === 'bank-3')!;
    expect(row2.status).toBe('matched_tolerance');
    expect(row2.matchedGL?.gl_row_id).toBe('gl-3');

    // gl-2 ถูกกันออกจาก pool อัตโนมัติแล้ว ไม่มีทางถูกเสนอให้แถวอื่นอีก
    expect(merged.consumedGLIds.has('gl-2')).toBe(true);
    expect(merged.autoUsedGLIds.has('gl-2')).toBe(false);
  });

  it('กลุ่ม 1 Bank ต่อหลาย GL -> matchedGL เป็น null แต่ matchedGLRows มีครบทุกแถว', () => {
    const oneToManyGL: MatchGLRow[] = [
      makeGLRow({ gl_row_id: 'gl-a', gl_amount: 700, gl_debit: 700, gl_credit: 0 }),
      makeGLRow({ gl_row_id: 'gl-b', gl_amount: 300, gl_debit: 300, gl_credit: 0 }),
    ];
    const oneBank = [makeBankRow({ bank_row_id: 'bank-x', bank_amount: 1000, bank_money_in: 1000 })];
    const group = buildMatchGroup({
      matchGroupId: 'group-2',
      matchType: 'one_to_many',
      bankRows: oneBank,
      glRows: oneToManyGL,
      matchedBy: 'user@example.com',
      matchedAt: '2026-07-16T09:00:00.000Z',
      note: '',
      amountTolerance: 0,
      autoMatchScore: null,
      autoMatchReason: null,
    });

    const merged = mergeManualMatches({
      matchBankRows: oneBank,
      matchGLRows: oneToManyGL,
      toleranceDays: 3,
      matchGroups: [group],
      reviewFlags: {},
      notes: {},
    });

    expect(merged.rows).toHaveLength(1);
    expect(merged.rows[0].matchedGL).toBeNull();
    expect(merged.rows[0].matchedGLRows.map((g) => g.gl_row_id)).toEqual(['gl-a', 'gl-b']);
    expect(merged.rows[0].status).toBe('confirmed_manual');
    expect(merged.glOnlyResults).toHaveLength(0);
  });

  it('กลุ่มหลาย Bank ต่อ 1 GL -> ทุกแถว Bank ในกลุ่มชี้ไป GL แถวเดียวกัน และไม่มีแถวไหนหลุดหายไปจากผลลัพธ์', () => {
    const manyBank = [
      makeBankRow({ bank_row_id: 'bank-x', bank_amount: 5000 }),
      makeBankRow({ bank_row_id: 'bank-y', bank_amount: 5700 }),
    ];
    const oneGL = [makeGLRow({ gl_row_id: 'gl-z', gl_amount: 10700, gl_debit: 10700 })];
    const group = buildMatchGroup({
      matchGroupId: 'group-3',
      matchType: 'many_to_one',
      bankRows: manyBank,
      glRows: oneGL,
      matchedBy: 'user@example.com',
      matchedAt: '2026-07-16T09:00:00.000Z',
      note: '',
      amountTolerance: 0,
      autoMatchScore: null,
      autoMatchReason: null,
    });

    const merged = mergeManualMatches({
      matchBankRows: manyBank,
      matchGLRows: oneGL,
      toleranceDays: 3,
      matchGroups: [group],
      reviewFlags: {},
      notes: {},
    });

    expect(merged.rows).toHaveLength(2);
    expect(merged.rows.every((r) => r.matchedGL?.gl_row_id === 'gl-z')).toBe(true);
    expect(merged.rows.every((r) => r.matchGroup?.match_group_id === 'group-3')).toBe(true);
  });

  it('ผลลัพธ์เรียงตามลำดับแถว Bank ต้นฉบับเสมอ ไม่ว่ากลุ่มจะอ้างอิงแถวลำดับไหน', () => {
    const group = buildMatchGroup({
      matchGroupId: 'group-4',
      matchType: 'manual_override',
      bankRows: [bankRows[2]], // bank-4 (แถวสุดท้าย) ถูกจับคู่ด้วยตนเอง
      glRows: [glRows[2]],
      matchedBy: 'user@example.com',
      matchedAt: '2026-07-16T09:00:00.000Z',
      note: 'เลือกเอง',
      amountTolerance: 20000,
      autoMatchScore: null,
      autoMatchReason: null,
    });
    const merged = mergeManualMatches({
      matchBankRows: bankRows,
      matchGLRows: glRows,
      toleranceDays: 3,
      matchGroups: [group],
      reviewFlags: {},
      notes: {},
    });
    expect(merged.rows.map((r) => r.bank.bank_row_id)).toEqual(['bank-2', 'bank-3', 'bank-4']);
  });

  it('reviewFlags/notes ผูกกับแถวที่ยังไม่ได้จับคู่ด้วยตนเองถูกต้อง และแถวที่จับคู่แล้วไม่ใช้ notes เดี่ยว', () => {
    const note: RowNote = { note: 'เช็คกับธนาคารแล้ว', updated_by: 'user@example.com', updated_at: '2026-07-16T00:00:00.000Z' };
    const merged = mergeManualMatches({
      matchBankRows: bankRows,
      matchGLRows: glRows,
      toleranceDays: 3,
      matchGroups: [],
      reviewFlags: { 'bank-4': { review_required: true, reviewed_by: 'user@example.com', reviewed_at: '2026-07-16T00:00:00.000Z' } },
      notes: { 'bank-3': note },
    });
    expect(merged.rows.find((r) => r.bank.bank_row_id === 'bank-4')!.reviewFlag?.review_required).toBe(true);
    expect(merged.rows.find((r) => r.bank.bank_row_id === 'bank-3')!.note).toEqual(note);
    expect(merged.rows.find((r) => r.bank.bank_row_id === 'bank-2')!.reviewFlag).toBeNull();
  });
});
