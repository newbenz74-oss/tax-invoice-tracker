import { test, expect } from '@playwright/test';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import { attachConsoleErrorCollector, gotoBankReconcile, setupMockSupabase } from './helpers';

/**
 * e2e — Bank Reconcile: อัปโหลดไฟล์ → จับคู่คอลัมน์ → ตรวจสอบข้อมูลก่อนกระทบยอด (Preview)
 * เขียนใหม่ทั้งไฟล์ 2026-07-17 พร้อมกับการ rebuild โมดูล Bank Reconcile ทั้งโมดูล — แทนที่ e2e/bankReconcile.spec.ts
 * เดิม (เทสต์เฟส 1-2 เก่า อ้างอิง testid/ข้อความที่ถูกลบไปแล้วทั้งหมด เช่น gl-mapping-debit/gl-mapping-credit,
 * date-tolerance-select) ให้ตรงกับโมเดลใหม่: จับคู่ด้วย "ทิศทางธุรกรรม" (รับเงิน/จ่ายเงิน) + "จำนวนเงิน" เท่านั้น
 * ไม่มี tolerance/score ใดๆ ในขั้นตอนนี้เลย — เทสต์ในไฟล์นี้ครอบคลุมเฉพาะ 3 ขั้นตอนแรกของโมดูล (อัปโหลด/จับคู่
 * คอลัมน์/พรีวิว) ไม่แตะหน้าผลลัพธ์/บันทึก/ export (ดู bankReconcileMatch.spec.ts, bankReconcileReview.spec.ts,
 * bankReconcilePersistence.spec.ts สำหรับส่วนที่เหลือ)
 */

const OWNER = 'user@example.com';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function buildXlsxBuffer(rows: unknown[][]): Buffer {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
}

function buildCsvBuffer(content: string): Buffer {
  return Buffer.from(content, 'utf-8');
}

/** สร้างไฟล์ PDF ที่มี text layer จริง (ไม่ใช่เอกสารสแกน) — วางตำแหน่งคอลัมน์ห่างกัน 35mm (≈ 99pt ในหน่วยของ
 * pdfjs) เกิน COLUMN_GAP_THRESHOLD=10pt มาก และวางแต่ละแถวห่างกัน 10mm (≈ 28pt) เกิน Y_TOLERANCE=3pt มาก เพื่อให้
 * lib/bankReconcilePdfParse.ts จัดกลุ่มเป็นแถว/คอลัมน์ตามที่ตั้งใจได้แน่นอน — ใช้ตัวอักษรละติน/ตัวเลขล้วนๆ (ไม่ใช้
 * ภาษาไทย) เพราะฟอนต์มาตรฐานของ jsPDF ไม่มี glyph ภาษาไทยให้ */
function buildTextPdfBuffer(rows: string[][]): Buffer {
  const doc = new jsPDF();
  doc.setFontSize(10);
  const colX = [10, 45, 80, 115, 150];
  let y = 20;
  for (const row of rows) {
    row.forEach((cell, i) => doc.text(cell, colX[i] ?? 10 + i * 35, y));
    y += 10;
  }
  return Buffer.from(doc.output('arraybuffer'));
}

/** สร้างไฟล์ PDF ที่ไม่มี text layer เลย (จำลองเอกสารสแกน) — วาดแค่สี่เหลี่ยมทึบ ไม่มี doc.text() แม้แต่ครั้งเดียว
 * ทำให้ totalChars=0 < pageCount*10 ตามฮิวริสติกของ extractPdfToRawTable() เข้าเงื่อนไข isScanned=true ทันที */
function buildScannedPdfBuffer(): Buffer {
  const doc = new jsPDF();
  doc.setFillColor(200, 200, 200);
  doc.rect(10, 10, 100, 150, 'F');
  return Buffer.from(doc.output('arraybuffer'));
}

const BANK_HEADERS = ['วันที่', 'รายละเอียด', 'เงินเข้า', 'เงินออก', 'ยอดคงเหลือ', 'เลขบัญชี'];
const GL_HEADERS = ['วันที่', 'เลขที่เอกสาร', 'รายละเอียด', 'รับเงิน', 'จ่ายเงิน', 'รหัสบัญชี'];

