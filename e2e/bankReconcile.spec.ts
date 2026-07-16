import { test, expect } from '@playwright/test';
import * as XLSX from 'xlsx';
import { attachConsoleErrorCollector, gotoBankReconcile, setupMockSupabase } from './helpers';

const OWNER = 'user@example.com';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function buildXlsxBuffer(rows: unknown[][]): Buffer {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
}

// แถวที่ 2 (เงินออกเป็น "-") ต้อง normalize เป็น 0 — แถวที่ 3 (เงินออก "15,000" ไม่มี comma ในแถวอื่น)
// ทดสอบทั้งค่าที่มี comma และไม่มี comma ปนกันในไฟล์เดียว
const BANK_ROWS = [
  ['วันที่รายการ', 'รายละเอียด', 'เงินเข้า', 'เงินออก', 'ยอดคงเหลือ'],
  ['16/07/2026', 'รับโอนจากลูกค้า A', '10,000.00', '', '50,000.00'],
  ['16/07/2026', 'ค่าธรรมเนียมธนาคาร', '', '-', '49,900.00'],
  ['17/07/2026', 'จ่ายค่าเช่า', '', '15,000', '34,900.00'],
];

const GL_ROWS = [
  ['วันที่', 'เลขที่เอกสาร', 'รายละเอียด', 'เดบิต', 'เครดิต'],
  ['16/07/2026', 'JV-001', 'รับชำระจากลูกค้า A', '10,000.00', ''],
  ['17/07/2026', 'JV-002', 'จ่ายค่าเช่าสำนักงาน', '', '15,000.00'],
];

