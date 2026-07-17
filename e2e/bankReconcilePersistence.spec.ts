import { readFileSync } from 'fs';
import { test, expect, type Page } from '@playwright/test';
import * as XLSX from 'xlsx';
import {
  attachConsoleErrorCollector,
  attachDialogGuard,
  gotoBankReconcile,
  gotoBankReconcileList,
  setupMockSupabase,
} from './helpers';
import type {
  MockSeed,
  MockSeedReconcileAuditLog,
  MockSeedReconcileBankTransaction,
  MockSeedReconcileGLTransaction,
  MockSeedReconcileMatchGroup,
  MockSeedReconcileSession,
} from './mockSupabase';

/**
 * E2E ของฟีเจอร์ "Bank Reconcile" เฟส 4 (บันทึกรอบกระทบยอด + ประวัติ + Export) — เพิ่มเข้ามา 2026-07-16
 *
 * ต่างจากเฟส 1-3 (bankReconcile.spec.ts / bankReconcileMatch.spec.ts / bankReconcileManualMatch.spec.ts) ที่
 * ทดสอบผ่านการ "อัปโหลดไฟล์สดๆ" เกือบทั้งหมด ไฟล์นี้ทดสอบผ่านการ "seed ข้อมูลลง mock Supabase ตรงๆ" เป็นหลัก
 * (ผ่าน reconcileSessions/reconcileBankTransactions/reconcileGLTransactions/reconcileMatchGroups/
 * reconcileAuditLogs ของ MockSeed) เพราะเฟสนี้ทดสอบพฤติกรรม "บันทึก/โหลด/ปิดรอบ/เปิดรอบใหม่" ไม่ใช่ตัวเครื่องมือ
 * จับคู่รายการเอง (ซึ่งถูกทดสอบครบแล้วในเฟส 2/3) การ seed ตรงๆ ทำให้ควบคุมค่าที่ต้องการทดสอบได้แน่นอน 100%
 * (เช่น session สถานะ completed พร้อมรายการไม่จับคู่จำนวนที่กำหนดเอง) โดยไม่ต้องพึ่งผลลัพธ์ของเอนจินจับคู่
 *
 * หลักการออกแบบข้อมูลทดสอบที่สำคัญ (อ่านก่อนแก้ไขไฟล์นี้):
 * 1. id ของแถว Bank/GL ที่ seed ทุกตัวต้องเป็นรูปแบบ UUID ที่ถูกต้องเสมอ (ผ่าน isUuid() ของ
 *    lib/bankReconcileSessionMapping.ts) — สร้างผ่าน makeId() ด้านล่าง ไม่ใช้ id แบบ "id-xxxx" ที่ mock
 *    สร้างให้อัตโนมัติ (ไม่ใช่ UUID) เพราะถ้า id ไม่ใช่ UUID การกดบันทึกซ้ำจะถูกมองว่าเป็น "แถวใหม่" เสมอ
 *    (ensureStableId สร้าง uuid ใหม่ให้ทุกครั้ง) ทำให้ id ไม่เสถียรข้ามการบันทึก
 * 2. เครื่องมือจับคู่อัตโนมัติของเฟส 2 จับคู่จาก "ยอดเงินตรงกันเป๊ะ" เป็นหลักเสมอ (ไม่มีการรวมหลาย GL อัตโนมัติ)
 *    ข้อมูลทดสอบของไฟล์นี้จึงตั้งใจให้ยอดเงินของแถวที่ต้องการให้ "ไม่จับคู่กัน" ไม่ตรงกันเป๊ะเสมอ กันการจับคู่
 *    อัตโนมัติแทรกซ้อนเข้ามาโดยไม่ตั้งใจ
 * 3. แถวที่อยู่ใน matchGroup (ยืนยันด้วยตนเองแล้ว) มีสถานะ "แช่แข็ง" จาก MatchGroup.status ตรงๆ ไม่ถูกคำนวณ
 *    ใหม่จากเอนจินอัตโนมัติเลย — ใช้ยืนยันพฤติกรรม "เปิดรอบเดิมไม่รันจับคู่อัตโนมัติซ้ำ" (สเปกส่วน "8. OPEN
 *    EXISTING SESSION")
 */

/* ============================== ตัวช่วยสร้างข้อมูลทดสอบ (seed factories) ============================== */

let idCounter = 0;
/** สร้าง id รูปแบบ UUID ที่ถูกต้องเสมอ (ผ่าน isUuid()) แบบไล่เลขขึ้นเรื่อยๆ เพื่อให้ debug ง่าย (ไม่ใช้
 * crypto.randomUUID()/Math.random() เพราะไม่จำเป็นต้องสุ่มจริง แค่ต้องไม่ซ้ำกันภายในไฟล์ทดสอบนี้เท่านั้น) */
