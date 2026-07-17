import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { buildReconcileSessionExcelBlob, buildReconcileSessionPdfBlob } from './bankReconcileSessionExport';
import type { MatchBankRow, MatchGLRow, MatchGroup, ReconcileRow } from '@/types/bankReconcile';
import type { ReconcileAuditLogEntry, ReconcileSession } from '@/types/bankReconcileSession';

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
    note: 'ตรวจสอบแล้วถูกต้อง',
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

function makeSession(overrides: Partial<ReconcileSession> = {}): ReconcileSession {
  return {
    id: 'session-1',
    session_name: 'กระทบยอดบัญชีกระแสรายวัน กรกฎาคม 2569',
    bank_account_no: '123-4-56789-0',
    bank_name: 'ธนาคารทดสอบ',
    period_start: '2026-07-01',
    period_end: '2026-07-31',
    bank_file_name: 'statement-july.xlsx',
    gl_file_name: 'gl-july.xlsx',
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
    date_tolerance_days: 3,
    amount_tolerance: 0,
    status: 'in_progress',
    created_by: 'user-1',
    created_by_email: 'creator@example.com',
    created_at: '2026-07-16T08:00:00.000Z',
    updated_by: 'user-1',
    updated_by_email: 'creator@example.com',
    updated_at: '2026-07-16T09:00:00.000Z',
    completed_by: null,
    completed_by_email: null,
    completed_at: null,
    completion_note: null,
    reopened_by: null,
    reopened_by_email: null,
    reopened_at: null,
    reopen_reason: null,
    deleted_at: null,
    ...overrides,
  };
}

function makeAuditEntry(overrides: Partial<ReconcileAuditLogEntry> = {}): ReconcileAuditLogEntry {
  return {
    id: 'audit-1',
    session_id: 'session-1',
    action_type: 'session_created',
    entity_type: null,
    entity_id: null,
    old_value: null,
    new_value: { session_name: 'กระทบยอดบัญชีกระแสรายวัน กรกฎาคม 2569' },
    action_note: null,
    performed_by: 'user-1',
    performed_by_email: 'creator@example.com',
    performed_at: '2026-07-16T08:00:00.000Z',
    ...overrides,
  };
}

