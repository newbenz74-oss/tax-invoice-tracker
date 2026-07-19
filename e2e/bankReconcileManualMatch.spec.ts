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

async function uploadFiles(
  page: import('@playwright/test').Page,
  bankRows: Record<string, unknown>[],
  glRows: Record<string, unknown>[]
) {
  await page.getByTestId('bank-upload-input').setInputFiles({
    name: 'bank-statement.xlsx',
    mimeType: XLSX_MIME,
    buffer: buildWorkbookBuffer(bankRows),
  });
  await expect(page.getByTestId('bank-upload-success')).toBeVisible();
  await page.getByTestId('gl-upload-input').setInputFiles({
    name: 'gl.xlsx',
    mimeType: XLSX_MIME,
    buffer: buildWorkbookBuffer(glRows),
  });
  await expect(page.getByTestId('gl-upload-success')).toBeVisible();
  await page.getByTestId('check-data-button').click();
}

test.describe('Bank Reconcile — จับคู่เอง (checkbox + ยืนยันจับคู่)', () => {
  test('ติ๊กเลือกแล้วยืนยันจับคู่เองแบบ N:1 ได้ เมื่อยอดรวมเท่ากันและประเภทตรงกันเท่านั้น — badge แยกอัตโนมัติ/เอง ถูกต้อง', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    const dialogs = attachDialogGuard(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoBankReconcile(page);

    // B0/G0 จับคู่อัตโนมัติได้ (วันที่+จำนวนเงิน+ประเภทตรงกันเป๊ะ) — ใช้ตรวจสอบว่า badge "จับคู่อัตโนมัติ"
    // กับ "จับคู่เอง" อยู่ในตารางเดียวกันได้พร้อมกันหลังจากจับคู่เองสำเร็จด้านล่าง
    const BANK_ROWS = [
      { วันที่: '2026-07-01', รับ: 1000, จ่าย: '' }, // B0 → auto กับ G0
      { วันที่: '2026-07-01', รับ: '', จ่าย: 300 }, // B1
      { วันที่: '2026-07-02', รับ: '', จ่าย: 200 }, // B2 (B1+B2 = 500 = G1)
      { วันที่: '2026-07-03', รับ: 500, จ่าย: '' }, // B3 — จำนวนเงินตรงกับ G1 แต่ประเภทต่างกัน (รับ vs จ่าย)
    ];
    const GL_ROWS = [
      { 'เลขที่เอกสาร': 'DOC-000', วันที่: '2026-07-01', รับ: 1000, จ่าย: '' }, // G0 → auto กับ B0
      { 'เลขที่เอกสาร': 'DOC-001', วันที่: '2026-07-01', รับ: '', จ่าย: 500 }, // G1
      { 'เลขที่เอกสาร': 'DOC-002', วันที่: '2026-07-02', รับ: 999, จ่าย: '' }, // G2 — ไม่ถูกใช้เลย ต้องเหลือค้างไว้
    ];
    await uploadFiles(page, BANK_ROWS, GL_ROWS);

    // หลังตรวจสอบข้อมูล: กระทบยอดสำเร็จ 1 (auto B0↔G0), Bank ไม่สำเร็จ 3 (B1,B2,B3), GL ไม่สำเร็จ 2 (G1,G2)
    await expect(page.getByTestId('bank-reconcile-summary-matched-count')).toContainText('1');
    await expect(page.getByTestId('bank-unmatched-section').locator('tbody tr')).toHaveCount(3);
    await expect(page.getByTestId('gl-unmatched-section').locator('tbody tr')).toHaveCount(2);

    // แถวที่จับคู่อัตโนมัติต้องมี badge "จับคู่อัตโนมัติ" และไม่มีปุ่มขยาย (เพราะเป็น 1:1)
    const matchedSection = page.getByTestId('matched-section');
    await expect(matchedSection).toContainText('จับคู่อัตโนมัติ');
    await expect(matchedSection.locator('tbody tr')).toHaveCount(1);

    // toolbar แสดงอยู่แล้วตั้งแต่มีรายการไม่สำเร็จ แต่ปุ่มยืนยันยัง disable เพราะยังไม่ได้ติ๊กอะไรเลย
    const toolbar = page.getByTestId('manual-match-toolbar');
    await expect(toolbar).toBeVisible();
    await expect(page.getByTestId('manual-match-confirm-button')).toBeDisabled();
    await expect(page.getByTestId('manual-match-hint')).toContainText('Bank Statement');

    // หา id จริงของแต่ละแถวจาก data-testid ของ checkbox แต่ละแถว (ผูกกับ synthetic id ของ parse ไม่ใช่ค่าคงที่)
    async function rowCheckbox(testId: string, matchText: string) {
      const row = page.locator(`[data-testid^="${testId}-row-"]`).filter({ hasText: matchText });
      return row.locator('input[type="checkbox"]');
    }

    // ขั้นที่ 1: ติ๊ก B3 (รับ 500) + G1 (จ่าย 500) — ยอดรวมเท่ากันแต่ประเภทต่างกัน (รับ vs จ่าย) ต้อง disable
    // และ hint ต้องบอกเรื่องประเภทไม่ตรงกัน
    await (await rowCheckbox('bank-unmatched', '500.00')).check();
    await (await rowCheckbox('gl-unmatched', 'DOC-001')).check();
    await expect(page.getByTestId('manual-match-confirm-button')).toBeDisabled();
    await expect(page.getByTestId('manual-match-hint')).toContainText('รับกับรับ หรือจ่ายกับจ่าย');

    // ขั้นที่ 2: ยกเลิก B3 แล้วติ๊ก B1+B2 แทน (จ่าย 300 + จ่าย 200 = 500 = G1 ที่ติ๊กค้างไว้ ประเภทตรงกันหมด)
    await (await rowCheckbox('bank-unmatched', '500.00')).uncheck();
    await (await rowCheckbox('bank-unmatched', '300.00')).check();
    await (await rowCheckbox('bank-unmatched', '200.00')).check();
    await expect(page.getByTestId('manual-match-bank-total')).toContainText('500.00');
    await expect(page.getByTestId('manual-match-gl-total')).toContainText('500.00');
    await expect(page.getByTestId('manual-match-confirm-button')).toBeEnabled();
    await expect(page.getByTestId('manual-match-hint')).toContainText('พร้อมยืนยันจับคู่');

    await page.getByTestId('manual-match-confirm-button').click();

    // หลังยืนยัน: กระทบยอดสำเร็จเพิ่มเป็น 2 แถว (auto เดิม + manual ใหม่), Bank ไม่สำเร็จเหลือแค่ B3 (1
    // แถว), GL ไม่สำเร็จเหลือแค่ G2 (1 แถว) — B1/B2/G1 ถูกย้ายออกจากตารางไม่สำเร็จไปแล้ว
    await expect(matchedSection.locator('tbody tr')).toHaveCount(2);
    await expect(matchedSection).toContainText('จับคู่อัตโนมัติ');
    await expect(matchedSection).toContainText('จับคู่เอง');
    await expect(page.getByTestId('bank-unmatched-section').locator('tbody tr')).toHaveCount(1);
    await expect(page.getByTestId('bank-unmatched-section')).toContainText('500.00');
    await expect(page.getByTestId('gl-unmatched-section').locator('tbody tr')).toHaveCount(1);
    await expect(page.getByTestId('gl-unmatched-section')).toContainText('DOC-002');
    await expect(page.getByTestId('bank-reconcile-summary-matched-count')).toContainText('2');

    // แถวที่จับคู่เองแบบ N:1 (2 bank + 1 gl) ต้องมีปุ่มขยาย — คลิกแล้วเห็นรายละเอียดทั้ง 2 แถว Bank ข้างใน
    const manualRow = matchedSection.locator('tr', { hasText: 'จับคู่เอง' });
    const expandButton = manualRow.locator('[data-testid^="matched-row-expand-"]');
    await expect(expandButton).toBeVisible();
    await expandButton.click();
    const detailRow = matchedSection.locator('[data-testid^="matched-row-detail-"]');
    await expect(detailRow).toBeVisible();
    await expect(detailRow).toContainText('2 รายการ');
    await expect(detailRow).toContainText('300.00');
    await expect(detailRow).toContainText('200.00');

    expect(dialogs).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('เลือกทั้งหมดด้วย checkbox หัวตาราง และจับคู่เองแบบ 1:N พร้อมยอดรวมที่แม่นยำหลังปัดเศษทศนิยม', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoBankReconcile(page);

    // B1 (รับ 300) ไม่จับคู่อัตโนมัติกับใครเลย G1+G2 รวมกันได้ 300.00 พอดี แต่แยกกันคนละแถว (100.10 + 199.90
    // เป็นตัวเลขที่มีปัญหา floating point คลาสสิกใน JavaScript ถ้าไม่ปัดเศษให้ถูกต้อง)
    const BANK_ROWS = [{ วันที่: '2026-07-01', รับ: 300, จ่าย: '' }];
    const GL_ROWS = [
      { 'เลขที่เอกสาร': 'DOC-001', วันที่: '2026-07-01', รับ: 100.1, จ่าย: '' },
      { 'เลขที่เอกสาร': 'DOC-002', วันที่: '2026-07-01', รับ: 199.9, จ่าย: '' },
    ];
    await uploadFiles(page, BANK_ROWS, GL_ROWS);

    await expect(page.getByTestId('bank-reconcile-summary-matched-count')).toContainText('0');
    await expect(page.getByTestId('bank-unmatched-section').locator('tbody tr')).toHaveCount(1);
    await expect(page.getByTestId('gl-unmatched-section').locator('tbody tr')).toHaveCount(2);

    // ติ๊กฝั่ง Bank ด้วย checkbox หัวตาราง "เลือกทั้งหมด" (มีแถวเดียวพอดี)
    await page.getByTestId('bank-unmatched-select-all').check();
    // ติ๊กฝั่ง GL ด้วย checkbox หัวตาราง "เลือกทั้งหมด" เช่นกัน (เลือกทั้ง G1 และ G2 พร้อมกัน)
    await page.getByTestId('gl-unmatched-select-all').check();

    await expect(page.getByTestId('manual-match-bank-total')).toContainText('300.00');
    await expect(page.getByTestId('manual-match-gl-total')).toContainText('300.00');
    await expect(page.getByTestId('manual-match-difference')).toContainText('0.00');
    await expect(page.getByTestId('manual-match-confirm-button')).toBeEnabled();

    await page.getByTestId('manual-match-confirm-button').click();

    await expect(page.getByTestId('matched-section').locator('tbody tr')).toHaveCount(1);
    // ตาราง Bank/GL ไม่สำเร็จเหลือ 0 แถวพอดี — section wrapper ยังอยู่เสมอ แค่แสดง empty state แทนตาราง
    await expect(page.getByTestId('bank-unmatched-empty')).toBeVisible();
    await expect(page.getByTestId('gl-unmatched-empty')).toBeVisible();

    const expandButton = page.locator('[data-testid^="matched-row-expand-"]');
    await expect(expandButton).toBeVisible();
    await expandButton.click();
    const detailRow = page.locator('[data-testid^="matched-row-detail-"]');
    await expect(detailRow).toContainText('DOC-001');
    await expect(detailRow).toContainText('DOC-002');
    await expect(detailRow).toContainText('2 รายการ');

    expect(errors).toEqual([]);
  });
});
