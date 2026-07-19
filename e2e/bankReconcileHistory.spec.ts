import { test, expect } from '@playwright/test';
import * as XLSX from 'xlsx';
import { attachConsoleErrorCollector, attachDialogGuard, gotoBankReconcileHistory, setupMockSupabase } from './helpers';

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
  bankName: string,
  bankRows: Record<string, unknown>[],
  glName: string,
  glRows: Record<string, unknown>[]
) {
  await page.getByTestId('bank-upload-input').setInputFiles({
    name: bankName,
    mimeType: XLSX_MIME,
    buffer: buildWorkbookBuffer(bankRows),
  });
  await expect(page.getByTestId('bank-upload-success')).toBeVisible();
  await page.getByTestId('gl-upload-input').setInputFiles({
    name: glName,
    mimeType: XLSX_MIME,
    buffer: buildWorkbookBuffer(glRows),
  });
  await expect(page.getByTestId('gl-upload-success')).toBeVisible();
}

test.describe('ประวัติการกระทบยอด (บันทึก + เปิดจากประวัติ)', () => {
  test('บันทึกรายการใหม่จากหน้า Bank Reconcile → เห็นในหน้าประวัติ → เปิดกลับมาแก้ไขไม่ต้องอัปโหลดซ้ำ → แก้แล้วบันทึกซ้ำอัปเดตรายการเดิม', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    const dialogs = attachDialogGuard(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });

    // 1) หน้าประวัติต้องว่างเปล่าก่อน ยังไม่เคยบันทึกอะไรเลย — นี่คือการ page.goto() ครั้งเดียวของเทสต์นี้
    // (ต่อจากนี้นำทางด้วยการคลิกเมนู Sidebar ตรงๆ เท่านั้น ไม่เรียก gotoX() ซ้ำอีก เพราะ gotoX() ทุกตัวเรียก
    // page.goto('/dashboard') ซึ่งจะโหลดหน้าใหม่ทั้งหมด ทำให้ init script ของ mock Supabase รันซ้ำด้วย seed
    // เดิมตั้งแต่ต้น ล้างข้อมูลที่เพิ่งบันทึกผ่าน RPC ระหว่างเทสต์ทิ้งไปหมด — ต้องคลิกเมนูแบบ SPA navigation
    // เท่านั้นถึงจะรักษาข้อมูลในหน่วยความจำของ mock ไว้ได้ เหมือนพฤติกรรมจริงของแอปที่ไม่มีการ reload หน้า
    // ระหว่างสลับเมนูเลย)
    await gotoBankReconcileHistory(page);
    await expect(page.getByTestId('reconcile-history-empty')).toBeVisible();

    // 2) ไปหน้า Bank Reconcile ด้วยการคลิกเมนูตรงๆ (ไม่ใช่ gotoBankReconcile — ดูเหตุผลด้านบน) อัปโหลดไฟล์ +
    // ตรวจสอบข้อมูล — B1↔G1 จับคู่อัตโนมัติได้ (1000, วันที่ตรงกัน), B2/G2 ไม่มีคู่เลยทั้งคู่ (คนละจำนวนเงิน)
    // จึงคาดหวังผลลัพธ์ที่นับแม่นยำได้: bank=2, gl=2, จับคู่=1, Bank ไม่สำเร็จ=1, GL ไม่สำเร็จ=1
    const BANK_ROWS = [
      { วันที่: '2026-07-01', รับ: 1000, จ่าย: '' }, // B1 → auto กับ G1
      { วันที่: '2026-07-10', รับ: 300, จ่าย: '' }, // B2 — ไม่มีคู่
    ];
    const GL_ROWS = [
      { 'เลขที่เอกสาร': 'DOC-001', วันที่: '2026-07-01', รับ: 1000, จ่าย: '' }, // G1 → auto กับ B1
      { 'เลขที่เอกสาร': 'DOC-002', วันที่: '2026-07-20', รับ: '', จ่าย: 900 }, // G2 — ไม่มีคู่
    ];
    await page.getByTestId('nav-item-bank-reconcile').click();
    await uploadFiles(page, 'bank-history-test.xlsx', BANK_ROWS, 'gl-history-test.xlsx', GL_ROWS);
    await page.getByTestId('check-data-button').click();
    await expect(page.getByTestId('bank-reconcile-summary-matched-count')).toContainText('1');
    await expect(page.getByTestId('bank-reconcile-summary-bank-unmatched-count')).toContainText('1');
    await expect(page.getByTestId('bank-reconcile-summary-gl-unmatched-count')).toContainText('1');

    // 3) กด "บันทึกเป็นประวัติ" — เลือกเดือนมิถุนายนชัดเจน (ปีปล่อยเป็นค่าเริ่มต้นของ dialog เอง ไม่ผูกกับ
    // วันที่ปัจจุบันของเทสต์ตรงๆ) สถานะปล่อยเป็นค่าเริ่มต้น "ทำค้างไว้"
    await page.getByTestId('bank-reconcile-save-button').click();
    await expect(page.getByTestId('bank-reconcile-save-dialog')).toBeVisible();
    await page.getByTestId('bank-reconcile-save-month').selectOption({ label: 'มิถุนายน' });
    const selectedYear = await page.getByTestId('bank-reconcile-save-year').inputValue();
    await expect(page.getByTestId('bank-reconcile-save-status-draft')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('bank-reconcile-save-confirm').click();

    await expect(page.getByTestId('bank-reconcile-save-dialog')).toBeHidden();
    await expect(page.getByTestId('bank-reconcile-save-status')).toContainText('มิถุนายน');
    await expect(page.getByTestId('bank-reconcile-save-status')).toContainText(selectedYear);
    await expect(page.getByTestId('bank-reconcile-save-status')).toContainText('ทำค้างไว้');

    // 4) ไปหน้าประวัติ (คลิกเมนูตรงๆ) — ต้องเห็น 1 รายการพร้อมยอดสรุปที่ถูกต้องครบทุกคอลัมน์
    await page.getByTestId('nav-item-reconcile-history').click();
    await expect(page.getByTestId('reconcile-history-empty')).toHaveCount(0);
    const row = page.locator('[data-testid^="reconcile-history-row-"]');
    await expect(row).toHaveCount(1);
    const cells = row.locator('td');
    await expect(cells.nth(0)).toContainText('มิถุนายน');
    await expect(cells.nth(0)).toContainText(selectedYear);
    await expect(cells.nth(1)).toContainText('ทำค้างไว้');
    await expect(cells.nth(2)).toHaveText('2'); // แถว Bank
    await expect(cells.nth(3)).toHaveText('2'); // แถว GL
    await expect(cells.nth(4)).toHaveText('1'); // จับคู่สำเร็จ
    await expect(cells.nth(5)).toHaveText('1'); // Bank ไม่สำเร็จ
    await expect(cells.nth(6)).toHaveText('1'); // GL ไม่สำเร็จ

    // 5) กด "เปิดดู/แก้ไข" — ต้องกลับไปหน้า Bank Reconcile พร้อมข้อมูลครบทันที ไม่ต้องอัปโหลดไฟล์ใหม่เลย
    await row.getByRole('button', { name: 'เปิดดู/แก้ไข' }).click();
    await expect(page.getByTestId('bank-reconcile-loaded-banner')).toBeVisible();
    await expect(page.getByTestId('bank-reconcile-loaded-banner')).toContainText('มิถุนายน');
    await expect(page.getByTestId('bank-reconcile-loaded-banner')).toContainText('ทำค้างไว้');
    await expect(page.getByTestId('bank-reconcile-empty')).toHaveCount(0);
    await expect(page.getByTestId('bank-upload-success')).toContainText('bank-history-test.xlsx');
    await expect(page.getByTestId('gl-upload-success')).toContainText('gl-history-test.xlsx');
    await expect(page.getByTestId('matched-section').locator('tbody tr')).toHaveCount(1);
    await expect(page.getByTestId('bank-unmatched-section').locator('tbody tr')).toHaveCount(1);
    await expect(page.getByTestId('gl-unmatched-section').locator('tbody tr')).toHaveCount(1);

    // 6) แก้ไข: เปลี่ยนสถานะเป็น "เสร็จสมบูรณ์" แล้วบันทึกซ้ำ — dialog ต้องเสนอเดือน/ปีเดิมที่เคยเลือกไว้
    // ล่วงหน้าให้อัตโนมัติ (ไม่รีเซ็ตกลับไปเดือน/ปีปัจจุบัน)
    await page.getByTestId('bank-reconcile-save-button').click();
    await expect(page.getByTestId('bank-reconcile-save-month')).toHaveValue('6');
    await expect(page.getByTestId('bank-reconcile-save-year')).toHaveValue(selectedYear);
    await expect(page.getByTestId('bank-reconcile-save-status-draft')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('bank-reconcile-save-status-complete').click();
    await page.getByTestId('bank-reconcile-save-confirm').click();
    await expect(page.getByTestId('bank-reconcile-save-dialog')).toBeHidden();
    await expect(page.getByTestId('bank-reconcile-save-status')).toContainText('เสร็จสมบูรณ์');

    // 7) กลับไปหน้าประวัติ (คลิกเมนูตรงๆ) — ต้องยังมีแค่ 1 รายการเท่านั้น (อัปเดตทับของเดิม ไม่สร้างซ้ำ)
    // สถานะเปลี่ยนแล้ว
    await page.getByTestId('nav-item-reconcile-history').click();
    const rowAfter = page.locator('[data-testid^="reconcile-history-row-"]');
    await expect(rowAfter).toHaveCount(1);
    await expect(rowAfter.locator('[data-testid^="reconcile-history-status-"]')).toContainText('เสร็จสมบูรณ์');

    expect(dialogs).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('เปิดรายการที่มีทั้งจับคู่อัตโนมัติ+เอง และรายการค้างจากประวัติที่บันทึกไว้แล้วโดยตรง (seed ล่วงหน้า)', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    const AUTO_GROUP_ID = 'auto-group-1';
    const MANUAL_GROUP_ID = 'manual-group-1';

    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      reconcileReports: [
        {
          id: 'seeded-report-1',
          reportName: 'กระทบยอดเดือนมกราคม 2569',
          periodMonth: 1,
          periodYear: 2569,
          status: 'complete',
          bankFileName: 'bank-jan.xlsx',
          glFileName: 'gl-jan.xlsx',
          toleranceDays: 1,
          matchGroups: [
            { id: AUTO_GROUP_ID, matchType: 'auto', type: 'receive' },
            { id: MANUAL_GROUP_ID, matchType: 'manual', type: 'payment' },
          ],
          bankRows: [
            { id: 'b1', matchGroupId: AUTO_GROUP_ID, date: '2026-01-01', type: 'receive', amount: 1000 },
            { id: 'b2', matchGroupId: MANUAL_GROUP_ID, date: '2026-01-02', type: 'payment', amount: 300 },
            { id: 'b3', matchGroupId: MANUAL_GROUP_ID, date: '2026-01-03', type: 'payment', amount: 200 },
            { id: 'b4', matchGroupId: null, date: '2026-01-10', type: 'receive', amount: 777 },
          ],
          glRows: [
            { id: 'g1', matchGroupId: AUTO_GROUP_ID, documentNo: 'DOC-J01', date: '2026-01-01', type: 'receive', amount: 1000 },
            { id: 'g2', matchGroupId: MANUAL_GROUP_ID, documentNo: 'DOC-J02', date: '2026-01-02', type: 'payment', amount: 500 },
            { id: 'g3', matchGroupId: null, documentNo: 'DOC-J03', date: '2026-01-15', type: 'payment', amount: 888 },
          ],
        },
      ],
    });

    // 1) หน้าประวัติเห็นรายการที่ seed ไว้ทันที พร้อมยอดสรุปถูกต้อง (bank=4, gl=3, จับคู่=2, ไม่สำเร็จฝั่งละ 1)
    await gotoBankReconcileHistory(page);
    const row = page.locator('[data-testid^="reconcile-history-row-"]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('กระทบยอดเดือนมกราคม 2569');
    const cells = row.locator('td');
    await expect(cells.nth(1)).toContainText('เสร็จสมบูรณ์');
    await expect(cells.nth(2)).toHaveText('4');
    await expect(cells.nth(3)).toHaveText('3');
    await expect(cells.nth(4)).toHaveText('2');
    await expect(cells.nth(5)).toHaveText('1');
    await expect(cells.nth(6)).toHaveText('1');

    // 2) เปิดดู/แก้ไข — ต้อง hydrate ครบทุกอย่างจากสแนปช็อตที่บันทึกไว้ โดยไม่ต้องอัปโหลดไฟล์เลย
    await row.getByRole('button', { name: 'เปิดดู/แก้ไข' }).click();
    await expect(page.getByTestId('bank-reconcile-loaded-banner')).toContainText('กระทบยอดเดือนมกราคม 2569');
    await expect(page.getByTestId('bank-reconcile-loaded-banner')).toContainText('เสร็จสมบูรณ์');
    await expect(page.getByTestId('bank-upload-success')).toContainText('bank-jan.xlsx');
    await expect(page.getByTestId('bank-upload-success')).toContainText('4 รายการ');
    await expect(page.getByTestId('gl-upload-success')).toContainText('gl-jan.xlsx');
    await expect(page.getByTestId('gl-upload-success')).toContainText('3 รายการ');

    // การ์ดสรุปต้องตรงกับสแนปช็อตที่โหลดมาทันที (ไม่ต้องกด "ตรวจสอบข้อมูล" ซ้ำ)
    await expect(page.getByTestId('bank-reconcile-summary-bank-count')).toContainText('4');
    await expect(page.getByTestId('bank-reconcile-summary-gl-count')).toContainText('3');
    await expect(page.getByTestId('bank-reconcile-summary-matched-count')).toContainText('2');
    await expect(page.getByTestId('bank-reconcile-summary-bank-unmatched-count')).toContainText('1');
    await expect(page.getByTestId('bank-reconcile-summary-gl-unmatched-count')).toContainText('1');

    // 3) ตาราง "กระทบยอดสำเร็จ" ต้องมี 2 แถว: 1 auto (1:1 แสดงตรงๆ ไม่มีปุ่มขยาย) + 1 manual (2 bank + 1 gl
    // แสดงย่อ "2 รายการ" ฝั่ง Bank และเลขที่เอกสารตรงๆ ฝั่ง GL เพราะมีแค่ 1 แถว พร้อมปุ่มขยาย)
    const matchedSection = page.getByTestId('matched-section');
    await expect(matchedSection.locator('tbody tr').first()).toBeVisible();
    await expect(matchedSection).toContainText('จับคู่อัตโนมัติ');
    await expect(matchedSection).toContainText('จับคู่เอง');
    await expect(page.getByTestId(`matched-row-${AUTO_GROUP_ID}`)).toContainText('DOC-J01');
    await expect(page.getByTestId(`matched-row-${AUTO_GROUP_ID}`).locator(`[data-testid^="matched-row-expand-"]`)).toHaveCount(0);

    const manualRow = page.getByTestId(`matched-row-${MANUAL_GROUP_ID}`);
    await expect(manualRow).toContainText('2 รายการ');
    await expect(manualRow).toContainText('DOC-J02');
    await manualRow.getByTestId(`matched-row-expand-${MANUAL_GROUP_ID}`).click();
    const detailRow = page.getByTestId(`matched-row-detail-${MANUAL_GROUP_ID}`);
    await expect(detailRow).toContainText('Bank Statement (2 รายการ)');
    await expect(detailRow).toContainText('GL (1 รายการ)');
    await expect(detailRow).toContainText('300.00');
    await expect(detailRow).toContainText('200.00');
    await expect(detailRow).toContainText('500.00');

    // 4) แถวที่ยังไม่จับคู่ทั้งสองฝั่งต้องอยู่ครบ
    await expect(page.getByTestId('bank-unmatched-section')).toContainText('777.00');
    await expect(page.getByTestId('gl-unmatched-section')).toContainText('DOC-J03');

    expect(errors).toEqual([]);
  });
});
