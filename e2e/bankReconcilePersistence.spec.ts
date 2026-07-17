import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import * as XLSX from 'xlsx';
import { attachConsoleErrorCollector, attachDialogGuard, gotoBankReconcile, gotoBankReconcileList, setupMockSupabase } from './helpers';
import type { MockSeedReconcileBankTransaction, MockSeedReconcileGLTransaction, MockSeedReconcileSession } from './mockSupabase';

/**
 * e2e — Bank Reconcile: หน้ารายการ "ประวัติการกระทบยอดธนาคาร", วงจรชีวิตของรอบกระทบยอด (บันทึก/บันทึกอัตโนมัติ/
 * ป้องกันข้อมูลสูญหาย/เปลี่ยนสถานะ/Export Excel/เปิดรอบเดิม) เขียนใหม่ทั้งไฟล์ 2026-07-17 พร้อมกับการ rebuild
 * โมดูล Bank Reconcile ทั้งโมดูล — แทนที่ e2e/bankReconcilePersistence.spec.ts เดิมทั้งหมด (1,474 บรรทัด ทดสอบ
 * โมเดลเดิมที่ถูกลบทิ้งไปทั้งหมด: match group/audit log/date tolerance/สถานะ 5 ค่ารวม draft/reopened/cancelled/
 * การล็อกแก้ไขเมื่อปิดรอบ/คำนวณใหม่หลายโหมด/ทำสำเนา/เปลี่ยนชื่อ/ยกเลิกรอบ/Export PDF/9 ชีท Excel — ไม่มีสิ่งใด
 * ในรายการนี้เหลืออยู่ในสเปกใหม่เลย)
 *
 * ต่างจาก bankReconcile.spec.ts/bankReconcileMatch.spec.ts/bankReconcileReview.spec.ts ที่เน้นทดสอบผ่านการ
 * "อัปโหลดไฟล์สดๆ" หรือ "seed ข้อมูลแล้วเปิดดูผลลัพธ์" ไฟล์นี้เน้นทดสอบวงจรชีวิตของ "การบันทึก" เอง (สร้างใหม่/
 * บันทึกซ้ำ/auto-save/ปิดรอบ/เปิดรอบใหม่/ลบ) จึงผสมทั้งสองวิธี: ส่วน A/E/F/G ใช้ seed ตรงเข้า mock (ควบคุมข้อมูล
 * แน่นอน) ส่วน B/D ใช้อัปโหลดไฟล์สดๆ (ต้องมี sessionId=null ตั้งต้นจริงๆ เพื่อทดสอบ "บันทึกครั้งแรก")
 */

const OWNER = 'user@example.com';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function buildXlsxBuffer(rows: unknown[][]): Buffer {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
}

const BANK_HEADERS = ['วันที่', 'รายละเอียด', 'เงินเข้า', 'เงินออก', 'ยอดคงเหลือ', 'เลขบัญชี'];
const GL_HEADERS = ['วันที่', 'เลขที่เอกสาร', 'รายละเอียด', 'รับเงิน', 'จ่ายเงิน', 'รหัสบัญชี'];

async function mapAllColumns(page: Page) {
  await page.getByTestId('bank-mapping-transactionDate').selectOption('0');
  await page.getByTestId('bank-mapping-description').selectOption('1');
  await page.getByTestId('bank-mapping-moneyIn').selectOption('2');
  await page.getByTestId('bank-mapping-moneyOut').selectOption('3');
  await page.getByTestId('gl-mapping-date').selectOption('0');
  await page.getByTestId('gl-mapping-docNo').selectOption('1');
  await page.getByTestId('gl-mapping-description').selectOption('2');
  await page.getByTestId('gl-mapping-moneyIn').selectOption('3');
  await page.getByTestId('gl-mapping-moneyOut').selectOption('4');
}

/** อัปโหลด Bank/GL แถวเดียวที่ถูกต้องสมบูรณ์แล้วกด "เริ่มกระทบยอด" — ใช้กับเทสต์ที่ต้องการ session สดใหม่จริงๆ
 * (sessionId=null, dirty=true ตั้งต้นเสมอ) เพื่อทดสอบ "บันทึกครั้งแรก"/"ป้องกันข้อมูลสูญหาย" โดยเฉพาะ */
async function reachFreshResults(page: Page, bankFileName = 'bank.xlsx') {
  await gotoBankReconcile(page);
  await page.getByTestId('bank-file-input').setInputFiles({
    name: bankFileName,
    mimeType: XLSX_MIME,
    buffer: buildXlsxBuffer([BANK_HEADERS, ['2026-07-01', 'ทดสอบบันทึก', 1000, 0, 5000, '111-1-11111-1']]),
  });
  await page.getByTestId('gl-file-input').setInputFiles({
    name: 'gl.xlsx',
    mimeType: XLSX_MIME,
    buffer: buildXlsxBuffer([GL_HEADERS, ['2026-07-01', 'DOC-1', 'บันทึกทดสอบ', 1000, 0, '4100']]),
  });
  await page.getByTestId('next-to-mapping').click();
  await mapAllColumns(page);
  await page.getByTestId('mapping-save').click();
  await page.getByTestId('preview-start-reconciliation').click();
  await expect(page.getByTestId('bank-reconcile-results')).toBeVisible();
}