const BANK_ROWS = [
  ['2026-07-01', 'รับโอนจากลูกค้า A', 1000, 0, 5000, '111-1-11111-1'],
  ['2026-07-02', 'จ่ายค่าเช่า', 0, 2000, 3000, '111-1-11111-1'],
];
const GL_ROWS = [
  ['2026-07-01', 'DOC-001', 'รับชำระจากลูกค้า A', 1000, 0, '4100'],
  ['2026-07-02', 'DOC-002', 'จ่ายค่าเช่าสำนักงาน', 0, 2000, '5200'],
];

async function uploadBankFile(page: import('@playwright/test').Page, buffer: Buffer, name: string, mimeType: string) {
  await page.getByTestId('bank-file-input').setInputFiles({ name, mimeType, buffer });
}
async function uploadGlFile(page: import('@playwright/test').Page, buffer: Buffer, name: string, mimeType: string) {
  await page.getByTestId('gl-file-input').setInputFiles({ name, mimeType, buffer });
}

async function uploadValidBankAndGl(page: import('@playwright/test').Page) {
  await uploadBankFile(page, buildXlsxBuffer([BANK_HEADERS, ...BANK_ROWS]), 'bank.xlsx', XLSX_MIME);
  await expect(page.getByTestId('bank-validation-status')).toContainText('ผ่านการตรวจสอบ');
  await uploadGlFile(page, buildXlsxBuffer([GL_HEADERS, ...GL_ROWS]), 'gl.xlsx', XLSX_MIME);
  await expect(page.getByTestId('gl-validation-status')).toContainText('ผ่านการตรวจสอบ');
}

async function mapAllColumns(page: import('@playwright/test').Page) {
  await page.getByTestId('bank-mapping-transactionDate').selectOption('0');
  await page.getByTestId('bank-mapping-description').selectOption('1');
  await page.getByTestId('bank-mapping-moneyIn').selectOption('2');
  await page.getByTestId('bank-mapping-moneyOut').selectOption('3');
  await page.getByTestId('bank-mapping-balance').selectOption('4');
  await page.getByTestId('bank-mapping-accountNo').selectOption('5');
  await page.getByTestId('gl-mapping-date').selectOption('0');
  await page.getByTestId('gl-mapping-docNo').selectOption('1');
  await page.getByTestId('gl-mapping-description').selectOption('2');
  await page.getByTestId('gl-mapping-moneyIn').selectOption('3');
  await page.getByTestId('gl-mapping-moneyOut').selectOption('4');
  await page.getByTestId('gl-mapping-accountCode').selectOption('5');
}

