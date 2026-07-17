import { test, expect } from '@playwright/test';
import * as XLSX from 'xlsx';
import { attachConsoleErrorCollector, attachDialogGuard, gotoBankReconcile, setupMockSupabase } from './helpers';

const OWNER = 'user@example.com';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function buildWorkbookBuffer(rows: Record<string, unknown>[]): Buffer {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
}

// ชุดข้อมูลหลักที่ใช้ทดสอบกติกากระทบยอดแบบ end-to-end ในเบราว์เซอร์จริง:
// - B1 (รับ 1000, 01/07) จับคู่กับ G1 (DOC-001) ได้เสมอ ไม่ว่าเลือกช่วงวันที่แบบไหน (วันที่ตรงเป๊ะ)
// - B2 (จ่าย 500, 02/07) จับคู่กับ G2 (DOC-002, 05/07) ได้เฉพาะตอนเลือก ±3 วัน เท่านั้น (ห่างกัน 3 วันพอดี)
// - B3 (รับ 300, 10/07) ไม่มีคู่ใน GL เลย (จำนวนเงินไม่ตรงกับ GL แถวไหนเลย) ต้องไปโผล่ใน "Bank ไม่สำเร็จ" เสมอ
// - G3 (DOC-003, จ่าย 900, 20/07) ไม่มีคู่ใน Bank เลย ต้องไปโผล่ใน "GL ไม่สำเร็จ" เสมอ
const BANK_ROWS = [
  { วันที่: '2026-07-01', รับ: 1000, จ่าย: '' },
  { วันที่: '2026-07-02', รับ: '', จ่าย: 500 },
  { วันที่: '2026-07-10', รับ: 300, จ่าย: '' },
];
const GL_ROWS = [
  { 'เลขที่เอกสาร': 'DOC-001', วันที่: '2026-07-01', รับ: 1000, จ่าย: '' },
  { 'เลขที่เอกสาร': 'DOC-002', วันที่: '2026-07-05', รับ: '', จ่าย: 500 },
  { 'เลขที่เอกสาร': 'DOC-003', วันที่: '2026-07-20', รับ: '', จ่าย: 900 },
];

async function uploadStandardFiles(page: import('@playwright/test').Page) {
  await page.getByTestId('bank-upload-input').setInputFiles({
    name: 'bank-statement.xlsx',
    mimeType: XLSX_MIME,
    buffer: buildWorkbookBuffer(BANK_ROWS),
  });
  await expect(page.getByTestId('bank-upload-success')).toBeVisible();
  await page.getByTestId('gl-upload-input').setInputFiles({
    name: 'gl.xlsx',
    mimeType: XLSX_MIME,
    buffer: buildWorkbookBuffer(GL_ROWS),
  });
  await expect(page.getByTestId('gl-upload-success')).toBeVisible();
}