describe('buildReconcileSessionExcelBlob', () => {
  it('สร้างไฟล์ Excel ที่อ่านกลับมาได้ ครบทั้ง 9 ชีทตามชื่อที่สเปกกำหนด', async () => {
    const session = makeSession();
    const rows = [makeRow()];
    const glRows = [makeGLRow()];
    const groups = [makeGroup()];
    const auditLog = [makeAuditEntry()];

    const blob = buildReconcileSessionExcelBlob(session, rows, glRows, groups, auditLog);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    const arrayBuffer = await blob.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    expect(workbook.SheetNames).toEqual([
      'Summary',
      'Bank Statement',
      'GL Express',
      'Matched',
      'Manual Match',
      'Unmatched Bank',
      'Unmatched GL',
      'Review Required',
      'Audit Log',
    ]);
  });

  it('ชีท Summary มีชื่อรอบกระทบยอด/ธนาคาร/เลขบัญชี และค่า KPI ที่คำนวณใหม่ (ไม่ใช่ค่า cache)', async () => {
    const session = makeSession({ session_name: 'ทดสอบสรุปยอด', bank_name: 'ธนาคาร ก', bank_account_no: '999-9-99999-9' });
    const rows = [makeRow({ bank: makeBankRow({ bank_amount: 1000 }), status: 'matched_exact' })];
    const blob = buildReconcileSessionExcelBlob(session, rows, [makeGLRow()], [makeGroup()], []);
    const workbook = XLSX.read(await blob.arrayBuffer(), { type: 'array' });
    const sheet = workbook.Sheets['Summary'];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
    const flat = aoa.map((r) => r.join('|')).join('\n');
    expect(flat).toContain('ทดสอบสรุปยอด');
    expect(flat).toContain('ธนาคาร ก');
    expect(flat).toContain('999-9-99999-9');
    expect(flat).toContain('กระทบยอดแล้ว');
  });

  it('ชีท Bank Statement มีแถวรวมยอด (totals row) และรายการทุกแถวที่ส่งเข้าไป', async () => {
    const rows = [
      makeRow({ bank: makeBankRow({ bank_row_id: 'bank-1', bank_description: 'รายการที่หนึ่ง', bank_amount: 500 }) }),
      makeRow({ bank: makeBankRow({ bank_row_id: 'bank-2', bank_description: 'รายการที่สอง', bank_amount: 300 }), status: 'not_found_in_gl', matchedGL: null, matchedGLRows: [] }),
    ];
    const blob = buildReconcileSessionExcelBlob(makeSession(), rows, [], [], []);
    const workbook = XLSX.read(await blob.arrayBuffer(), { type: 'array' });
    const sheet = workbook.Sheets['Bank Statement'];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
    const flat = aoa.map((r) => r.join('|')).join('\n');
    expect(flat).toContain('รายการที่หนึ่ง');
    expect(flat).toContain('รายการที่สอง');
    const lastRow = aoa[aoa.length - 1];
    expect(lastRow.join('|')).toContain('รวม');
  });

  it('ชีท Unmatched Bank / Unmatched GL กรองเฉพาะรายการที่ยังไม่กระทบยอดจริง', async () => {
    const rows = [
      makeRow({ bank: makeBankRow({ bank_row_id: 'bank-1', bank_description: 'จับคู่แล้ว' }), status: 'matched_exact' }),
      makeRow({ bank: makeBankRow({ bank_row_id: 'bank-2', bank_description: 'ยังไม่จับคู่' }), status: 'not_found_in_gl', matchedGL: null, matchedGLRows: [] }),
    ];
    const glRows = [makeGLRow({ gl_row_id: 'gl-1', gl_document_no: 'ใช้แล้ว' }), makeGLRow({ gl_row_id: 'gl-2', gl_document_no: 'ยังไม่ใช้' })];
    const groups = [makeGroup({ bank_transaction_ids: ['bank-1'], gl_transaction_ids: ['gl-1'] })];

    const blob = buildReconcileSessionExcelBlob(makeSession(), rows, glRows, groups, []);
    const workbook = XLSX.read(await blob.arrayBuffer(), { type: 'array' });

    const unmatchedBankFlat = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['Unmatched Bank'], { header: 1 }).map((r) => r.join('|')).join('\n');
    expect(unmatchedBankFlat).toContain('ยังไม่จับคู่');
    expect(unmatchedBankFlat).not.toContain('จับคู่แล้ว');

    const unmatchedGlFlat = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['Unmatched GL'], { header: 1 }).map((r) => r.join('|')).join('\n');
    expect(unmatchedGlFlat).toContain('ยังไม่ใช้');
    expect(unmatchedGlFlat).not.toContain('ใช้แล้ว');
  });

  it('ชีท Review Required แสดงเฉพาะแถวที่มีการทำเครื่องหมายตรวจสอบ', async () => {
    const rows = [
      makeRow({ bank: makeBankRow({ bank_row_id: 'bank-1', bank_description: 'ปกติ' }) }),
      makeRow({
        bank: makeBankRow({ bank_row_id: 'bank-2', bank_description: 'ต้องตรวจสอบ' }),
        status: 'pending_review',
        reviewFlag: { review_required: true, reviewed_by: 'checker@example.com', reviewed_at: '2026-07-16T00:00:00.000Z' },
      }),
    ];
    const blob = buildReconcileSessionExcelBlob(makeSession(), rows, [], [], []);
    const workbook = XLSX.read(await blob.arrayBuffer(), { type: 'array' });
    const flat = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['Review Required'], { header: 1 }).map((r) => r.join('|')).join('\n');
    expect(flat).toContain('ต้องตรวจสอบ');
    expect(flat).toContain('checker@example.com');
    expect(flat).not.toContain('bank-1|');
  });

  it('ชีท Manual Match แสดงรายละเอียดกลุ่มจับคู่ครบ (ผู้ยืนยัน/หมายเหตุ/ประเภทการจับคู่)', async () => {
    const groups = [makeGroup({ matched_by: 'confirmer@example.com', note: 'ผลต่างค่าธรรมเนียม' })];
    const blob = buildReconcileSessionExcelBlob(makeSession(), [makeRow()], [makeGLRow()], groups, []);
    const workbook = XLSX.read(await blob.arrayBuffer(), { type: 'array' });
    const flat = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['Manual Match'], { header: 1 }).map((r) => r.join('|')).join('\n');
    expect(flat).toContain('confirmer@example.com');
    expect(flat).toContain('ผลต่างค่าธรรมเนียม');
  });

  it('ชีท Audit Log แสดงประวัติทุกรายการที่ส่งเข้าไป', async () => {
    const auditLog = [makeAuditEntry({ action_type: 'session_completed', action_note: 'ปิดรอบเรียบร้อย', performed_by_email: 'closer@example.com' })];
    const blob = buildReconcileSessionExcelBlob(makeSession(), [], [], [], auditLog);
    const workbook = XLSX.read(await blob.arrayBuffer(), { type: 'array' });
    const flat = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['Audit Log'], { header: 1 }).map((r) => r.join('|')).join('\n');
    expect(flat).toContain('ปิดรอบเรียบร้อย');
    expect(flat).toContain('closer@example.com');
  });

  it('ทุกชีทที่เป็นตารางมี autofilter ตั้งไว้ที่แถวหัวคอลัมน์', async () => {
    const blob = buildReconcileSessionExcelBlob(makeSession(), [makeRow()], [makeGLRow()], [makeGroup()], [makeAuditEntry()]);
    const workbook = XLSX.read(await blob.arrayBuffer(), { type: 'array' });
    for (const name of ['Bank Statement', 'GL Express', 'Matched', 'Manual Match', 'Unmatched Bank', 'Unmatched GL', 'Review Required', 'Audit Log']) {
      expect(workbook.Sheets[name]['!autofilter']).toBeTruthy();
    }
  });

  it('ข้อมูลว่างเปล่าทั้งหมดยังสร้างไฟล์ได้โดยไม่ error', () => {
    const blob = buildReconcileSessionExcelBlob(makeSession({ bank_row_count: 0, gl_row_count: 0 }), [], [], [], []);
    expect(blob.size).toBeGreaterThan(0);
  });
});