async function forceError(page: Page, target: string, message: string) {
  await page.evaluate(([t, m]) => (window as unknown as { __mockSupabaseForceError__: (t: string, m: string) => void }).__mockSupabaseForceError__(t, m), [target, message]);
}

test.describe('Bank Reconcile — หน้ารายการ "ประวัติการกระทบยอดธนาคาร"', () => {
  test('แสดงรายการที่บันทึกไว้ครบทุกคอลัมน์หลัก พร้อม badge สถานะถูกต้องของทั้งสองสถานะ', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      reconcileSessions: [
        {
          id: 's-list-1',
          session_name: 'กระทบยอดมิถุนายน 2569',
          bank_file_name: 'bank-june.xlsx',
          gl_file_name: 'gl-june.xlsx',
          bank_row_count: 12,
          gl_row_count: 9,
          found_count: 7,
          bank_not_found_count: 5,
          status: 'in_progress',
          created_by_email: OWNER,
        },
        {
          id: 's-list-2',
          session_name: 'กระทบยอดพฤษภาคม 2569',
          bank_file_name: 'bank-may.xlsx',
          gl_file_name: 'gl-may.xlsx',
          status: 'completed',
          created_by_email: OWNER,
        },
      ],
    });
    await gotoBankReconcileList(page);

    const row1 = page.getByTestId('session-row-s-list-1');
    await expect(row1).toContainText('กระทบยอดมิถุนายน 2569');
    await expect(row1).toContainText('bank-june.xlsx');
    await expect(row1).toContainText('gl-june.xlsx');
    await expect(row1).toContainText('12');
    await expect(row1).toContainText('9');
    await expect(row1).toContainText('7');
    await expect(row1).toContainText('5');
    await expect(row1).toContainText(OWNER);
    await expect(page.getByTestId('session-status-badge-s-list-1')).toContainText('กำลังดำเนินการ');
    await expect(page.getByTestId('session-status-badge-s-list-2')).toContainText('เสร็จสมบูรณ์');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('แท็บสถานะกรองรายการและนับจำนวนถูกต้องทุกแท็บ', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      reconcileSessions: [
        { id: 'tab-1', session_name: 'รอบ 1', bank_file_name: 'b1.xlsx', gl_file_name: 'g1.xlsx', status: 'in_progress' },
        { id: 'tab-2', session_name: 'รอบ 2', bank_file_name: 'b2.xlsx', gl_file_name: 'g2.xlsx', status: 'in_progress' },
        { id: 'tab-3', session_name: 'รอบ 3', bank_file_name: 'b3.xlsx', gl_file_name: 'g3.xlsx', status: 'completed' },
      ],
    });
    await gotoBankReconcileList(page);

    await expect(page.getByTestId('session-list-tab-all')).toContainText('ทั้งหมด (3)');
    await expect(page.getByTestId('session-list-tab-in_progress')).toContainText('กำลังดำเนินการ (2)');
    await expect(page.getByTestId('session-list-tab-completed')).toContainText('เสร็จสมบูรณ์ (1)');

    await page.getByTestId('session-list-tab-completed').click();
    await expect(page.getByTestId('session-row-tab-3')).toBeVisible();
    await expect(page.getByTestId('session-row-tab-1')).toHaveCount(0);
    await expect(page.getByTestId('session-row-tab-2')).toHaveCount(0);

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ค้นหาด้วยชื่อรอบ / ชื่อไฟล์ Bank / ชื่อไฟล์ GL กรองผลลัพธ์ถูกต้อง', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      reconcileSessions: [
        { id: 'srch-1', session_name: 'กระทบยอดสาขาสีลม', bank_file_name: 'kbank-silom.xlsx', gl_file_name: 'gl-silom.xlsx', status: 'in_progress' },
        { id: 'srch-2', session_name: 'กระทบยอดสาขาอโศก', bank_file_name: 'scb-asoke.xlsx', gl_file_name: 'gl-asoke.xlsx', status: 'in_progress' },
      ],
    });
    await gotoBankReconcileList(page);

    await page.getByTestId('session-list-search-input').fill('สีลม');
    await expect(page.getByTestId('session-row-srch-1')).toBeVisible();
    await expect(page.getByTestId('session-row-srch-2')).toHaveCount(0);

    await page.getByTestId('session-list-search-input').fill('scb-asoke');
    await expect(page.getByTestId('session-row-srch-2')).toBeVisible();
    await expect(page.getByTestId('session-row-srch-1')).toHaveCount(0);

    await page.getByTestId('session-list-search-input').fill('gl-silom');
    await expect(page.getByTestId('session-row-srch-1')).toBeVisible();
    await expect(page.getByTestId('session-row-srch-2')).toHaveCount(0);

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('"ล้างตัวกรอง" รีเซ็ตแท็บและคำค้นหากลับเป็นค่าเริ่มต้นทั้งหมด', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      reconcileSessions: [
        { id: 'clr-1', session_name: 'รอบหนึ่ง', bank_file_name: 'b.xlsx', gl_file_name: 'g.xlsx', status: 'in_progress' },
        { id: 'clr-2', session_name: 'รอบสอง', bank_file_name: 'b.xlsx', gl_file_name: 'g.xlsx', status: 'completed' },
      ],
    });
    await gotoBankReconcileList(page);

    await page.getByTestId('session-list-tab-completed').click();
    await page.getByTestId('session-list-search-input').fill('ไม่มีทางเจอ');
    await expect(page.getByTestId('session-list-empty')).toBeVisible();

    await page.getByTestId('session-list-clear-filters').click();
    await expect(page.getByTestId('session-list-tab-all')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('session-list-search-input')).toHaveValue('');
    await expect(page.getByTestId('session-row-clr-1')).toBeVisible();
    await expect(page.getByTestId('session-row-clr-2')).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('Pagination แบ่งหน้าถูกต้องเมื่อมีรายการเกิน 10 รายการ', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    const sessions: MockSeedReconcileSession[] = Array.from({ length: 15 }, (_, i) => ({
      id: `page-s${i + 1}`,
      session_name: `รอบทดสอบเพจ ${String(i + 1).padStart(2, '0')}`,
      bank_file_name: `bank-${i + 1}.xlsx`,
      gl_file_name: `gl-${i + 1}.xlsx`,
      status: 'in_progress',
    }));
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }], reconcileSessions: sessions });
    await gotoBankReconcileList(page);

    await expect(page.locator('[data-testid^="session-row-"]')).toHaveCount(10);
    await expect(page.getByTestId('session-list-pagination')).toContainText('แสดง 1–10 จาก 15 รายการ');
    await expect(page.getByTestId('session-list-pagination-page-indicator')).toContainText('หน้า 1 / 2');
    await expect(page.getByTestId('session-list-pagination-prev')).toBeDisabled();

    await page.getByTestId('session-list-pagination-next').click();
    await expect(page.locator('[data-testid^="session-row-"]')).toHaveCount(5);
    await expect(page.getByTestId('session-list-pagination')).toContainText('แสดง 11–15 จาก 15 รายการ');
    await expect(page.getByTestId('session-list-pagination-page-indicator')).toContainText('หน้า 2 / 2');
    await expect(page.getByTestId('session-list-pagination-next')).toBeDisabled();

    await page.getByTestId('session-list-pagination-prev').click();
    await expect(page.locator('[data-testid^="session-row-"]')).toHaveCount(10);

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('หน้าว่างแสดงข้อความถูกต้องทั้งกรณี "ยังไม่มีรอบกระทบยอดเลย" และ "กรองแล้วไม่พบรายการที่ตรงกัน"', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoBankReconcileList(page);
    await expect(page.getByTestId('session-list-empty')).toContainText('ยังไม่มีรอบกระทบยอดธนาคาร เริ่มสร้างรอบแรกได้เลย');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('หน้าว่างแสดงข้อความถูกต้องเมื่อตัวกรองไม่พบรายการที่ตรงกัน', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      reconcileSessions: [{ id: 'e1', session_name: 'รอบเดียว', bank_file_name: 'b.xlsx', gl_file_name: 'g.xlsx', status: 'in_progress' }],
    });
    await gotoBankReconcileList(page);

    await page.getByTestId('session-list-search-input').fill('ไม่มีทางเจอเด็ดขาด');
    await expect(page.getByTestId('session-list-empty')).toContainText('ไม่พบรอบกระทบยอดที่ตรงกับตัวกรองนี้');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('โหลดรายการไม่สำเร็จแสดงข้อความ error ที่กำหนด', async ({ page }) => {
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');
    await forceError(page, 'table:bank_reconcile_sessions', 'เครือข่ายขัดข้อง');

    await page.getByTestId('nav-item-bank-reconcile').click();
    await expect(page.getByTestId('bank-reconcile-page').getByRole('alert')).toContainText(
      'โหลดประวัติการกระทบยอดธนาคารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
    );
  });

  test('"เปิด" โหลดรอบเดิมแสดงผลลัพธ์ตรงกับข้อมูลที่บันทึกไว้ และไม่มีปุ่มย้อนกลับไปแก้ไขข้อมูลดิบ', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      reconcileSessions: [{ id: 'open-1', session_name: 'รอบที่จะเปิด', bank_file_name: 'b.xlsx', gl_file_name: 'g.xlsx', status: 'in_progress' }],
      reconcileBankTransactions: [
        { id: 'ob-1', session_id: 'open-1', row_number: 1, transaction_date: '2026-07-01', description: 'รับเงินทดสอบเปิดรอบ', direction: 'income', amount: 4200, money_in: 4200, money_out: 0 },
      ],
      reconcileGLTransactions: [
        { id: 'og-1', session_id: 'open-1', row_number: 1, transaction_date: '2026-07-01', description: 'บันทึกรับเงิน', doc_no: 'DOC-OPEN', direction: 'income', amount: 4200, money_in: 4200, money_out: 0 },
      ],
    });
    await gotoBankReconcileList(page);
    await page.getByTestId('session-open-open-1').click();

    await expect(page.getByTestId('bank-reconcile-results')).toBeVisible();
    await expect(page.getByTestId('reconcile-status-ob-1')).toContainText('พบใน GL');
    await expect(page.getByTestId('results-back-to-list')).toBeVisible();
    await expect(page.getByTestId('results-back-to-preview')).toHaveCount(0);

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('"ลบ" (soft delete): ยกเลิกไม่มีผล ยืนยันแล้วรายการหายไปจากหน้ารายการทันที', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    const dialogs = attachDialogGuard(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      reconcileSessions: [{ id: 'del-1', session_name: 'รอบที่จะลบ', bank_file_name: 'b.xlsx', gl_file_name: 'g.xlsx', status: 'in_progress' }],
    });
    await gotoBankReconcileList(page);

    await page.getByTestId('session-delete-del-1').click();
    await expect(page.getByTestId('delete-session-dialog')).toContainText('รอบที่จะลบ');
    await page.getByTestId('delete-session-cancel').click();
    await expect(page.getByTestId('session-row-del-1')).toBeVisible();

    await page.getByTestId('session-delete-del-1').click();
    await page.getByTestId('delete-session-confirm').click();
    await expect(page.getByTestId('session-row-del-1')).toHaveCount(0);
    await expect(page.getByTestId('session-list-empty')).toBeVisible();

    expect(dialogs, `ไม่ควรมี native dialog เกิดขึ้นเลย: ${dialogs.join(', ')}`).toEqual([]);
    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('"สร้างรอบกระทบยอดใหม่" นำไปขั้นตอนอัปโหลดไฟล์', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoBankReconcileList(page);

    await page.getByTestId('session-list-create-new').click();
    await expect(page.getByTestId('bank-reconcile-step-indicator')).toContainText('ขั้นตอนที่ 1 จาก 3: อัปโหลดไฟล์');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });
});