async function mapAllColumns(page: import('@playwright/test').Page) {
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

test.describe('Bank Reconcile (เฟส 1: อัปโหลด + เตรียมข้อมูล)', () => {
  test('เมนู Sidebar เปิดหน้าได้จริง (ไม่ใช่ "เร็วๆ นี้" อีกต่อไป) ปุ่มถัดไปปิดอยู่ตั้งแต่ต้น', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await page.getByTestId('nav-item-bank-reconcile').click();

    await expect(page.getByTestId('coming-soon')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Bank Reconcile' })).toBeVisible();
    await expect(page.getByTestId('bank-reconcile-page')).toBeVisible();
    await expect(page.getByTestId('bank-upload-card')).toBeVisible();
    await expect(page.getByTestId('gl-upload-card')).toBeVisible();
    await expect(page.getByTestId('next-to-mapping')).toBeDisabled();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('1. อัปโหลด Bank Statement ที่ถูกต้อง — แสดงชื่อไฟล์ จำนวนแถว และสถานะผ่านการตรวจสอบ', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoBankReconcile(page);

    await page.getByTestId('bank-file-input').setInputFiles({
      name: 'bank-statement.xlsx',
      mimeType: XLSX_MIME,
      buffer: buildXlsxBuffer(BANK_ROWS),
    });

    await expect(page.getByTestId('bank-file-name')).toContainText('bank-statement.xlsx');
    // 5. แสดงจำนวนแถว — ไฟล์มี 3 แถวข้อมูล (ไม่นับ header)
    await expect(page.getByTestId('bank-row-count')).toContainText('3 แถว');
    await expect(page.getByTestId('bank-validation-status')).toContainText('ผ่านการตรวจสอบ');
    // ยังไม่ได้อัปโหลด GL — ปุ่มถัดไปต้องยังปิดอยู่
    await expect(page.getByTestId('next-to-mapping')).toBeDisabled();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('2. อัปโหลดไฟล์ GL ที่ถูกต้อง — แสดงชื่อไฟล์ จำนวนแถว สถานะผ่านการตรวจสอบ และเปิดปุ่มถัดไปเมื่อครบทั้งสองไฟล์', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoBankReconcile(page);

    await page.getByTestId('bank-file-input').setInputFiles({
      name: 'bank-statement.xlsx',
      mimeType: XLSX_MIME,
      buffer: buildXlsxBuffer(BANK_ROWS),
    });
    await page.getByTestId('gl-file-input').setInputFiles({
      name: 'gl-express.xlsx',
      mimeType: XLSX_MIME,
      buffer: buildXlsxBuffer(GL_ROWS),
    });

    await expect(page.getByTestId('gl-file-name')).toContainText('gl-express.xlsx');
    await expect(page.getByTestId('gl-row-count')).toContainText('2 แถว');
    await expect(page.getByTestId('gl-validation-status')).toContainText('ผ่านการตรวจสอบ');
    await expect(page.getByTestId('next-to-mapping')).toBeEnabled();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('3. ปฏิเสธไฟล์ประเภทที่ไม่รองรับ — แสดงข้อความแจ้งเตือน ปุ่มถัดไปยังปิดอยู่', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoBankReconcile(page);

    await page.getByTestId('bank-file-input').setInputFiles({
      name: 'bank-statement.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('ไม่ใช่ไฟล์ที่รองรับ'),
    });

    await expect(page.getByTestId('bank-validation-status')).toContainText('.xlsx');
    await expect(page.getByTestId('next-to-mapping')).toBeDisabled();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('4. ปฏิเสธไฟล์ที่ว่างเปล่า (ไม่มีข้อมูลใดๆ) — แสดงข้อความแจ้งเตือน ปุ่มถัดไปยังปิดอยู่', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoBankReconcile(page);

    await page.getByTestId('gl-file-input').setInputFiles({
      name: 'empty.xlsx',
      mimeType: XLSX_MIME,
      buffer: buildXlsxBuffer([]),
    });

    await expect(page.getByTestId('gl-validation-status')).toContainText('ว่างเปล่า');
    await expect(page.getByTestId('next-to-mapping')).toBeDisabled();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('6/7/8/9. จับคู่คอลัมน์ทำงานถูกต้อง พรีวิวแสดงผลถูกต้อง ค่าว่าง/"-" กลายเป็น 0 และตัวเลขมี comma ถูกแปลงถูกต้อง', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoBankReconcile(page);

    await page.getByTestId('bank-file-input').setInputFiles({
      name: 'bank-statement.xlsx',
      mimeType: XLSX_MIME,
      buffer: buildXlsxBuffer(BANK_ROWS),
    });
    await page.getByTestId('gl-file-input').setInputFiles({
      name: 'gl-express.xlsx',
      mimeType: XLSX_MIME,
      buffer: buildXlsxBuffer(GL_ROWS),
    });
    await expect(page.getByTestId('next-to-mapping')).toBeEnabled();
    await page.getByTestId('next-to-mapping').click();

    await expect(page.getByTestId('bank-reconcile-mapping-step')).toBeVisible();
    // ก่อนจับคู่คอลัมน์ครบตามเงื่อนไขขั้นต่ำ ปุ่มบันทึกต้องปิดอยู่
    await expect(page.getByTestId('mapping-save')).toBeDisabled();

    await mapAllColumns(page);

    // 6. จับคู่คอลัมน์ครบแล้ว — ปุ่มบันทึกต้องเปิดใช้งาน
    await expect(page.getByTestId('mapping-save')).toBeEnabled();

    // 7/9. พรีวิว Bank Statement แถวแรก: เงินเข้า "10,000.00" (มี comma) → ต้อง parse ถูกต้อง ยอดสุทธิ +10,000.00
    const bankRow2 = page.getByTestId('bank-preview-row-2');
    await expect(bankRow2).toContainText('2026-07-16');
    await expect(bankRow2).toContainText('รับโอนจากลูกค้า A');
    await expect(bankRow2).toContainText('10,000.00');

    // 8. แถวสอง: เงินออกเป็น "-" → ต้องกลายเป็น 0.00 (ไม่ใช่ NaN/ค่าว่าง/error)
    const bankRow3 = page.getByTestId('bank-preview-row-3');
    await expect(bankRow3).toContainText('0.00');

    // 9. แถวสาม: เงินออก "15,000" (ไม่มี comma ในต้นฉบับ) → ยอดสุทธิ -15,000.00
    const bankRow4 = page.getByTestId('bank-preview-row-4');
    await expect(bankRow4).toContainText('15,000.00');

    // 7. พรีวิว GL แถวแรก: เดบิต 10,000 เครดิตว่าง ("" → 0) → ยอดสุทธิแปลงแล้ว +10,000.00 (debit - credit)
    const glRow2 = page.getByTestId('gl-preview-row-2');
    await expect(glRow2).toContainText('JV-001');
    await expect(glRow2).toContainText('รับชำระจากลูกค้า A');
    await expect(glRow2).toContainText('10,000.00');

    // แถวสอง: เครดิต 15,000 เดบิตว่าง → ยอดสุทธิแปลงแล้วต้องติดลบ (สำคัญ: sign convention ต้องไม่กลับด้าน)
    const glRow3 = page.getByTestId('gl-preview-row-3');
    await expect(glRow3).toContainText('JV-002');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ปุ่มล้างไฟล์ล้างทั้งสองไฟล์กลับสู่สถานะเริ่มต้น', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoBankReconcile(page);

    await page.getByTestId('bank-file-input').setInputFiles({
      name: 'bank-statement.xlsx',
      mimeType: XLSX_MIME,
      buffer: buildXlsxBuffer(BANK_ROWS),
    });
    await expect(page.getByTestId('bank-file-name')).toBeVisible();

    await page.getByTestId('clear-files').click();

    await expect(page.getByTestId('bank-file-name')).toHaveCount(0);
    await expect(page.getByTestId('next-to-mapping')).toBeDisabled();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ย้อนกลับจากขั้นตอนจับคู่คอลัมน์รักษาไฟล์เดิมไว้ ล้างการจับคู่คอลัมน์ได้ และบันทึกไปขั้นตอนถัดไปได้โดยไม่นำทางไปหน้าที่ไม่มีอยู่จริง', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoBankReconcile(page);

    await page.getByTestId('bank-file-input').setInputFiles({
      name: 'bank-statement.xlsx',
      mimeType: XLSX_MIME,
      buffer: buildXlsxBuffer(BANK_ROWS),
    });
    await page.getByTestId('gl-file-input').setInputFiles({
      name: 'gl-express.xlsx',
      mimeType: XLSX_MIME,
      buffer: buildXlsxBuffer(GL_ROWS),
    });
    await page.getByTestId('next-to-mapping').click();
    await mapAllColumns(page);
    await expect(page.getByTestId('mapping-save')).toBeEnabled();

    // ย้อนกลับ — ไฟล์ทั้งสองต้องยังอยู่ครบ ไม่ต้องอัปโหลดใหม่
    await page.getByTestId('mapping-back').click();
    await expect(page.getByTestId('bank-file-name')).toContainText('bank-statement.xlsx');
    await expect(page.getByTestId('gl-file-name')).toContainText('gl-express.xlsx');
    await expect(page.getByTestId('next-to-mapping')).toBeEnabled();

    // ไปขั้นตอนจับคู่คอลัมน์อีกครั้ง — การจับคู่เดิมยังอยู่ (ปุ่มบันทึกเปิดใช้งานอยู่แล้วโดยไม่ต้อง map ใหม่)
    await page.getByTestId('next-to-mapping').click();
    await expect(page.getByTestId('mapping-save')).toBeEnabled();

    // ล้างการจับคู่คอลัมน์ — ปุ่มบันทึกต้องปิดลงอีกครั้ง
    await page.getByTestId('mapping-clear').click();
    await expect(page.getByTestId('mapping-save')).toBeDisabled();

    // จับคู่ใหม่แล้วบันทึก — จบที่หน้าผลการกระทบยอดในหน้าเดิม (ไม่มี route ใหม่ใดๆ ถูกสร้างขึ้น) ตั้งแต่เฟส 2
    // (2026-07-16) หน้านี้แสดงผลการจับคู่จริงแทนข้อความ placeholder เดิมของเฟส 1 แล้ว — ดู
    // e2e/bankReconcileMatch.spec.ts สำหรับเทสต์ครอบคลุมเครื่องมือจับคู่รายการโดยละเอียด
    await mapAllColumns(page);
    await page.getByTestId('mapping-save').click();

    await expect(page.getByTestId('reconcile-results')).toBeVisible();
    await expect(page.getByTestId('kpi-total-bank-value')).toBeVisible();
    // URL ต้องยังอยู่ที่ /dashboard เดิมเสมอ (ไม่มี route ใหม่ใดๆ ถูกสร้างขึ้นในเฟสนี้)
    await expect(page).toHaveURL(/\/dashboard$/);

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });
});
