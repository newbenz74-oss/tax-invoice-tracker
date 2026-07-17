import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { buildReconcileSessionExcelBlob } from './bankReconcileSessionExport';
import type {
  BankReconcileResultRow,
  BankReviewFlags,
  BankRow,
  GLOnlyRow,
  GLReviewFlags,
  GLRow,
  ReconcileMatchOutput,
} from '@/types/bankReconcile';
import type { ReconcileSession } from '@/types/bankReconcileSession';

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
    accountCode: '',
    rawRow: ['15/07/2026', 'JV-001', 'รับชำระจากลูกค้า A', '1000', ''],
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

function makeSession(overrides: Partial<ReconcileSession> = {}): ReconcileSession {
  return {
    id: 'session-1',
    session_name: 'กระทบยอดบัญชีกระแสรายวัน กรกฎาคม 2569',
    bank_file_name: 'statement-july.xlsx',
    gl_file_name: 'gl-july.xlsx',
    bank_source_file_type: 'excel',
    gl_source_file_type: 'excel',
    bank_row_count: 1,
    gl_row_count: 1,
    found_count: 1,
    bank_not_found_count: 0,
    gl_not_found_count: 0,
    bank_income_total: 1000,
    bank_payment_total: 0,
    gl_income_total: 1000,
    gl_payment_total: 0,
    income_difference: 0,
    payment_difference: 0,
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
    deleted_at: null,
    ...overrides,
  };
}

async function readWorkbook(blob: Blob) {
  const arrayBuffer = await blob.arrayBuffer();
  return XLSX.read(arrayBuffer, { type: 'array' });
}

function sheetToFlatText(workbook: XLSX.WorkBook, sheetName: string): string {
  const sheet = workbook.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
  return aoa.map((r) => r.join('|')).join('\n');
}