test.describe('Bank Reconcile — บันทึกรอบกระทบยอด (Save workflow)', () => {
  test('บันทึกครั้งแรก: dialog บังคับตั้งชื่อ (ค่าเริ่มต้นจากชื่อไฟล์ Bank) ปุ่มยืนยัน disabled ถ้าว่างเปล่า แล้วบันทึกสำเร็จปรากฏในหน้ารายการ', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await reachFreshResults(page, 'bank-statement.xlsx');

    await expect(page.getByTestId('session-header-status-badge')).toHaveCount(0); // ยังไม่เคยบันทึก — ยังไม่มี status
    await page.getByTestId('session-save-button').click();
    await expect(page.getByTestId('save-session-dialog')).toBeVisible();
    await expect(page.getByTestId('save-session-input')).toHaveValue('กระทบยอด bank-statement.xlsx');

    await page.getByTestId('save-session-input').fill('');
    await expect(page.getByTestId('save-session-confirm')).toBeDisabled();
    await page.getByTestId('save-session-input').fill('รอบทดสอบบันทึกครั้งแรก');
    await page.getByTestId('save-session-confirm').click();

    await expect(page.getByTestId('save-session-dialog')).toHaveCount(0);
    await expect(page.getByTestId('session-header-name')).toContainText('รอบทดสอบบันทึกครั้งแรก');
    await expect(page.getByTestId('session-header-status-badge')).toContainText('กำลังดำเนินการ');
    await expect(page.getByTestId('session-save-status')).toContainText('บันทึกแล้ว');

    await page.getByTestId('results-back-to-list').click();
    await expect(page.getByTestId('bank-reconcile-session-list')).toBeVisible();
    await expect(page.locator('[data-testid^="session-row-"]').filter({ hasText: 'รอบทดสอบบันทึกครั้งแรก' })).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('บันทึกไม่สำเร็จแสดงข้อความ error ตามที่กำหนด และ session ยังไม่ถูกบันทึกจริง', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await reachFreshResults(page);
    await forceError(page, 'rpc:save_bank_reconcile_session', 'เครือข่ายขัดข้อง');

    await page.getByTestId('session-save-button').click();
    await page.getByTestId('save-session-confirm').click();

    await expect(page.getByTestId('reconcile-save-error')).toContainText('บันทึกรอบกระทบยอดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    await expect(page.getByTestId('session-save-status')).toContainText('บันทึกไม่สำเร็จ');
    await expect(page.getByTestId('session-export-excel-button')).toBeDisabled(); // ยังไม่มี sessionId จริง — ยังไม่เคยบันทึกสำเร็จ

    // เทสต์นี้ตั้งใจบังคับให้บันทึกล้มเหลวเอง — ต้องมี console.error หนึ่งรายการจาก catch ของ performSave()
    // (components/BankReconcileResults.tsx, log ไว้เพื่อ debug จริง) เท่านั้น ไม่ใช่ error อื่นที่ไม่คาดคิด
    expect(errors, `พบ console error ที่ไม่คาดคิด: ${errors.join(', ')}`).toEqual([
      '[BankReconcileResults] บันทึกรอบกระทบยอดไม่สำเร็จ {message: เครือข่ายขัดข้อง}',
    ]);
  });
});

test.describe('Bank Reconcile — บันทึกอัตโนมัติ (Auto-save)', () => {
  async function openAutoSaveSession(page: Page) {
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      reconcileSessions: [{ id: 'auto-1', session_name: 'รอบทดสอบ auto-save', bank_file_name: 'b.xlsx', gl_file_name: 'g.xlsx', status: 'in_progress' }],
      reconcileBankTransactions: [
        { id: 'auto-bt-1', session_id: 'auto-1', row_number: 1, transaction_date: '2026-07-01', description: 'จ่ายค่าน้ำ', direction: 'payment', amount: 300, money_in: 0, money_out: 300 },
      ],
    });
    await gotoBankReconcileList(page);
    await page.getByTestId('session-open-auto-1').click();
    await expect(page.getByTestId('bank-reconcile-results')).toBeVisible();
  }

  test('แก้ไขธงตรวจสอบของ session ที่บันทึกไว้แล้ว trigger auto-save ภายในเวลา debounce แสดง "บันทึกแล้ว" โดยไม่ต้องกดบันทึกเอง', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await openAutoSaveSession(page);

    await page.getByTestId('reconcile-reviewed-auto-bt-1').click();
    await expect(page.getByTestId('session-save-status')).toHaveText('บันทึกแล้ว', { timeout: 8000 });

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('บันทึกอัตโนมัติล้มเหลวแสดง "บันทึกไม่สำเร็จ" พร้อมข้อความ error', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await openAutoSaveSession(page);
    await forceError(page, 'rpc:save_bank_reconcile_session', 'บันทึกอัตโนมัติล้มเหลว');

    await page.getByTestId('reconcile-needs-gl-entry-auto-bt-1').click();
    await expect(page.getByTestId('session-save-status')).toHaveText('บันทึกไม่สำเร็จ', { timeout: 8000 });
    await expect(page.getByTestId('reconcile-save-error')).toContainText('บันทึกรอบกระทบยอดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');

    // เทสต์นี้ตั้งใจบังคับให้บันทึกอัตโนมัติล้มเหลวเอง — ต้องมี console.error หนึ่งรายการจาก catch ของ
    // performSave() (components/BankReconcileResults.tsx, log ไว้เพื่อ debug จริง) เท่านั้น
    expect(errors, `พบ console error ที่ไม่คาดคิด: ${errors.join(', ')}`).toEqual([
      '[BankReconcileResults] บันทึกรอบกระทบยอดไม่สำเร็จ {message: บันทึกอัตโนมัติล้มเหลว}',
    ]);
  });
});

