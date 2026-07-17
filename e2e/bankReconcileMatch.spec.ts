import { test, expect, type Page } from '@playwright/test';
import { attachConsoleErrorCollector, gotoBankReconcileList, setupMockSupabase } from './helpers';
import type { MockSeedReconcileBankTransaction, MockSeedReconcileGLTransaction } from './mockSupabase';

/**
 * e2e — Bank Reconcile: เครื่องมือจับคู่รายการ (runSimpleReconciliation), 9 KPI, ตารางผลลัพธ์หลัก/GL-only,
 * แท็บกรองสถานะ+ทิศทาง, ค้นหา/ตัวกรองเพิ่มเติม เขียนใหม่ทั้งไฟล์ 2026-07-17 พร้อมกับการ rebuild โมดูล Bank
 * Reconcile ทั้งโมดูล — แทนที่ e2e/bankReconcileMatch.spec.ts เดิม (เทสต์เฟส 2 เก่า อ้างอิงโมเดล match score/
 * date tolerance/สถานะ 9 ค่า/Modal รายละเอียด-ผู้สมัคร ที่ถูกลบออกทั้งหมดแล้ว)
 *
 * ใช้วิธี seed ข้อมูล session/bank/gl transactions ตรงเข้า mock Supabase แล้วเปิดผ่านหน้ารายการ (session-open-*)
 * แทนการอัปโหลดไฟล์จริงทีละสถานการณ์ — เพราะการกระทบยอดคำนวณสดจาก bankRows/glRows ที่โหลดมาเสมอ
 * (runSimpleReconciliation ไม่สนเลยว่าข้อมูลมาจากการอัปโหลดไฟล์หรือโหลดจากฐานข้อมูล) วิธีนี้จึงให้ผลลัพธ์แบบ
 * เดียวกับการอัปโหลดไฟล์จริงทุกประการ แต่ควบคุม direction/amount/row_number ของทุกแถวได้ตรงๆ แม่นยำ ไม่ต้องพึ่ง
 * การ parse ไฟล์ Excel/PDF ซ้ำซ้อนกับที่ bankReconcile.spec.ts ทดสอบไว้แล้ว
 */

const OWNER = 'user@example.com';
const SESSION_ID = 'sess-match-1';

/**
 * ชุดข้อมูลหลักของไฟล์นี้ — ครอบคลุมตัวอย่างสเปกส่วน "6. DUPLICATE AMOUNTS" ทั้งสองข้อพร้อมกันในรอบเดียว:
 *   ตัวอย่างที่ 1 (รับเงิน 1,000.00 x3 ฝั่ง Bank vs x2 ฝั่ง GL): bt-1/bt-2/bt-3 กับ gt-1/gt-2
 *     -> bt-1 จับคู่ gt-1 (FIFO แรกสุด), bt-2 จับคู่ gt-2, bt-3 ไม่พบ (คิวว่างแล้ว)
 *   ตัวอย่างที่ 2 (จ่ายเงิน 500.00 x1 ฝั่ง Bank vs x3 ฝั่ง GL): bt-4 กับ gt-3/gt-4/gt-5
 *     -> bt-4 จับคู่ gt-3 (แรกสุด) เหลือ gt-4/gt-5 ค้างในส่วน GL-only
 *   บวกคู่ "ทิศทางเดียวกันคนละยอด" อีกคู่ (777.00 รับเงิน+จ่ายเงิน อย่างละ 1 รายการ) เพื่อพิสูจน์ว่าทิศทางที่ต่าง
 *   กันไม่มีทางแย่งชิง GL กันเองแม้ยอดจะเท่ากันก็ตาม: bt-5(รับ)->gt-6, bt-6(จ่าย)->gt-7
 *
 * ผลลัพธ์ที่คำนวณได้ (ตรวจทานด้วยมือแล้ว ตรงกับ lib/bankReconcileKpi.ts เป๊ะ):
 *   found=5 (bt-1,bt-2,bt-4,bt-5,bt-6), not_found=1 (bt-3), gl-only=2 (gt-4,gt-5)
 *   bank_income_total = 1000+1000+1000+777 = 3,777.00 | bank_payment_total = 500+777 = 1,277.00
 *   gl_income_total (matched gt-1,gt-2,gt-6 + gl-only ไม่มีฝั่งรับเงินเลย) = 1000+1000+777 = 2,777.00
 *   gl_payment_total (matched gt-3,gt-7 + gl-only gt-4,gt-5) = 500+777+500+500 = 2,277.00
 *   income_difference = 3,777.00-2,777.00 = 1,000.00 | payment_difference = 1,277.00-2,277.00 = -1,000.00
 */