describe('buildReconcileSessionPdfBlob', () => {
  it('สร้างไฟล์ PDF โหมดสรุปได้โดยไม่ error และคืนค่าเป็น Blob ที่มีขนาดมากกว่า 0', () => {
    const blob = buildReconcileSessionPdfBlob(makeSession(), [makeRow()], [makeGLRow()], [makeGroup()], 'summary', 'preparer@example.com', '2026-07-16');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('สร้างไฟล์ PDF โหมดฉบับเต็มได้โดยไม่ error', () => {
    const blob = buildReconcileSessionPdfBlob(makeSession(), [makeRow()], [makeGLRow()], [makeGroup()], 'full', 'preparer@example.com', '2026-07-16');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('ข้อมูลว่างเปล่าทั้งหมดยังสร้างไฟล์ PDF ได้โดยไม่ error', () => {
    const blob = buildReconcileSessionPdfBlob(makeSession({ bank_row_count: 0, gl_row_count: 0 }), [], [], [], 'summary', 'preparer@example.com', '2026-07-16');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('รายการจำนวนมาก (ทดสอบการตัดจำนวนแถวโหมดสรุป + page-break) ยังสร้างได้โดยไม่ error ทั้งสองโหมด', () => {
    const manyRows: ReconcileRow[] = [];
    for (let i = 0; i < 80; i++) {
      manyRows.push(
        makeRow({
          bank: makeBankRow({ bank_row_id: `bank-${i}`, bank_description: `รายการที่ ${i}` }),
          status: 'not_found_in_gl',
          matchedGL: null,
          matchedGLRows: [],
        })
      );
    }
    const summaryBlob = buildReconcileSessionPdfBlob(makeSession(), manyRows, [], [], 'summary', 'preparer@example.com', '2026-07-16');
    expect(summaryBlob.size).toBeGreaterThan(0);
    const fullBlob = buildReconcileSessionPdfBlob(makeSession(), manyRows, [], [], 'full', 'preparer@example.com', '2026-07-16');
    expect(fullBlob.size).toBeGreaterThan(0);
  });

  it('session สถานะ completed แสดงข้อมูลผู้ปิดรอบได้โดยไม่ error', () => {
    const session = makeSession({
      status: 'completed',
      completed_by_email: 'closer@example.com',
      completed_at: '2026-07-16T12:00:00.000Z',
      completion_note: 'ปิดรอบเรียบร้อย ไม่มีผลต่าง',
    });
    const blob = buildReconcileSessionPdfBlob(session, [makeRow()], [makeGLRow()], [makeGroup()], 'summary', 'preparer@example.com', '2026-07-16');
    expect(blob.size).toBeGreaterThan(0);
  });
});