test.describe('Bank Reconcile — ป้องกันข้อมูลสูญหาย (Unsaved changes protection)', () => {
  test('กด "กลับไปหน้ารายการ" ขณะมีการเปลี่ยนแปลงค้างอยู่ (ยังไม่เคยบันทึกเลย) แสดง dialog ยืนยัน — ยกเลิกอยู่หน้าเดิม ยืนยันแล้วออกได้', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    const dialogs = attachDialogGuard(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await reachFreshResults(page);

    await page.getByTestId('results-back-to-list').click();
    await expect(page.getByTestId('unsaved-changes-dialog')).toContainText('ต้องการออกจากหน้านี้โดยไม่บันทึกการเปลี่ยนแปลงหรือไม่?');
    await page.getByTestId('unsaved-changes-cancel').click();
    await expect(page.getByTestId('bank-reconcile-results')).toBeVisible();

    await page.getByTestId('results-back-to-list').click();
    await page.getByTestId('unsaved-changes-confirm').click();
    await expect(page.getByTestId('bank-reconcile-session-list')).toBeVisible();

    expect(dialogs, `ไม่ควรมี native dialog เกิดขึ้นเลย: ${dialogs.join(', ')}`).toEqual([]);
    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('สลับเมนู Sidebar ขณะมีการเปลี่ยนแปลงค้างอยู่ แสดง dialog เดียวกัน — ยกเลิกอยู่หน้าเดิม ยืนยันแล้วออกไปเมนูอื่นจริง', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    const dialogs = attachDialogGuard(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await reachFreshResults(page);

    await page.getByTestId('nav-item-record-expense').click();
    await expect(page.getByTestId('sidebar-unsaved-leave-dialog')).toContainText('มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้หรือไม่');
    await page.getByTestId('sidebar-unsaved-leave-cancel').click();
    await expect(page.getByTestId('bank-reconcile-results')).toBeVisible();
    await expect(page.getByTestId('nav-item-bank-reconcile')).toHaveAttribute('aria-current', 'page');

    await page.getByTestId('nav-item-record-expense').click();
    await page.getByTestId('sidebar-unsaved-leave-confirm').click();
    await expect(page.getByTestId('nav-item-record-expense')).toHaveAttribute('aria-current', 'page');

    expect(dialogs, `ไม่ควรมี native dialog เกิดขึ้นเลย: ${dialogs.join(', ')}`).toEqual([]);
    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ไม่แสดง dialog เมื่อไม่มีการเปลี่ยนแปลงค้างอยู่ (บันทึกสำเร็จแล้ว) — กด "กลับไปหน้ารายการ" ออกได้ทันที', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await reachFreshResults(page);
    await page.getByTestId('session-save-button').click();
    await page.getByTestId('save-session-confirm').click();
    await expect(page.getByTestId('session-save-status')).toContainText('บันทึกแล้ว');

    await page.getByTestId('results-back-to-list').click();
    await expect(page.getByTestId('unsaved-changes-dialog')).toHaveCount(0);
    await expect(page.getByTestId('bank-reconcile-session-list')).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });
});

test.describe('Bank Reconcile — เปลี่ยนสถานะ (ทำเครื่องหมายว่าเสร็จสมบูรณ์ / เปิดกลับมาแก้ไข)', () => {
  async function openStatusSession(page: Page) {
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      reconcileSessions: [{ id: 'status-1', session_name: 'รอบทดสอบสถานะ', bank_file_name: 'b.xlsx', gl_file_name: 'g.xlsx', status: 'in_progress' }],
      reconcileBankTransactions: [
        { id: 'status-bt-1', session_id: 'status-1', row_number: 1, transaction_date: '2026-07-01', description: 'รับเงิน', direction: 'income', amount: 100, money_in: 100, money_out: 0 },
      ],
    });
    await gotoBankReconcileList(page);
    await page.getByTestId('session-open-status-1').click();
    await expect(page.getByTestId('bank-reconcile-results')).toBeVisible();
  }

  test('ทำเครื่องหมายว่าเสร็จสมบูรณ์แล้วเปิดกลับมาแก้ไขอีกครั้ง — ข้อความ dialog/badge/banner/ปุ่มถูกต้องทั้งสองทิศทาง', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    const dialogs = attachDialogGuard(page);
    await openStatusSession(page);

    await expect(page.getByTestId('session-toggle-status-button')).toContainText('ทำเครื่องหมายว่าเสร็จสมบูรณ์');
    await page.getByTestId('session-toggle-status-button').click();
    await expect(page.getByTestId('toggle-status-dialog')).toContainText('ต้องการทำเครื่องหมายรอบกระทบยอดนี้ว่าเสร็จสมบูรณ์หรือไม่? ยังแก้ไข/บันทึกต่อได้ตามปกติภายหลัง');
    await page.getByTestId('toggle-status-confirm').click();

    await expect(page.getByTestId('session-header-status-badge')).toContainText('เสร็จสมบูรณ์');
    await expect(page.getByTestId('session-completed-banner')).toContainText(OWNER);
    await expect(page.getByTestId('session-toggle-status-button')).toContainText('เปิดกลับมาแก้ไข');

    await page.getByTestId('session-toggle-status-button').click();
    await expect(page.getByTestId('toggle-status-dialog')).toContainText('ต้องการเปิดรอบกระทบยอดนี้กลับมาแก้ไขอีกครั้งหรือไม่?');
    await page.getByTestId('toggle-status-confirm').click();

    await expect(page.getByTestId('session-header-status-badge')).toContainText('กำลังดำเนินการ');
    await expect(page.getByTestId('session-completed-banner')).toHaveCount(0);
    await expect(page.getByTestId('session-toggle-status-button')).toContainText('ทำเครื่องหมายว่าเสร็จสมบูรณ์');

    expect(dialogs, `ไม่ควรมี native dialog เกิดขึ้นเลย: ${dialogs.join(', ')}`).toEqual([]);
    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ยกเลิก dialog เปลี่ยนสถานะ ไม่มีผลใดๆ ต่อสถานะเดิม', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await openStatusSession(page);

    await page.getByTestId('session-toggle-status-button').click();
    await page.getByTestId('toggle-status-cancel').click();
    await expect(page.getByTestId('toggle-status-dialog')).toHaveCount(0);
    await expect(page.getByTestId('session-header-status-badge')).toContainText('กำลังดำเนินการ');
    await expect(page.getByTestId('session-toggle-status-button')).toContainText('ทำเครื่องหมายว่าเสร็จสมบูรณ์');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('แก้ไขธงตรวจสอบยังทำงานได้ตามปกติแม้สถานะเป็น "เสร็จสมบูรณ์" แล้ว — ไม่มีการล็อกการแก้ไขใดๆ', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await openStatusSession(page);
    await page.getByTestId('session-toggle-status-button').click();
    await page.getByTestId('toggle-status-confirm').click();
    await expect(page.getByTestId('session-header-status-badge')).toContainText('เสร็จสมบูรณ์');

    // แถวนี้ found_in_gl (ไม่มีคู่ GL เลยจริงๆ แต่ยังทดสอบการแก้ไขหมายเหตุ/ธงผ่านแถวได้ปกติถ้าเป็น not_found — สร้าง
    // สถานการณ์ให้ status เสร็จสมบูรณ์ก่อนแล้วค่อยยืนยันว่าโต้ตอบกับตารางได้เหมือนเดิมทุกประการผ่าน filter ตรวจสอบแล้ว
    await page.getByTestId('reconcile-filter-reviewed').selectOption('reviewed');
    await expect(page.getByTestId('reconcile-row-status-bt-1')).toHaveCount(0);
    await page.getByTestId('reconcile-filter-reviewed').selectOption('all');
    await page.getByTestId('reconcile-reviewed-status-bt-1').click();
    await page.getByTestId('reconcile-filter-reviewed').selectOption('reviewed');
    await expect(page.getByTestId('reconcile-row-status-bt-1')).toBeVisible();
    await expect(page.getByTestId('session-save-status')).toHaveText('บันทึกแล้ว', { timeout: 8000 });

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });
});