const BANK_TXNS: MockSeedReconcileBankTransaction[] = [
  { id: 'bt-1', session_id: SESSION_ID, row_number: 1, transaction_date: '2026-07-01', description: 'รับเงินเดือน', direction: 'income', amount: 1000, money_in: 1000, money_out: 0 },
  { id: 'bt-2', session_id: SESSION_ID, row_number: 2, transaction_date: '2026-07-02', description: 'รับค่าสินค้า', direction: 'income', amount: 1000, money_in: 1000, money_out: 0 },
  { id: 'bt-3', session_id: SESSION_ID, row_number: 3, transaction_date: '2026-07-03', description: 'รับเงินไม่ทราบที่มา', direction: 'income', amount: 1000, money_in: 1000, money_out: 0 },
  { id: 'bt-4', session_id: SESSION_ID, row_number: 4, transaction_date: '2026-07-04', description: 'จ่ายค่าเช่า', direction: 'payment', amount: 500, money_in: 0, money_out: 500 },
  { id: 'bt-5', session_id: SESSION_ID, row_number: 5, transaction_date: '2026-07-05', description: 'รับเงินพิเศษ', direction: 'income', amount: 777, money_in: 777, money_out: 0 },
  { id: 'bt-6', session_id: SESSION_ID, row_number: 6, transaction_date: '2026-07-06', description: 'จ่ายเงินพิเศษ', direction: 'payment', amount: 777, money_in: 0, money_out: 777 },
];

const GL_TXNS: MockSeedReconcileGLTransaction[] = [
  { id: 'gt-1', session_id: SESSION_ID, row_number: 1, transaction_date: '2026-07-01', description: 'บันทึกรับเงิน 1', doc_no: 'DOC-A1', direction: 'income', amount: 1000, money_in: 1000, money_out: 0 },
  { id: 'gt-2', session_id: SESSION_ID, row_number: 2, transaction_date: '2026-07-02', description: 'บันทึกรับเงิน 2', doc_no: 'DOC-A2', direction: 'income', amount: 1000, money_in: 1000, money_out: 0 },
  { id: 'gt-3', session_id: SESSION_ID, row_number: 3, transaction_date: '2026-07-04', description: 'บันทึกจ่ายเช่า 1', doc_no: 'DOC-B1', direction: 'payment', amount: 500, money_in: 0, money_out: 500 },
  { id: 'gt-4', session_id: SESSION_ID, row_number: 4, transaction_date: '2026-07-04', description: 'บันทึกจ่ายเช่า 2', doc_no: 'DOC-B2', direction: 'payment', amount: 500, money_in: 0, money_out: 500 },
  { id: 'gt-5', session_id: SESSION_ID, row_number: 5, transaction_date: '2026-07-10', description: 'บันทึกจ่ายเช่า 3', doc_no: 'DOC-B3', direction: 'payment', amount: 500, money_in: 0, money_out: 500 },
  { id: 'gt-6', session_id: SESSION_ID, row_number: 6, transaction_date: '2026-07-05', description: 'บันทึกรับเงินพิเศษ', doc_no: 'DOC-C1', direction: 'income', amount: 777, money_in: 777, money_out: 0 },
  { id: 'gt-7', session_id: SESSION_ID, row_number: 7, transaction_date: '2026-07-06', description: 'บันทึกจ่ายเงินพิเศษ', doc_no: 'DOC-C2', direction: 'payment', amount: 777, money_in: 0, money_out: 777 },
];

/** เปิด session ที่ seed ไว้ — bankOverrides/glOverrides แทนที่แถวเดิมที่มี id ตรงกัน "ในตำแหน่งเดิม" (ไม่ใช่การ
 * เพิ่มแถวใหม่ต่อท้าย) ใช้กับเทสต์ที่ต้องการปรับธงตรวจสอบ/ค่าบางแถวโดยไม่กระทบจำนวนแถว/ผลจับคู่ของแถวอื่นเลย */