test.describe('Bank Reconcile — อัปโหลดไฟล์', () => {
  test('เมนู Sidebar เปิดหน้ารายการก่อนเสมอ กด "สร้างรอบใหม่" แล้วเห็นการ์ดอัปโหลดทั้งสองใบ ปุ่มถัดไปปิดอยู่ตั้งแต่ต้น', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await page.getByTestId('nav-item-bank-reconcile').click();
    await expect(page.getByTestId('coming-soon')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Bank Reconcile' })).toBeVisible();
    await expect(page.getByTestId('bank-reconcile-session-list')).toBeVisible();

    await page.getByTestId('session-list-create-new').click();
    await expect(page.getByTestId('bank-upload-card')).toBeVisible();
    await expect(page.getByTestId('gl-upload-card')).toBeVisible();
    await expect(page.getByTestId('bank-helper-text')).toContainText('รองรับ Excel, CSV และ PDF');
    await expect(page.getByTestId('next-to-mapping')).toBeDisabled();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('รองรับ .xlsx/.csv/.pdf (text-based) — แสดงประเภทไฟล์/จำนวนแถว/ผ่านการตรวจสอบถูกต้อง', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoBankReconcile(page);

    await uploadBankFile(page, buildXlsxBuffer([BANK_HEADERS, ...BANK_ROWS]), 'bank.xlsx', XLSX_MIME);
    await expect(page.getByTestId('bank-file-name')).toContainText('bank.xlsx');
    await expect(page.getByTestId('bank-file-type')).toContainText('Excel');
    await expect(page.getByTestId('bank-row-count')).toContainText('2 แถว');
    await expect(page.getByTestId('bank-validation-status')).toContainText('ผ่านการตรวจสอบ');

    const csvContent = 'Date,Description,MoneyIn,MoneyOut\n2026-07-05,CSV Income,900,0\n2026-07-06,CSV Payment,0,400';
    await uploadGlFile(page, buildCsvBuffer(csvContent), 'gl.csv', 'text/csv');
    await expect(page.getByTestId('gl-file-name')).toContainText('gl.csv');
    await expect(page.getByTestId('gl-file-type')).toContainText('CSV');
    await expect(page.getByTestId('gl-row-count')).toContainText('2 แถว');
    await expect(page.getByTestId('gl-validation-status')).toContainText('ผ่านการตรวจสอบ');
    await expect(page.getByTestId('next-to-mapping')).toBeEnabled();

    // แทนที่ไฟล์ GL ด้วย PDF ที่มี text layer จริง — ต้องอ่านได้ถูกต้องเช่นกัน (ไม่ใช่เอกสารสแกน)
    const pdfRows = [
      ['Date', 'Description', 'In', 'Out'],
      ['2026-07-07', 'PDF Income', '700', '0'],
      ['2026-07-08', 'PDF Payment', '0', '300'],
    ];
    await uploadGlFile(page, buildTextPdfBuffer(pdfRows), 'gl.pdf', 'application/pdf');
    await expect(page.getByTestId('gl-file-type')).toContainText('PDF');
    await expect(page.getByTestId('gl-file-type')).toContainText('1 หน้า');
    await expect(page.getByTestId('gl-row-count')).toContainText('3 แถว'); // รวมแถวหัวตาราง PDF เองที่หลุดมาเป็นแถวข้อมูลด้วย
    await expect(page.getByTestId('gl-validation-status')).toContainText('ผ่านการตรวจสอบ');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ปฏิเสธนามสกุลไฟล์ที่ไม่รองรับ — แสดงข้อความ error ที่กำหนด และปุ่มถัดไปยังคง disabled', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoBankReconcile(page);

    await uploadBankFile(page, Buffer.from('not a real file'), 'bank.docx', 'application/octet-stream');
    await expect(page.getByTestId('bank-validation-status')).toContainText('ไฟล์ต้องเป็นนามสกุล .xlsx, .xls, .csv หรือ .pdf เท่านั้น');
    await expect(page.getByTestId('next-to-mapping')).toBeDisabled();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ไฟล์ว่างเปล่าไม่ผ่านการตรวจสอบ', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoBankReconcile(page);

    await uploadGlFile(page, buildXlsxBuffer([]), 'empty.xlsx', XLSX_MIME);
    await expect(page.getByTestId('gl-validation-status')).toContainText('ไฟล์นี้ว่างเปล่า ไม่มีข้อมูลใดๆ');
    await expect(page.getByTestId('next-to-mapping')).toBeDisabled();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('PDF เอกสารสแกน (ไม่มี text layer) แสดงคำเตือนตามสเปกเป๊ะ และบล็อกไม่ให้ไปขั้นตอนถัดไป', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoBankReconcile(page);

    await uploadBankFile(page, buildScannedPdfBuffer(), 'scanned-statement.pdf', 'application/pdf');
    await expect(page.getByTestId('bank-validation-status')).toContainText(
      'ไฟล์ PDF นี้เป็นเอกสารสแกน ระบบไม่สามารถอ่านข้อมูลได้อย่างแม่นยำ กรุณาใช้ Excel, CSV หรือ PDF ที่สามารถเลือกข้อความได้'
    );

    // แม้ไฟล์ GL จะถูกต้องสมบูรณ์ ปุ่มถัดไปก็ยังต้อง disabled เพราะฝั่ง Bank ยังไม่ผ่านการตรวจสอบ
    await uploadGlFile(page, buildXlsxBuffer([GL_HEADERS, ...GL_ROWS]), 'gl.xlsx', XLSX_MIME);
    await expect(page.getByTestId('gl-validation-status')).toContainText('ผ่านการตรวจสอบ');
    await expect(page.getByTestId('next-to-mapping')).toBeDisabled();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('"ล้างไฟล์" รีเซ็ตทั้งสองการ์ด และ "กลับไปหน้ารายการ" ออกจากขั้นตอนอัปโหลดพร้อมล้างไฟล์', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoBankReconcile(page);

    await uploadValidBankAndGl(page);
    await expect(page.getByTestId('next-to-mapping')).toBeEnabled();

    await page.getByTestId('clear-files').click();
    await expect(page.getByTestId('bank-file-name')).toHaveCount(0);
    await expect(page.getByTestId('gl-file-name')).toHaveCount(0);
    await expect(page.getByTestId('next-to-mapping')).toBeDisabled();

    await uploadValidBankAndGl(page);
    await page.getByTestId('upload-back-to-list').click();
    await expect(page.getByTestId('bank-reconcile-session-list')).toBeVisible();

    // กลับเข้ามาใหม่ต้องเริ่มต้นจากไฟล์ว่างเปล่าเสมอ (handleBackToListFromUpload ล้าง state ไฟล์ทิ้ง)
    await page.getByTestId('session-list-create-new').click();
    await expect(page.getByTestId('bank-file-name')).toHaveCount(0);
    await expect(page.getByTestId('next-to-mapping')).toBeDisabled();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });
});

test.describe('Bank Reconcile — จับคู่คอลัมน์', () => {
  test('บังคับจับคู่ครบ 4 ฟิลด์ทั้งสองฝั่งก่อนไปขั้นตอนถัดไปได้ — ฝั่ง GL ใช้คำว่า "ฝั่งรับเงิน/ฝั่งจ่ายเงิน" ไม่ใช่เดบิต/เครดิต', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoBankReconcile(page);
    await uploadValidBankAndGl(page);
    await page.getByTestId('next-to-mapping').click();
    await expect(page.getByTestId('bank-reconcile-mapping-step')).toBeVisible();

    // ยืนยันคำศัพท์ GL — ต้องไม่มีคำว่า "เดบิต"/"เครดิต" ปรากฏในหน้านี้เลย (เปลี่ยนเป็นฝั่งรับเงิน/จ่ายเงินที่ผู้ใช้ระบุเอง)
    const glMoneyInLabel = page.locator('label').filter({ has: page.getByTestId('gl-mapping-moneyIn') });
    const glMoneyOutLabel = page.locator('label').filter({ has: page.getByTestId('gl-mapping-moneyOut') });
    await expect(glMoneyInLabel).toContainText('ฝั่งรับเงิน');
    await expect(glMoneyOutLabel).toContainText('ฝั่งจ่ายเงิน');
    await expect(page.getByText('เดบิต')).toHaveCount(0);
    await expect(page.getByText('เครดิต')).toHaveCount(0);

    await expect(page.getByTestId('mapping-save')).toBeDisabled();

    // จับคู่ครบเฉพาะฝั่ง Bank ก่อน — ฝั่ง GL ยังไม่ครบ ปุ่มยังต้อง disabled
    await page.getByTestId('bank-mapping-transactionDate').selectOption('0');
    await page.getByTestId('bank-mapping-description').selectOption('1');
    await page.getByTestId('bank-mapping-moneyIn').selectOption('2');
    await page.getByTestId('bank-mapping-moneyOut').selectOption('3');
    await expect(page.getByTestId('mapping-save')).toBeDisabled();

    // ยอดคงเหลือ/เลขที่บัญชีเป็น optional — ไม่ต้องจับคู่ก็ไปต่อได้ ขอแค่ฝั่ง GL ครบ 4 ฟิลด์บังคับด้วย
    await page.getByTestId('gl-mapping-date').selectOption('0');
    await page.getByTestId('gl-mapping-description').selectOption('2');
    await page.getByTestId('gl-mapping-moneyIn').selectOption('3');
    await page.getByTestId('gl-mapping-moneyOut').selectOption('4');
    await expect(page.getByTestId('mapping-save')).toBeEnabled();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ตารางตัวอย่างแสดงประเภทรายการ/จำนวนเงิน/สถานะที่ resolve แล้วถูกต้อง รวมถึงแถวที่ผิดปกติ', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoBankReconcile(page);

    const bankRowsWithProblems = [
      ...BANK_ROWS,
      ['2026-07-03', 'แถวมีทั้งเข้าและออก', 500, 300, 3200, '111-1-11111-1'], // ambiguous
      ['2026-07-04', 'แถวไม่มีจำนวนเงิน', 0, 0, 3200, '111-1-11111-1'], // ไม่มีทิศทาง
    ];
    await uploadBankFile(page, buildXlsxBuffer([BANK_HEADERS, ...bankRowsWithProblems]), 'bank.xlsx', XLSX_MIME);
    await uploadGlFile(page, buildXlsxBuffer([GL_HEADERS, ...GL_ROWS]), 'gl.xlsx', XLSX_MIME);
    await page.getByTestId('next-to-mapping').click();
    await mapAllColumns(page);

    const row2 = page.getByTestId('bank-preview-row-2'); // แถวข้อมูลแรก = rowNumber 2 (แถว 1 คือ header)
    await expect(row2).toContainText('รับเงิน');
    await expect(row2).toContainText('1,000.00');
    await expect(row2).toContainText('ถูกต้อง');

    const row4 = page.getByTestId('bank-preview-row-4'); // แถว "มีทั้งเข้าและออก"
    await expect(row4).toContainText('พบทั้งเงินเข้าและเงินออกในแถวเดียวกัน กรุณาตรวจสอบ');

    const row5 = page.getByTestId('bank-preview-row-5'); // แถว "ไม่มีจำนวนเงิน"
    await expect(row5).toContainText('ไม่พบจำนวนเงินเข้าหรือเงินออกในแถวนี้');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('"ล้างการจับคู่คอลัมน์" รีเซ็ตทุกช่องกลับเป็น "- ไม่ระบุ -" และ "ย้อนกลับ" กลับไปขั้นตอนอัปโหลดโดยไม่ล้างไฟล์', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoBankReconcile(page);
    await uploadValidBankAndGl(page);
    await page.getByTestId('next-to-mapping').click();
    await mapAllColumns(page);
    await expect(page.getByTestId('mapping-save')).toBeEnabled();

    await page.getByTestId('mapping-clear').click();
    await expect(page.getByTestId('bank-mapping-transactionDate')).toHaveValue('');
    await expect(page.getByTestId('gl-mapping-moneyOut')).toHaveValue('');
    await expect(page.getByTestId('mapping-save')).toBeDisabled();

    await page.getByTestId('mapping-back').click();
    await expect(page.getByTestId('bank-file-name')).toContainText('bank.xlsx');
    await expect(page.getByTestId('gl-file-name')).toContainText('gl.xlsx');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });
});

test.describe('Bank Reconcile — ตรวจสอบข้อมูลก่อนกระทบยอด (Preview)', () => {
  async function reachPreview(page: import('@playwright/test').Page, bankRows: unknown[][] = BANK_ROWS) {
    await uploadBankFile(page, buildXlsxBuffer([BANK_HEADERS, ...bankRows]), 'bank.xlsx', XLSX_MIME);
    await uploadGlFile(page, buildXlsxBuffer([GL_HEADERS, ...GL_ROWS]), 'gl.xlsx', XLSX_MIME);
    await page.getByTestId('next-to-mapping').click();
    await mapAllColumns(page);
    await page.getByTestId('mapping-save').click();
    await expect(page.getByTestId('bank-reconcile-preview-step')).toBeVisible();
  }

  test('แสดงจำนวนแถวที่นำเข้ากระทบยอดถูกต้อง และปุ่ม "เริ่มกระทบยอด" เปิดใช้งานได้เมื่อทุกแถวถูกต้อง', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoBankReconcile(page);
    await reachPreview(page);

    await expect(page.getByTestId('bank-review-included-count')).toContainText('รวมทั้งหมด 2 แถว — นำเข้ากระทบยอด 2 แถว');
    await expect(page.getByTestId('gl-review-included-count')).toContainText('รวมทั้งหมด 2 แถว — นำเข้ากระทบยอด 2 แถว');
    await expect(page.getByTestId('preview-not-ready-message')).toHaveCount(0);
    await expect(page.getByTestId('preview-start-reconciliation')).toBeEnabled();

    await page.getByTestId('preview-start-reconciliation').click();
    await expect(page.getByTestId('bank-reconcile-results')).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('แถวไม่ถูกต้องบล็อกปุ่ม "เริ่มกระทบยอด" จนกว่าจะแก้ไขหรือยกเว้นแถวนั้นออก', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoBankReconcile(page);
    await reachPreview(page, [...BANK_ROWS, ['2026-07-03', 'แถวไม่มีจำนวนเงิน', 0, 0, 3200, '111-1-11111-1']]);

    await expect(page.getByTestId('preview-not-ready-message')).toBeVisible();
    await expect(page.getByTestId('preview-start-reconciliation')).toBeDisabled();
    await expect(page.getByTestId('bank-review-status-bank-4')).toContainText('ไม่ถูกต้อง');

    // ยกเว้นแถวที่ผิดพลาดออก — ปุ่มต้องเปิดใช้งานได้ทันที
    await page.getByTestId('bank-review-toggle-exclude-bank-4').click();
    await expect(page.getByTestId('bank-review-status-bank-4')).toContainText('ถูกยกเว้น');
    await expect(page.getByTestId('bank-review-included-count')).toContainText('นำเข้ากระทบยอด 2 แถว');
    await expect(page.getByTestId('preview-not-ready-message')).toHaveCount(0);
    await expect(page.getByTestId('preview-start-reconciliation')).toBeEnabled();

    // กู้คืนแถวกลับมา — ปุ่มต้องกลับไป disabled อีกครั้ง
    await page.getByTestId('bank-review-toggle-exclude-bank-4').click();
    await expect(page.getByTestId('bank-review-status-bank-4')).toContainText('ไม่ถูกต้อง');
    await expect(page.getByTestId('preview-start-reconciliation')).toBeDisabled();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('แก้ไขแถวผ่าน dialog แก้ไข — เปลี่ยนประเภทรายการ/จำนวนเงินแล้วสถานะกลับมาถูกต้อง และปิดโดยไม่บันทึกไม่มีผลใดๆ', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoBankReconcile(page);
    await reachPreview(page, [...BANK_ROWS, ['2026-07-03', 'แถวไม่มีจำนวนเงิน', 0, 0, 3200, '111-1-11111-1']]);

    await page.getByTestId('bank-review-edit-bank-4').click();
    await expect(page.getByTestId('edit-bank-row-dialog')).toBeVisible();
    await page.getByTestId('edit-bank-row-direction').selectOption('income');
    await page.getByTestId('edit-bank-row-amount').fill('750');
    await page.getByTestId('edit-bank-row-description').fill('แก้ไขแล้ว');
    await page.getByTestId('edit-bank-row-save').click();
    await expect(page.getByTestId('edit-bank-row-dialog')).toHaveCount(0);

    await expect(page.getByTestId('bank-review-status-bank-4')).toContainText('ถูกต้อง');
    await expect(page.getByTestId('bank-review-amount-bank-4')).toContainText('750.00');
    await expect(page.getByTestId('bank-review-row-bank-4')).toContainText('แก้ไขแล้ว');
    await expect(page.getByTestId('preview-start-reconciliation')).toBeEnabled();

    // ปิดด้วยปุ่ม X โดยไม่กด "บันทึก" — ต้องไม่มีผลใดๆ ต่อข้อมูล
    await page.getByTestId('gl-review-edit-gl-2').click();
    await expect(page.getByTestId('edit-gl-row-dialog')).toBeVisible();
    await page.getByTestId('edit-gl-row-doc-no').fill('ไม่ควรถูกบันทึก');
    await page.getByTestId('edit-gl-row-close').click();
    await expect(page.getByTestId('edit-gl-row-dialog')).toHaveCount(0);
    await expect(page.getByTestId('gl-review-row-gl-2')).not.toContainText('ไม่ควรถูกบันทึก');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('"ย้อนกลับ" กลับไปขั้นตอนจับคู่คอลัมน์', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoBankReconcile(page);
    await reachPreview(page);

    await page.getByTestId('preview-back').click();
    await expect(page.getByTestId('bank-reconcile-mapping-step')).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });
});