test.describe('Bank Reconcile — Export Excel', () => {
  test('ปุ่ม Export Excel ปิดใช้งานจนกว่าจะบันทึกครั้งแรก แล้วเปิดใช้งานได้ทันทีหลังบันทึกสำเร็จ', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await reachFreshResults(page);

    await expect(page.getByTestId('session-export-excel-button')).toBeDisabled();
    await expect(page.getByTestId('session-export-excel-button')).toHaveAttribute('title', 'บันทึกรอบกระทบยอดก่อนจึงจะ Export ได้');

    await page.getByTestId('session-save-button').click();
    await page.getByTestId('save-session-confirm').click();
    await expect(page.getByTestId('session-export-excel-button')).toBeEnabled();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('Export ได้ไฟล์ Excel ครบ 6 ชีทตามชื่อที่กำหนด พร้อมข้อมูลสรุป/รายละเอียด/หมายเหตุถูกต้อง', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    const bankTxns: MockSeedReconcileBankTransaction[] = [
      { id: 'ex-bt-1', session_id: 'export-1', row_number: 1, transaction_date: '2026-07-01', description: 'รับเงินลูกค้า', direction: 'income', amount: 2000, money_in: 2000, money_out: 0, raw_row: ['2026-07-01', 'ทดสอบ', 2000, 0] },
      { id: 'ex-bt-2', session_id: 'export-1', row_number: 2, transaction_date: '2026-07-02', description: 'จ่ายค่าใช้จ่ายไม่ทราบที่มา', direction: 'payment', amount: 800, money_in: 0, money_out: 800, needs_gl_entry: true, reviewed: true, review_note: 'รอเอกสาร' },
    ];
    const glTxns: MockSeedReconcileGLTransaction[] = [
      { id: 'ex-gt-1', session_id: 'export-1', row_number: 1, transaction_date: '2026-07-01', description: 'บันทึกรับเงิน', doc_no: 'DOC-X1', direction: 'income', amount: 2000, money_in: 2000, money_out: 0 },
      { id: 'ex-gt-2', session_id: 'export-1', row_number: 2, transaction_date: '2026-07-05', description: 'บันทึกค่าน้ำประปา', doc_no: 'DOC-X2', direction: 'payment', amount: 450, money_in: 0, money_out: 450, needs_gl_review: true, review_note: 'ตรวจสอบภายหลัง' },
    ];
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      reconcileSessions: [{ id: 'export-1', session_name: 'รอบทดสอบ Export', bank_file_name: 'b.xlsx', gl_file_name: 'g.xlsx', status: 'in_progress', created_by_email: OWNER }],
      reconcileBankTransactions: bankTxns,
      reconcileGLTransactions: glTxns,
    });
    await gotoBankReconcileList(page);
    await page.getByTestId('session-open-export-1').click();
    await expect(page.getByTestId('bank-reconcile-results')).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('session-export-excel-button').click()]);
    const buffer = readFileSync((await download.path())!);
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    expect(workbook.SheetNames).toEqual(['Summary', 'Found in GL', 'Bank Not Found in GL', 'GL Not Found in Bank', 'Bank Raw Data', 'GL Raw Data']);

    const summaryRows = XLSX.utils.sheet_to_json<(string | number)[]>(workbook.Sheets['Summary'], { header: 1 });
    expect(summaryRows).toContainEqual(['รายการ Bank ทั้งหมด', 2]);
    expect(summaryRows).toContainEqual(['พบใน GL', 1]);
    expect(summaryRows).toContainEqual(['ไม่พบใน GL', 1]);
    expect(summaryRows).toContainEqual(['รายการ GL ทั้งหมด', 2]);
    expect(summaryRows).toContainEqual(['GL ที่ไม่พบใน Bank', 1]);

    const foundRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['Found in GL'], { defval: '' });
    expect(foundRows).toHaveLength(1);
    expect(foundRows[0]['สถานะ']).toBe('พบใน GL');
    expect(foundRows[0]['เลขที่เอกสาร GL']).toBe('DOC-X1');
    expect(foundRows[0]['ยอด Bank']).toBe(2000);

    const notFoundRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['Bank Not Found in GL'], { defval: '' });
    expect(notFoundRows[0]['ยอด']).toBe(800);
    expect(notFoundRows[0]['ต้องบันทึก GL เพิ่ม']).toBe('ใช่');
    expect(notFoundRows[0]['หมายเหตุ']).toBe('รอเอกสาร');

    const glOnlyRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['GL Not Found in Bank'], { defval: '' });
    expect(glOnlyRows[0]['ยอด GL']).toBe(450);
    expect(glOnlyRows[0]['ต้องตรวจสอบ GL']).toBe('ใช่');
    expect(glOnlyRows[0]['หมายเหตุ']).toBe('ตรวจสอบภายหลัง');

    const bankRawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['Bank Raw Data'], { defval: '' });
    expect(bankRawRows[0]['คอลัมน์ 1']).toBe('2026-07-01');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('Export ไม่สำเร็จแสดงข้อความ error ที่กำหนด', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      reconcileSessions: [{ id: 'export-err-1', session_name: 'รอบทดสอบ Export ล้มเหลว', bank_file_name: 'b.xlsx', gl_file_name: 'g.xlsx', status: 'in_progress' }],
    });
    await gotoBankReconcileList(page);
    await page.getByTestId('session-open-export-err-1').click();
    await expect(page.getByTestId('bank-reconcile-results')).toBeVisible();

    await forceError(page, 'table:bank_reconcile_sessions', 'โหลดข้อมูลสำหรับ export ล้มเหลว');
    await page.getByTestId('session-export-excel-button').click();
    await expect(page.getByTestId('reconcile-save-error')).toContainText('Export Excel ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');

    // เทสต์นี้ตั้งใจบังคับให้ Export ล้มเหลวเอง — ต้องมี console.error หนึ่งรายการจาก catch ของ
    // handleExportExcel() (components/BankReconcileResults.tsx, log ไว้เพื่อ debug จริง) เท่านั้น
    expect(errors, `พบ console error ที่ไม่คาดคิด: ${errors.join(', ')}`).toEqual([
      '[BankReconcileResults] Export Excel ไม่สำเร็จ {message: โหลดข้อมูลสำหรับ export ล้มเหลว}',
    ]);
  });
});