function makeId(): string {
  idCounter += 1;
  return `${idCounter.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const TEST_USER = 'tester@benz.co.th';

function makeSession(
  overrides: Partial<MockSeedReconcileSession> & { session_name: string }
): MockSeedReconcileSession & { id: string } {
  const id = overrides.id ?? makeId();
  return {
    bank_file_name: 'bank-statement.xlsx',
    gl_file_name: 'gl-express.xlsx',
    created_by_email: TEST_USER,
    updated_by_email: TEST_USER,
    date_tolerance_days: 3,
    amount_tolerance: 0,
    ...overrides,
    id,
  };
}

function makeBankTxn(
  sessionId: string,
  rowNum: number,
  overrides: Partial<MockSeedReconcileBankTransaction> = {}
): MockSeedReconcileBankTransaction & { id: string } {
  const id = overrides.id ?? makeId();
  const bank_transaction_date = overrides.bank_transaction_date ?? '2026-07-01';
  const bank_description = overrides.bank_description ?? `รายการ Bank ${rowNum}`;
  const bank_money_in = overrides.bank_money_in ?? 0;
  const bank_money_out = overrides.bank_money_out ?? 0;
  const bank_amount = overrides.bank_amount ?? round2(bank_money_in - bank_money_out);
  const bank_balance = overrides.bank_balance ?? 0;
  return {
    reconcile_status: 'not_found_in_gl',
    review_required: false,
    ...overrides,
    id,
    session_id: sessionId,
    source_row_number: rowNum,
    bank_transaction_date,
    bank_description,
    bank_money_in,
    bank_money_out,
    bank_amount,
    bank_balance,
    raw_data: overrides.raw_data ?? [bank_transaction_date, bank_description, bank_money_in, bank_money_out, bank_balance],
    normalized_data: overrides.normalized_data ?? {
      bank_date: bank_transaction_date,
      bank_description,
      bank_money_in,
      bank_money_out,
      bank_amount,
      bank_balance,
    },
  };
}

function makeGlTxn(
  sessionId: string,
  rowNum: number,
  overrides: Partial<MockSeedReconcileGLTransaction> = {}
): MockSeedReconcileGLTransaction & { id: string } {
  const id = overrides.id ?? makeId();
  const gl_date = overrides.gl_date ?? '2026-07-01';
  const gl_document_no = overrides.gl_document_no ?? `JV-${rowNum}`;
  const gl_description = overrides.gl_description ?? `รายการ GL ${rowNum}`;
  const gl_debit = overrides.gl_debit ?? 0;
  const gl_credit = overrides.gl_credit ?? 0;
  const gl_amount = overrides.gl_amount ?? round2(gl_debit - gl_credit);
  return {
    is_used: false,
    ...overrides,
    id,
    session_id: sessionId,
    source_row_number: rowNum,
    gl_date,
    gl_document_no,
    gl_description,
    gl_debit,
    gl_credit,
    gl_amount,
    raw_data: overrides.raw_data ?? [gl_date, gl_document_no, gl_description, gl_debit, gl_credit],
    normalized_data: overrides.normalized_data ?? { gl_date, gl_document_no, gl_description, gl_debit, gl_credit, gl_amount },
  };
}

function makeMatchGroup(
  sessionId: string,
  bankIds: string[],
  glIds: string[],
  overrides: Partial<MockSeedReconcileMatchGroup> = {}
): MockSeedReconcileMatchGroup & { id: string } {
  const id = overrides.id ?? `mg-${makeId()}`;
  return {
    match_type: bankIds.length > 1 ? 'many_to_one' : glIds.length > 1 ? 'one_to_many' : 'one_to_one',
    status: 'confirmed_manual',
    manual_match: true,
    amount_difference: 0,
    matched_by: TEST_USER,
    matched_at: '2026-07-05T04:00:00.000Z',
    note: '',
    ...overrides,
    id,
    session_id: sessionId,
    bank_transaction_ids: bankIds,
    gl_transaction_ids: glIds,
  };
}

function makeAuditEntry(
  sessionId: string,
  actionType: string,
  overrides: Partial<MockSeedReconcileAuditLog> = {}
): MockSeedReconcileAuditLog {
  return {
    performed_by_email: TEST_USER,
    ...overrides,
    session_id: sessionId,
    action_type: actionType,
  };
}

/** ห่อ seed ให้ login อัตโนมัติเป็น TEST_USER เสมอ (ทุกเทสต์ของไฟล์นี้ต้อง login ก่อนเข้าเมนู Bank Reconcile
 * ได้เหมือนกันหมด — ลดการพิมพ์ loggedInAs/users ซ้ำในทุกเทสต์) */
function seed(partial: Partial<MockSeed>): MockSeed {
  return {
    loggedInAs: TEST_USER,
    users: [{ email: TEST_USER, password: 'x' }],
    ...partial,
  };
}

/* ============================== ตัวช่วยอื่นๆ ============================== */

function expectNoErrors(errors: string[], dialogs: string[]) {
  expect(errors, `ไม่ควรมี console error: ${errors.join(' | ')}`).toEqual([]);
  expect(dialogs, `ไม่ควรมี native dialog: ${dialogs.join(' | ')}`).toEqual([]);
}

/** เปิดรอบกระทบยอดที่ seed ไว้แล้วจากหน้ารายการ — ใช้แทนการอัปโหลดไฟล์สดๆ สำหรับเทสต์ส่วนใหญ่ของไฟล์นี้ */
async function openSession(page: Page, sessionId: string) {
  await gotoBankReconcileList(page);
  await page.getByTestId(`session-open-${sessionId}`).click();
  await expect(page.getByTestId('reconcile-results')).toBeVisible();
}

/** จำลอง error จาก Supabase RPC/table ครั้งถัดไป — เรียกตอนหน้าโหลดเสร็จแล้ว (ผ่าน page.evaluate เพราะ
 * window.__mockSupabaseForceError__ ถูกฉีดไว้แล้วในหน้าที่โหลดอยู่) ต่างจาก forceSupabaseErrorOnLoad ด้านล่าง
 * ที่ใช้ตอนต้องการให้ error เกิดขึ้นตั้งแต่การโหลดหน้าครั้งแรก (ก่อน navigate) */
async function forceSupabaseError(page: Page, target: string, message: string) {
  await page.evaluate(
    ({ target, message }) => {
      (window as unknown as { __mockSupabaseForceError__: (t: string, m: string) => void }).__mockSupabaseForceError__(
        target,
        message
      );
    },
    { target, message }
  );
}

async function forceSupabaseErrorOnLoad(page: Page, target: string, message: string) {
  await page.addInitScript(
    ({ target, message }) => {
      (window as unknown as { __mockSupabaseForceError__: (t: string, m: string) => void }).__mockSupabaseForceError__(
        target,
        message
      );
    },
    { target, message }
  );
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function buildXlsxBuffer(rows: unknown[][]): Buffer {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
}

async function mapAllColumns(page: Page) {
  await page.getByTestId('bank-mapping-transactionDate').selectOption('0');
  await page.getByTestId('bank-mapping-description').selectOption('1');
  await page.getByTestId('bank-mapping-moneyIn').selectOption('2');
  await page.getByTestId('bank-mapping-moneyOut').selectOption('3');
  await page.getByTestId('bank-mapping-balance').selectOption('4');
  await page.getByTestId('gl-mapping-date').selectOption('0');
  await page.getByTestId('gl-mapping-docNo').selectOption('1');
  await page.getByTestId('gl-mapping-description').selectOption('2');
  await page.getByTestId('gl-mapping-debit').selectOption('3');
  await page.getByTestId('gl-mapping-credit').selectOption('4');
}

// ชุดไฟล์ขั้นต่ำสุดสำหรับเทสต์ "บันทึกครั้งแรก" เท่านั้น (ยอดเงินตั้งใจให้ไม่ตรงกันเป๊ะ กันการจับคู่อัตโนมัติ
// แทรกซ้อน — ดูหลักการข้อ 2 ที่หัวไฟล์)
const FRESH_BANK_ROWS = [
  ['วันที่รายการ', 'รายละเอียด', 'เงินเข้า', 'เงินออก', 'ยอดคงเหลือ'],
  ['01/07/2026', 'รับโอนทดสอบบันทึกครั้งแรก', '5000', '', '5000'],
];
const FRESH_GL_ROWS = [
  ['วันที่', 'เลขที่เอกสาร', 'รายละเอียด', 'เดบิต', 'เครดิต'],
  ['01/07/2026', 'JV-900', 'รายการที่ไม่ตรงกับ Bank', '', '9999'],
];

async function uploadFreshFilesAndReachResults(page: Page) {
  await gotoBankReconcile(page); // เมนู Bank Reconcile -> กด "สร้างรอบกระทบยอดใหม่" -> ขั้นตอนอัปโหลด
  await page.getByTestId('bank-file-input').setInputFiles({
    name: 'bank-fresh.xlsx',
    mimeType: XLSX_MIME,
    buffer: buildXlsxBuffer(FRESH_BANK_ROWS),
  });
  await page.getByTestId('gl-file-input').setInputFiles({
    name: 'gl-fresh.xlsx',
    mimeType: XLSX_MIME,
    buffer: buildXlsxBuffer(FRESH_GL_ROWS),
  });
  await page.getByTestId('next-to-mapping').click();
  await mapAllColumns(page);
  await page.getByTestId('mapping-save').click();
  await expect(page.getByTestId('reconcile-results')).toBeVisible();
}

/* ============================== ชุดข้อมูลรอบกระทบยอด 5 สถานะ สำหรับเทสต์หน้ารายการ ==============================
 * s1 แบบร่าง / s2 กำลังดำเนินการ / s3 เสร็จสมบูรณ์ / s4 เปิดใหม่ / s5 ยกเลิก — ครบทุกสถานะ ธนาคาร/เลขบัญชี/
 * ผู้สร้าง/เดือนจงใจให้เหลื่อมกันบางคู่ (s1,s3 ธนาคารเดียวกัน; s4,s5 ธนาคารเดียวกัน; s2,s4 ผู้สร้างเดียวกัน)
 * เพื่อพิสูจน์ว่าตัวกรองหลายมิติทำงานร่วมกันแบบ AND จริง ไม่ใช่แค่กรองได้ทีละมิติเดี่ยวๆ */
function filterTabSessions(): MockSeedReconcileSession[] {
  return [
    makeSession({
      id: 's1',
      session_name: 'กระทบยอดบัญชีออมทรัพย์ มกราคม 2569',
      status: 'draft',
      bank_name: 'ธนาคารกสิกรไทย',
      bank_account_no: '111-1-11111-1',
      period_start: '2026-01-01',
      period_end: '2026-01-31',
      bank_file_name: 'bank-jan.xlsx',
      gl_file_name: 'gl-jan.xlsx',
      created_by_email: 'somchai@benz.co.th',
      created_at: '2026-01-05T03:00:00.000Z',
      updated_at: '2026-01-05T03:00:00.000Z',
      bank_row_count: 10,
      gl_row_count: 9,
      matched_count: 6,
      manual_match_count: 2,
      review_count: 1,
      unmatched_bank_count: 3,
      unmatched_gl_count: 2,
      net_difference: 150.5,
    }),
    makeSession({
      id: 's2',
      session_name: 'กระทบยอดบัญชีกระแสรายวัน กุมภาพันธ์ 2569',
      status: 'in_progress',
      bank_name: 'ธนาคารไทยพาณิชย์',
      bank_account_no: '222-2-22222-2',
      period_start: '2026-02-01',
      period_end: '2026-02-28',
      bank_file_name: 'bank-feb.xlsx',
      gl_file_name: 'gl-feb.xlsx',
      created_by_email: 'somsri@benz.co.th',
      created_at: '2026-02-05T03:00:00.000Z',
      updated_at: '2026-02-05T03:00:00.000Z',
    }),
    makeSession({
      id: 's3',
      session_name: 'กระทบยอดบัญชีออมทรัพย์ มีนาคม 2569 (เสร็จสมบูรณ์)',
      status: 'completed',
      bank_name: 'ธนาคารกสิกรไทย',
      bank_account_no: '111-1-11111-1',
      period_start: '2026-03-01',
      period_end: '2026-03-31',
      bank_file_name: 'bank-mar.xlsx',
      gl_file_name: 'gl-mar.xlsx',
      created_by_email: 'somchai@benz.co.th',
      created_at: '2026-03-05T03:00:00.000Z',
      updated_at: '2026-03-06T03:00:00.000Z',
      completed_by_email: 'somchai@benz.co.th',
      completed_at: '2026-03-06T03:00:00.000Z',
    }),
    makeSession({
      id: 's4',
      session_name: 'กระทบยอดบัญชีออมทรัพย์ เมษายน 2569 (เปิดใหม่)',
      status: 'reopened',
      bank_name: 'ธนาคารกรุงไทย',
      bank_account_no: '333-3-33333-3',
      period_start: '2026-04-01',
      period_end: '2026-04-30',
      bank_file_name: 'bank-apr.xlsx',
      gl_file_name: 'gl-apr.xlsx',
      created_by_email: 'somsri@benz.co.th',
      created_at: '2026-04-05T03:00:00.000Z',
      updated_at: '2026-04-06T03:00:00.000Z',
    }),
    makeSession({
      id: 's5',
      session_name: 'กระทบยอดที่ถูกยกเลิก พฤษภาคม 2569',
      status: 'cancelled',
      bank_name: 'ธนาคารกรุงไทย',
      bank_account_no: '333-3-33333-3',
      period_start: '2026-05-01',
      period_end: '2026-05-31',
      bank_file_name: 'bank-may.xlsx',
      gl_file_name: 'gl-may.xlsx',
      created_by_email: 'somchai@benz.co.th',
      created_at: '2026-05-05T03:00:00.000Z',
      updated_at: '2026-05-05T03:00:00.000Z',
    }),
  ];
}

test.describe('Bank Reconcile (เฟส 4: บันทึกถาวร ประวัติการแก้ไข และ Export)', () => {
  test.describe('หน้ารายการ "ประวัติการกระทบยอดธนาคาร" — การแสดงผล/กรอง/แบ่งหน้า', () => {
    test('1/10. แสดงรายการที่บันทึกไว้ครบทุกคอลัมน์หลัก พร้อม badge สถานะถูกต้องของทุกสถานะ', async ({ page }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      await setupMockSupabase(page, seed({ reconcileSessions: filterTabSessions() }));
      await gotoBankReconcileList(page);
      await expect(page.getByTestId('bank-reconcile-session-list')).toBeVisible();

      const row1 = page.getByTestId('session-row-s1');
      await expect(row1).toContainText('กระทบยอดบัญชีออมทรัพย์ มกราคม 2569');
      await expect(row1).toContainText('ธนาคารกสิกรไทย');
      await expect(row1).toContainText('111-1-11111-1');
      await expect(row1).toContainText('150.50');
      await expect(page.getByTestId('session-status-badge-s1')).toHaveText('แบบร่าง');
      await expect(page.getByTestId('session-status-badge-s2')).toHaveText('กำลังดำเนินการ');
      await expect(page.getByTestId('session-status-badge-s3')).toHaveText('เสร็จสมบูรณ์');
      await expect(page.getByTestId('session-status-badge-s4')).toHaveText('เปิดใหม่');
      await expect(page.getByTestId('session-status-badge-s5')).toHaveText('ยกเลิก');

      expectNoErrors(errors, dialogs);
    });

    test('2/10. แท็บสถานะกรองรายการและนับจำนวนถูกต้องทุกแท็บ', async ({ page }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      await setupMockSupabase(page, seed({ reconcileSessions: filterTabSessions() }));
      await gotoBankReconcileList(page);

      await expect(page.getByTestId('session-list-tab-all')).toContainText('ทั้งหมด (5)');
      await expect(page.getByTestId('session-list-tab-draft')).toContainText('แบบร่าง (1)');
      await expect(page.getByTestId('session-list-tab-in_progress')).toContainText('กำลังดำเนินการ (1)');
      await expect(page.getByTestId('session-list-tab-completed')).toContainText('เสร็จสมบูรณ์ (1)');
      await expect(page.getByTestId('session-list-tab-reopened')).toContainText('เปิดใหม่ (1)');

      await page.getByTestId('session-list-tab-completed').click();
      await expect(page.getByTestId('session-row-s3')).toBeVisible();
      await expect(page.getByTestId('session-row-s1')).toHaveCount(0);
      await expect(page.getByTestId('session-row-s2')).toHaveCount(0);

      await page.getByTestId('session-list-tab-all').click();
      await expect(page.getByTestId('session-row-s5')).toBeVisible(); // ยกเลิก เห็นเฉพาะแท็บ "ทั้งหมด" เท่านั้น

      expectNoErrors(errors, dialogs);
    });

    test('3/10. ค้นหาด้วยชื่อรอบ / ชื่อไฟล์ / เลขที่บัญชี กรองผลลัพธ์ถูกต้อง', async ({ page }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      await setupMockSupabase(page, seed({ reconcileSessions: filterTabSessions() }));
      await gotoBankReconcileList(page);

      const search = page.getByTestId('session-list-search-input');
      await search.fill('กุมภาพันธ์');
      await expect(page.getByTestId('session-row-s2')).toBeVisible();
      await expect(page.getByTestId('session-row-s1')).toHaveCount(0);

      await search.fill('111-1-11111-1');
      await expect(page.getByTestId('session-row-s1')).toBeVisible();
      await expect(page.getByTestId('session-row-s3')).toBeVisible();
      await expect(page.getByTestId('session-row-s2')).toHaveCount(0);

      await search.fill('gl-apr');
      await expect(page.getByTestId('session-row-s4')).toBeVisible();
      await expect(page.getByTestId('session-row-s1')).toHaveCount(0);

      expectNoErrors(errors, dialogs);
    });

    test('4/10. ตัวกรองหลายมิติทำงานร่วมกันแบบ AND (ปี+เดือน, ธนาคาร+สถานะ, ผู้สร้าง, ช่วงวันที่)', async ({ page }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      await setupMockSupabase(page, seed({ reconcileSessions: filterTabSessions() }));
      await gotoBankReconcileList(page);

      await page.getByTestId('session-list-filter-year').selectOption('2026');
      await page.getByTestId('session-list-filter-month').selectOption('1');
      await expect(page.getByTestId('session-row-s1')).toBeVisible();
      await expect(page.getByTestId('session-row-s2')).toHaveCount(0);
      await page.getByTestId('session-list-clear-filters').click();

      await page.getByTestId('session-list-filter-bank').selectOption('ธนาคารกสิกรไทย');
      await page.getByTestId('session-list-filter-status').selectOption('draft');
      await expect(page.getByTestId('session-row-s1')).toBeVisible();
      await expect(page.getByTestId('session-row-s3')).toHaveCount(0); // ธนาคารเดียวกันแต่สถานะไม่ตรง ต้องถูกกรองออก
      await page.getByTestId('session-list-clear-filters').click();

      await page.getByTestId('session-list-filter-creator').selectOption('somsri@benz.co.th');
      await expect(page.getByTestId('session-row-s2')).toBeVisible();
      await expect(page.getByTestId('session-row-s4')).toBeVisible();
      await expect(page.getByTestId('session-row-s1')).toHaveCount(0);
      await page.getByTestId('session-list-clear-filters').click();

      await page.getByTestId('session-list-filter-date-from').fill('2026-02-01');
      await page.getByTestId('session-list-filter-date-to').fill('2026-04-30');
      await expect(page.getByTestId('session-row-s2')).toBeVisible();
      await expect(page.getByTestId('session-row-s3')).toBeVisible();
      await expect(page.getByTestId('session-row-s4')).toBeVisible();
      await expect(page.getByTestId('session-row-s1')).toHaveCount(0);
      await expect(page.getByTestId('session-row-s5')).toHaveCount(0);

      expectNoErrors(errors, dialogs);
    });

    test('5/10. ตัวกรองสถานะละเอียดเลือก "ยกเลิก" ได้ (ไม่มีแท็บของสถานะนี้โดยตรง)', async ({ page }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      await setupMockSupabase(page, seed({ reconcileSessions: filterTabSessions() }));
      await gotoBankReconcileList(page);

      await page.getByTestId('session-list-filter-status').selectOption('cancelled');
      await expect(page.getByTestId('session-row-s5')).toBeVisible();
      await expect(page.getByTestId('session-row-s1')).toHaveCount(0);
      await expect(page.getByTestId('session-row-s2')).toHaveCount(0);
      await expect(page.getByTestId('session-row-s3')).toHaveCount(0);
      await expect(page.getByTestId('session-row-s4')).toHaveCount(0);

      expectNoErrors(errors, dialogs);
    });

    test('6/10. ล้างตัวกรองกลับเป็นค่าเริ่มต้นทั้งหมด', async ({ page }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      await setupMockSupabase(page, seed({ reconcileSessions: filterTabSessions() }));
      await gotoBankReconcileList(page);

      await page.getByTestId('session-list-search-input').fill('มกราคม');
      await page.getByTestId('session-list-tab-draft').click();
      await expect(page.getByTestId('session-row-s2')).toHaveCount(0);

      await page.getByTestId('session-list-clear-filters').click();
      await expect(page.getByTestId('session-list-search-input')).toHaveValue('');
      await expect(page.getByTestId('session-list-tab-all')).toHaveAttribute('aria-selected', 'true');
      for (const id of ['s1', 's2', 's3', 's4', 's5']) {
        await expect(page.getByTestId(`session-row-${id}`)).toBeVisible();
      }

      expectNoErrors(errors, dialogs);
    });

    test('7/10. Pagination แบ่งหน้าถูกต้องเมื่อมีรายการเกิน 10 รายการ', async ({ page }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      const sessions = Array.from({ length: 12 }, (_, i) => {
        const n = i + 1;
        return makeSession({
          id: `page-${n}`,
          session_name: `รอบทดสอบเพจจิ้ง ${String(n).padStart(2, '0')}`,
          status: 'draft',
          created_at: `2026-06-01T${String(n).padStart(2, '0')}:00:00.000Z`,
          updated_at: `2026-06-01T${String(n).padStart(2, '0')}:00:00.000Z`,
        });
      });
      await setupMockSupabase(page, seed({ reconcileSessions: sessions }));
      await gotoBankReconcileList(page);

      await expect(page.getByTestId('session-list-pagination-page-indicator')).toHaveText('หน้า 1 / 2');
      await expect(page.getByTestId('session-row-page-12')).toBeVisible();
      await expect(page.getByTestId('session-row-page-3')).toBeVisible();
      await expect(page.getByTestId('session-row-page-2')).toHaveCount(0);
      await expect(page.getByTestId('session-list-pagination-prev')).toBeDisabled();

      await page.getByTestId('session-list-pagination-next').click();
      await expect(page.getByTestId('session-list-pagination-page-indicator')).toHaveText('หน้า 2 / 2');
      await expect(page.getByTestId('session-row-page-2')).toBeVisible();
      await expect(page.getByTestId('session-row-page-1')).toBeVisible();
      await expect(page.getByTestId('session-list-pagination-next')).toBeDisabled();

      await page.getByTestId('session-list-pagination-prev').click();
      await expect(page.getByTestId('session-list-pagination-page-indicator')).toHaveText('หน้า 1 / 2');

      expectNoErrors(errors, dialogs);
    });

    test('8/10. หน้าว่างแสดงข้อความถูกต้องเมื่อไม่มีรอบกระทบยอดเลย', async ({ page }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      await setupMockSupabase(page, seed({}));
      await gotoBankReconcileList(page);
      await expect(page.getByTestId('session-list-empty')).toContainText('ยังไม่มีรอบกระทบยอดธนาคาร เริ่มสร้างรอบแรกได้เลย');
      expectNoErrors(errors, dialogs);
    });

    test('9/10. หน้าว่างแสดงข้อความถูกต้องเมื่อกรองแล้วไม่พบรายการที่ตรงกัน', async ({ page }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      await setupMockSupabase(page, seed({ reconcileSessions: filterTabSessions() }));
      await gotoBankReconcileList(page);
      await page.getByTestId('session-list-search-input').fill('ไม่มีทางพบข้อความนี้แน่นอน123456');
      await expect(page.getByTestId('session-list-empty')).toContainText('ไม่พบรอบกระทบยอดที่ตรงกับตัวกรองนี้');
      expectNoErrors(errors, dialogs);
    });

    test('10/10. โหลดรายการไม่สำเร็จแสดงข้อความ error ที่กำหนด', async ({ page }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      await setupMockSupabase(page, seed({ reconcileSessions: filterTabSessions() }));
      await forceSupabaseErrorOnLoad(page, 'table:bank_reconcile_sessions', 'จำลองข้อผิดพลาดจากเทสต์');
      await gotoBankReconcileList(page);
      await expect(page.getByText('โหลดประวัติการกระทบยอดธนาคารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')).toBeVisible();
      expectNoErrors(errors, dialogs);
    });
  });

  test.describe('หน้ารายการ — ปุ่มดำเนินการต่อแถว', () => {
    test('1/7. "เปิด" โหลดรอบเดิมและไม่รันจับคู่อัตโนมัติซ้ำ (รายการที่ยืนยันแล้วยังเป็น "ยืนยันด้วยตนเอง" ทันที)', async ({
      page,
    }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      const sessionId = 'ra-open';
      const bId1 = makeId();
      const gId1 = makeId();
      const bId2 = makeId();
      await setupMockSupabase(
        page,
        seed({
          reconcileSessions: [makeSession({ id: sessionId, session_name: 'รอบทดสอบเปิดรายการเดิม', status: 'in_progress' })],
          reconcileBankTransactions: [
            makeBankTxn(sessionId, 1, {
              id: bId1,
              bank_transaction_date: '2026-01-10',
              bank_description: 'รับโอนลูกค้า X',
              bank_money_in: 1000,
              bank_amount: 1000,
            }),
            makeBankTxn(sessionId, 2, {
              id: bId2,
              bank_transaction_date: '2026-01-12',
              bank_description: 'รายการไม่พบคู่',
              bank_money_in: 777,
              bank_amount: 777,
            }),
          ],
          reconcileGLTransactions: [
            makeGlTxn(sessionId, 1, { id: gId1, gl_date: '2026-01-10', gl_document_no: 'JV-100', gl_debit: 1000, gl_amount: 1000 }),
          ],
          reconcileMatchGroups: [
            makeMatchGroup(sessionId, [bId1], [gId1], {
              status: 'confirmed_manual',
              amount_difference: 0,
              bank_total: 1000,
              gl_total: 1000,
              note: 'ตรวจสอบแล้ว',
            }),
          ],
        })
      );

      await openSession(page, sessionId);
      await expect(page.getByTestId('session-header-name')).toHaveText('รอบทดสอบเปิดรายการเดิม');
      await expect(page.getByTestId(`reconcile-status-${bId1}`)).toHaveText('ยืนยันด้วยตนเอง');
      await expect(page.getByTestId(`reconcile-status-${bId2}`)).toHaveText('ไม่พบใน GL');

      expectNoErrors(errors, dialogs);
    });

    test('2/7. "เปลี่ยนชื่อ" อัปเดตชื่อรอบและแสดงในตารางทันที', async ({ page }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      const sessionId = 'ra-rename';
      await setupMockSupabase(
        page,
        seed({ reconcileSessions: [makeSession({ id: sessionId, session_name: 'ชื่อเดิมก่อนเปลี่ยน', status: 'draft' })] })
      );
      await gotoBankReconcileList(page);

      await page.getByTestId(`session-rename-${sessionId}`).click();
      await expect(page.getByTestId('rename-session-dialog')).toBeVisible();
      await expect(page.getByTestId('rename-session-input')).toHaveValue('ชื่อเดิมก่อนเปลี่ยน');
      await page.getByTestId('rename-session-input').fill('ชื่อใหม่หลังเปลี่ยน');
      await page.getByTestId('rename-session-confirm').click();
      await expect(page.getByTestId('rename-session-dialog')).toHaveCount(0);
      await expect(page.getByTestId(`session-row-${sessionId}`)).toContainText('ชื่อใหม่หลังเปลี่ยน');

      expectNoErrors(errors, dialogs);
    });

    test('3/7. "ทำสำเนา" สร้างรอบใหม่สถานะแบบร่างจากข้อมูลชุดเดียวกัน โดยต้นฉบับไม่ถูกแก้ไข', async ({ page }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      const sessionId = 'ra-duplicate';
      await setupMockSupabase(
        page,
        seed({
          reconcileSessions: [makeSession({ id: sessionId, session_name: 'รอบต้นฉบับสำหรับทำสำเนา', status: 'in_progress' })],
          reconcileBankTransactions: [makeBankTxn(sessionId, 1)],
        })
      );
      await gotoBankReconcileList(page);

      await page.getByTestId(`session-duplicate-${sessionId}`).click();
      await expect(page.getByTestId('duplicate-session-dialog')).toBeVisible();
      await expect(page.getByTestId('duplicate-session-input')).toHaveValue('รอบต้นฉบับสำหรับทำสำเนา (สำเนา)');
      await page.getByTestId('duplicate-session-confirm').click();
      await expect(page.getByTestId('duplicate-session-dialog')).toHaveCount(0);

      const newRow = page.locator('tbody tr', { hasText: 'รอบต้นฉบับสำหรับทำสำเนา (สำเนา)' });
      await expect(newRow).toBeVisible();
      await expect(newRow.getByText('แบบร่าง')).toBeVisible();
      await expect(page.getByTestId(`session-row-${sessionId}`)).toBeVisible(); // ต้นฉบับยังอยู่เหมือนเดิม

      expectNoErrors(errors, dialogs);
    });

    test('4/7. "ยกเลิก" เปลี่ยนสถานะเป็นยกเลิกและซ่อนปุ่มยกเลิกหลังจากนั้น', async ({ page }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      const sessionId = 'ra-cancel';
      await setupMockSupabase(
        page,
        seed({ reconcileSessions: [makeSession({ id: sessionId, session_name: 'รอบสำหรับทดสอบยกเลิก', status: 'in_progress' })] })
      );
      await gotoBankReconcileList(page);

      await page.getByTestId(`session-cancel-${sessionId}`).click();
      await expect(page.getByTestId('cancel-session-dialog')).toContainText('รอบสำหรับทดสอบยกเลิก');
      await page.getByTestId('cancel-session-confirm').click();
      await expect(page.getByTestId('cancel-session-dialog')).toHaveCount(0);
      await expect(page.getByTestId(`session-status-badge-${sessionId}`)).toHaveText('ยกเลิก');
      await expect(page.getByTestId(`session-cancel-${sessionId}`)).toHaveCount(0);

      expectNoErrors(errors, dialogs);
    });

    test('5/7. "ลบ" (soft delete) เอาแถวออกจากรายการทันที', async ({ page }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      const sessionId = 'ra-delete';
      await setupMockSupabase(
        page,
        seed({ reconcileSessions: [makeSession({ id: sessionId, session_name: 'รอบสำหรับทดสอบลบ', status: 'draft' })] })
      );
      await gotoBankReconcileList(page);

      await page.getByTestId(`session-delete-${sessionId}`).click();
      await expect(page.getByTestId('delete-session-dialog')).toContainText('รอบสำหรับทดสอบลบ');
      await page.getByTestId('delete-session-confirm').click();
      await expect(page.getByTestId('delete-session-dialog')).toHaveCount(0);
      await expect(page.getByTestId(`session-row-${sessionId}`)).toHaveCount(0);
      await expect(page.getByTestId('session-list-empty')).toBeVisible();

      expectNoErrors(errors, dialogs);
    });

    test('6/7. "Export Excel" จากแถวในหน้ารายการดาวน์โหลดไฟล์ที่มี 9 ชีทถูกต้อง', async ({ page }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      const sessionId = 'ra-export-excel';
      const bId = makeId();
      const gId = makeId();
      await setupMockSupabase(
        page,
        seed({
          reconcileSessions: [makeSession({ id: sessionId, session_name: 'รอบสำหรับทดสอบ Export Excel', status: 'in_progress' })],
          reconcileBankTransactions: [makeBankTxn(sessionId, 1, { id: bId, bank_money_in: 500, bank_amount: 500 })],
          reconcileGLTransactions: [makeGlTxn(sessionId, 1, { id: gId, gl_credit: 900, gl_amount: -900 })],
        })
      );
      await gotoBankReconcileList(page);

      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId(`session-export-excel-${sessionId}`).click(),
      ]);
      const path = await download.path();
      expect(path).not.toBeNull();
      const buffer = readFileSync(path!);
      expect(buffer.byteLength).toBeGreaterThan(0);
      const workbook = XLSX.read(buffer, { type: 'buffer' });
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
      const summaryAoa = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['Summary'], { header: 1 });
      expect(summaryAoa.some((r) => r.join('|').includes('รอบสำหรับทดสอบ Export Excel'))).toBe(true);

      expectNoErrors(errors, dialogs);
    });

    test('7/7. "Export PDF" จากแถวในหน้ารายการดาวน์โหลดไฟล์ PDF ที่ถูกต้อง', async ({ page }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      const sessionId = 'ra-export-pdf';
      await setupMockSupabase(
        page,
        seed({
          reconcileSessions: [makeSession({ id: sessionId, session_name: 'รอบสำหรับทดสอบ Export PDF', status: 'in_progress' })],
          reconcileBankTransactions: [makeBankTxn(sessionId, 1)],
        })
      );
      await gotoBankReconcileList(page);

      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId(`session-export-pdf-${sessionId}`).click(),
      ]);
      const path = await download.path();
      expect(path).not.toBeNull();
      const buffer = readFileSync(path!);
      expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');

      expectNoErrors(errors, dialogs);
    });
  });

  test.describe('บันทึกรอบกระทบยอด (Save workflow)', () => {
    test('1/3. บันทึกครั้งแรก: dialog บังคับกรอกชื่อ + สร้าง session ใหม่สถานะแบบร่าง + ปรากฏในหน้ารายการ', async ({
      page,
    }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      await setupMockSupabase(page, seed({}));
      await uploadFreshFilesAndReachResults(page);

      await expect(page.getByTestId('done-back-to-mapping')).toBeVisible(); // ยังไม่เคยบันทึก
      await page.getByTestId('session-save-button').click();
      await expect(page.getByTestId('save-session-dialog')).toBeVisible();
      await expect(page.getByTestId('save-session-confirm')).toBeDisabled(); // ชื่อว่าง กดบันทึกไม่ได้

      await page.getByTestId('save-session-name-input').fill('รอบกระทบยอดทดสอบบันทึกครั้งแรก');
      await expect(page.getByTestId('save-session-confirm')).toBeEnabled();
      await page.getByTestId('save-session-confirm').click();
      await expect(page.getByTestId('save-session-dialog')).toHaveCount(0);

      await expect(page.getByTestId('session-header-status-badge')).toHaveText('แบบร่าง');
      await expect(page.getByTestId('session-save-status')).toHaveText('บันทึกแล้ว');
      await expect(page.getByTestId('done-back-to-list')).toBeVisible();

      await page.getByTestId('done-back-to-list').click();
      await expect(page.getByTestId('bank-reconcile-session-list')).toBeVisible();
      const row = page.locator('tbody tr', { hasText: 'รอบกระทบยอดทดสอบบันทึกครั้งแรก' });
      await expect(row).toBeVisible();
      await expect(row.getByText('แบบร่าง')).toBeVisible();

      expectNoErrors(errors, dialogs);
    });

    test('2/3. บันทึกซ้ำ (มี session อยู่แล้ว) เปลี่ยนสถานะจากแบบร่างเป็นกำลังดำเนินการอัตโนมัติ', async ({ page }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      const sessionId = 's-resave';
      await setupMockSupabase(
        page,
        seed({
          reconcileSessions: [makeSession({ id: sessionId, session_name: 'รอบทดสอบบันทึกซ้ำ', status: 'draft' })],
          reconcileBankTransactions: [makeBankTxn(sessionId, 1, { bank_money_in: 500, bank_amount: 500 })],
          reconcileGLTransactions: [makeGlTxn(sessionId, 1, { gl_credit: 700, gl_amount: -700 })],
        })
      );
      await openSession(page, sessionId);

      await expect(page.getByTestId('session-header-status-badge')).toHaveText('แบบร่าง');
      await page.getByTestId('session-save-button').click();
      await expect(page.getByTestId('session-header-status-badge')).toHaveText('กำลังดำเนินการ');
      await expect(page.getByTestId('session-save-status')).toHaveText('บันทึกแล้ว');

      expectNoErrors(errors, dialogs);
    });

    test('3/3. บันทึกไม่สำเร็จแสดงข้อความ error ตามที่กำหนด', async ({ page }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      const sessionId = 's-savefail';
      await setupMockSupabase(
        page,
        seed({
          reconcileSessions: [makeSession({ id: sessionId, session_name: 'รอบทดสอบบันทึกล้มเหลว', status: 'in_progress' })],
          reconcileBankTransactions: [makeBankTxn(sessionId, 1)],
        })
      );
      await openSession(page, sessionId);
      await forceSupabaseError(page, 'rpc:save_bank_reconcile_session', 'จำลองบันทึกล้มเหลว');

      await page.getByTestId('session-save-button').click();
      await expect(page.getByTestId('session-save-status')).toHaveText('บันทึกไม่สำเร็จ');
      await expect(page.getByTestId('session-error-message')).toHaveText(
        'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง — การเชื่อมต่อฐานข้อมูลอาจขัดข้องชั่วคราว'
      );

      expectNoErrors(errors, dialogs);
    });
  });

  test.describe('บันทึกอัตโนมัติ (Auto-save)', () => {
    test('1/2. แก้ไขข้อมูลหลังบันทึกครั้งแรกแล้ว trigger auto-save ภายในเวลา debounce แสดง "บันทึกแล้ว"', async ({
      page,
    }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      const sessionId = 's-autosave';
      const bankId = makeId();
      await setupMockSupabase(
        page,
        seed({
          reconcileSessions: [makeSession({ id: sessionId, session_name: 'รอบทดสอบบันทึกอัตโนมัติ', status: 'in_progress' })],
          reconcileBankTransactions: [makeBankTxn(sessionId, 1, { id: bankId, bank_money_in: 300, bank_amount: 300 })],
        })
      );
      await openSession(page, sessionId);

      await page.getByTestId(`reconcile-mark-pending-${bankId}`).click();
      // ยังไม่ครบเวลา debounce (800-1500ms) — ต้องยังไม่มี saveStatus ปรากฏเลย พิสูจน์ว่ามีการหน่วงเวลาจริง
      await page.waitForTimeout(400);
      await expect(page.getByTestId('session-save-status')).toHaveCount(0);
      // เลยเวลา debounce แล้ว ต้องบันทึกสำเร็จเองโดยไม่ต้องกดปุ่มใดๆ
      await expect(page.getByTestId('session-save-status')).toHaveText('บันทึกแล้ว', { timeout: 5000 });

      expectNoErrors(errors, dialogs);
    });

    test('2/2. บันทึกอัตโนมัติล้มเหลวแสดง "บันทึกไม่สำเร็จ" พร้อมข้อความ error', async ({ page }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      const sessionId = 's-autosavefail';
      const bankId = makeId();
      await setupMockSupabase(
        page,
        seed({
          reconcileSessions: [
            makeSession({ id: sessionId, session_name: 'รอบทดสอบบันทึกอัตโนมัติล้มเหลว', status: 'in_progress' }),
          ],
          reconcileBankTransactions: [makeBankTxn(sessionId, 1, { id: bankId })],
        })
      );
      await openSession(page, sessionId);
      await forceSupabaseError(page, 'rpc:save_bank_reconcile_session', 'จำลองข้อผิดพลาดเครือข่าย');

      await page.getByTestId(`reconcile-mark-pending-${bankId}`).click();
      await expect(page.getByTestId('session-save-status')).toHaveText('บันทึกไม่สำเร็จ', { timeout: 5000 });
      await expect(page.getByTestId('session-error-message')).toBeVisible();

      expectNoErrors(errors, dialogs);
    });
  });

  test.describe('ป้องกันข้อมูลสูญหาย (Unsaved changes protection)', () => {
    test('1/3. กด "กลับไปหน้ารายการ" ขณะมีการเปลี่ยนแปลงค้างอยู่ แสดง dialog ยืนยันข้อความตามสเปก แล้วออกได้เมื่อยืนยัน', async ({
      page,
    }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      const sessionId = 's-leave-back';
      const bankId = makeId();
      await setupMockSupabase(
        page,
        seed({
          reconcileSessions: [
            makeSession({ id: sessionId, session_name: 'รอบทดสอบออกจากหน้าโดยไม่บันทึก', status: 'in_progress' }),
          ],
          reconcileBankTransactions: [makeBankTxn(sessionId, 1, { id: bankId })],
        })
      );
      await openSession(page, sessionId);

      await page.getByTestId(`reconcile-mark-pending-${bankId}`).click();
      await page.getByTestId('done-back-to-list').click();
      const dialog = page.getByTestId('unsaved-leave-dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้หรือไม่');
      await page.getByTestId('unsaved-leave-confirm').click();
      await expect(page.getByTestId('bank-reconcile-session-list')).toBeVisible();

      expectNoErrors(errors, dialogs);
    });

    test('2/3. สลับเมนู Sidebar ขณะมีการเปลี่ยนแปลงค้างอยู่ แสดง dialog เดียวกัน — ยกเลิกแล้วอยู่หน้าเดิม ยืนยันแล้วออกจริง', async ({
      page,
    }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      const sessionId = 's-leave-sidebar';
      const bankId = makeId();
      await setupMockSupabase(
        page,
        seed({
          reconcileSessions: [
            makeSession({ id: sessionId, session_name: 'รอบทดสอบสลับเมนูโดยไม่บันทึก', status: 'in_progress' }),
          ],
          reconcileBankTransactions: [makeBankTxn(sessionId, 1, { id: bankId })],
        })
      );
      await openSession(page, sessionId);

      await page.getByTestId(`reconcile-mark-pending-${bankId}`).click();
      await page.getByTestId('nav-item-record-expense').click();
      const dialog = page.getByTestId('sidebar-unsaved-leave-dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้หรือไม่');

      await page.getByTestId('sidebar-unsaved-leave-cancel').click();
      await expect(page.getByTestId('bank-reconcile-page')).toBeVisible(); // ยกเลิก ต้องยังอยู่หน้าเดิม

      await page.getByTestId('nav-item-record-expense').click();
      await page.getByTestId('sidebar-unsaved-leave-confirm').click();
      await expect(page.getByTestId('bank-reconcile-page')).toHaveCount(0); // ยืนยันแล้ว ต้องออกจากหน้าจริง

      expectNoErrors(errors, dialogs);
    });

    test('3/3. ไม่แสดง dialog เมื่อไม่มีการเปลี่ยนแปลงค้างอยู่ กด "กลับไปหน้ารายการ" ออกได้ทันที', async ({ page }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      const sessionId = 's-leave-clean';
      await setupMockSupabase(
        page,
        seed({
          reconcileSessions: [
            makeSession({ id: sessionId, session_name: 'รอบทดสอบไม่มีการเปลี่ยนแปลงค้าง', status: 'in_progress' }),
          ],
          reconcileBankTransactions: [makeBankTxn(sessionId, 1)],
        })
      );
      await openSession(page, sessionId);

      await page.getByTestId('done-back-to-list').click();
      await expect(page.getByTestId('bank-reconcile-session-list')).toBeVisible();
      await expect(page.getByTestId('unsaved-leave-dialog')).toHaveCount(0);

      expectNoErrors(errors, dialogs);
    });
  });

  test.describe('คำนวณใหม่ (Recalculate)', () => {
    function recalcSeed(sessionId: string, bId: string, gId: string): MockSeed {
      return seed({
        reconcileSessions: [makeSession({ id: sessionId, session_name: 'รอบทดสอบคำนวณใหม่', status: 'in_progress' })],
        reconcileBankTransactions: [
          makeBankTxn(sessionId, 1, { id: bId, bank_transaction_date: '2026-07-10', bank_money_in: 1500, bank_amount: 1500 }),
        ],
        reconcileGLTransactions: [
          makeGlTxn(sessionId, 1, { id: gId, gl_date: '2026-07-10', gl_debit: 1500, gl_amount: 1500 }),
        ],
        reconcileMatchGroups: [
          makeMatchGroup(sessionId, [bId], [gId], {
            status: 'confirmed_manual',
            amount_difference: 0,
            bank_total: 1500,
            gl_total: 1500,
            note: 'ยืนยันแล้ว',
          }),
        ],
      });
    }

    test('1/2. โหมด "ล้างผลเดิมและคำนวณใหม่ทั้งหมด" ต้องกาช่องยืนยันเพิ่มก่อนถึงจะกดได้ + ล้างการจับคู่ด้วยตนเองจริง', async ({
      page,
    }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      const sessionId = 's-recalc-clear';
      const bId = makeId();
      const gId = makeId();
      await setupMockSupabase(page, recalcSeed(sessionId, bId, gId));
      await openSession(page, sessionId);

      await expect(page.getByTestId(`reconcile-status-${bId}`)).toHaveText('ยืนยันด้วยตนเอง');
      await page.getByTestId('session-recalculate-button').click();
      await expect(page.getByTestId('recalculate-dialog')).toBeVisible();
      await page.getByTestId('recalculate-radio-clear_and_recalculate_all').check();
      await expect(page.getByTestId('recalculate-strong-confirm-box')).toBeVisible();
      await expect(page.getByTestId('recalculate-confirm')).toBeDisabled();
      await page.getByTestId('recalculate-strong-confirm-checkbox').check();
      await expect(page.getByTestId('recalculate-confirm')).toBeEnabled();
      await page.getByTestId('recalculate-confirm').click();
      await expect(page.getByTestId('recalculate-dialog')).toHaveCount(0);
      await expect(page.getByTestId(`reconcile-status-${bId}`)).not.toHaveText('ยืนยันด้วยตนเอง');

      expectNoErrors(errors, dialogs);
    });

    test('2/2. โหมด "เฉพาะรายการที่ยังไม่จับคู่" กดยืนยันได้ทันทีไม่ต้องกาช่อง และไม่แตะการจับคู่ด้วยตนเองเดิม', async ({
      page,
    }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      const sessionId = 's-recalc-keep';
      const bId = makeId();
      const gId = makeId();
      await setupMockSupabase(page, recalcSeed(sessionId, bId, gId));
      await openSession(page, sessionId);

      await page.getByTestId('session-recalculate-button').click();
      await expect(page.getByTestId('recalculate-strong-confirm-box')).toHaveCount(0);
      await expect(page.getByTestId('recalculate-confirm')).toBeEnabled();
      await page.getByTestId('recalculate-confirm').click();
      await expect(page.getByTestId('recalculate-dialog')).toHaveCount(0);
      await expect(page.getByTestId(`reconcile-status-${bId}`)).toHaveText('ยืนยันด้วยตนเอง');

      expectNoErrors(errors, dialogs);
    });
  });

  test.describe('ปิดรอบกระทบยอด (Completion)', () => {
    test('1/4. ปิดรอบไม่ได้เมื่อมี blocking error (ยืนยันมีผลต่างยอดเงินแต่ไม่มีหมายเหตุ) — ปุ่มยืนยันถูก disable', async ({
      page,
    }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      const sessionId = 's-complete-blocked';
      const bId = makeId();
      const gId = makeId();
      await setupMockSupabase(
        page,
        seed({
          reconcileSessions: [makeSession({ id: sessionId, session_name: 'รอบทดสอบปิดรอบไม่ได้', status: 'in_progress' })],
          reconcileBankTransactions: [makeBankTxn(sessionId, 1, { id: bId, bank_money_in: 1050, bank_amount: 1050 })],
          reconcileGLTransactions: [makeGlTxn(sessionId, 1, { id: gId, gl_debit: 1000, gl_amount: 1000 })],
          reconcileMatchGroups: [
            makeMatchGroup(sessionId, [bId], [gId], {
              status: 'confirmed_variance',
              amount_difference: 50,
              bank_total: 1050,
              gl_total: 1000,
              note: '',
            }),
          ],
        })
      );
      await openSession(page, sessionId);

      await page.getByTestId('session-complete-button').click();
      await expect(page.getByTestId('complete-session-dialog')).toBeVisible();
      await expect(page.getByTestId('complete-session-blocking-errors')).toContainText(
        'มีการยืนยันที่มีผลต่างยอดเงินแต่ยังไม่ได้กรอกหมายเหตุ 1 รายการ'
      );
      await expect(page.getByTestId('complete-session-confirm')).toBeDisabled();

      expectNoErrors(errors, dialogs);
    });

    test('2/4. ปิดรอบมี warning ต้องกรอกหมายเหตุก่อนถึงจะยืนยันได้ แล้วปิดรอบสำเร็จ', async ({ page }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      const sessionId = 's-complete-warning';
      await setupMockSupabase(
        page,
        seed({
          reconcileSessions: [makeSession({ id: sessionId, session_name: 'รอบทดสอบปิดรอบมีคำเตือน', status: 'in_progress' })],
          reconcileBankTransactions: [
            makeBankTxn(sessionId, 1, { bank_description: 'ยังไม่พบคู่', bank_money_in: 800, bank_amount: 800 }),
          ],
        })
      );
      await openSession(page, sessionId);

      await page.getByTestId('session-complete-button').click();
      await expect(page.getByTestId('complete-session-blocking-errors')).toHaveCount(0);
      const warnBox = page.getByTestId('complete-session-warnings');
      await expect(warnBox).toContainText('ยังมีรายการไม่พบใน GL จำนวน 1 รายการ');
      await expect(warnBox).toContainText('ต้องการปิดรอบกระทบยอดหรือไม่');

      await page.getByTestId('complete-session-confirm').click();
      await expect(page.getByTestId('complete-session-note-error')).toBeVisible(); // ยังไม่กรอกหมายเหตุ ต้องบล็อกไว้

      await page.getByTestId('complete-session-note-input').fill('ตรวจสอบแล้ว รอติดตามในรอบถัดไป');
      await page.getByTestId('complete-session-confirm').click();
      await expect(page.getByTestId('complete-session-dialog')).toHaveCount(0);
      await expect(page.getByTestId('session-header-status-badge')).toHaveText('เสร็จสมบูรณ์');
      await expect(page.getByTestId('session-completed-banner')).toBeVisible();

      expectNoErrors(errors, dialogs);
    });

    test('3/4. ปิดรอบสำเร็จเมื่อข้อมูลครบถ้วน (all-clear) และกลายเป็นอ่านอย่างเดียวระดับปุ่มควบคุม session', async ({
      page,
    }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      const sessionId = 's-complete-clean';
      const bId = makeId();
      const gId = makeId();
      await setupMockSupabase(
        page,
        seed({
          reconcileSessions: [makeSession({ id: sessionId, session_name: 'รอบทดสอบปิดรอบครบถ้วน', status: 'in_progress' })],
          reconcileBankTransactions: [makeBankTxn(sessionId, 1, { id: bId, bank_money_in: 1200, bank_amount: 1200 })],
          reconcileGLTransactions: [makeGlTxn(sessionId, 1, { id: gId, gl_debit: 1200, gl_amount: 1200 })],
          reconcileMatchGroups: [
            makeMatchGroup(sessionId, [bId], [gId], {
              status: 'confirmed_manual',
              amount_difference: 0,
              bank_total: 1200,
              gl_total: 1200,
            }),
          ],
        })
      );
      await openSession(page, sessionId);

      await page.getByTestId('session-complete-button').click();
      await expect(page.getByTestId('complete-session-all-clear')).toBeVisible();
      await expect(page.getByTestId('complete-session-confirm')).toBeEnabled();
      await page.getByTestId('complete-session-confirm').click();

      await expect(page.getByTestId('session-header-status-badge')).toHaveText('เสร็จสมบูรณ์');
      await expect(page.getByTestId('session-completed-banner')).toBeVisible();
      await expect(page.getByTestId('session-save-button')).toHaveCount(0);
      await expect(page.getByTestId('session-complete-button')).toHaveCount(0);
      await expect(page.getByTestId('session-recalculate-button')).toHaveCount(0);
      await expect(page.getByTestId('date-tolerance-select')).toHaveCount(0);
      await expect(page.getByTestId('session-export-excel-button')).toBeEnabled();
      await expect(page.getByTestId('session-reopen-button')).toBeVisible();

      expectNoErrors(errors, dialogs);
    });

    test('4/4. session ที่ปิดแล้วป้องกันการแก้ไขระดับแถว — คลิกปุ่มในตารางไม่มีผลใดๆ เกิดขึ้นจริง', async ({ page }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      const sessionId = 's-readonly-row';
      const bId = makeId();
      await setupMockSupabase(
        page,
        seed({
          reconcileSessions: [
            makeSession({
              id: sessionId,
              session_name: 'รอบทดสอบอ่านอย่างเดียวระดับแถว',
              status: 'completed',
              completed_by_email: TEST_USER,
              completed_at: '2026-06-01T02:00:00.000Z',
              completion_note: 'ปิดรอบเรียบร้อย',
            }),
          ],
          reconcileBankTransactions: [makeBankTxn(sessionId, 1, { id: bId, bank_money_in: 900, bank_amount: 900 })],
        })
      );
      await openSession(page, sessionId);

      await expect(page.getByTestId('session-completed-banner')).toBeVisible();
      await expect(page.getByTestId(`reconcile-status-${bId}`)).toHaveText('ไม่พบใน GL');

      await page.getByTestId(`reconcile-mark-pending-${bId}`).click();
      await expect(page.getByTestId(`reconcile-flagged-${bId}`)).toHaveCount(0);
      await expect(page.getByTestId(`reconcile-mark-pending-${bId}`)).toHaveText('ทำเครื่องหมายรอตรวจสอบ');
      await expect(page.getByTestId('session-save-status')).toHaveCount(0);

      expectNoErrors(errors, dialogs);
    });
  });

  test.describe('เปิดรอบที่ปิดแล้วกลับมาแก้ไข (Reopen)', () => {
    test('1/2. ปุ่มยืนยันถูก disable จนกว่าจะกรอกเหตุผล + เปิดรอบใหม่สำเร็จ + ประวัติการปิดรอบเดิมยังอยู่ครบ', async ({
      page,
    }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      const sessionId = 's-reopen';
      await setupMockSupabase(
        page,
        seed({
          reconcileSessions: [
            makeSession({
              id: sessionId,
              session_name: 'รอบทดสอบเปิดรอบใหม่',
              status: 'completed',
              completed_by_email: 'somchai@benz.co.th',
              completed_at: '2026-06-01T02:00:00.000Z',
              completion_note: 'ปิดรอบไตรมาส 2',
            }),
          ],
          reconcileBankTransactions: [makeBankTxn(sessionId, 1)],
          reconcileAuditLogs: [
            makeAuditEntry(sessionId, 'session_completed', {
              performed_at: '2026-06-01T02:00:00.000Z',
              performed_by_email: 'somchai@benz.co.th',
              action_note: 'ปิดรอบไตรมาส 2',
            }),
          ],
        })
      );
      await openSession(page, sessionId);
      await expect(page.getByTestId('session-completed-banner')).toBeVisible();

      await page.getByTestId('session-reopen-button').click();
      const dlg = page.getByTestId('reopen-session-dialog');
      await expect(dlg).toBeVisible();
      await expect(dlg).toContainText('somchai@benz.co.th');
      await expect(dlg).toContainText('ปิดรอบไตรมาส 2');
      await expect(page.getByTestId('reopen-session-confirm')).toBeDisabled();

      await page.getByTestId('reopen-session-reason-input').fill('พบรายการตกหล่นต้องแก้ไขเพิ่มเติม');
      await expect(page.getByTestId('reopen-session-confirm')).toBeEnabled();
      await page.getByTestId('reopen-session-confirm').click();
      await expect(page.getByTestId('reopen-session-dialog')).toHaveCount(0);

      await expect(page.getByTestId('session-header-status-badge')).toHaveText('เปิดใหม่');
      await expect(page.getByTestId('session-completed-banner')).toHaveCount(0);
      await expect(page.getByTestId('session-save-button')).toBeVisible();
      await expect(page.getByTestId('session-complete-button')).toBeVisible();

      await page.getByTestId('session-audit-log-button').click();
      const drawer = page.getByTestId('audit-log-drawer');
      await expect(drawer).toBeVisible();
      await expect(drawer.getByText('ปิดรอบกระทบยอด')).toBeVisible(); // ประวัติเดิมที่ seed ไว้ยังอยู่
      await expect(drawer.getByText('เปิดรอบใหม่เพื่อแก้ไข')).toBeVisible(); // ประวัติใหม่ถูกเพิ่มเข้ามา
      await expect(drawer).toContainText('พบรายการตกหล่นต้องแก้ไขเพิ่มเติม');

      expectNoErrors(errors, dialogs);
    });

    test('2/2. ยกเลิก dialog เปิดรอบใหม่ ไม่มีผลใดๆ สถานะยังเป็นเสร็จสมบูรณ์เหมือนเดิม', async ({ page }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      const sessionId = 's-reopen-cancel';
      await setupMockSupabase(
        page,
        seed({
          reconcileSessions: [
            makeSession({
              id: sessionId,
              session_name: 'รอบทดสอบยกเลิกการเปิดรอบใหม่',
              status: 'completed',
              completed_by_email: TEST_USER,
              completed_at: '2026-06-01T02:00:00.000Z',
            }),
          ],
        })
      );
      await openSession(page, sessionId);

      await page.getByTestId('session-reopen-button').click();
      await page.getByTestId('reopen-session-cancel').click();
      await expect(page.getByTestId('reopen-session-dialog')).toHaveCount(0);
      await expect(page.getByTestId('session-header-status-badge')).toHaveText('เสร็จสมบูรณ์');
      await expect(page.getByTestId('session-completed-banner')).toBeVisible();

      expectNoErrors(errors, dialogs);
    });
  });

  test.describe('ประวัติการแก้ไข (Audit log)', () => {
    test('1/2. แสดงประวัติทั้งหมดเรียงล่าสุดขึ้นก่อนพร้อมป้ายชื่อรายการภาษาไทยถูกต้อง', async ({ page }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      const sessionId = 's-audit-seeded';
      await setupMockSupabase(
        page,
        seed({
          reconcileSessions: [makeSession({ id: sessionId, session_name: 'รอบทดสอบประวัติการแก้ไข', status: 'in_progress' })],
          reconcileBankTransactions: [makeBankTxn(sessionId, 1)],
          reconcileAuditLogs: [
            makeAuditEntry(sessionId, 'session_created', { performed_at: '2026-01-01T00:00:00.000Z' }),
            makeAuditEntry(sessionId, 'file_uploaded', { performed_at: '2026-01-02T00:00:00.000Z' }),
            makeAuditEntry(sessionId, 'manual_match_confirmed', { performed_at: '2026-01-03T00:00:00.000Z' }),
          ],
        })
      );
      await openSession(page, sessionId);

      await page.getByTestId('session-audit-log-button').click();
      const entries = page.getByTestId('audit-log-entry');
      await expect(entries).toHaveCount(3);
      await expect(entries.first()).toContainText('ยืนยันการจับคู่ด้วยตนเอง');
      await expect(entries.last()).toContainText('สร้างรอบกระทบยอด');

      expectNoErrors(errors, dialogs);
    });

    test('2/2. แสดงข้อความหน้าว่างเมื่อยังไม่มีประวัติ แล้วมีรายการใหม่ปรากฏทันทีหลัง Export', async ({ page }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      const sessionId = 's-audit-empty';
      await setupMockSupabase(
        page,
        seed({
          reconcileSessions: [makeSession({ id: sessionId, session_name: 'รอบทดสอบประวัติว่างเปล่า', status: 'in_progress' })],
          reconcileBankTransactions: [makeBankTxn(sessionId, 1)],
        })
      );
      await openSession(page, sessionId);

      await page.getByTestId('session-audit-log-button').click();
      await expect(page.getByTestId('audit-log-empty')).toContainText('ยังไม่มีประวัติการแก้ไขของรอบกระทบยอดนี้');
      await page.getByTestId('audit-log-close').click();
      await expect(page.getByTestId('audit-log-drawer')).toHaveCount(0);

      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('session-export-excel-button').click(),
      ]);
      expect(await download.path()).not.toBeNull();

      await page.getByTestId('session-audit-log-button').click();
      const entries = page.getByTestId('audit-log-entry');
      await expect(entries).toHaveCount(1);
      await expect(entries.first()).toContainText('ส่งออกไฟล์');
      await expect(entries.first()).toContainText('Export Excel');

      expectNoErrors(errors, dialogs);
    });
  });

  test.describe('KPI และผลต่างสุทธิ (Net difference)', () => {
    test('1/1. ผลต่างสุทธิคำนวณใหม่จากข้อมูลจริงเสมอตามสูตร unmatched_bank - unmatched_gl + confirmedDifferenceSum (ไม่ใช้ค่า cache เดิม)', async ({
      page,
    }) => {
      const errors = attachConsoleErrorCollector(page);
      const dialogs = attachDialogGuard(page);
      const sessionId = 's-kpi';
      const u1 = makeId();
      const u2 = makeId();
      const m1 = makeId();
      const v1 = makeId();
      const m2 = makeId();
      await setupMockSupabase(
        page,
        seed({
          reconcileSessions: [
            makeSession({
              id: sessionId,
              session_name: 'รอบทดสอบผลต่างสุทธิ',
              status: 'in_progress',
              // ตั้งใจ seed ค่าผิดๆ ไว้ก่อน (placeholder) เพื่อพิสูจน์ว่าหน้ารายการแสดงค่าที่คำนวณสดใหม่หลัง
              // บันทึกจริง ไม่ใช่ค่า cache เดิมที่ค้างอยู่ในฐานข้อมูล
              net_difference: 999.99,
              bank_row_count: 3,
              gl_row_count: 2,
              matched_count: 1,
              manual_match_count: 1,
              unmatched_bank_count: 2,
              unmatched_gl_count: 1,
            }),
          ],
          reconcileBankTransactions: [
            makeBankTxn(sessionId, 1, {
              id: u1,
              bank_transaction_date: '2026-07-10',
              bank_description: 'ยังไม่พบคู่ 1',
              bank_money_in: 1000,
              bank_amount: 1000,
            }),
            makeBankTxn(sessionId, 2, {
              id: u2,
              bank_transaction_date: '2026-07-11',
              bank_description: 'ยังไม่พบคู่ 2',
              bank_money_out: 400,
              bank_amount: -400,
            }),
            makeBankTxn(sessionId, 3, {
              id: m1,
              bank_transaction_date: '2026-07-05',
              bank_description: 'ยืนยันแล้วมีผลต่าง',
              bank_money_in: 2000,
              bank_amount: 2000,
            }),
          ],
          reconcileGLTransactions: [
            makeGlTxn(sessionId, 1, {
              id: v1,
              gl_date: '2026-07-12',
              gl_document_no: 'JV-777',
              gl_description: 'ยังไม่พบคู่ GL',
              gl_debit: 250,
              gl_amount: 250,
            }),
            makeGlTxn(sessionId, 2, {
              id: m2,
              gl_date: '2026-07-05',
              gl_document_no: 'JV-500',
              gl_description: 'ยืนยันแล้วมีผลต่าง GL',
              gl_debit: 1925,
              gl_amount: 1925,
            }),
          ],
          reconcileMatchGroups: [
            makeMatchGroup(sessionId, [m1], [m2], {
              status: 'confirmed_variance',
              amount_difference: 75,
              bank_total: 2000,
              gl_total: 1925,
              note: 'ผลต่างจากค่าธรรมเนียมธนาคาร',
            }),
          ],
        })
      );

      // unmatched_bank_total = 1000 + (-400) = 600.00 (m1 อยู่ใน matchGroup แล้วสถานะ "แช่แข็ง" เป็น
      // confirmed_variance จึงไม่นับเป็นรายการไม่พบคู่)
      // unmatched_gl_total = 250.00 (m2 อยู่ใน matchGroup แล้วจึงไม่นับ)
      // confirmedDifferenceSum = 75.00 (จาก MatchGroup.amount_difference ตรงๆ)
      // net_difference = 600 - 250 + 75 = 425.00
      await gotoBankReconcileList(page);
      await expect(page.getByTestId(`session-row-${sessionId}`)).toContainText('999.99');

      await page.getByTestId(`session-open-${sessionId}`).click();
      await expect(page.getByTestId('reconcile-results')).toBeVisible();
      await page.getByTestId('session-save-button').click();
      await expect(page.getByTestId('session-save-status')).toHaveText('บันทึกแล้ว');
      await page.getByTestId('done-back-to-list').click();

      const row = page.getByTestId(`session-row-${sessionId}`);
      await expect(row).toContainText('425.00');
      await expect(row).not.toContainText('999.99');

      expectNoErrors(errors, dialogs);
    });
  });
});
