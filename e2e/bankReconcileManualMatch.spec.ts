import { test, expect } from '@playwright/test';
import * as XLSX from 'xlsx';
import { attachConsoleErrorCollector, attachDialogGuard, gotoBankReconcile, setupMockSupabase } from './helpers';

const OWNER = 'user@example.com';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function buildXlsxBuffer(rows: unknown[][]): Buffer {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
}

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

// ชุดข้อมูลหลักที่ใช้ในเทสต์เกือบทั้งหมดของไฟล์นี้ — ออกแบบให้ไม่มียอดเงินชนกันโดยไม่ตั้งใจ (ตรวจสอบครบทุกคู่
// แล้ว) ครอบคลุมทุกสถานะและทุก flow ของเฟส 3 ในชุดเดียว:
//   bank-2  15/07 เข้า 1,000.00   -> gl-2  15/07 JV-001 เดบิต 1,000.00  = matched_exact (baseline ไม่แตะ)
//   bank-3  16/07 ออก   500.00   -> gl-3  17/07 JV-002 เครดิต 500.00   = matched_tolerance (1 วัน, ทดสอบ "ยืนยันว่าตรงกัน")
//   bank-4  20/07 เข้า 2,000.00   -> gl-4  19/07 JV-005 เดบิต 2,000.00  \_ ambiguous (ผู้สมัคร 2 ราย เท่ากันทั้งคู่
//                                    gl-5  21/07 JV-006 เดบิต 2,000.00  /  ทดสอบ "เลือกรายการ GL" + "บล็อก GL ที่ใช้แล้ว")
//   bank-5  22/07 ออก   300.00   -> gl-6  01/07 JV-007 เครดิต 300.00   = pending_review (21 วัน เกิน tolerance)
//   bank-6  23/07 เข้า   750.00   -> (ไม่มี GL ตรงเลย) = not_found_in_gl (ใช้เปิด Drawer ดูว่า GL ที่ถูกใช้แล้วถูกบล็อก)
//   bank-7  10/07 เข้า 10,700.00  -> gl-7 10/07 JV-008 เดบิต 10,000.00  \_ ไม่มี GL ตรงยอดเป๊ะ = not_found_in_gl
//                                    gl-8 10/07 JV-009 เดบิต    700.00  /  (ทดสอบ "1 Bank ต่อหลาย GL": 10,000+700=10,700)
//   bank-8  11/07 เข้า 3,200.00 \  -> gl-9 11/07 JV-010 เดบิต 5,000.00  (ทดสอบ "หลาย Bank ต่อ 1 GL": 3,200+1,800=5,000)
//   bank-9  11/07 เข้า 1,800.00 /
//   bank-10 12/07 เข้า 3,000.00   -> gl-10 12/07 JV-011 เดบิต 2,999.50  = not_found_in_gl (ผลต่าง 0.50 พอดี ทดสอบค่าคลาดเคลื่อน)
const BANK_ROWS = [
  ['วันที่รายการ', 'รายละเอียด', 'เงินเข้า', 'เงินออก', 'ยอดคงเหลือ'],
  ['15/07/2026', 'รับโอนจากลูกค้า A', '1000', '', '5000'],
  ['16/07/2026', 'จ่ายค่าเช่า', '', '500', '4500'],
  ['20/07/2026', 'โอนเงินไม่ทราบสาเหตุ', '2000', '', '6500'],
  ['22/07/2026', 'ค่าธรรมเนียมธนาคาร', '', '300', '6200'],
  ['23/07/2026', 'โอนเงินทดสอบ', '750', '', '6950'],
  ['10/07/2026', 'รับโอนยอดใหญ่', '10700', '', '17650'],
  ['11/07/2026', 'โอนเงินย่อย 1', '3200', '', '20850'],
  ['11/07/2026', 'โอนเงินย่อย 2', '1800', '', '22650'],
  ['12/07/2026', 'ทดสอบผลต่างในค่าคลาดเคลื่อน', '3000', '', '25650'],
];