test.describe('Bank Reconcile — เปิดรอบเดิมกลับมาแก้ไข (fidelity)', () => {
  test('เปิดรอบเดิมที่มีธงตรวจสอบ/หมายเหตุไว้แล้ว — โหลดกลับมาแสดงครบถ้วนทุกจุดทันทีโดยไม่ต้องทำอะไรเพิ่ม', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      reconcileSessions: [{ id: 'fid-1', session_name: 'รอบทดสอบความครบถ้วน', bank_file_name: 'b.xlsx', gl_file_name: 'g.xlsx', status: 'in_progress' }],
      reconcileBankTransactions: [
        { id: 'fid-bt-1', session_id: 'fid-1', row_number: 1, transaction_date: '2026-07-01', description: 'จ่ายค่าโฆษณา', direction: 'payment', amount: 1500, money_in: 0, money_out: 1500, needs_gl_entry: true, reviewed: true, review_note: 'บันทึกไว้แล้วรอ GL' },
      ],
      reconcileGLTransactions: [
        { id: 'fid-gt-1', session_id: 'fid-1', row_number: 1, transaction_date: '2026-07-02', description: 'บันทึกค่าเช่าที่จอดรถ', doc_no: 'DOC-FID', direction: 'payment', amount: 600, money_in: 0, money_out: 600, needs_gl_review: true, review_note: 'รอผู้จัดการอนุมัติ' },
      ],
    });
    await gotoBankReconcileList(page);
    await page.getByTestId('session-open-fid-1').click();
    await expect(page.getByTestId('bank-reconcile-results')).toBeVisible();

    await expect(page.getByTestId('reconcile-row-fid-bt-1')).toContainText('ต้องบันทึก GL เพิ่ม');
    await expect(page.getByTestId('reconcile-row-fid-bt-1')).toContainText('บันทึกไว้แล้วรอ GL');
    await expect(page.getByTestId('reconcile-unmatched-gl-row-fid-gt-1')).toContainText('ต้องตรวจสอบ GL');
    await expect(page.getByTestId('reconcile-unmatched-gl-row-fid-gt-1')).toContainText('รอผู้จัดการอนุมัติ');

    await page.getByTestId('reconcile-filter-reviewed').selectOption('reviewed');
    await expect(page.getByTestId('reconcile-row-fid-bt-1')).toBeVisible();
    await expect(page.getByTestId('reconcile-unmatched-gl-row-fid-gt-1')).toHaveCount(0); // gl-only แถวนี้ไม่ได้ตั้ง reviewed ไว้

    await expect(page.getByTestId('results-back-to-preview')).toHaveCount(0);
    await expect(page.getByTestId('results-back-to-list')).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });
});
