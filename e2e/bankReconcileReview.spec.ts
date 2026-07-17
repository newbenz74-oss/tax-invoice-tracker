import { test, expect, type Page } from '@playwright/test';
import { attachConsoleErrorCollector, attachDialogGuard, gotoBankReconcileList, setupMockSupabase } from './helpers';

/**
 * e2e — Bank Reconcile: เวิร์กโฟลว์ตรวจสอบ (Review Workflow, สเปกส่วน "17. REVIEW WORKFLOW")
 * ไฟล์ใหม่ เพิ่มเข้ามา 2026-07-17 แทนที่ e2e/bankReconcileManualMatch.spec.ts เดิมที่ถูกลบทิ้ง (ทดสอบฟีเจอร์
 * "จับคู่ด้วยตนเอง" — one-to-many/many-to-one/ambiguous candidate selection/ยกเลิกการจับคู่/Group Detail Drawer
 * — ที่ถูกลบออกจากโมดูลทั้งหมดตามสเปก rebuild ไม่มีแนวคิดนี้หลงเหลืออยู่เลย) ไฟล์นี้ครอบคลุมสิ่งที่มาแทนที่:
 * ธงตรวจสอบอิสระ (needsGlEntry/needsGlReview + reviewed + หมายเหตุ) ของแถว "ไม่พบใน GL" (ฝั่ง Bank) และ "มีใน
 * GL แต่ไม่มีใน Bank" (ฝั่ง GL) — เน้นกลไก UI ล้วนๆ (toggle/dialog) ไม่ทับซ้อนกับ bankReconcileMatch.spec.ts
 * ที่ครอบคลุมเครื่องมือจับคู่/KPI/ตาราง/ตัวกรองไปแล้ว
 */

const OWNER = 'user@example.com';
const SESSION_ID = 'sess-review-1';

async function openReviewSession(page: Page) {
  await setupMockSupabase(page, {
    loggedInAs: OWNER,
    users: [{ email: OWNER, password: 'x' }],
    reconcileSessions: [
      { id: SESSION_ID, session_name: 'กระทบยอดสำหรับทดสอบตรวจสอบ', bank_file_name: 'bank.xlsx', gl_file_name: 'gl.xlsx', status: 'in_progress', created_by_email: OWNER },
    ],
    reconcileBankTransactions: [
      { id: 'bt-found', session_id: SESSION_ID, row_number: 1, transaction_date: '2026-07-01', description: 'รับชำระค่าสินค้า', direction: 'income', amount: 1000, money_in: 1000, money_out: 0 },
      { id: 'bt-nf', session_id: SESSION_ID, row_number: 2, transaction_date: '2026-07-02', description: 'จ่ายค่าไฟฟ้า', direction: 'payment', amount: 300, money_in: 0, money_out: 300 },
    ],
    reconcileGLTransactions: [
      { id: 'gt-found', session_id: SESSION_ID, row_number: 1, transaction_date: '2026-07-01', description: 'บันทึกรับชำระ', doc_no: 'DOC-1', direction: 'income', amount: 1000, money_in: 1000, money_out: 0 },
      { id: 'gt-only', session_id: SESSION_ID, row_number: 2, transaction_date: '2026-07-03', description: 'บันทึกค่าน้ำประปา', doc_no: 'DOC-2', direction: 'payment', amount: 500, money_in: 0, money_out: 500 },
    ],
  });
  await gotoBankReconcileList(page);
  await page.getByTestId(`session-open-${SESSION_ID}`).click();
  await expect(page.getByTestId('bank-reconcile-results')).toBeVisible();
}