async function openSeededSession(page: Page, bankOverrides: MockSeedReconcileBankTransaction[] = [], glOverrides: MockSeedReconcileGLTransaction[] = []) {
  const bankTxns = BANK_TXNS.map((t) => bankOverrides.find((o) => o.id === t.id) ?? t);
  const glTxns = GL_TXNS.map((t) => glOverrides.find((o) => o.id === t.id) ?? t);
  await setupMockSupabase(page, {
    loggedInAs: OWNER,
    users: [{ email: OWNER, password: 'x' }],
    reconcileSessions: [
      {
        id: SESSION_ID,
        session_name: 'กระทบยอดกรกฎาคม 2569',
        bank_file_name: 'bank-july.xlsx',
        gl_file_name: 'gl-july.xlsx',
        status: 'in_progress',
        created_by_email: OWNER,
        // ค่า KPI ที่บันทึกไว้ในแถว session จงใจตั้งให้ "ผิด" ทั้งหมด — ต้องไม่ถูกนำมาแสดงเลย เพราะ KPI ต้อง
        // คำนวณสดจาก bankRows/glRows ที่โหลดมาเสมอผ่าน runSimpleReconciliation() ตามที่ระบุไว้ที่หัวไฟล์
        // types/bankReconcileSession.ts ("ไม่เคยอ่านค่าที่ cache ไว้ในฐานข้อมูลมาแสดงบนจอโดยตรง")
        bank_row_count: 999,
        found_count: 999,
        bank_not_found_count: 999,
        gl_row_count: 999,
        gl_not_found_count: 999,
      },
    ],
    reconcileBankTransactions: bankTxns,
    reconcileGLTransactions: glTxns,
  });
  await gotoBankReconcileList(page);
  await page.getByTestId(`session-open-${SESSION_ID}`).click();
  await expect(page.getByTestId('bank-reconcile-results')).toBeVisible();
}