const GL_ROWS = [
  ['วันที่', 'เลขที่เอกสาร', 'รายละเอียด', 'เดบิต', 'เครดิต'],
  ['15/07/2026', 'JV-001', 'รับชำระจากลูกค้า A', '1000', ''],
  ['17/07/2026', 'JV-002', 'จ่ายค่าเช่าสำนักงาน', '', '500'],
  ['19/07/2026', 'JV-005', 'รายการที่คาดว่าเกี่ยวข้อง 1', '2000', ''],
  ['21/07/2026', 'JV-006', 'รายการที่คาดว่าเกี่ยวข้อง 2', '2000', ''],
  ['01/07/2026', 'JV-007', 'ค่าธรรมเนียมเดือนก่อน', '', '300'],
  ['10/07/2026', 'JV-008', 'รายการยอดใหญ่ 1', '10000', ''],
  ['10/07/2026', 'JV-009', 'รายการยอดใหญ่ 2', '700', ''],
  ['11/07/2026', 'JV-010', 'รวมยอดย่อย', '5000', ''],
  ['12/07/2026', 'JV-011', 'รายการใกล้เคียง', '2999.50', ''],
];

async function setupManualMatchResults(page: import('@playwright/test').Page) {
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
  await page.getByTestId('mapping-save').click();
  await expect(page.getByTestId('reconcile-results')).toBeVisible();
}

