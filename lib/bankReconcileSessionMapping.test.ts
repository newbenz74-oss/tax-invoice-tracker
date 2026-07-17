import { describe, expect, it } from 'vitest';
import {
  amountToleranceValueToOption,
  buildSessionSavePayload,
  daysToDateToleranceOption,
  dateToleranceOptionToDays,
  ensureStableId,
  isUuid,
  mapDbRowsToSessionCore,
  regenerateAllIds,
  remapRecordKeys,
} from './bankReconcileSessionMapping';
import type { MatchBankRow, MatchGLRow, MatchGroup, ReconcileRow } from '@/types/bankReconcile';
import type { BankTransactionDbRow, GLTransactionDbRow, MatchGroupDbRow, MatchGroupItemDbRow } from '@/types/bankReconcileSession';

const SAMPLE_UUID = '11111111-2222-4333-8444-555555555555';
const SAMPLE_UUID_2 = '66666666-7777-4888-8999-aaaaaaaaaaaa';

function makeBankRow(overrides: Partial<MatchBankRow> = {}): MatchBankRow {
  return {
    bank_row_id: 'bank-1',
    bank_date: '2026-07-15',
    bank_description: 'รับโอนจากลูกค้า A',
    bank_money_in: 1000,
    bank_money_out: 0,
    bank_amount: 1000,
    bank_balance: 5000,
    raw_bank_row: ['15/07/2026', 'รับโอนจากลูกค้า A', '1000', '', '5000'],
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
    raw_gl_row: ['15/07/2026', 'JV-001', 'รับชำระจากลูกค้า A', '1000', ''],
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

describe('isUuid', () => {
  it('ยอมรับ uuid มาตรฐานทุกรูปแบบตัวพิมพ์', () => {
    expect(isUuid(SAMPLE_UUID)).toBe(true);
    expect(isUuid(SAMPLE_UUID.toUpperCase())).toBe(true);
  });

  it('ปฏิเสธรูปแบบ id ของเฟส 2 เดิม ("bank-N"/"gl-N")', () => {
    expect(isUuid('bank-1')).toBe(false);
    expect(isUuid('gl-42')).toBe(false);
  });

  it('ปฏิเสธ match_group_id ที่มี prefix "mg-" นำหน้า uuid (ไม่ใช่ uuid ล้วนๆ)', () => {
    expect(isUuid(`mg-${SAMPLE_UUID}`)).toBe(false);
  });
});

describe('ensureStableId', () => {
  it('คืนค่าเดิมเป๊ะเมื่อเป็น uuid อยู่แล้ว (changed: false)', () => {
    const result = ensureStableId(SAMPLE_UUID);
    expect(result).toEqual({ id: SAMPLE_UUID, changed: false });
  });

  it('สร้าง uuid ใหม่ให้เมื่อยังเป็นรูปแบบ "bank-N" เดิม (changed: true)', () => {
    const result = ensureStableId('bank-7');
    expect(result.changed).toBe(true);
    expect(isUuid(result.id)).toBe(true);
    expect(result.id).not.toBe('bank-7');
  });
});

describe('dateToleranceOptionToDays / daysToDateToleranceOption', () => {
  it('แปลงไป-กลับได้ครบทุกตัวเลือกเป๊ะ', () => {
    expect(dateToleranceOptionToDays('same_day')).toBe(0);
    expect(dateToleranceOptionToDays('1_day')).toBe(1);
    expect(dateToleranceOptionToDays('3_days')).toBe(3);
    expect(dateToleranceOptionToDays('7_days')).toBe(7);
    expect(daysToDateToleranceOption(0)).toBe('same_day');
    expect(daysToDateToleranceOption(1)).toBe('1_day');
    expect(daysToDateToleranceOption(3)).toBe('3_days');
    expect(daysToDateToleranceOption(7)).toBe('7_days');
  });

  it('fallback เป็นค่าเริ่มต้นของระบบ (3_days) เมื่อจำนวนวันไม่ตรงกับตัวเลือกใดเลย', () => {
    expect(daysToDateToleranceOption(99)).toBe('3_days');
  });
});

describe('amountToleranceValueToOption', () => {
  it('จับคู่ค่าตัวเลขกับตัวเลือกสำเร็จรูปได้ถูกต้อง', () => {
    expect(amountToleranceValueToOption(0)).toEqual({ option: 'zero', custom: 0 });
    expect(amountToleranceValueToOption(0.01)).toEqual({ option: 'small', custom: 0 });
    expect(amountToleranceValueToOption(1)).toEqual({ option: 'one', custom: 0 });
  });

  it('ค่าที่ไม่ตรงกับตัวเลือกสำเร็จรูปใดเลยถือเป็น custom พร้อมเก็บค่าเดิมไว้', () => {
    expect(amountToleranceValueToOption(25.5)).toEqual({ option: 'custom', custom: 25.5 });
  });

  it('ค่าที่ไม่ใช่ตัวเลขจริง (NaN) fallback เป็นค่าเริ่มต้นของระบบ (zero) แทนที่จะเป็น custom', () => {
    expect(amountToleranceValueToOption(NaN)).toEqual({ option: 'zero', custom: 0 });
  });
});

describe('buildSessionSavePayload', () => {
  it('แถวที่มี uuid ถาวรอยู่แล้วใช้ id เดิมต่อไป (idsChanged: false)', () => {
    const rows: ReconcileRow[] = [makeRow({ bank: makeBankRow({ bank_row_id: SAMPLE_UUID }) })];
    const glRows: MatchGLRow[] = [makeGLRow({ gl_row_id: SAMPLE_UUID_2 })];
    const result = buildSessionSavePayload({ reconcileRows: rows, matchGLRows: glRows, matchGroups: [] });
    expect(result.idsChanged).toBe(false);
    expect(result.remappedMatchBankRows[0].bank_row_id).toBe(SAMPLE_UUID);
    expect(result.remappedMatchGLRows[0].gl_row_id).toBe(SAMPLE_UUID_2);
    expect(result.bankTransactionsPayload[0].id).toBe(SAMPLE_UUID);
  });

  it('แถวที่เพิ่งอัปโหลดสดๆ ("bank-N"/"gl-N") ได้ uuid ถาวรใหม่ (idsChanged: true) และกลุ่มจับคู่ถูกรีแมปตาม', () => {
    const rows: ReconcileRow[] = [makeRow({ bank: makeBankRow({ bank_row_id: 'bank-1' }) })];
    const glRows: MatchGLRow[] = [makeGLRow({ gl_row_id: 'gl-1' })];
    const groups: MatchGroup[] = [makeGroup({ bank_transaction_ids: ['bank-1'], gl_transaction_ids: ['gl-1'] })];
    const result = buildSessionSavePayload({ reconcileRows: rows, matchGLRows: glRows, matchGroups: groups });

    expect(result.idsChanged).toBe(true);
    const newBankId = result.remappedMatchBankRows[0].bank_row_id;
    const newGlId = result.remappedMatchGLRows[0].gl_row_id;
    expect(isUuid(newBankId)).toBe(true);
    expect(isUuid(newGlId)).toBe(true);
    // กลุ่มจับคู่ต้องอ้างอิง id ใหม่ที่ถูกรีแมปแล้ว ไม่ใช่ "bank-1"/"gl-1" เดิม
    expect(result.remappedMatchGroups[0].bank_transaction_ids).toEqual([newBankId]);
    expect(result.remappedMatchGroups[0].gl_transaction_ids).toEqual([newGlId]);
  });

  it('กำหนด source_row_number ตามตำแหน่งใน array (1-based) เสมอ', () => {
    const rows: ReconcileRow[] = [
      makeRow({ bank: makeBankRow({ bank_row_id: SAMPLE_UUID }) }),
      makeRow({ bank: makeBankRow({ bank_row_id: SAMPLE_UUID_2, bank_description: 'แถวที่สอง' }) }),
    ];
    const result = buildSessionSavePayload({ reconcileRows: rows, matchGLRows: [], matchGroups: [] });
    expect(result.bankTransactionsPayload.map((p) => p.source_row_number)).toEqual([1, 2]);
  });

  it('is_used ของ GL คำนวณจาก gl_transaction_ids ที่ถูกใช้ในกลุ่มจับคู่ใดๆ ก็ตาม', () => {
    const glRows: MatchGLRow[] = [makeGLRow({ gl_row_id: SAMPLE_UUID, gl_document_no: 'JV-USED' }), makeGLRow({ gl_row_id: SAMPLE_UUID_2, gl_document_no: 'JV-UNUSED' })];
    const groups: MatchGroup[] = [makeGroup({ bank_transaction_ids: [SAMPLE_UUID], gl_transaction_ids: [SAMPLE_UUID] })];
    const result = buildSessionSavePayload({
      reconcileRows: [makeRow({ bank: makeBankRow({ bank_row_id: SAMPLE_UUID }) })],
      matchGLRows: glRows,
      matchGroups: groups,
    });
    const usedRow = result.glTransactionsPayload.find((p) => p.id === SAMPLE_UUID);
    const unusedRow = result.glTransactionsPayload.find((p) => p.id === SAMPLE_UUID_2);
    expect(usedRow?.is_used).toBe(true);
    expect(unusedRow?.is_used).toBe(false);
  });

  it('แยก raw_data/normalized_data ออกจากกันเสมอ และไม่รวม bank_row_id/gl_row_id ปนใน normalized_data', () => {
    const bank = makeBankRow({ bank_row_id: SAMPLE_UUID });
    const result = buildSessionSavePayload({ reconcileRows: [makeRow({ bank })], matchGLRows: [], matchGroups: [] });
    const payload = result.bankTransactionsPayload[0];
    expect(payload.raw_data).toEqual(bank.raw_bank_row);
    const normalized = payload.normalized_data as Record<string, unknown>;
    expect(normalized.bank_row_id).toBeUndefined();
    expect(normalized.raw_bank_row).toBeUndefined();
    expect(normalized.bank_description).toBe(bank.bank_description);
  });

  it('คืน bankIdMap ที่ใช้รีแมป reviewFlags/notes ต่อได้ทันทีหลังบันทึกครั้งแรก (กันบั๊ก "หมายเหตุหายเงียบๆ")', () => {
    const rows: ReconcileRow[] = [makeRow({ bank: makeBankRow({ bank_row_id: 'bank-1' }) })];
    const result = buildSessionSavePayload({ reconcileRows: rows, matchGLRows: [], matchGroups: [] });
    const newBankId = result.remappedMatchBankRows[0].bank_row_id;
    expect(result.bankIdMap.get('bank-1')).toBe(newBankId);

    const reviewFlags = { 'bank-1': { review_required: true as const, reviewed_by: 'x', reviewed_at: '' } };
    const remapped = remapRecordKeys(reviewFlags, result.bankIdMap);
    expect(remapped[newBankId]).toEqual(reviewFlags['bank-1']);
  });

  it('bankIdMap ว่างเปล่าเมื่อทุกแถวมี uuid ถาวรอยู่แล้ว (idsChanged: false)', () => {
    const rows: ReconcileRow[] = [makeRow({ bank: makeBankRow({ bank_row_id: SAMPLE_UUID }) })];
    const result = buildSessionSavePayload({ reconcileRows: rows, matchGLRows: [], matchGroups: [] });
    expect(result.bankIdMap.size).toBe(0);
  });

  it('สร้าง matchGroupItemsPayload ครบทั้งฝั่ง bank และ gl ของทุกกลุ่ม', () => {
    const groups: MatchGroup[] = [
      makeGroup({ match_group_id: 'mg-a', bank_transaction_ids: [SAMPLE_UUID], gl_transaction_ids: [SAMPLE_UUID_2] }),
    ];
    const result = buildSessionSavePayload({
      reconcileRows: [makeRow({ bank: makeBankRow({ bank_row_id: SAMPLE_UUID }) })],
      matchGLRows: [makeGLRow({ gl_row_id: SAMPLE_UUID_2 })],
      matchGroups: groups,
    });
    expect(result.matchGroupItemsPayload).toEqual([
      { match_group_id: 'mg-a', transaction_type: 'bank', bank_transaction_id: SAMPLE_UUID, gl_transaction_id: null },
      { match_group_id: 'mg-a', transaction_type: 'gl', bank_transaction_id: null, gl_transaction_id: SAMPLE_UUID_2 },
    ]);
  });
});

describe('mapDbRowsToSessionCore', () => {
  function makeBankDbRow(overrides: Partial<BankTransactionDbRow> = {}): BankTransactionDbRow {
    return {
      id: SAMPLE_UUID,
      session_id: 'session-1',
      source_row_number: 1,
      bank_transaction_date: '2026-07-15',
      bank_description: 'รับโอนจากลูกค้า A',
      bank_money_in: 1000,
      bank_money_out: 0,
      bank_amount: 1000,
      bank_balance: 5000,
      raw_data: ['15/07/2026', 'รับโอนจากลูกค้า A', '1000', '', '5000'],
      normalized_data: {
        bank_date: '2026-07-15',
        bank_description: 'รับโอนจากลูกค้า A',
        bank_money_in: 1000,
        bank_money_out: 0,
        bank_amount: 1000,
        bank_balance: 5000,
      },
      reconcile_status: 'confirmed_manual',
      review_required: false,
      review_note: null,
      note_updated_by: null,
      note_updated_at: null,
      reviewed_by: null,
      reviewed_at: null,
      created_at: '2026-07-16T00:00:00.000Z',
      ...overrides,
    };
  }

  function makeGLDbRow(overrides: Partial<GLTransactionDbRow> = {}): GLTransactionDbRow {
    return {
      id: SAMPLE_UUID_2,
      session_id: 'session-1',
      source_row_number: 1,
      gl_date: '2026-07-15',
      gl_document_no: 'JV-001',
      gl_description: 'รับชำระจากลูกค้า A',
      gl_debit: 1000,
      gl_credit: 0,
      gl_amount: 1000,
      raw_data: ['15/07/2026', 'JV-001', 'รับชำระจากลูกค้า A', '1000', ''],
      normalized_data: {
        gl_date: '2026-07-15',
        gl_document_no: 'JV-001',
        gl_description: 'รับชำระจากลูกค้า A',
        gl_debit: 1000,
        gl_credit: 0,
        gl_amount: 1000,
      },
      is_used: true,
      created_at: '2026-07-16T00:00:00.000Z',
      ...overrides,
    };
  }

  it('เรียงลำดับแถว Bank/GL ตาม source_row_number เสมอ (ไม่พึ่งลำดับ SELECT จากฐานข้อมูล)', () => {
    const bankRows = [makeBankDbRow({ id: 'b-2', source_row_number: 2 }), makeBankDbRow({ id: 'b-1', source_row_number: 1 })];
    const result = mapDbRowsToSessionCore(bankRows, [], [], []);
    expect(result.matchBankRows.map((r) => r.bank_row_id)).toEqual(['b-1', 'b-2']);
  });

  it('ประกอบ MatchBankRow กลับจาก raw_data + normalized_data + id ได้ครบทุกฟิลด์', () => {
    const result = mapDbRowsToSessionCore([makeBankDbRow()], [], [], []);
    expect(result.matchBankRows[0]).toEqual({
      bank_row_id: SAMPLE_UUID,
      raw_bank_row: makeBankDbRow().raw_data,
      bank_date: '2026-07-15',
      bank_description: 'รับโอนจากลูกค้า A',
      bank_money_in: 1000,
      bank_money_out: 0,
      bank_amount: 1000,
      bank_balance: 5000,
    });
  });

  it('ประกอบ MatchGroup กลับพร้อม bank_transaction_ids/gl_transaction_ids จากแถว match_group_items', () => {
    const groupRow: MatchGroupDbRow = {
      id: 'mg-1',
      session_id: 'session-1',
      match_type: 'one_to_one',
      bank_total: 1000,
      gl_total: 1000,
      amount_difference: 0,
      match_score: 100,
      match_reason: 'ยอดตรงกัน',
      manual_match: true,
      status: 'confirmed_manual',
      note: 'ตรวจสอบแล้ว',
      matched_by: 'user@example.com',
      matched_at: '2026-07-16T10:00:00.000Z',
      created_at: '2026-07-16T10:00:00.000Z',
      updated_at: '2026-07-16T10:00:00.000Z',
    };
    const itemRows: MatchGroupItemDbRow[] = [
      { id: 'item-1', session_id: 'session-1', match_group_id: 'mg-1', transaction_type: 'bank', bank_transaction_id: SAMPLE_UUID, gl_transaction_id: null, created_at: '' },
      { id: 'item-2', session_id: 'session-1', match_group_id: 'mg-1', transaction_type: 'gl', bank_transaction_id: null, gl_transaction_id: SAMPLE_UUID_2, created_at: '' },
    ];
    const result = mapDbRowsToSessionCore([makeBankDbRow()], [makeGLDbRow()], [groupRow], itemRows);
    expect(result.matchGroups).toHaveLength(1);
    expect(result.matchGroups[0].bank_transaction_ids).toEqual([SAMPLE_UUID]);
    expect(result.matchGroups[0].gl_transaction_ids).toEqual([SAMPLE_UUID_2]);
    // date_difference_days คำนวณใหม่จากวันที่ของแถว Bank/GL จริง (ไม่ได้ persist ไว้ในฐานข้อมูล) — ทั้งสองแถว
    // วันที่เดียวกัน (2026-07-15) จึงต้องได้ 0
    expect(result.matchGroups[0].date_difference_days).toBe(0);
  });

  it('date_difference_days เป็น null เสมอเมื่อกลุ่มไม่ใช่ 1:1 (มากกว่า 1 แถวฝั่งใดฝั่งหนึ่ง)', () => {
    const groupRow: MatchGroupDbRow = {
      id: 'mg-1',
      session_id: 'session-1',
      match_type: 'one_to_many',
      bank_total: 1000,
      gl_total: 1000,
      amount_difference: 0,
      match_score: null,
      match_reason: null,
      manual_match: true,
      status: 'confirmed_manual',
      note: '',
      matched_by: 'user@example.com',
      matched_at: '2026-07-16T10:00:00.000Z',
      created_at: '2026-07-16T10:00:00.000Z',
      updated_at: '2026-07-16T10:00:00.000Z',
    };
    const itemRows: MatchGroupItemDbRow[] = [
      { id: 'item-1', session_id: 'session-1', match_group_id: 'mg-1', transaction_type: 'bank', bank_transaction_id: SAMPLE_UUID, gl_transaction_id: null, created_at: '' },
      { id: 'item-2', session_id: 'session-1', match_group_id: 'mg-1', transaction_type: 'gl', bank_transaction_id: null, gl_transaction_id: SAMPLE_UUID_2, created_at: '' },
      { id: 'item-3', session_id: 'session-1', match_group_id: 'mg-1', transaction_type: 'gl', bank_transaction_id: null, gl_transaction_id: 'gl-extra', created_at: '' },
    ];
    const result = mapDbRowsToSessionCore(
      [makeBankDbRow()],
      [makeGLDbRow(), makeGLDbRow({ id: 'gl-extra', gl_document_no: 'JV-002' })],
      [groupRow],
      itemRows
    );
    expect(result.matchGroups[0].date_difference_days).toBeNull();
  });

  it('ประกอบ reviewFlags/notes กลับจากฟิลด์ review_required/review_note ของแถว Bank', () => {
    const bankRow = makeBankDbRow({
      review_required: true,
      reviewed_by: 'reviewer@example.com',
      reviewed_at: '2026-07-16T09:00:00.000Z',
      review_note: 'ต้องตรวจสอบยอดซ้ำ',
      note_updated_by: 'reviewer@example.com',
      note_updated_at: '2026-07-16T09:00:00.000Z',
    });
    const result = mapDbRowsToSessionCore([bankRow], [], [], []);
    expect(result.reviewFlags[SAMPLE_UUID]).toEqual({
      review_required: true,
      reviewed_by: 'reviewer@example.com',
      reviewed_at: '2026-07-16T09:00:00.000Z',
    });
    expect(result.notes[SAMPLE_UUID]).toEqual({
      note: 'ต้องตรวจสอบยอดซ้ำ',
      updated_by: 'reviewer@example.com',
      updated_at: '2026-07-16T09:00:00.000Z',
    });
  });

  it('ไม่สร้าง reviewFlags/notes ให้แถวที่ไม่มีการตรวจสอบ/หมายเหตุ', () => {
    const result = mapDbRowsToSessionCore([makeBankDbRow()], [], [], []);
    expect(result.reviewFlags[SAMPLE_UUID]).toBeUndefined();
    expect(result.notes[SAMPLE_UUID]).toBeUndefined();
  });
});

describe('regenerateAllIds', () => {
  it('สร้าง id ใหม่ทั้งหมดแบบไม่มีเงื่อนไข (ต่างจาก ensureStableId) แม้ id เดิมจะเป็น uuid ที่ถูกต้องอยู่แล้ว', () => {
    const matchBankRows = [makeBankRow({ bank_row_id: SAMPLE_UUID })];
    const matchGLRows = [makeGLRow({ gl_row_id: SAMPLE_UUID_2 })];
    const matchGroups = [makeGroup({ match_group_id: 'mg-old', bank_transaction_ids: [SAMPLE_UUID], gl_transaction_ids: [SAMPLE_UUID_2] })];

    const result = regenerateAllIds(matchBankRows, matchGLRows, matchGroups);

    expect(result.matchBankRows[0].bank_row_id).not.toBe(SAMPLE_UUID);
    expect(isUuid(result.matchBankRows[0].bank_row_id)).toBe(true);
    expect(result.matchGLRows[0].gl_row_id).not.toBe(SAMPLE_UUID_2);
    expect(result.matchGroups[0].match_group_id).not.toBe('mg-old');
    expect(result.matchGroups[0].match_group_id.startsWith('mg-')).toBe(true);
    // กลุ่มจับคู่ต้องอ้างอิง id ใหม่ที่รีแมปแล้ว ไม่ใช่ id เดิม
    expect(result.matchGroups[0].bank_transaction_ids).toEqual([result.matchBankRows[0].bank_row_id]);
    expect(result.matchGroups[0].gl_transaction_ids).toEqual([result.matchGLRows[0].gl_row_id]);
  });

  it('คืน bankIdMap/glIdMap ที่ใช้รีแมป key อื่น (เช่น reviewFlags/notes) ต่อได้', () => {
    const matchBankRows = [makeBankRow({ bank_row_id: 'bank-1' })];
    const result = regenerateAllIds(matchBankRows, [], []);
    expect(result.bankIdMap.get('bank-1')).toBe(result.matchBankRows[0].bank_row_id);
  });
});

describe('remapRecordKeys', () => {
  it('รีแมป key ตาม idMap ที่ให้มา', () => {
    const idMap = new Map([['old-1', 'new-1']]);
    const record = { 'old-1': { note: 'หมายเหตุ', updated_by: 'x', updated_at: '2026-07-16T00:00:00.000Z' } };
    const result = remapRecordKeys(record, idMap);
    expect(result).toEqual({ 'new-1': record['old-1'] });
  });

  it('คง key เดิมไว้เมื่อไม่มีใน idMap (กันไว้เพื่อความปลอดภัย)', () => {
    const record = { 'unmapped-1': { note: 'x', updated_by: 'x', updated_at: '' } };
    const result = remapRecordKeys(record, new Map());
    expect(result).toEqual(record);
  });
});