test.describe('Bank Reconcile — เครื่องมือจับคู่รายการ (matching engine)', () => {
  test('จับคู่ด้วยทิศทาง+จำนวนเงินเท่านั้น จัดการยอดซ้ำแบบ FIFO ตามตัวอย่างสเปกทั้งสองข้อ และรักษาลำดับแถว Bank เดิมเสมอ', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await openSeededSession(page);

    // ตัวอย่างที่ 1: รับเงิน 1,000 x3 Bank vs x2 GL — FIFO: bt-1->gt-1(DOC-A1), bt-2->gt-2(DOC-A2), bt-3 ไม่พบ
    await expect(page.getByTestId('reconcile-status-bt-1')).toContainText('พบใน GL');
    await expect(page.getByTestId('reconcile-row-bt-1')).toContainText('DOC-A1');
    await expect(page.getByTestId('reconcile-status-bt-2')).toContainText('พบใน GL');
    await expect(page.getByTestId('reconcile-row-bt-2')).toContainText('DOC-A2');
    await expect(page.getByTestId('reconcile-status-bt-3')).toContainText('ไม่พบใน GL');

    // ตัวอย่างที่ 2: จ่ายเงิน 500 x1 Bank vs x3 GL — bt-4 จับคู่ gt-3 (แรกสุด) เท่านั้น เหลือ gt-4/gt-5 ค้าง
    await expect(page.getByTestId('reconcile-status-bt-4')).toContainText('พบใน GL');
    await expect(page.getByTestId('reconcile-row-bt-4')).toContainText('DOC-B1');
    await expect(page.getByTestId('reconcile-unmatched-gl-row-gt-4')).toBeVisible();
    await expect(page.getByTestId('reconcile-unmatched-gl-row-gt-5')).toBeVisible();
    await expect(page.getByTestId('reconcile-unmatched-gl-row-gt-3')).toHaveCount(0); // gt-3 ถูกใช้ไปแล้ว ไม่ค้างใน GL-only

    // ทิศทางต่างกันยอดเท่ากัน (777) ต้องไม่แย่งชิง GL กันเอง
    await expect(page.getByTestId('reconcile-row-bt-5')).toContainText('DOC-C1');
    await expect(page.getByTestId('reconcile-row-bt-6')).toContainText('DOC-C2');

    // ลำดับแถวในตารางต้องตรงกับลำดับไฟล์ Bank Statement ต้นฉบับเสมอ (row_number 1-6) ไม่ว่าผลจับคู่จะเป็นอย่างไร
    const orderedIds = await page.getByTestId('reconcile-result-table').locator('tbody tr').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-testid')));
    expect(orderedIds).toEqual(['reconcile-row-bt-1', 'reconcile-row-bt-2', 'reconcile-row-bt-3', 'reconcile-row-bt-4', 'reconcile-row-bt-5', 'reconcile-row-bt-6']);

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('9 KPI คำนวณสดจากผลจับคู่จริงเสมอ ไม่ใช้ค่าที่บันทึก (cache) ไว้ในแถว session', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await openSeededSession(page);

    await expect(page.getByTestId('reconcile-kpi-bank_row_count')).toContainText('6');
    await expect(page.getByTestId('reconcile-kpi-found_count')).toContainText('5');
    await expect(page.getByTestId('reconcile-kpi-bank_not_found_count')).toContainText('1');
    await expect(page.getByTestId('reconcile-kpi-gl_row_count')).toContainText('7');
    await expect(page.getByTestId('reconcile-kpi-gl_not_found_count')).toContainText('2');
    await expect(page.getByTestId('reconcile-kpi-bank_income_total')).toContainText('3,777.00');
    await expect(page.getByTestId('reconcile-kpi-bank_payment_total')).toContainText('1,277.00');
    await expect(page.getByTestId('reconcile-kpi-income_difference')).toContainText('1,000.00');
    await expect(page.getByTestId('reconcile-kpi-payment_difference')).toContainText('-1,000.00');

    // ค่าผิดๆ ที่ seed ไว้ในแถว session (999) ต้องไม่ปรากฏที่ใดเลยบนหน้าจอ
    await expect(page.getByTestId('reconcile-kpi-cards')).not.toContainText('999');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ตารางผลลัพธ์หลัก: แถวพบใน GL เป็นสีเขียว แถวไม่พบเป็นสีแดง ปุ่มจัดการปรากฏเฉพาะแถวไม่พบใน GL เท่านั้น', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await openSeededSession(page);

    await expect(page.getByTestId('reconcile-row-bt-1')).toHaveClass(/bg-success\/5/);
    await expect(page.getByTestId('reconcile-status-bt-1')).toHaveClass(/bg-success\/15/);
    await expect(page.getByTestId('reconcile-row-bt-3')).toHaveClass(/bg-danger\/5/);
    await expect(page.getByTestId('reconcile-status-bt-3')).toHaveClass(/bg-danger\/15/);

    // แถวพบใน GL แล้ว — ไม่มีปุ่มจัดการใดๆ เลย (ไม่มีอะไรให้ตรวจสอบเพิ่ม)
    await expect(page.getByTestId('reconcile-note-bt-1')).toHaveCount(0);
    await expect(page.getByTestId('reconcile-needs-gl-entry-bt-1')).toHaveCount(0);
    await expect(page.getByTestId('reconcile-reviewed-bt-1')).toHaveCount(0);

    // แถวไม่พบใน GL — ต้องมีปุ่มจัดการครบสาม
    await expect(page.getByTestId('reconcile-note-bt-3')).toBeVisible();
    await expect(page.getByTestId('reconcile-needs-gl-entry-bt-3')).toBeVisible();
    await expect(page.getByTestId('reconcile-reviewed-bt-3')).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ตาราง GL-only: ป้ายสถานะสีม่วง ยอดรวม/จำนวนรายการถูกต้อง และพับ/ขยายได้', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await openSeededSession(page);

    await expect(page.getByTestId('reconcile-unmatched-gl-count')).toContainText('2 รายการ');
    await expect(page.getByTestId('reconcile-unmatched-gl-total')).toContainText('1,000.00'); // 500+500

    const badge = page.getByTestId('reconcile-unmatched-gl-row-gt-4').getByText('มีใน GL แต่ไม่มีใน Bank', { exact: true });
    await expect(badge).toHaveClass(/bg-purple-100/);

    await expect(page.getByTestId('reconcile-unmatched-gl-toggle')).toHaveAttribute('aria-expanded', 'true');
    await page.getByTestId('reconcile-unmatched-gl-toggle').click();
    await expect(page.getByTestId('reconcile-unmatched-gl-toggle')).toHaveAttribute('aria-expanded', 'false');
    await page.getByTestId('reconcile-unmatched-gl-toggle').click();
    await expect(page.getByTestId('reconcile-unmatched-gl-toggle')).toHaveAttribute('aria-expanded', 'true');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ธงตรวจสอบ (needs_gl_entry/reviewed/หมายเหตุ) ไม่มีผลต่อสถานะการจับคู่ที่คำนวณได้เลย', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await openSeededSession(page, [{ id: 'bt-3', session_id: SESSION_ID, row_number: 3, transaction_date: '2026-07-03', description: 'รับเงินไม่ทราบที่มา', direction: 'income', amount: 1000, money_in: 1000, money_out: 0, needs_gl_entry: true, reviewed: true, review_note: 'ตรวจสอบแล้วรอบันทึก GL' }]);

    await expect(page.getByTestId('reconcile-status-bt-3')).toContainText('ไม่พบใน GL'); // สถานะจับคู่ไม่เปลี่ยนแม้ reviewed=true
    await expect(page.getByTestId('reconcile-row-bt-3')).toContainText('ต้องบันทึก GL เพิ่ม');
    await expect(page.getByTestId('reconcile-row-bt-3')).toContainText('ตรวจสอบแล้วรอบันทึก GL');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('แท็บสถานะ+ทิศทางกรองทั้งสองตารางถูกต้อง พร้อมจำนวนรายการกำกับทุกแท็บ', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await openSeededSession(page);

    await expect(page.getByTestId('reconcile-status-tab-all')).toContainText('ทั้งหมด (8)');
    await expect(page.getByTestId('reconcile-status-tab-found_in_gl')).toContainText('พบใน GL (5)');
    await expect(page.getByTestId('reconcile-status-tab-not_found_in_gl')).toContainText('ไม่พบใน GL (1)');
    await expect(page.getByTestId('reconcile-status-tab-gl_not_found_in_bank')).toContainText('GL ไม่พบใน Bank (2)');

    // 'found_in_gl' — แสดงเฉพาะตารางหลัก (กรองแล้ว) ซ่อนตาราง GL-only ไปทั้งหมด
    await page.getByTestId('reconcile-status-tab-found_in_gl').click();
    await expect(page.getByTestId('reconcile-result-table').locator('tbody tr')).toHaveCount(5);
    await expect(page.getByTestId('reconcile-row-bt-3')).toHaveCount(0);
    await expect(page.getByTestId('reconcile-unmatched-gl-section')).toHaveCount(0);

    // 'gl_not_found_in_bank' — แสดงเฉพาะตาราง GL-only ซ่อนตารางหลักไปทั้งหมด
    await page.getByTestId('reconcile-status-tab-gl_not_found_in_bank').click();
    await expect(page.getByTestId('reconcile-result-table')).toHaveCount(0);
    await expect(page.getByTestId('reconcile-result-table-empty')).toHaveCount(0);
    await expect(page.getByTestId('reconcile-unmatched-gl-section')).toBeVisible();
    await expect(page.getByTestId('reconcile-unmatched-gl-row-gt-4')).toBeVisible();

    await page.getByTestId('reconcile-status-tab-all').click();
    await expect(page.getByTestId('reconcile-direction-tab-all')).toContainText('ทั้งหมด (8)');
    await expect(page.getByTestId('reconcile-direction-tab-income')).toContainText('รับเงิน (4)');
    await expect(page.getByTestId('reconcile-direction-tab-payment')).toContainText('จ่ายเงิน (4)');

    await page.getByTestId('reconcile-direction-tab-payment').click();
    await expect(page.getByTestId('reconcile-row-bt-4')).toBeVisible();
    await expect(page.getByTestId('reconcile-row-bt-6')).toBeVisible();
    await expect(page.getByTestId('reconcile-row-bt-1')).toHaveCount(0);
    await expect(page.getByTestId('reconcile-unmatched-gl-row-gt-4')).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ค้นหา/ช่วงวันที่/ช่วงจำนวนเงิน/ตัวกรองตรวจสอบแล้ว กรองทั้งสองตารางถูกต้อง', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await openSeededSession(page, [], [{ id: 'gt-4', session_id: SESSION_ID, row_number: 4, transaction_date: '2026-07-04', description: 'บันทึกจ่ายเช่า 2', doc_no: 'DOC-B2', direction: 'payment', amount: 500, money_in: 0, money_out: 500, reviewed: true }]);

    // ค้นหาด้วยเลขที่เอกสาร GL — ต้องเจอเฉพาะแถว Bank ที่จับคู่กับเอกสารนั้น
    await page.getByTestId('reconcile-search-input').fill('DOC-A2');
    await expect(page.getByTestId('reconcile-row-bt-2')).toBeVisible();
    await expect(page.getByTestId('reconcile-row-bt-1')).toHaveCount(0);
    await page.getByTestId('reconcile-clear-filters').click();

    // ค้นหาฝั่ง GL-only ด้วยเลขที่เอกสาร
    await page.getByTestId('reconcile-search-input').fill('DOC-B2');
    await expect(page.getByTestId('reconcile-unmatched-gl-row-gt-4')).toBeVisible();
    await expect(page.getByTestId('reconcile-unmatched-gl-row-gt-5')).toHaveCount(0);
    await page.getByTestId('reconcile-clear-filters').click();

    // ช่วงวันที่ 2026-07-04 เท่านั้น — bt-4 (ตารางหลัก) และ gt-4 (GL-only, gt-5 วันที่ 07-10 ไม่เข้าเงื่อนไข)
    await page.getByTestId('reconcile-filter-date-from').fill('2026-07-04');
    await page.getByTestId('reconcile-filter-date-to').fill('2026-07-04');
    await expect(page.getByTestId('reconcile-row-bt-4')).toBeVisible();
    await expect(page.getByTestId('reconcile-row-bt-1')).toHaveCount(0);
    await expect(page.getByTestId('reconcile-unmatched-gl-row-gt-4')).toBeVisible();
    await expect(page.getByTestId('reconcile-unmatched-gl-row-gt-5')).toHaveCount(0);
    await page.getByTestId('reconcile-clear-filters').click();

    // ช่วงจำนวนเงิน 600-900 — เฉพาะยอด 777 (bt-5, bt-6) เท่านั้น ไม่มี GL-only แถวใดอยู่ในช่วงนี้เลย (ทั้งหมด 500)
    await page.getByTestId('reconcile-filter-amount-min').fill('600');
    await page.getByTestId('reconcile-filter-amount-max').fill('900');
    await expect(page.getByTestId('reconcile-row-bt-5')).toBeVisible();
    await expect(page.getByTestId('reconcile-row-bt-6')).toBeVisible();
    await expect(page.getByTestId('reconcile-row-bt-4')).toHaveCount(0);
    await expect(page.getByTestId('reconcile-unmatched-gl-empty')).toBeVisible();
    await page.getByTestId('reconcile-clear-filters').click();

    // ตัวกรอง "ตรวจสอบแล้ว" — เฉพาะ gt-4 ที่ seed ให้ reviewed=true เท่านั้นในฝั่ง GL-only
    await page.getByTestId('reconcile-filter-reviewed').selectOption('reviewed');
    await expect(page.getByTestId('reconcile-unmatched-gl-row-gt-4')).toBeVisible();
    await expect(page.getByTestId('reconcile-unmatched-gl-row-gt-5')).toHaveCount(0);

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('"ล้างตัวกรอง" รีเซ็ตแท็บ/ค้นหา/ช่วงวันที่/ช่วงจำนวนเงิน/ตัวกรองตรวจสอบแล้วกลับเป็นค่าเริ่มต้นทั้งหมด', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await openSeededSession(page);

    await page.getByTestId('reconcile-status-tab-not_found_in_gl').click();
    await page.getByTestId('reconcile-direction-tab-income').click();
    await page.getByTestId('reconcile-search-input').fill('บางอย่าง');
    await page.getByTestId('reconcile-filter-amount-min').fill('100');
    await page.getByTestId('reconcile-filter-reviewed').selectOption('reviewed');

    await page.getByTestId('reconcile-clear-filters').click();

    await expect(page.getByTestId('reconcile-status-tab-all')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('reconcile-direction-tab-all')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('reconcile-search-input')).toHaveValue('');
    await expect(page.getByTestId('reconcile-filter-amount-min')).toHaveValue('');
    await expect(page.getByTestId('reconcile-filter-reviewed')).toHaveValue('all');
    await expect(page.getByTestId('reconcile-row-bt-1')).toBeVisible();
    await expect(page.getByTestId('reconcile-unmatched-gl-section')).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });
});