test.describe('Bank Reconcile (เฟส 3: เครื่องมือจับคู่รายการด้วยตนเอง)', () => {
  test('1/14. ยืนยันรายการที่ระบบแนะนำ (matched_tolerance และ pending_review) + Segmented Control นับถูกต้อง', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    const dialogs = attachDialogGuard(page);
    await setupManualMatchResults(page);

    // ก่อนยืนยัน — น่าจะตรงกัน 1 ราย (bank-3), ยืนยันด้วยตนเอง 0 ราย
    await expect(page.getByTestId('reconcile-tab-matched_tolerance')).toContainText('น่าจะตรงกัน (1)');
    await expect(page.getByTestId('reconcile-tab-confirmed')).toContainText('ยืนยันด้วยตนเอง (0)');

    // matched_tolerance: bank-3 น่าจะตรงกับ gl-3 (JV-002) อยู่แล้ว
    await page.getByTestId('reconcile-confirm-suggested-bank-3').click();
    await expect(page.getByTestId('confirm-suggested-dialog')).toBeVisible();
    await expect(page.getByTestId('confirm-suggested-dialog')).toContainText('JV-002');
    await expect(page.getByTestId('confirm-suggested-dialog')).toContainText('น่าจะตรงกัน');
    await page.getByTestId('confirm-suggested-note-input').fill('ตรวจสอบแล้วถูกต้อง');
    await page.getByTestId('confirm-suggested-confirm').click();
    await expect(page.getByTestId('confirm-suggested-dialog')).toHaveCount(0);
    await expect(page.getByTestId('reconcile-status-bank-3')).toContainText('ยืนยันด้วยตนเอง');
    await expect(page.getByTestId('reconcile-view-group-bank-3')).toContainText('1 Bank : 1 GL');

    // pending_review: bank-5 ไม่มี matchedGL อัตโนมัติ (แค่ candidates) แต่ resolveSuggestedCandidate ต้องหา
    // gl-6 (JV-007) ให้ถูกต้องเช่นกัน
    await page.getByTestId('reconcile-confirm-suggested-bank-5').click();
    await expect(page.getByTestId('confirm-suggested-dialog')).toBeVisible();
    await expect(page.getByTestId('confirm-suggested-dialog')).toContainText('JV-007');
    await page.getByTestId('confirm-suggested-confirm').click();
    await expect(page.getByTestId('reconcile-status-bank-5')).toContainText('ยืนยันด้วยตนเอง');

    // หลังยืนยันทั้งสองแถว — ตัวนับต้องอัปเดตทันทีโดยไม่รีโหลดหน้า
    await expect(page.getByTestId('reconcile-tab-matched_tolerance')).toContainText('น่าจะตรงกัน (0)');
    await expect(page.getByTestId('reconcile-tab-pending_review')).toContainText('รอตรวจสอบ (0)');
    await expect(page.getByTestId('reconcile-tab-confirmed')).toContainText('ยืนยันด้วยตนเอง (2)');
    await expect(page.getByTestId('kpi-confirmed-manual-value')).toHaveText('2');

    expect(dialogs, `ห้ามมี native dialog เกิดขึ้นเลย: ${dialogs.join(', ')}`).toEqual([]);
    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('2/3. เลือกรายการ GL ด้วยตนเอง (ambiguous) และบล็อกรายการ GL ที่ถูกใช้ไปแล้ว', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    const dialogs = attachDialogGuard(page);
    await setupManualMatchResults(page);

    await expect(page.getByTestId('reconcile-status-bank-4')).toContainText('พบหลายรายการที่อาจตรงกัน');
    await page.getByTestId('reconcile-select-gl-bank-4').click();
    await expect(page.getByTestId('match-drawer')).toBeVisible();
    await expect(page.getByTestId('match-drawer-candidate-gl-4')).toContainText('JV-005');
    await expect(page.getByTestId('match-drawer-candidate-gl-5')).toContainText('JV-006');

    // ยังไม่เลือกอะไรเลย -> ปุ่มยืนยันต้องปิดใช้งาน
    await expect(page.getByTestId('match-drawer-confirm')).toBeDisabled();

    await page.getByTestId('match-drawer-candidate-checkbox-gl-4').check();
    await expect(page.getByTestId('match-drawer-summary')).toContainText('0.00 บาท');
    await expect(page.getByTestId('match-drawer-confirm')).toBeEnabled();
    await page.getByTestId('match-drawer-confirm').click();
    await expect(page.getByTestId('match-drawer')).toHaveCount(0);
    await expect(page.getByTestId('reconcile-status-bank-4')).toContainText('ยืนยันด้วยตนเอง');

    // เปิด Drawer ของแถวอื่น (not_found_in_gl) แล้วต้องเห็น JV-005 ถูกบล็อกไว้แล้ว (checkbox disabled + tooltip)
    // ส่วน JV-006 (ผู้สมัครอีกรายที่ยังไม่ถูกใช้) ต้องยังเลือกได้ตามปกติ
    await page.getByTestId('reconcile-select-gl-bank-6').click();
    await expect(page.getByTestId('match-drawer')).toBeVisible();
    await expect(page.getByTestId('match-drawer-candidate-checkbox-gl-4')).toBeDisabled();
    await expect(page.getByTestId('match-drawer-candidate-gl-4')).toHaveAttribute(
      'title',
      'รายการนี้ถูกใช้ในการจับคู่อื่นแล้ว'
    );
    await expect(page.getByTestId('match-drawer-candidate-checkbox-gl-5')).toBeEnabled();
    await page.getByTestId('match-drawer-close').click();
    await expect(page.getByTestId('match-drawer')).toHaveCount(0);

    expect(dialogs, `ห้ามมี native dialog เกิดขึ้นเลย: ${dialogs.join(', ')}`).toEqual([]);
    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('4/6. จับคู่ 1 Bank กับหลาย GL (one-to-many) — ยอดรวมตรงเป๊ะ', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    const dialogs = attachDialogGuard(page);
    await setupManualMatchResults(page);

    await expect(page.getByTestId('reconcile-status-bank-7')).toContainText('ไม่พบใน GL');
    await page.getByTestId('reconcile-select-gl-bank-7').click();
    await expect(page.getByTestId('match-drawer')).toBeVisible();
    await expect(page.getByTestId('match-drawer-bank-total')).toContainText('10,700.00');

    await page.getByTestId('match-drawer-candidate-checkbox-gl-7').check();
    await page.getByTestId('match-drawer-candidate-checkbox-gl-8').check();

    await expect(page.getByTestId('match-drawer-summary')).toContainText('2 รายการ');
    await expect(page.getByTestId('match-drawer-summary')).toContainText('10,700.00');
    await expect(page.getByTestId('match-drawer-summary')).toContainText('0.00 บาท');
    await expect(page.getByTestId('match-drawer-live-status')).toContainText('ยืนยันด้วยตนเอง');
    await expect(page.getByTestId('match-drawer-confirm')).toHaveText('ยืนยันการจับคู่');

    await page.getByTestId('match-drawer-confirm').click();
    await expect(page.getByTestId('match-drawer')).toHaveCount(0);
    await expect(page.getByTestId('reconcile-status-bank-7')).toContainText('ยืนยันด้วยตนเอง');
    await expect(page.getByTestId('reconcile-view-group-bank-7')).toContainText('1 Bank : 2 GL');

    expect(dialogs, `ห้ามมี native dialog เกิดขึ้นเลย: ${dialogs.join(', ')}`).toEqual([]);
    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('5. จับคู่หลาย Bank กับ 1 GL (many-to-one)', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    const dialogs = attachDialogGuard(page);
    await setupManualMatchResults(page);

    await page.getByTestId('reconcile-select-bank-8').check();
    await page.getByTestId('reconcile-select-bank-9').check();
    await expect(page.getByTestId('reconcile-combine-bar')).toContainText('เลือกไว้ 2 รายการ');

    await page.getByTestId('reconcile-combine-confirm').click();
    await expect(page.getByTestId('match-drawer')).toBeVisible();
    await expect(page.getByTestId('match-drawer')).toContainText('รวมรายการ Bank เพื่อจับคู่กับ GL');
    await expect(page.getByTestId('match-drawer-bank-total')).toContainText('5,000.00');

    await page.getByTestId('match-drawer-candidate-checkbox-gl-9').check();
    await expect(page.getByTestId('match-drawer-summary')).toContainText('0.00 บาท');
    await page.getByTestId('match-drawer-confirm').click();
    await expect(page.getByTestId('match-drawer')).toHaveCount(0);

    // ทั้งสองแถว Bank ต้องกลายเป็นกลุ่มเดียวกัน (group id เดียวกัน) และเลิกเลือกไว้แล้วอัตโนมัติ
    await expect(page.getByTestId('reconcile-status-bank-8')).toContainText('ยืนยันด้วยตนเอง');
    await expect(page.getByTestId('reconcile-status-bank-9')).toContainText('ยืนยันด้วยตนเอง');
    await expect(page.getByTestId('reconcile-view-group-bank-8')).toContainText('2 Bank : 1 GL');
    await expect(page.getByTestId('reconcile-view-group-bank-9')).toContainText('2 Bank : 1 GL');
    await expect(page.getByTestId('reconcile-combine-bar')).toHaveCount(0);

    expect(dialogs, `ห้ามมี native dialog เกิดขึ้นเลย: ${dialogs.join(', ')}`).toEqual([]);
    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('7/8/9. ค่าคลาดเคลื่อนของยอดเงิน — ภายในค่าคลาดเคลื่อนยืนยันได้ปกติ / เกินค่าคลาดเคลื่อนต้องมีหมายเหตุ', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    const dialogs = attachDialogGuard(page);
    await setupManualMatchResults(page);

    // ตั้งค่าคลาดเคลื่อนเป็น 1.00 -> ผลต่าง 0.50 (3000 vs 2999.50) ต้องอยู่ "ภายในค่าคลาดเคลื่อน" ยืนยันได้ปกติ
    await page.getByTestId('amount-tolerance-select').selectOption('one');
    await page.getByTestId('reconcile-select-gl-bank-10').click();
    await page.getByTestId('match-drawer-candidate-checkbox-gl-10').check();
    await expect(page.getByTestId('match-drawer-live-status')).toContainText('ตรงกันภายในค่าคลาดเคลื่อน');
    await expect(page.getByTestId('match-drawer-confirm')).toHaveText('ยืนยันการจับคู่');
    await expect(page.getByTestId('match-drawer-confirm')).toBeEnabled(); // ไม่บังคับหมายเหตุ
    await page.getByTestId('match-drawer-confirm').click();
    await expect(page.getByTestId('match-drawer')).toHaveCount(0);
    await expect(page.getByTestId('reconcile-status-bank-10')).toContainText('ตรงกันภายในค่าคลาดเคลื่อน');

    expect(dialogs, `ห้ามมี native dialog เกิดขึ้นเลย: ${dialogs.join(', ')}`).toEqual([]);
    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('8/9. ผลต่างเกินค่าคลาดเคลื่อน (ค่าเริ่มต้น 0.00) ต้องขึ้น "ยืนยันแบบมีผลต่าง" และบังคับกรอกหมายเหตุ', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    const dialogs = attachDialogGuard(page);
    await setupManualMatchResults(page);

    // ค่าคลาดเคลื่อนค่าเริ่มต้น 0.00 -> ผลต่าง 0.50 เกินทันที
    await expect(page.getByTestId('amount-tolerance-select')).toHaveValue('zero');
    await page.getByTestId('reconcile-select-gl-bank-10').click();
    await page.getByTestId('match-drawer-candidate-checkbox-gl-10').check();
    await expect(page.getByTestId('match-drawer-live-status')).toContainText('ยืนยันแบบมีผลต่าง');
    await expect(page.getByTestId('match-drawer-confirm')).toHaveText('ยืนยันแบบมีผลต่าง');

    // ยังไม่กรอกหมายเหตุ -> ต้องเห็น error ในตัว Drawer เอง (ไม่ใช่ alert) และปุ่มยืนยันต้องปิดใช้งานอยู่
    await expect(page.getByTestId('match-drawer-errors')).toBeVisible();
    await expect(page.getByTestId('match-drawer-errors')).toContainText('หมายเหตุ');
    await expect(page.getByTestId('match-drawer-confirm')).toBeDisabled();

    await page.getByTestId('match-drawer-note-input').fill('ยอมรับผลต่างจากค่าธรรมเนียมปัดเศษ');
    await expect(page.getByTestId('match-drawer-errors')).toHaveCount(0);
    await expect(page.getByTestId('match-drawer-confirm')).toBeEnabled();
    await page.getByTestId('match-drawer-confirm').click();
    await expect(page.getByTestId('match-drawer')).toHaveCount(0);
    await expect(page.getByTestId('reconcile-status-bank-10')).toContainText('ยืนยันแบบมีผลต่าง');

    expect(dialogs, `ห้ามมี native dialog เกิดขึ้นเลย: ${dialogs.join(', ')}`).toEqual([]);
    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('10/15/17. ยกเลิกการจับคู่แบบ 1:1 -> GL กลับมาใช้ได้อีก และค่าที่นำเข้าต้นฉบับไม่ถูกแก้ไข', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    const dialogs = attachDialogGuard(page);
    await setupManualMatchResults(page);

    const originalAmountText = await page.getByTestId('reconcile-bank-amount-bank-3').textContent();
    const originalDateText = await page.locator('[data-testid="reconcile-row-bank-3"] td').nth(2).textContent();

    await page.getByTestId('reconcile-confirm-suggested-bank-3').click();
    await page.getByTestId('confirm-suggested-confirm').click();
    await expect(page.getByTestId('reconcile-status-bank-3')).toContainText('ยืนยันด้วยตนเอง');

    // ค่า Bank ต้นฉบับต้องไม่เปลี่ยนแม้จับคู่ไปแล้ว (เก็บความสัมพันธ์แยกต่างหาก ไม่แก้ไขข้อมูลเดิม)
    await expect(page.getByTestId('reconcile-bank-amount-bank-3')).toHaveText(originalAmountText ?? '');

    await page.getByTestId('reconcile-undo-match-bank-3').click();
    await expect(page.getByTestId('undo-match-dialog')).toBeVisible();
    await expect(page.getByTestId('undo-match-dialog')).toContainText('JV-002');
    await page.getByTestId('undo-match-confirm').click();
    await expect(page.getByTestId('undo-match-dialog')).toHaveCount(0);

    // ยกเลิกแล้ว -> ต้องกลับไปเป็น "น่าจะตรงกัน" อัตโนมัติเหมือนเดิมทุกประการ (GL กลับมาใช้ได้อีก)
    await expect(page.getByTestId('reconcile-status-bank-3')).toContainText('น่าจะตรงกัน');
    await expect(page.getByTestId('reconcile-view-group-bank-3')).toHaveCount(0);

    // ยืนยันอีกครั้งว่าค่าที่นำเข้าต้นฉบับ (ยอดเงิน/วันที่) ยังคงเดิมทุกประการหลังผ่านรอบจับคู่+ยกเลิกเต็มรอบ
    await expect(page.getByTestId('reconcile-bank-amount-bank-3')).toHaveText(originalAmountText ?? '');
    const dateAfterUndo = await page.locator('[data-testid="reconcile-row-bank-3"] td').nth(2).textContent();
    expect(dateAfterUndo).toBe(originalDateText);

    expect(dialogs, `ห้ามมี native dialog เกิดขึ้นเลย: ${dialogs.join(', ')}`).toEqual([]);
    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('11/16. ยกเลิกการจับคู่แบบกลุ่ม + Group Detail Drawer แสดงข้อมูลถูกต้อง', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    const dialogs = attachDialogGuard(page);
    await setupManualMatchResults(page);

    await page.getByTestId('reconcile-select-gl-bank-7').click();
    await page.getByTestId('match-drawer-candidate-checkbox-gl-7').check();
    await page.getByTestId('match-drawer-candidate-checkbox-gl-8').check();
    await page.getByTestId('match-drawer-confirm').click();

    await page.getByTestId('reconcile-view-group-bank-7').click();
    await expect(page.getByTestId('group-detail-drawer')).toBeVisible();
    await expect(page.getByTestId('group-detail-drawer')).toContainText('รับโอนยอดใหญ่');
    await expect(page.getByTestId('group-detail-drawer')).toContainText('JV-008');
    await expect(page.getByTestId('group-detail-drawer')).toContainText('JV-009');
    await expect(page.getByTestId('group-detail-drawer')).toContainText('10,700.00');
    await expect(page.getByTestId('group-detail-drawer')).toContainText('1 Bank ต่อหลาย GL');
    await expect(page.getByTestId('group-detail-drawer')).toContainText(OWNER);

    await page.getByTestId('group-detail-undo-match').click();
    await expect(page.getByTestId('group-detail-drawer')).toHaveCount(0);
    await expect(page.getByTestId('undo-match-dialog')).toBeVisible();
    await page.getByTestId('undo-match-confirm').click();

    await expect(page.getByTestId('reconcile-status-bank-7')).toContainText('ไม่พบใน GL');
    await expect(page.getByTestId('reconcile-view-group-bank-7')).toHaveCount(0);

    expect(dialogs, `ห้ามมี native dialog เกิดขึ้นเลย: ${dialogs.join(', ')}`).toEqual([]);
    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('12. ทำเครื่องหมาย "ต้องตรวจสอบ" (คนละแกนกับสถานะอัตโนมัติ)', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    const dialogs = attachDialogGuard(page);
    await setupManualMatchResults(page);

    await expect(page.getByTestId('reconcile-tab-review_required')).toContainText('ต้องตรวจสอบ (0)');

    await page.getByTestId('reconcile-mark-pending-bank-2').click();
    await expect(page.getByTestId('reconcile-flagged-bank-2')).toBeVisible();
    await expect(page.getByTestId('reconcile-flagged-bank-2')).toContainText('ต้องตรวจสอบ');
    // สถานะอัตโนมัติจริงต้องไม่เปลี่ยน (คนละแกนกัน)
    await expect(page.getByTestId('reconcile-status-bank-2')).toContainText('เรียบร้อย');
    await expect(page.getByTestId('reconcile-tab-review_required')).toContainText('ต้องตรวจสอบ (1)');

    await page.getByTestId('reconcile-tab-review_required').click();
    await expect(page.getByTestId('reconcile-row-bank-2')).toBeVisible();
    await expect(page.getByTestId('reconcile-row-bank-3')).toHaveCount(0);

    await page.getByTestId('reconcile-tab-all').click();
    await page.getByTestId('reconcile-mark-pending-bank-2').click();
    await expect(page.getByTestId('reconcile-flagged-bank-2')).toHaveCount(0);
    await expect(page.getByTestId('reconcile-tab-review_required')).toContainText('ต้องตรวจสอบ (0)');

    expect(dialogs, `ห้ามมี native dialog เกิดขึ้นเลย: ${dialogs.join(', ')}`).toEqual([]);
    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('13. เพิ่มและแก้ไขหมายเหตุของแถว', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    const dialogs = attachDialogGuard(page);
    await setupManualMatchResults(page);

    await page.getByTestId('reconcile-edit-note-bank-2').click();
    await expect(page.getByTestId('note-dialog')).toBeVisible();
    await expect(page.getByTestId('note-dialog')).toContainText('เพิ่มหมายเหตุ');
    await page.getByTestId('note-dialog-input').fill('หมายเหตุทดสอบ');
    await page.getByTestId('note-dialog-save').click();
    await expect(page.getByTestId('note-dialog')).toHaveCount(0);
    await expect(page.getByTestId('reconcile-edit-note-bank-2')).toHaveAttribute('title', 'หมายเหตุทดสอบ');

    // เปิดใหม่ต้องเห็นหมายเหตุเดิม + หัวข้อเปลี่ยนเป็น "แก้ไขหมายเหตุ"
    await page.getByTestId('reconcile-edit-note-bank-2').click();
    await expect(page.getByTestId('note-dialog')).toContainText('แก้ไขหมายเหตุ');
    await expect(page.getByTestId('note-dialog-input')).toHaveValue('หมายเหตุทดสอบ');
    await page.getByTestId('note-dialog-input').fill('หมายเหตุที่แก้ไขแล้ว');
    await page.getByTestId('note-dialog-save').click();
    await expect(page.getByTestId('reconcile-edit-note-bank-2')).toHaveAttribute('title', 'หมายเหตุที่แก้ไขแล้ว');

    expect(dialogs, `ห้ามมี native dialog เกิดขึ้นเลย: ${dialogs.join(', ')}`).toEqual([]);
    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('เฟส 2 เดิมยังทำงานถูกต้องทุกประการ (regression): ไม่มีการจับคู่ด้วยตนเองเลย', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupManualMatchResults(page);

    // ไม่แตะฟีเจอร์เฟส 3 เลยแม้แต่จุดเดียว -> ผลลัพธ์ต้องเหมือนเฟส 2 เป๊ะ (พิสูจน์ผ่าน unit test แล้วว่า
    // mergeManualMatches ที่ matchGroups ว่างเปล่าให้ผลตรงกับ runReconciliationMatch ทุกประการ)
    await expect(page.getByTestId('reconcile-status-bank-2')).toContainText('เรียบร้อย');
    await expect(page.getByTestId('reconcile-status-bank-3')).toContainText('น่าจะตรงกัน');
    await expect(page.getByTestId('reconcile-status-bank-4')).toContainText('พบหลายรายการที่อาจตรงกัน');
    await expect(page.getByTestId('reconcile-status-bank-5')).toContainText('รอตรวจสอบ');
    await expect(page.getByTestId('reconcile-status-bank-6')).toContainText('ไม่พบใน GL');
    await expect(page.getByTestId('kpi-total-bank-value')).toHaveText('9');
    await expect(page.getByTestId('kpi-matched-exact-value')).toHaveText('1');
    await expect(page.getByTestId('kpi-confirmed-manual-value')).toHaveText('0');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });
});
