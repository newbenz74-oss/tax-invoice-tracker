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

// ชุดข้อมูลหลักที่ใช้ในเทสต์ส่วนใหญ่ของไฟล์นี้:
// Bank แถว 1: 15/07/2026 เข้า 1,000.00 -> ตรงกับ GL แถว 1 เป๊ะทั้งยอดและวันที่ (matched_exact)
// Bank แถว 2: 16/07/2026 ออก 500.00   -> ตรงยอดกับ GL แถว 2 (17/07/2026) ต่างกัน 1 วัน อยู่ใน tolerance ±3
//                                        ค่าเริ่มต้น (matched_tolerance)
// Bank แถว 3: 20/07/2026 เข้า 2,000.00 -> ไม่มียอดเงินนี้ใน GL เลย (not_found_in_gl)
// GL แถว 3: 18/07/2026 JV-003 เครดิต 9,999.00 -> ไม่มี Bank แถวใดยอดตรงกัน เหลือค้างในส่วน "ไม่พบใน Bank"
const BANK_ROWS = [
  ['วันที่รายการ', 'รายละเอียด', 'เงินเข้า', 'เงินออก', 'ยอดคงเหลือ'],
  ['15/07/2026', 'รับโอนจากลูกค้า A', '1000', '', '5000'],
  ['16/07/2026', 'จ่ายค่าเช่า', '', '500', '4500'],
  ['20/07/2026', 'โอนเงินไม่ทราบสาเหตุ', '2000', '', '6500'],
];

const GL_ROWS = [
  ['วันที่', 'เลขที่เอกสาร', 'รายละเอียด', 'เดบิต', 'เครดิต'],
  ['15/07/2026', 'JV-001', 'รับชำระจากลูกค้า A', '1000', ''],
  ['17/07/2026', 'JV-002', 'จ่ายค่าเช่าสำนักงาน', '', '500'],
  ['18/07/2026', 'JV-003', 'รายการไม่ทราบที่มา', '', '9999'],
];