test.describe('Bank Reconcile — เวิร์กโฟลว์ตรวจสอบ (แถวไม่พบใน GL)', () => {
  test('แถวที่พบใน GL แล้วไม่มีปุ่มจัดการใดๆ เลย — มีเฉพาะแถวไม่พบใน GL เท่านั้น', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await openReviewSession(page);

    await expect(page.getByTestId('reconcile-note-bt-found')).toHaveCount(0);
    await expect(page.getByTestId('reconcile-needs-gl-entry-bt-found')).toHaveCount(0);
    await expect(page.getByTestId('reconcile-reviewed-bt-found')).toHaveCount(0);
    await expect(page.getByTestId('reconcile-note-bt-nf')).toBeVisible();
    await expect(page.getByTestId('reconcile-needs-gl-entry-bt-nf')).toBeVisible();
    await expect(page.getByTestId('reconcile-reviewed-bt-nf')).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ทำเครื่องหมาย "ต้องบันทึก GL เพิ่ม" สลับเปิด/ปิดได้ แสดง/ซ่อนป้ายข้อความถูกต้อง', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await openReviewSession(page);

    await expect(page.getByTestId('reconcile-row-bt-nf')).not.toContainText('ต้องบันทึก GL เพิ่ม');
    await page.getByTestId('reconcile-needs-gl-entry-bt-nf').click();
    await expect(page.getByTestId('reconcile-row-bt-nf')).toContainText('ต้องบันทึก GL เพิ่ม');
    await page.getByTestId('reconcile-needs-gl-entry-bt-nf').click();
    await expect(page.getByTestId('reconcile-row-bt-nf')).not.toContainText('ต้องบันทึก GL เพิ่ม');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ทำเครื่องหมาย "ตรวจสอบแล้ว" สลับค่าได้จริง — ยืนยันผ่านตัวกรอง "การตรวจสอบ"', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await openReviewSession(page);

    await page.getByTestId('reconcile-filter-reviewed').selectOption('reviewed');
    await expect(page.getByTestId('reconcile-row-bt-nf')).toHaveCount(0); // ยังไม่ตรวจสอบ — ไม่ผ่านตัวกรอง "ตรวจสอบแล้ว"
    await page.getByTestId('reconcile-filter-reviewed').selectOption('all');

    await page.getByTestId('reconcile-reviewed-bt-nf').click();
    await page.getByTestId('reconcile-filter-reviewed').selectOption('reviewed');
    await expect(page.getByTestId('reconcile-row-bt-nf')).toBeVisible();
    await page.getByTestId('reconcile-filter-reviewed').selectOption('not_reviewed');
    await expect(page.getByTestId('reconcile-row-bt-nf')).toHaveCount(0);

    // สลับกลับ — ต้องหายไปจากตัวกรอง "ตรวจสอบแล้ว" อีกครั้ง
    await page.getByTestId('reconcile-filter-reviewed').selectOption('all');
    await page.getByTestId('reconcile-reviewed-bt-nf').click();
    await page.getByTestId('reconcile-filter-reviewed').selectOption('reviewed');
    await expect(page.getByTestId('reconcile-row-bt-nf')).toHaveCount(0);

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('หมายเหตุ: เปิด dialog เห็นรายละเอียดแถวถูกต้อง พิมพ์+บันทึกแล้วปรากฏในตาราง เปิดใหม่เห็นค่าที่บันทึกไว้', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    const dialogs = attachDialogGuard(page);
    await openReviewSession(page);

    await page.getByTestId('reconcile-note-bt-nf').click();
    await expect(page.getByTestId('note-dialog')).toBeVisible();
    await expect(page.getByTestId('note-dialog')).toContainText('เพิ่ม/แก้ไขหมายเหตุ');
    await expect(page.getByTestId('note-dialog')).toContainText('จ่ายค่าไฟฟ้า');
    await expect(page.getByTestId('note-dialog-input')).toHaveValue('');

    await page.getByTestId('note-dialog-input').fill('รอใบกำกับภาษีจากผู้ขาย');
    await page.getByTestId('note-dialog-save').click();
    await expect(page.getByTestId('note-dialog')).toHaveCount(0);
    await expect(page.getByTestId('reconcile-row-bt-nf')).toContainText('รอใบกำกับภาษีจากผู้ขาย');

    await page.getByTestId('reconcile-note-bt-nf').click();
    await expect(page.getByTestId('note-dialog-input')).toHaveValue('รอใบกำกับภาษีจากผู้ขาย');

    expect(dialogs, `ไม่ควรมี native dialog เกิดขึ้นเลย: ${dialogs.join(', ')}`).toEqual([]);
    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('หมายเหตุ: ยกเลิกหรือปิดด้วยปุ่ม X ไม่บันทึกการเปลี่ยนแปลงที่พิมพ์ไว้', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await openReviewSession(page);

    await page.getByTestId('reconcile-note-bt-nf').click();
    await page.getByTestId('note-dialog-input').fill('ข้อความที่จะยกเลิก');
    await page.getByTestId('note-dialog-cancel').click();
    await expect(page.getByTestId('note-dialog')).toHaveCount(0);
    await expect(page.getByTestId('reconcile-row-bt-nf')).not.toContainText('ข้อความที่จะยกเลิก');

    await page.getByTestId('reconcile-note-bt-nf').click();
    await expect(page.getByTestId('note-dialog-input')).toHaveValue(''); // ยืนยันว่าไม่มีอะไรถูกบันทึกค้างไว้จากรอบก่อน
    await page.getByTestId('note-dialog-input').fill('ข้อความที่จะปิดด้วย X');
    await page.getByTestId('note-dialog-close').click();
    await expect(page.getByTestId('note-dialog')).toHaveCount(0);
    await expect(page.getByTestId('reconcile-row-bt-nf')).not.toContainText('ข้อความที่จะปิดด้วย X');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ธงตรวจสอบทั้งสามอย่าง (ต้องบันทึก GL เพิ่ม/ตรวจสอบแล้ว/หมายเหตุ) เป็นอิสระต่อกัน ตั้งค่าหนึ่งไม่ล้างอีกค่าหนึ่งที่ตั้งไว้ก่อนแล้ว', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await openReviewSession(page);

    await page.getByTestId('reconcile-needs-gl-entry-bt-nf').click();
    await page.getByTestId('reconcile-reviewed-bt-nf').click();
    await page.getByTestId('reconcile-note-bt-nf').click();
    await page.getByTestId('note-dialog-input').fill('ตั้งค่าครบทั้งสามอย่าง');
    await page.getByTestId('note-dialog-save').click();

    const row = page.getByTestId('reconcile-row-bt-nf');
    await expect(row).toContainText('ต้องบันทึก GL เพิ่ม');
    await expect(row).toContainText('ตั้งค่าครบทั้งสามอย่าง');
    await page.getByTestId('reconcile-filter-reviewed').selectOption('reviewed');
    await expect(page.getByTestId('reconcile-row-bt-nf')).toBeVisible(); // reviewed ยังคงเป็น true อยู่ ไม่ถูกล้างโดยการตั้งค่าอื่น

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });
});

test.describe('Bank Reconcile — เวิร์กโฟลว์ตรวจสอบ (แถว GL ที่ไม่พบใน Bank)', () => {
  test('ทำเครื่องหมาย "ต้องตรวจสอบ GL" และ "ตรวจสอบแล้ว" ทำงานเหมือนฝั่ง Bank ทุกประการ', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await openReviewSession(page);

    await expect(page.getByTestId('reconcile-unmatched-gl-row-gt-only')).not.toContainText('ต้องตรวจสอบ GL');
    await page.getByTestId('reconcile-gl-needs-review-gt-only').click();
    await expect(page.getByTestId('reconcile-unmatched-gl-row-gt-only')).toContainText('ต้องตรวจสอบ GL');

    await page.getByTestId('reconcile-filter-reviewed').selectOption('reviewed');
    await expect(page.getByTestId('reconcile-unmatched-gl-row-gt-only')).toHaveCount(0);
    await page.getByTestId('reconcile-filter-reviewed').selectOption('all');

    await page.getByTestId('reconcile-gl-reviewed-gt-only').click();
    await page.getByTestId('reconcile-filter-reviewed').selectOption('reviewed');
    await expect(page.getByTestId('reconcile-unmatched-gl-row-gt-only')).toBeVisible();
    // ทำเครื่องหมาย "ต้องตรวจสอบ GL" ที่ตั้งไว้ก่อนหน้ายังต้องอยู่ครบ ไม่ถูกล้างโดยการติ๊ก "ตรวจสอบแล้ว"
    await expect(page.getByTestId('reconcile-unmatched-gl-row-gt-only')).toContainText('ต้องตรวจสอบ GL');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('หมายเหตุของแถว GL-only: เปิด/บันทึก/เปิดใหม่เห็นค่าที่บันทึกไว้ ยกเลิกไม่บันทึกการเปลี่ยนแปลง', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    const dialogs = attachDialogGuard(page);
    await openReviewSession(page);

    await page.getByTestId('reconcile-gl-note-gt-only').click();
    await expect(page.getByTestId('note-dialog')).toContainText('บันทึกค่าน้ำประปา');
    await page.getByTestId('note-dialog-input').fill('รอเอกสารจากฝ่ายจัดซื้อ');
    await page.getByTestId('note-dialog-save').click();
    await expect(page.getByTestId('reconcile-unmatched-gl-row-gt-only')).toContainText('รอเอกสารจากฝ่ายจัดซื้อ');

    await page.getByTestId('reconcile-gl-note-gt-only').click();
    await expect(page.getByTestId('note-dialog-input')).toHaveValue('รอเอกสารจากฝ่ายจัดซื้อ');
    await page.getByTestId('note-dialog-input').fill('ข้อความที่ไม่ควรถูกบันทึก');
    await page.getByTestId('note-dialog-cancel').click();
    await expect(page.getByTestId('reconcile-unmatched-gl-row-gt-only')).not.toContainText('ข้อความที่ไม่ควรถูกบันทึก');
    await expect(page.getByTestId('reconcile-unmatched-gl-row-gt-only')).toContainText('รอเอกสารจากฝ่ายจัดซื้อ');

    expect(dialogs, `ไม่ควรมี native dialog เกิดขึ้นเลย: ${dialogs.join(', ')}`).toEqual([]);
    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });
});