describe('buildReconcileSessionExcelBlob', () => {
  it('สร้างไฟล์ Excel ที่อ่านกลับมาได้ ครบทั้ง 6 ชีทตามชื่อที่สเปกกำหนดเป๊ะ (ไม่มี PDF export อีกต่อไป)', async () => {
    const session = makeSession();
    const bank = buildBankRow();
    const gl = buildGLRow();
    const matchOutput: ReconcileMatchOutput = { bankResults: [foundRow(bank, gl)], glOnlyResults: [] };

    const blob = buildReconcileSessionExcelBlob(session, matchOutput, {}, {});
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    const workbook = await readWorkbook(blob);
    expect(workbook.SheetNames).toEqual([
      'Summary',
      'Found in GL',
      'Bank Not Found in GL',
      'GL Not Found in Bank',
      'Bank Raw Data',
      'GL Raw Data',
    ]);
  });

  it('ชีท Summary มีชื่อรอบกระทบยอด/ชื่อไฟล์ และค่า KPI ที่คำนวณสดใหม่จาก matchOutput เสมอ (ไม่ใช่ค่า cache)', async () => {
    const session = makeSession({ session_name: 'ทดสอบสรุปยอด', bank_file_name: 'my-statement.pdf' });
    const bank = buildBankRow({ amount: 1000, direction: 'income' });
    const gl = buildGLRow({ amount: 1000, direction: 'income' });
    const matchOutput: ReconcileMatchOutput = { bankResults: [foundRow(bank, gl)], glOnlyResults: [] };

    const blob = buildReconcileSessionExcelBlob(session, matchOutput, {}, {});
    const workbook = await readWorkbook(blob);
    const flat = sheetToFlatText(workbook, 'Summary');
    expect(flat).toContain('ทดสอบสรุปยอด');
    expect(flat).toContain('my-statement.pdf');
    expect(flat).toContain('กำลังดำเนินการ'); // ป้ายสถานะ in_progress
  });

  it('ชีท Found in GL แสดงเฉพาะแถวที่จับคู่ได้แล้ว พร้อมยอด Bank/GL และผลต่าง (=0 เสมอ)', async () => {
    const bankFound = buildBankRow({ id: 'bank-1', description: 'จับคู่แล้ว', amount: 1000 });
    const glFound = buildGLRow({ id: 'gl-1', description: 'GL จับคู่แล้ว', amount: 1000 });
    const bankNotFound = buildBankRow({ id: 'bank-2', description: 'ยังไม่จับคู่', amount: 500 });
    const matchOutput: ReconcileMatchOutput = {
      bankResults: [foundRow(bankFound, glFound), notFoundRow(bankNotFound)],
      glOnlyResults: [],
    };

    const blob = buildReconcileSessionExcelBlob(makeSession(), matchOutput, {}, {});
    const workbook = await readWorkbook(blob);
    const flat = sheetToFlatText(workbook, 'Found in GL');
    expect(flat).toContain('จับคู่แล้ว');
    expect(flat).toContain('GL จับคู่แล้ว');
    expect(flat).not.toContain('ยังไม่จับคู่');
  });

  it('ชีท Bank Not Found in GL แสดงเฉพาะแถวที่ไม่พบ พร้อมแถวรวมยอด (totals row) และคอลัมน์ธงตรวจสอบ', async () => {
    const bankFound = buildBankRow({ id: 'bank-1', description: 'จับคู่แล้ว' });
    const glFound = buildGLRow({ id: 'gl-1' });
    const bankNotFound = buildBankRow({ id: 'bank-2', description: 'รอบันทึก GL', amount: 300 });
    const matchOutput: ReconcileMatchOutput = {
      bankResults: [foundRow(bankFound, glFound), notFoundRow(bankNotFound)],
      glOnlyResults: [],
    };
    const bankFlags: Record<string, BankReviewFlags> = {
      'bank-2': { needsGlEntry: true, reviewed: true, reviewNote: 'รอ IT confirm' },
    };

    const blob = buildReconcileSessionExcelBlob(makeSession(), matchOutput, bankFlags, {});
    const workbook = await readWorkbook(blob);
    const flat = sheetToFlatText(workbook, 'Bank Not Found in GL');
    expect(flat).toContain('รอบันทึก GL');
    expect(flat).not.toContain('จับคู่แล้ว');
    expect(flat).toContain('รอ IT confirm');
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['Bank Not Found in GL'], { header: 1 });
    const lastRow = aoa[aoa.length - 1];
    expect(lastRow.join('|')).toContain('รวม');
  });

  it('ชีท GL Not Found in Bank แสดงเฉพาะ glOnlyResults พร้อมธงตรวจสอบฝั่ง GL และแถวรวมยอด', async () => {
    const glOnlyRow = buildGLRow({ id: 'gl-orphan', description: 'มีใน GL แต่ไม่มีใน Bank', amount: 700, direction: 'payment' });
    const matchOutput: ReconcileMatchOutput = { bankResults: [], glOnlyResults: [glOnly(glOnlyRow)] };
    const glFlags: Record<string, GLReviewFlags> = {
      'gl-orphan': { needsGlReview: true, reviewed: false, reviewNote: 'รอตรวจสอบเอกสารต้นทาง' },
    };

    const blob = buildReconcileSessionExcelBlob(makeSession(), matchOutput, {}, glFlags);
    const workbook = await readWorkbook(blob);
    const flat = sheetToFlatText(workbook, 'GL Not Found in Bank');
    expect(flat).toContain('มีใน GL แต่ไม่มีใน Bank');
    expect(flat).toContain('รอตรวจสอบเอกสารต้นทาง');
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['GL Not Found in Bank'], { header: 1 });
    const lastRow = aoa[aoa.length - 1];
    expect(lastRow.join('|')).toContain('รวม');
  });

  it('ชีท Bank Raw Data / GL Raw Data ใช้หัวคอลัมน์ทั่วไป "คอลัมน์ N" และคงค่าดิบต้นฉบับไว้ครบ', async () => {
    const bank = buildBankRow({ rawRow: ['15/07/2026', 'ค่าทดสอบดิบ', '1000', '', '5000'] });
    const gl = buildGLRow({ rawRow: ['15/07/2026', 'JV-999', 'ค่าทดสอบ GL ดิบ', '1000', ''] });
    const matchOutput: ReconcileMatchOutput = { bankResults: [foundRow(bank, gl)], glOnlyResults: [] };

    const blob = buildReconcileSessionExcelBlob(makeSession(), matchOutput, {}, {});
    const workbook = await readWorkbook(blob);

    const bankFlat = sheetToFlatText(workbook, 'Bank Raw Data');
    expect(bankFlat).toContain('คอลัมน์ 1');
    expect(bankFlat).toContain('ค่าทดสอบดิบ');

    const glFlat = sheetToFlatText(workbook, 'GL Raw Data');
    expect(glFlat).toContain('คอลัมน์ 1');
    expect(glFlat).toContain('ค่าทดสอบ GL ดิบ');
  });

  it('ทุกชีทที่เป็นตารางมี autofilter ตั้งไว้ที่แถวหัวคอลัมน์', async () => {
    const bank = buildBankRow();
    const gl = buildGLRow();
    const matchOutput: ReconcileMatchOutput = { bankResults: [foundRow(bank, gl)], glOnlyResults: [] };
    const blob = buildReconcileSessionExcelBlob(makeSession(), matchOutput, {}, {});
    const workbook = await readWorkbook(blob);
    for (const name of ['Found in GL', 'Bank Not Found in GL', 'GL Not Found in Bank', 'Bank Raw Data', 'GL Raw Data']) {
      expect(workbook.Sheets[name]['!autofilter']).toBeTruthy();
    }
  });

  it('ข้อมูลว่างเปล่าทั้งหมดยังสร้างไฟล์ได้โดยไม่ error', () => {
    const matchOutput: ReconcileMatchOutput = { bankResults: [], glOnlyResults: [] };
    const blob = buildReconcileSessionExcelBlob(makeSession({ bank_row_count: 0, gl_row_count: 0 }), matchOutput, {}, {});
    expect(blob.size).toBeGreaterThan(0);
  });

  it('สถานะ completed แสดงป้ายภาษาไทยถูกต้องในชีท Summary', async () => {
    const session = makeSession({ status: 'completed', completed_by_email: 'closer@example.com' });
    const matchOutput: ReconcileMatchOutput = { bankResults: [], glOnlyResults: [] };
    const blob = buildReconcileSessionExcelBlob(session, matchOutput, {}, {});
    const workbook = await readWorkbook(blob);
    const flat = sheetToFlatText(workbook, 'Summary');
    expect(flat).toContain('เสร็จสมบูรณ์');
  });
});