test.describe('Bank Reconcile — หน้าใหม่ (รายงานเปรียบเทียบ Bank Statement vs GL)', () => {
  test('สถานะเริ่มต้น: ปุ่มตรวจสอบข้อมูลถูก disable จนกว่าจะอัปโหลดครบทั้งสองไฟล์', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoBankReconcile(page);

    await expect(page.getByTestId('bank-reconcile-empty')).toBeVisible();
    await expect(page.getByTestId('check-data-button')).toBeDisabled();

    await page.getByTestId('bank-upload-input').setInputFiles({
      name: 'bank-statement.xlsx',
      mimeType: XLSX_MIME,
      buffer: buildWorkbookBuffer(BANK_ROWS),
    });
    await expect(page.getByTestId('bank-upload-success')).toBeVisible();
    // อัปโหลดแค่ไฟล์เดียว ปุ่มต้องยัง disable อยู่
    await expect(page.getByTestId('check-data-button')).toBeDisabled();

    expect(errors).toEqual([]);
  });

  test('กระทบยอดสำเร็จ: แสดง 3 sections แยกกันชัดเจน พร้อมการ์ดสรุปที่ถูกต้อง (tolerance ±1 วัน)', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    const dialogs = attachDialogGuard(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoBankReconcile(page);
    await uploadStandardFiles(page);

    // ค่าเริ่มต้นคือ ±1 วัน
    await expect(page.getByTestId('tolerance-option-1')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('check-data-button')).toBeEnabled();
    await page.getByTestId('check-data-button').click();

    // การ์ดสรุป: Bank 3, GL 3, สำเร็จ 1 (แค่ B1↔G1 — B2/G2 ห่างกัน 3 วัน เกิน ±1), Bank ไม่สำเร็จ 2, GL ไม่สำเร็จ 2
    await expect(page.getByTestId('bank-reconcile-summary-bank-count')).toContainText('3');
    await expect(page.getByTestId('bank-reconcile-summary-gl-count')).toContainText('3');
    await expect(page.getByTestId('bank-reconcile-summary-matched-count')).toContainText('1');
    await expect(page.getByTestId('bank-reconcile-summary-bank-unmatched-count')).toContainText('2');
    await expect(page.getByTestId('bank-reconcile-summary-gl-unmatched-count')).toContainText('2');

    // Section 1: กระทบยอดสำเร็จ — ต้องมี 1 แถวเท่านั้น (B1 ↔ G1 DOC-001)
    const matchedSection = page.getByTestId('matched-section');
    await expect(matchedSection.getByText('กระทบยอดสำเร็จ')).toBeVisible();
    await expect(matchedSection.locator('tbody tr')).toHaveCount(1);
    await expect(matchedSection).toContainText('DOC-001');
    await expect(matchedSection).toContainText('สำเร็จ');

    // Section 2: Bank Statement ไม่สำเร็จ — B2 (500) และ B3 (300) ต้องอยู่ที่นี่ ไม่มีคอลัมน์ GL ปนอยู่เลย
    const bankUnmatchedSection = page.getByTestId('bank-unmatched-section');
    await expect(bankUnmatchedSection.getByText('Bank Statement ไม่สำเร็จ')).toBeVisible();
    await expect(bankUnmatchedSection.locator('tbody tr')).toHaveCount(2);
    await expect(bankUnmatchedSection).toContainText('ไม่พบข้อมูลใน GL');
    await expect(bankUnmatchedSection.locator('thead')).not.toContainText('เลขที่เอกสาร');

    // Section 3: GL ไม่สำเร็จ — G2 (DOC-002) และ G3 (DOC-003) ต้องอยู่ที่นี่ แต่ "ไม่แสดงเลขที่เอกสาร" ตามสเปก
    const glUnmatchedSection = page.getByTestId('gl-unmatched-section');
    await expect(glUnmatchedSection.getByText('GL ไม่สำเร็จ')).toBeVisible();
    await expect(glUnmatchedSection.locator('tbody tr')).toHaveCount(2);
    await expect(glUnmatchedSection).toContainText('ไม่พบข้อมูลใน Bank Statement');
    await expect(glUnmatchedSection.locator('thead')).not.toContainText('เลขที่เอกสาร');
    await expect(glUnmatchedSection).not.toContainText('DOC-002');
    await expect(glUnmatchedSection).not.toContainText('DOC-003');

    expect(dialogs).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('เปลี่ยนช่วงวันที่เป็น ±3 วัน แล้วกดตรวจสอบใหม่ — B2/G2 ต้องจับคู่กันได้เพิ่ม', async ({ page }) => {
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoBankReconcile(page);
    await uploadStandardFiles(page);

    await page.getByTestId('tolerance-option-3').click();
    await expect(page.getByTestId('tolerance-option-3')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('check-data-button').click();

    await expect(page.getByTestId('bank-reconcile-summary-matched-count')).toContainText('2');
    await expect(page.getByTestId('bank-reconcile-summary-bank-unmatched-count')).toContainText('1');
    await expect(page.getByTestId('bank-reconcile-summary-gl-unmatched-count')).toContainText('1');

    const matchedSection = page.getByTestId('matched-section');
    await expect(matchedSection.locator('tbody tr')).toHaveCount(2);
    await expect(matchedSection).toContainText('DOC-001');
    await expect(matchedSection).toContainText('DOC-002');
  });

  test('รองรับไฟล์ CSV เช่นเดียวกับ Excel', async ({ page }) => {
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoBankReconcile(page);

    const bankCsv = 'วันที่,รับ,จ่าย\n2026-07-01,1000,\n2026-07-10,300,\n';
    const glCsv = 'เลขที่เอกสาร,วันที่,รับ,จ่าย\nDOC-001,2026-07-01,1000,\n';

    await page.getByTestId('bank-upload-input').setInputFiles({
      name: 'bank.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(bankCsv, 'utf-8'),
    });
    await expect(page.getByTestId('bank-upload-success')).toBeVisible();

    await page.getByTestId('gl-upload-input').setInputFiles({
      name: 'gl.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(glCsv, 'utf-8'),
    });
    await expect(page.getByTestId('gl-upload-success')).toBeVisible();

    await page.getByTestId('check-data-button').click();
    await expect(page.getByTestId('bank-reconcile-summary-matched-count')).toContainText('1');
    await expect(page.getByTestId('bank-reconcile-summary-bank-unmatched-count')).toContainText('1');
  });

  test('แสดง error เมื่อไฟล์ไม่มีคอลัมน์ที่จำเป็น และปุ่มตรวจสอบข้อมูลยังคง disable อยู่', async ({ page }) => {
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoBankReconcile(page);

    await page.getByTestId('bank-upload-input').setInputFiles({
      name: 'invalid.xlsx',
      mimeType: XLSX_MIME,
      buffer: buildWorkbookBuffer([{ Foo: 'bar', Baz: 123 }]),
    });
    await expect(page.getByTestId('bank-upload-error')).toBeVisible();
    await expect(page.getByTestId('bank-upload-error')).toContainText('วันที่');
    await expect(page.getByTestId('check-data-button')).toBeDisabled();
  });

  test('มี pagination เมื่อจำนวนรายการในตารางมากเกิน 1 หน้า', async ({ page }) => {
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoBankReconcile(page);

    // สร้าง Bank 25 แถวที่ไม่มีคู่ใน GL เลย (จำนวนเงินไม่ซ้ำกับ GL แถวเดียว) เพื่อบังคับให้ตาราง "Bank
    // ไม่สำเร็จ" มีมากกว่า 1 หน้า (PAGE_SIZE = 20)
    const bankRows = Array.from({ length: 25 }, (_, i) => ({
      วันที่: '2026-07-01',
      รับ: 1000 + i,
      จ่าย: '',
    }));
    const glRows = [{ 'เลขที่เอกสาร': 'DOC-999', วันที่: '2026-07-01', รับ: 1, จ่าย: '' }];

    await page.getByTestId('bank-upload-input').setInputFiles({
      name: 'bank-many.xlsx',
      mimeType: XLSX_MIME,
      buffer: buildWorkbookBuffer(bankRows),
    });
    await expect(page.getByTestId('bank-upload-success')).toBeVisible();
    await page.getByTestId('gl-upload-input').setInputFiles({
      name: 'gl-small.xlsx',
      mimeType: XLSX_MIME,
      buffer: buildWorkbookBuffer(glRows),
    });
    await expect(page.getByTestId('gl-upload-success')).toBeVisible();
    await page.getByTestId('check-data-button').click();

    await expect(page.getByTestId('bank-reconcile-summary-bank-unmatched-count')).toContainText('25');
    await expect(page.getByTestId('bank-unmatched-pagination-page-indicator')).toHaveText('หน้า 1 / 2');
    await expect(page.getByTestId('bank-unmatched-section').locator('tbody tr')).toHaveCount(20);

    await page.getByTestId('bank-unmatched-pagination-next').click();
    await expect(page.getByTestId('bank-unmatched-pagination-page-indicator')).toHaveText('หน้า 2 / 2');
    await expect(page.getByTestId('bank-unmatched-section').locator('tbody tr')).toHaveCount(5);
  });
});
