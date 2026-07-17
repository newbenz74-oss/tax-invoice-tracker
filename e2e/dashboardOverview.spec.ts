import { test, expect } from '@playwright/test';
import { attachConsoleErrorCollector, isoDaysFromNow, setupMockSupabase } from './helpers';
import type { MockSeedInvoice } from './mockSupabase';

const OWNER = 'user@example.com';

// เทสต์หน้า Dashboard ภาพรวม — เพิ่มเข้ามาในรอบปรับโครงสร้าง Navigation/Layout (2026-07-15) พร้อมกับ
// การเปลี่ยน DEFAULT_ACTIVE_ID เป็น 'dashboard' (ดู lib/navigation.ts) หน้านี้เป็น "อ่านอย่างเดียว"
// ตามสเปก ("Dashboard เป็นหน้าภาพรวม ไม่ใช่หน้าสำหรับแก้ไขข้อมูล") จึงไม่มีเทสต์แก้ไข/ลบ/มาร์คได้รับแล้ว
// ในไฟล์นี้ — เทสต์เหล่านั้นยังอยู่ที่ e2e/invoices.spec.ts เหมือนเดิม (ตรวจผ่านหน้า "บันทึกค่าใช้จ่าย")
test.describe('Dashboard ภาพรวม', () => {
  test('แสดง KPI Cards, Quick Actions, รายการล่าสุด, รายการเกินกำหนด และสรุป VAT รายเดือน ครบถ้วน และเป็นหน้าอ่านอย่างเดียว', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      invoices: [
        {
          id: 'inv-pending-recent',
          vendor_name: 'ผู้ขาย รอรับ เดชบอร์ด',
          transaction_date: isoDaysFromNow(0),
          amount_excl_vat: 1000,
          vat_amount: 70,
          expected_date: isoDaysFromNow(5),
          status: 'pending',
        },
        {
          id: 'inv-overdue-recent',
          vendor_name: 'ผู้ขาย เกินกำหนด เดชบอร์ด',
          transaction_date: isoDaysFromNow(-20),
          amount_excl_vat: 200,
          vat_amount: 14,
          expected_date: isoDaysFromNow(-10),
          status: 'pending',
        },
        {
          id: 'inv-received-recent',
          vendor_name: 'ผู้ขาย ได้รับแล้ว เดชบอร์ด',
          transaction_date: isoDaysFromNow(-3),
          amount_excl_vat: 2000,
          vat_amount: 140,
          status: 'received',
          received_date: isoDaysFromNow(0),
          tax_invoice_number: 'INV-DASH-1',
        },
      ],
    });
    await page.goto('/dashboard');

    // เห็นหน้า Dashboard ทันทีโดยไม่ต้องคลิกอะไร (เป็นเมนูเริ่มต้นหลังรอบปรับโครงสร้างนี้)
    await expect(page.getByTestId('nav-item-dashboard')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

    // KPI Cards ครบทั้ง 5 ใบ (ย้ายมาจากหน้า "บันทึกค่าใช้จ่าย")
    await expect(page.getByTestId('stat-pending')).toBeVisible();
    await expect(page.getByTestId('stat-pending-amount')).toBeVisible();
    await expect(page.getByTestId('stat-pending-vat')).toBeVisible();
    await expect(page.getByTestId('stat-overdue')).toBeVisible();
    await expect(page.getByTestId('stat-received')).toBeVisible();

    // Quick Actions ครบทั้ง 4 ปุ่มตามสเปก
    await expect(page.getByTestId('quick-action-add-expense')).toBeVisible();
    await expect(page.getByTestId('quick-action-import-excel')).toBeVisible();
    await expect(page.getByTestId('quick-action-purchase-tax-report')).toBeVisible();
    await expect(page.getByTestId('quick-action-sales-tax-report')).toBeVisible();

    // ตารางรายการรอรับใบกำกับภาษีล่าสุด
    await expect(page.getByTestId('recent-pending-inv-pending-recent')).toBeVisible();
    await expect(page.getByTestId('recent-pending-inv-overdue-recent')).toBeVisible();

    // รายการเกินกำหนด — เฉพาะที่เกินกำหนดจริงเท่านั้น (inv-pending-recent ยังไม่ถึงกำหนดจึงไม่ควรอยู่)
    await expect(page.getByTestId('overdue-item-inv-overdue-recent')).toBeVisible();
    await expect(page.getByTestId('overdue-item-inv-pending-recent')).toHaveCount(0);

    // สรุป VAT รายเดือน
    await expect(page.getByText('สรุป VAT รายเดือน')).toBeVisible();

    // Dashboard เป็นหน้าภาพรวมอย่างเดียวตามสเปก ("ไม่ใช่หน้าสำหรับแก้ไขข้อมูล") — ต้องไม่มีปุ่มแก้ไข/
    // ลบ/มาร์คได้รับแล้ว/เพิ่มรายการโดยตรงอยู่ในหน้านี้เลย
    await expect(page.getByTestId('open-add-form')).toHaveCount(0);
    await expect(page.getByTestId('mark-received-inv-pending-recent')).toHaveCount(0);
    await expect(page.getByTestId('edit-inv-pending-recent')).toHaveCount(0);
    await expect(page.getByTestId('delete-inv-pending-recent')).toHaveCount(0);

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  // ย้ายมาจาก e2e/invoices.spec.ts (เดิมทดสอบรวมกับคอลัมน์ในตาราง) — ตั้งแต่รอบปรับโครงสร้าง
  // Navigation/Layout นี้ stat-pending-vat และสรุป VAT รายเดือนอยู่ที่หน้า Dashboard เท่านั้น
  test('การ์ดสถิติ "VAT ที่รอรับ" และสรุป VAT รายเดือนคำนวณถูกต้อง', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    const currentMonth = isoDaysFromNow(0).slice(0, 7);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      invoices: [
        {
          id: 'inv-vat-pending',
          vendor_name: 'ผู้ขาย VAT ค้างรับ',
          transaction_date: isoDaysFromNow(0),
          amount_excl_vat: 1000,
          vat_amount: 70,
          status: 'pending',
        },
        {
          id: 'inv-vat-received',
          vendor_name: 'ผู้ขาย VAT ได้รับแล้ว',
          transaction_date: isoDaysFromNow(0),
          amount_excl_vat: 2000,
          vat_amount: 140,
          status: 'received',
          received_date: isoDaysFromNow(0),
          tax_invoice_number: 'INV-777',
        },
      ],
    });
    await page.goto('/dashboard');

    // การ์ดสถิติ "VAT ที่รอรับ" นับเฉพาะรายการ pending (70 บาท ไม่รวมของ received)
    await expect(page.getByTestId('stat-pending-vat')).toContainText('70.00');

    // สรุป VAT รายเดือน — แยกค้างรับ (70) กับได้รับแล้ว (140) ถูกต้อง
    await expect(page.getByTestId(`vat-pending-${currentMonth}`)).toHaveText('70.00');
    await expect(page.getByTestId(`vat-received-${currentMonth}`)).toHaveText('140.00');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('คลิกการ์ด "รอรับใบกำกับภาษี" พาไปหน้าบันทึกค่าใช้จ่ายพร้อม filter รอรับ', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      invoices: [
        {
          id: 'inv-p',
          vendor_name: 'ผู้ขาย รอรับ คลิกการ์ด',
          transaction_date: isoDaysFromNow(0),
          amount_excl_vat: 100,
          vat_amount: 7,
          expected_date: isoDaysFromNow(5),
          status: 'pending',
        },
        {
          id: 'inv-r',
          vendor_name: 'ผู้ขาย ได้รับแล้ว คลิกการ์ด',
          transaction_date: isoDaysFromNow(-3),
          amount_excl_vat: 100,
          vat_amount: 7,
          status: 'received',
          received_date: isoDaysFromNow(0),
          tax_invoice_number: 'INV-CLICK-1',
        },
      ],
    });
    await page.goto('/dashboard');

    await page.getByTestId('stat-pending').click();

    await expect(page.getByRole('heading', { level: 1, name: 'บันทึกการจ่ายเงิน' })).toBeVisible();
    await expect(page.getByText('ผู้ขาย รอรับ คลิกการ์ด')).toBeVisible();
    await expect(page.getByText('ผู้ขาย ได้รับแล้ว คลิกการ์ด')).not.toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('คลิกการ์ด "ได้รับแล้ว" พาไปหน้าบันทึกค่าใช้จ่ายพร้อม filter ได้รับแล้ว', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      invoices: [
        {
          id: 'inv-p2',
          vendor_name: 'ผู้ขาย รอรับ คลิกการ์ด2',
          transaction_date: isoDaysFromNow(0),
          amount_excl_vat: 100,
          vat_amount: 7,
          expected_date: isoDaysFromNow(5),
          status: 'pending',
        },
        {
          id: 'inv-r2',
          vendor_name: 'ผู้ขาย ได้รับแล้ว คลิกการ์ด2',
          transaction_date: isoDaysFromNow(-3),
          amount_excl_vat: 100,
          vat_amount: 7,
          status: 'received',
          received_date: isoDaysFromNow(0),
          tax_invoice_number: 'INV-CLICK-2',
        },
      ],
    });
    await page.goto('/dashboard');

    await page.getByTestId('stat-received').click();

    await expect(page.getByRole('heading', { level: 1, name: 'บันทึกการจ่ายเงิน' })).toBeVisible();
    await expect(page.getByText('ผู้ขาย ได้รับแล้ว คลิกการ์ด2')).toBeVisible();
    await expect(page.getByText('ผู้ขาย รอรับ คลิกการ์ด2')).not.toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('คลิกการ์ด "VAT ที่รอรับ" พาไปหน้ารายงานภาษีซื้อ', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await page.getByTestId('stat-pending-vat').click();

    await expect(page.getByRole('heading', { level: 1, name: 'รายงานภาษีซื้อ' })).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('Quick Action "เพิ่มค่าใช้จ่าย" และ "Import Excel" เปิดฟอร์ม/แผงนำเข้าทันทีที่หน้าบันทึกค่าใช้จ่าย', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await page.getByTestId('quick-action-add-expense').click();
    await expect(page.getByRole('heading', { level: 1, name: 'บันทึกการจ่ายเงิน' })).toBeVisible();
    await expect(page.getByTestId('invoice-form')).toBeVisible();

    await page.getByTestId('nav-item-dashboard').click();
    await page.getByTestId('quick-action-import-excel').click();
    await expect(page.getByRole('heading', { level: 1, name: 'บันทึกการจ่ายเงิน' })).toBeVisible();
    await expect(page.getByTestId('excel-import-panel')).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('Quick Action "รายงานภาษีซื้อ" และ "รายงานภาษีขาย" พาไปหน้าที่ถูกต้อง', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await page.getByTestId('quick-action-purchase-tax-report').click();
    await expect(page.getByRole('heading', { level: 1, name: 'รายงานภาษีซื้อ' })).toBeVisible();

    await page.getByTestId('nav-item-dashboard').click();
    await page.getByTestId('quick-action-sales-tax-report').click();
    // รายงานภาษีขายยังไม่มีฟีเจอร์จริง (implemented: false) — ต้องขึ้นหน้า "เร็วๆ นี้" โดยไม่มี error
    await expect(page.getByTestId('coming-soon')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'รายงานภาษีขาย' })).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ปุ่ม "ดูทั้งหมด" ในรายการรอรับใบกำกับภาษีล่าสุดและรายการเกินกำหนด พาไปหน้าบันทึกค่าใช้จ่ายพร้อม filter รอรับ', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      invoices: [
        {
          id: 'inv-viewall',
          vendor_name: 'ผู้ขาย ดูทั้งหมด',
          transaction_date: isoDaysFromNow(0),
          amount_excl_vat: 100,
          vat_amount: 7,
          expected_date: isoDaysFromNow(5),
          status: 'pending',
        },
      ],
    });
    await page.goto('/dashboard');

    await page.getByTestId('view-all-pending').click();
    await expect(page.getByRole('heading', { level: 1, name: 'บันทึกการจ่ายเงิน' })).toBeVisible();
    await expect(page.getByText('ผู้ขาย ดูทั้งหมด')).toBeVisible();

    await page.getByTestId('nav-item-dashboard').click();
    await page.getByTestId('view-all-overdue').click();
    await expect(page.getByRole('heading', { level: 1, name: 'บันทึกการจ่ายเงิน' })).toBeVisible();
    await expect(page.getByText('ผู้ขาย ดูทั้งหมด')).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('รายการรอรับใบกำกับภาษีล่าสุดแสดงไม่เกิน 5 รายการแม้มีรายการรอรับมากกว่านั้น', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    const manyPending: MockSeedInvoice[] = Array.from({ length: 7 }, (_, i) => ({
      id: `inv-many-${i}`,
      vendor_name: `ผู้ขาย รอรับจำนวนมาก ${i}`,
      transaction_date: isoDaysFromNow(0),
      amount_excl_vat: 100,
      vat_amount: 7,
      expected_date: isoDaysFromNow(5),
      status: 'pending',
    }));
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      invoices: manyPending,
    });
    await page.goto('/dashboard');

    await expect(page.locator('[data-testid^="recent-pending-"]')).toHaveCount(5);

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('รายการเกินกำหนดแสดงไม่เกิน 5 รายการ และเลือกรายการที่เกินกำหนดนานสุดก่อนเสมอ', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    // เกินกำหนด 20-50 วัน (เรียงจากนานสุดไปน้อยสุด) — ต้องเห็นแค่ 5 อันดับแรก (นานสุด) เท่านั้น
    // ตัวที่เกินกำหนดน้อยสุด (index สุดท้าย) ต้องหลุดจากลิสต์
    const OVERDUE_OFFSETS = [-50, -45, -40, -35, -30, -25, -20];
    const manyOverdue: MockSeedInvoice[] = OVERDUE_OFFSETS.map((offset, i) => ({
      id: `inv-overdue-many-${i}`,
      vendor_name: `ผู้ขาย เกินกำหนดจำนวนมาก ${offset}`,
      transaction_date: isoDaysFromNow(offset - 5),
      amount_excl_vat: 100,
      vat_amount: 7,
      expected_date: isoDaysFromNow(offset),
      status: 'pending',
    }));
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      invoices: manyOverdue,
    });
    await page.goto('/dashboard');

    await expect(page.locator('[data-testid^="overdue-item-"]')).toHaveCount(5);
    await expect(page.getByTestId('overdue-item-inv-overdue-many-0')).toBeVisible();
    await expect(page.getByTestId('overdue-item-inv-overdue-many-6')).toHaveCount(0);

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });
});