async function setupReconcileResults(page: import('@playwright/test').Page) {
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

test.describe('Bank Reconcile (เฟส 2: เครื่องมือจับคู่รายการ + ตารางผลลัพธ์)', () => {
  test('1/2/6. จับคู่อัตโนมัติถูกต้อง: ยอด+วันที่ตรงเป๊ะ, ยอดตรงวันต่างกัน 1 วันในช่วง tolerance, ไม่พบยอดใน GL', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupReconcileResults(page);

    await expect(page.getByTestId('reconcile-status-bank-2')).toContainText('เรียบร้อย');
    await expect(page.getByTestId('reconcile-status-bank-3')).toContainText('น่าจะตรงกัน');
    await expect(page.getByTestId('reconcile-status-bank-4')).toContainText('ไม่พบใน GL');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('17. KPI cards นับถูกต้องตามผลการจับคู่', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupReconcileResults(page);

    await expect(page.getByTestId('kpi-total-bank-value')).toHaveText('3');
    await expect(page.getByTestId('kpi-matched-exact-value')).toHaveText('1');
    await expect(page.getByTestId('kpi-matched-tolerance-value')).toHaveText('1');
    await expect(page.getByTestId('kpi-ambiguous-value')).toHaveText('0');
    await expect(page.getByTestId('kpi-pending-review-value')).toHaveText('0');
    await expect(page.getByTestId('kpi-not-found-gl-value')).toHaveText('1');
    await expect(page.getByTestId('kpi-not-found-bank-value')).toHaveText('1');
    // ผลต่างรวม = ยอด Bank ที่ยังไม่กระทบยอด (2,000 จากแถวที่ 3) + ยอด GL ที่เหลือค้าง (9,999 จาก JV-003)
    await expect(page.getByTestId('kpi-total-difference-value')).toHaveText('11,999.00');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('16. Segmented Control แสดงจำนวนถูกต้อง และกรองตารางได้โดยไม่รีโหลดหน้า', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupReconcileResults(page);

    await expect(page.getByTestId('reconcile-tab-all')).toContainText('ทั้งหมด (3)');
    await expect(page.getByTestId('reconcile-tab-matched_exact')).toContainText('เรียบร้อย (1)');
    await expect(page.getByTestId('reconcile-tab-not_found_in_gl')).toContainText('ไม่พบใน GL (1)');

    await page.getByTestId('reconcile-tab-matched_exact').click();
    await expect(page.getByTestId('reconcile-row-bank-2')).toBeVisible();
    await expect(page.getByTestId('reconcile-row-bank-3')).toHaveCount(0);
    await expect(page.getByTestId('reconcile-row-bank-4')).toHaveCount(0);
    // เปลี่ยนแท็บแล้ว URL ต้องไม่เปลี่ยน (กรองในหน้าเดิม ไม่รีโหลด)
    await expect(page).toHaveURL(/\/dashboard$/);

    // แท็บที่ไม่มีรายการเลย -> ต้องเห็น empty state ตามข้อความที่สเปกกำหนด
    await page.getByTestId('reconcile-tab-ambiguous').click();
    await expect(page.getByTestId('reconcile-table-empty')).toContainText('ไม่พบรายการในสถานะนี้');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('18. ค้นหาและตัวกรองทำงานถูกต้อง (รายละเอียด/ช่วงวันที่/ช่วงจำนวนเงิน)', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupReconcileResults(page);

    await page.getByTestId('reconcile-search-input').fill('เช่า');
    await page.getByTestId('reconcile-search-submit').click();
    await expect(page.getByTestId('reconcile-row-bank-3')).toBeVisible();
    await expect(page.getByTestId('reconcile-row-bank-2')).toHaveCount(0);
    await expect(page.getByTestId('reconcile-row-bank-4')).toHaveCount(0);

    await page.getByTestId('reconcile-clear-filters').click();
    await expect(page.getByTestId('reconcile-row-bank-2')).toBeVisible();

    // ตัวกรองช่วงจำนวนเงิน — เฉพาะแถวยอด 2,000 (bank-4) เท่านั้นที่อยู่ในช่วง 1,500-2,500
    await page.getByTestId('reconcile-amount-min').fill('1500');
    await page.getByTestId('reconcile-amount-max').fill('2500');
    await expect(page.getByTestId('reconcile-row-bank-4')).toBeVisible();
    await expect(page.getByTestId('reconcile-row-bank-2')).toHaveCount(0);
    await expect(page.getByTestId('reconcile-row-bank-3')).toHaveCount(0);

    await page.getByTestId('reconcile-clear-filters').click();

    // ตัวกรองช่วงวันที่ — เฉพาะ 16/07/2026 (bank-3)
    await page.getByTestId('reconcile-date-from').fill('2026-07-16');
    await page.getByTestId('reconcile-date-to').fill('2026-07-16');
    await expect(page.getByTestId('reconcile-row-bank-3')).toBeVisible();
    await expect(page.getByTestId('reconcile-row-bank-2')).toHaveCount(0);

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('15. เปลี่ยน Date Tolerance รันจับคู่ใหม่และรีเฟรชผลลัพธ์ทั้งหมดทันที', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupReconcileResults(page);

    // ค่าเริ่มต้น ±3 วัน — แถว 2 (ต่างกัน 1 วัน) ต้องเป็น "น่าจะตรงกัน"
    await expect(page.getByTestId('date-tolerance-select')).toHaveValue('3_days');
    await expect(page.getByTestId('reconcile-status-bank-3')).toContainText('น่าจะตรงกัน');
    await expect(page.getByTestId('kpi-matched-tolerance-value')).toHaveText('1');

    // เปลี่ยนเป็น "วันเดียวกันเท่านั้น" -> แถว 2 ต้องกลายเป็น "รอตรวจสอบ" ทันที (KPI/ตารางรีเฟรชตาม)
    await page.getByTestId('date-tolerance-select').selectOption('same_day');
    await expect(page.getByTestId('reconcile-status-bank-3')).toContainText('รอตรวจสอบ');
    await expect(page.getByTestId('kpi-matched-tolerance-value')).toHaveText('0');
    await expect(page.getByTestId('kpi-pending-review-value')).toHaveText('1');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('19. ส่วน "รายการใน GL ที่ไม่พบใน Bank Statement" แสดงถูกต้อง พับ/ขยายได้', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupReconcileResults(page);

    await expect(page.getByTestId('reconcile-unmatched-gl-count')).toContainText('1 รายการ');
    await expect(page.getByTestId('reconcile-unmatched-gl-total')).toContainText('9,999.00');
    await expect(page.getByTestId('reconcile-unmatched-gl-row-gl-4')).toContainText('JV-003');
    await expect(page.getByTestId('reconcile-unmatched-gl-row-gl-4')).toContainText('ไม่พบใน Bank');

    // พับเก็บ -> เนื้อหาตารางไม่ควรมองเห็น (grid-template-rows: 0fr ผ่าน .month-detail-panel)
    await page.getByTestId('reconcile-unmatched-gl-toggle').click();
    await expect(page.getByTestId('reconcile-unmatched-gl-toggle')).toHaveAttribute('aria-expanded', 'false');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('การจัดการรายรายการ: ดูรายละเอียด, ดูรายการที่อาจตรงกัน (อ่านอย่างเดียว), ทำเครื่องหมายรอตรวจสอบ', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupReconcileResults(page);

    // ดูรายละเอียด — ต้องเห็นข้อมูลเปรียบเทียบครบ (ยอด Bank/ยอด GL/ผลต่าง/สถานะ)
    await page.getByTestId('reconcile-view-detail-bank-2').click();
    await expect(page.getByTestId('reconcile-detail-modal')).toBeVisible();
    await expect(page.getByTestId('reconcile-detail-modal')).toContainText('เรียบร้อย');
    await expect(page.getByTestId('reconcile-detail-modal')).toContainText('JV-001');
    await page.getByTestId('reconcile-detail-close').click();
    await expect(page.getByTestId('reconcile-detail-modal')).toHaveCount(0);

    // ดูรายการที่อาจตรงกัน — อ่านอย่างเดียว ไม่มีปุ่มเลือก/ยืนยันใดๆ ภายใน Modal นี้ (ตรวจเฉพาะภายใน Modal เอง
    // ไม่ใช่ทั้งหน้า เพราะตั้งแต่เฟส 3 ตารางหลักที่ยังอยู่ข้างหลัง overlay มีปุ่ม "เลือกรายการ GL"/"ยืนยันว่า
    // ตรงกัน" ของแถวอื่นๆ อยู่แล้วโดยเจตนา — ไม่เกี่ยวกับ Modal อ่านอย่างเดียวนี้เลย)
    await page.getByTestId('reconcile-view-candidates-bank-2').click();
    await expect(page.getByTestId('reconcile-candidates-modal')).toBeVisible();
    await expect(page.getByTestId('reconcile-candidate-gl-2')).toBeVisible();
    await expect(
      page.getByTestId('reconcile-candidates-modal').getByRole('button', { name: /เลือก|ยืนยัน/ })
    ).toHaveCount(0);
    await page.getByTestId('reconcile-candidates-close').click();

    // ปุ่มนี้ต้องปิดใช้งานเมื่อไม่มีผู้สมัคร GL เลย (แถว not_found_in_gl)
    await expect(page.getByTestId('reconcile-view-candidates-bank-4')).toBeDisabled();

    // ทำเครื่องหมายรอตรวจสอบ — เป็นแค่การทำเครื่องหมายชั่วคราว ไม่เปลี่ยนสถานะที่คำนวณได้จริง
    await page.getByTestId('reconcile-mark-pending-bank-2').click();
    await expect(page.getByTestId('reconcile-flagged-bank-2')).toBeVisible();
    await expect(page.getByTestId('reconcile-status-bank-2')).toContainText('เรียบร้อย'); // สถานะจริงไม่เปลี่ยน
    await page.getByTestId('reconcile-mark-pending-bank-2').click();
    await expect(page.getByTestId('reconcile-flagged-bank-2')).toHaveCount(0);

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('5/8/9/10. ยอดเงินซ้ำกันหลายแถว (duplicate) ต้องพบหลายรายการที่อาจตรงกันเสมอ ไม่เลือกอัตโนมัติ ไม่ใช้ GL ซ้ำ', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoBankReconcile(page);

    const dupBank = [
      ['วันที่รายการ', 'รายละเอียด', 'เงินเข้า', 'เงินออก', 'ยอดคงเหลือ'],
      ['15/07/2026', 'โอนเงินรายการที่ 1', '1000', '', '1000'],
      ['15/07/2026', 'โอนเงินรายการที่ 2', '1000', '', '2000'],
    ];
    const dupGL = [
      ['วันที่', 'เลขที่เอกสาร', 'รายละเอียด', 'เดบิต', 'เครดิต'],
      ['15/07/2026', 'JV-101', 'รับชำระ 1', '1000', ''],
      ['15/07/2026', 'JV-102', 'รับชำระ 2', '1000', ''],
    ];

    await page.getByTestId('bank-file-input').setInputFiles({
      name: 'bank-dup.xlsx',
      mimeType: XLSX_MIME,
      buffer: buildXlsxBuffer(dupBank),
    });
    await page.getByTestId('gl-file-input').setInputFiles({
      name: 'gl-dup.xlsx',
      mimeType: XLSX_MIME,
      buffer: buildXlsxBuffer(dupGL),
    });
    await page.getByTestId('next-to-mapping').click();
    await mapAllColumns(page);
    await page.getByTestId('mapping-save').click();

    // ทั้งสองแถว Bank ต้องเป็น "พบหลายรายการที่อาจตรงกัน" (ไม่ deterministic เพราะยอด+วันที่เหมือนกันทุกประการ)
    await expect(page.getByTestId('reconcile-status-bank-2')).toContainText('พบหลายรายการที่อาจตรงกัน');
    await expect(page.getByTestId('reconcile-status-bank-3')).toContainText('พบหลายรายการที่อาจตรงกัน');
    await expect(page.getByTestId('kpi-ambiguous-value')).toHaveText('2');

    // ไม่มี GL แถวใดถูกใช้ไปเลย -> ทั้งสองแถวยังปรากฏในส่วน "ไม่พบใน Bank" รอตรวจสอบด้วยตนเอง
    await expect(page.getByTestId('reconcile-unmatched-gl-count')).toContainText('2 รายการ');

    // เปิด Modal ผู้สมัคร — ต้องเห็นทั้งสองแถว GL โดยไม่มีการเลือกอัตโนมัติ
    await page.getByTestId('reconcile-view-candidates-bank-2').click();
    await expect(page.getByTestId('reconcile-candidate-gl-2')).toBeVisible();
    await expect(page.getByTestId('reconcile-candidate-gl-3')).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ปุ่ม "กลับไปแก้ไขการจับคู่คอลัมน์" พาไปขั้นตอนจับคู่คอลัมน์ได้จริง (ไฟล์/การจับคู่เดิมยังอยู่ครบ)', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupReconcileResults(page);

    await page.getByTestId('done-back-to-mapping').click();
    await expect(page.getByTestId('bank-reconcile-mapping-step')).toBeVisible();
    await expect(page.getByTestId('mapping-save')).toBeEnabled(); // การจับคู่เดิมยังอยู่ครบ ไม่ต้องจับคู่ใหม่

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });
});
