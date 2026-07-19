import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import * as XLSX from 'xlsx';
import {
  attachConsoleErrorCollector,
  gotoHiddenNavItem,
  gotoOverduePurchaseTax,
  isoDaysFromNow,
  setupMockSupabase,
} from './helpers';

const OWNER = 'user@example.com';

test.describe('ภาษีซื้อที่ยังไม่ได้รับ (Overdue Purchase Tax Report)', () => {
  // อัปเดต 2026-07-17 (รอบปรับโครงสร้าง Sidebar): เมนูนี้ถูกเอาออกจาก Sidebar แล้ว ("Outstanding
  // Purchase VAT" อยู่ในลิสต์ REMOVE FROM SIDEBAR) จึงไม่มี nav-item ให้ตรวจ/คลิกใน Sidebar อีกต่อไป —
  // นำทางตรงผ่าน gotoHiddenNavItem แทน หน้า/component/business logic เดิมไม่ถูกแก้ไขเลยแม้แต่บรรทัดเดียว
  // (ตัดส่วน "เมนู Sidebar แสดงชื่อใหม่" ออกจากชื่อเทสต์เพราะไม่มีเมนูใน Sidebar ให้ตรวจแล้ว)
  test('เปิดหน้าได้จริง (ไม่ใช่ "เร็วๆ นี้" อีกต่อไป) และ Empty State ตรงตามสเปก', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoHiddenNavItem(page, 'overdue-purchase-tax');

    await expect(page.getByTestId('coming-soon')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'ภาษีซื้อที่ยังไม่ได้รับ' })).toBeVisible();
    await expect(page.getByText('ติดตามใบกำกับภาษีซื้อที่บันทึกค่าใช้จ่ายแล้วแต่ยังไม่ได้รับเอกสาร')).toBeVisible();

    await expect(page.getByTestId('overdue-report-empty')).toBeVisible();
    await expect(page.getByTestId('overdue-report-empty')).toContainText('ไม่มีรายการใบกำกับภาษีที่รอรับ');
    await expect(page.getByTestId('overdue-report-empty')).toContainText('รายการที่ได้รับเอกสารครบแล้วจะไม่แสดงในหน้านี้');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('แสดงเฉพาะรายการที่มี VAT และยังไม่ได้รับเอกสาร ซ่อนรายการไม่มี VAT / มี VAT แต่ไม่ใช้เครดิต / ได้รับแล้ว / ยกเลิก', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      invoices: [
        {
          id: 'inv-should-show',
          vendor_name: 'บริษัท ควรแสดง จำกัด',
          transaction_date: '2026-07-01',
          amount_excl_vat: 1000,
          vat_amount: 70,
          status: 'pending',
          expected_date: '2026-07-25',
          tax_type: 'claimable_vat',
        },
        {
          id: 'inv-no-vat',
          vendor_name: 'ผู้ขาย ไม่มี VAT',
          transaction_date: '2026-07-01',
          amount_excl_vat: 100,
          vat_amount: 0,
          status: 'received',
          expected_date: null,
          tax_type: 'no_vat',
        },
        {
          id: 'inv-non-claimable',
          vendor_name: 'ผู้ขาย ไม่ใช้เครดิต',
          transaction_date: '2026-07-01',
          amount_excl_vat: 200,
          vat_amount: 14,
          status: 'received',
          expected_date: null,
          tax_type: 'non_claimable_vat',
        },
        {
          id: 'inv-already-received',
          vendor_name: 'ผู้ขาย ได้รับแล้ว',
          transaction_date: '2026-07-01',
          amount_excl_vat: 300,
          vat_amount: 21,
          status: 'received',
          received_date: '2026-07-10',
          tax_invoice_number: 'TAX-001',
          expected_date: '2026-07-20',
          tax_type: 'claimable_vat',
        },
        {
          id: 'inv-cancelled',
          vendor_name: 'ผู้ขาย ยกเลิก',
          transaction_date: '2026-07-01',
          amount_excl_vat: 400,
          vat_amount: 28,
          status: 'cancelled',
          expected_date: '2026-07-20',
          tax_type: 'claimable_vat',
        },
      ],
    });
    await gotoOverduePurchaseTax(page);

    // เหลือแค่เดือนเดียว (กรกฎาคม) เพราะรายการอื่นทั้งหมดถูกกรองออกตั้งแต่ base query ไม่มีทางสร้างแถวเดือนได้
    await expect(page.locator('[data-testid^="overdue-report-month-row-"]')).toHaveCount(1);
    await expect(page.getByTestId('overdue-report-kpi-item-count')).toContainText('1');

    await page.getByTestId('overdue-report-month-toggle-2026-07').click();
    await expect(page.getByTestId('overdue-report-vendor-toggle-2026-07-0')).toContainText('บริษัท ควรแสดง จำกัด');

    await expect(page.getByText('ผู้ขาย ไม่มี VAT')).toHaveCount(0);
    await expect(page.getByText('ผู้ขาย ไม่ใช้เครดิต')).toHaveCount(0);
    await expect(page.getByText('ผู้ขาย ได้รับแล้ว')).toHaveCount(0);
    await expect(page.getByText('ผู้ขาย ยกเลิก')).toHaveCount(0);

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('รายการเก่าที่ tax_type เป็น NULL ยังถือเป็นรายการที่ต้องติดตาม (ปฏิบัติเหมือน claimable_vat)', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      invoices: [
        {
          id: 'inv-legacy',
          vendor_name: 'ผู้ขาย ข้อมูลเก่า',
          transaction_date: '2026-07-01',
          amount_excl_vat: 500,
          vat_amount: 35,
          status: 'pending',
          expected_date: '2026-07-20',
          // ไม่ระบุ tax_type — จำลองข้อมูลเก่าก่อนมีฟีเจอร์จำแนกประเภทภาษี (NULL ในฐานข้อมูลจริง)
        },
      ],
    });
    await gotoOverduePurchaseTax(page);

    await expect(page.getByTestId('overdue-report-kpi-item-count')).toContainText('1');
    await page.getByTestId('overdue-report-month-toggle-2026-07').click();
    await expect(page.getByTestId('overdue-report-vendor-toggle-2026-07-0')).toContainText('ผู้ขาย ข้อมูลเก่า');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('จัดกลุ่มตามเดือนของวันที่คาดว่าจะได้รับ เรียงเดือนล่าสุดก่อน และรายการไม่ระบุวันที่อยู่กลุ่มท้ายสุดเสมอ', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      invoices: [
        {
          id: 'inv-aug',
          vendor_name: 'ผู้ขาย สิงหาคม',
          transaction_date: '2026-07-01',
          amount_excl_vat: 100,
          vat_amount: 7,
          status: 'pending',
          expected_date: '2026-08-10',
          tax_type: 'claimable_vat',
        },
        {
          id: 'inv-jul',
          vendor_name: 'ผู้ขาย กรกฎาคม',
          transaction_date: '2026-07-01',
          amount_excl_vat: 200,
          vat_amount: 14,
          status: 'pending',
          expected_date: '2026-07-15',
          tax_type: 'claimable_vat',
        },
        {
          id: 'inv-jun',
          vendor_name: 'ผู้ขาย มิถุนายน',
          transaction_date: '2026-06-01',
          amount_excl_vat: 300,
          vat_amount: 21,
          status: 'pending',
          expected_date: '2026-06-05',
          tax_type: 'claimable_vat',
        },
        {
          id: 'inv-no-date',
          vendor_name: 'ผู้ขาย ไม่ระบุวันที่',
          transaction_date: '2026-07-01',
          amount_excl_vat: 400,
          vat_amount: 28,
          status: 'pending',
          expected_date: null,
          tax_type: 'claimable_vat',
        },
      ],
    });
    await gotoOverduePurchaseTax(page);

    const rows = page.locator('[data-testid^="overdue-report-month-row-"]');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toHaveAttribute('data-testid', 'overdue-report-month-row-2026-08');
    await expect(rows.nth(1)).toHaveAttribute('data-testid', 'overdue-report-month-row-2026-07');
    await expect(rows.nth(2)).toHaveAttribute('data-testid', 'overdue-report-month-row-2026-06');
    await expect(rows.nth(3)).toHaveAttribute('data-testid', 'overdue-report-month-row-unspecified');
    await expect(rows.nth(0)).toContainText('สิงหาคม 2026');
    await expect(rows.nth(1)).toContainText('กรกฎาคม 2026');
    await expect(rows.nth(2)).toContainText('มิถุนายน 2026');
    await expect(rows.nth(3)).toContainText('ยังไม่ระบุเดือนที่คาดว่าจะได้รับ');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('คำนวณสถานะ "ยังไม่ถึงกำหนด" / "เกินกำหนด" ถูกต้องตามวันที่คาดว่าจะได้รับเทียบกับวันนี้', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      invoices: [
        {
          id: 'inv-not-due',
          vendor_name: 'ผู้ขาย ยังไม่ถึงกำหนด',
          transaction_date: isoDaysFromNow(-10),
          amount_excl_vat: 100,
          vat_amount: 7,
          status: 'pending',
          expected_date: isoDaysFromNow(5), // อีก 5 วันถึงกำหนด
          tax_type: 'claimable_vat',
        },
        {
          id: 'inv-overdue',
          vendor_name: 'ผู้ขาย เกินกำหนดแล้ว',
          transaction_date: isoDaysFromNow(-20),
          amount_excl_vat: 200,
          vat_amount: 14,
          status: 'pending',
          expected_date: isoDaysFromNow(-12), // เกินกำหนดมาแล้ว 12 วัน
          tax_type: 'claimable_vat',
        },
      ],
    });
    await gotoOverduePurchaseTax(page);

    // สองรายการนี้อาจอยู่คนละเดือนกันหรือเดือนเดียวกันก็ได้ ขึ้นกับวันที่รันเทสต์จริง — ขยายทุกแถวเดือน
    // ที่มีให้หมดก่อน แล้วค่อยหาปุ่มขยายผู้ขายด้วยชื่อ (ไม่อิง index) เพื่อไม่ให้เทสต์ผูกกับวันที่รันเทสต์
    const monthToggles = page.locator('[data-testid^="overdue-report-month-toggle-"]');
    const monthCount = await monthToggles.count();
    for (let i = 0; i < monthCount; i++) {
      await monthToggles.nth(i).click();
    }
    await page.getByRole('button', { name: /ผู้ขาย ยังไม่ถึงกำหนด/ }).click();
    await page.getByRole('button', { name: /ผู้ขาย เกินกำหนดแล้ว/ }).click();

    await expect(page.getByTestId('overdue-report-aging-inv-not-due')).toContainText('เหลือ 5 วัน');
    await expect(page.getByTestId('overdue-report-aging-inv-overdue')).toContainText('เกินกำหนด 12 วัน');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('KPI Cards คำนวณตรงกับรายการที่ผ่านตัวกรองปัจจุบัน (จำนวนรายการ/บริษัท/ยอดก่อน VAT/VAT/เกินกำหนด)', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      invoices: [
        {
          id: 'inv-kpi-1',
          vendor_name: 'บริษัท เอ จำกัด',
          transaction_date: '2026-07-01',
          amount_excl_vat: 1000,
          vat_amount: 70,
          status: 'pending',
          expected_date: isoDaysFromNow(10),
          tax_type: 'claimable_vat',
        },
        {
          id: 'inv-kpi-2',
          vendor_name: 'บริษัท บี จำกัด',
          transaction_date: '2026-07-01',
          amount_excl_vat: 2000,
          vat_amount: 140,
          status: 'pending',
          expected_date: isoDaysFromNow(-3),
          tax_type: 'claimable_vat',
        },
        {
          id: 'inv-kpi-3',
          vendor_name: 'บริษัท เอ จำกัด',
          transaction_date: '2026-07-02',
          amount_excl_vat: 500,
          vat_amount: 35,
          status: 'pending',
          expected_date: isoDaysFromNow(-1),
          tax_type: 'claimable_vat',
        },
      ],
    });
    await gotoOverduePurchaseTax(page);

    // 3 รายการ, 2 บริษัท (เอ ซ้ำ), ยอดก่อน VAT รวม 3,500 VAT รวม 245 เกินกำหนด 2 รายการ (kpi-2, kpi-3)
    await expect(page.getByTestId('overdue-report-kpi-item-count')).toContainText('3');
    await expect(page.getByTestId('overdue-report-kpi-vendor-count')).toContainText('2');
    await expect(page.getByTestId('overdue-report-kpi-amount-excl-vat')).toContainText('3,500.00');
    await expect(page.getByTestId('overdue-report-kpi-vat-amount')).toContainText('245.00');
    await expect(page.getByTestId('overdue-report-kpi-overdue-count')).toContainText('2');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('กด "ดูรายละเอียด" ขยายแถวเดือน เห็นรายการแยกตามผู้ขาย และเปิด modal ดูรายละเอียดรายการเดี่ยวได้', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      invoices: [
        {
          id: 'inv-detail-1',
          vendor_name: 'บริษัท รายละเอียด จำกัด',
          transaction_date: '2026-07-01',
          description: 'ค่าสินค้าทดสอบ',
          amount_excl_vat: 1000,
          vat_amount: 70,
          reference_no: 'PO-DETAIL-1',
          status: 'pending',
          expected_date: '2026-07-20',
          tax_type: 'claimable_vat',
        },
      ],
    });
    await gotoOverduePurchaseTax(page);

    const monthPanel = page.getByTestId('overdue-report-month-detail-2026-07');
    await expect(monthPanel).not.toBeVisible();

    await page.getByTestId('overdue-report-month-toggle-2026-07').click();
    await expect(monthPanel).toBeVisible();

    await page.getByTestId('overdue-report-vendor-toggle-2026-07-0').click();
    await expect(page.getByTestId('overdue-report-invoice-row-inv-detail-1')).toBeVisible();
    await expect(page.getByTestId('overdue-report-invoice-row-inv-detail-1')).toContainText('PO-DETAIL-1');

    await page.getByTestId('overdue-report-view-inv-detail-1').click();
    await expect(page.getByTestId('overdue-report-detail-modal')).toBeVisible();
    await expect(page.getByTestId('overdue-report-detail-modal')).toContainText('ค่าสินค้าทดสอบ');
    await page.getByTestId('overdue-report-detail-close').click();
    await expect(page.getByTestId('overdue-report-detail-modal')).toHaveCount(0);

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ปุ่ม "แก้ไข" พาไปหน้า "บันทึกการจ่ายเงิน" พร้อมเปิดฟอร์มแก้ไขรายการนั้นล่วงหน้าให้ทันที (ใช้ InvoiceForm เดิม)', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      invoices: [
        {
          id: 'inv-to-edit',
          vendor_name: 'บริษัท แก้ไขทดสอบ จำกัด',
          transaction_date: '2026-07-01',
          amount_excl_vat: 1500,
          vat_amount: 105,
          reference_no: 'PO-EDIT-1',
          status: 'pending',
          expected_date: '2026-07-20',
          tax_type: 'claimable_vat',
        },
      ],
    });
    await gotoOverduePurchaseTax(page);

    await page.getByTestId('overdue-report-month-toggle-2026-07').click();
    await page.getByTestId('overdue-report-vendor-toggle-2026-07-0').click();
    await page.getByTestId('overdue-report-edit-inv-to-edit').click();

    await expect(page.getByRole('heading', { level: 1, name: 'บันทึกการจ่ายเงิน' })).toBeVisible();
    await expect(page.getByTestId('invoice-form')).toBeVisible();
    await expect(page.getByText('แก้ไขรายการ')).toBeVisible();
    await expect(page.getByTestId('input-vendor-name')).toHaveValue('บริษัท แก้ไขทดสอบ จำกัด');
    await expect(page.getByTestId('input-reference-no')).toHaveValue('PO-EDIT-1');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('มาร์ค "ได้รับใบกำกับภาษีแล้ว" ทำให้รายการหายจากหน้านี้ทันที และไปปรากฏในรายงานภาษีซื้อของเดือน/ปีที่เลือกไว้', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      invoices: [
        {
          id: 'inv-to-mark',
          vendor_name: 'บริษัท มาร์คได้รับ จำกัด',
          transaction_date: '2026-07-01',
          amount_excl_vat: 1000,
          vat_amount: 70,
          status: 'pending',
          expected_date: '2026-07-20',
          tax_type: 'claimable_vat',
        },
      ],
    });
    await gotoOverduePurchaseTax(page);

    await page.getByTestId('overdue-report-month-toggle-2026-07').click();
    await page.getByTestId('overdue-report-vendor-toggle-2026-07-0').click();

    const markReceivedButton = page.getByTestId('overdue-report-mark-received-inv-to-mark');
    await markReceivedButton.click();

    await page.getByTestId('overdue-report-tax-invoice-number-input-inv-to-mark').fill('TAX-MARK-001');
    await page.getByTestId('overdue-report-tax-invoice-date-input-inv-to-mark').fill('2026-07-15');

    // เดือน/ปีที่ใช้เครดิต VAT มีค่าเริ่มต้นเป็นเดือน/ปีปัจจุบันอยู่แล้ว (ดู OverdueMonthDetail.tsx
    // startReceiving) — อ่านค่าที่เลือกอยู่มาใช้ต่อเพื่อไปตรวจสอบที่หน้ารายงานภาษีซื้อให้ตรงกันแน่นอน
    // โดยไม่ต้อง hardcode เดือน/ปีปัจจุบันซ้ำเอง
    const claimMonth = await page.getByTestId('overdue-report-vat-claim-month-select-inv-to-mark').inputValue();
    const claimYear = await page.getByTestId('overdue-report-vat-claim-year-select-inv-to-mark').inputValue();

    await page.getByTestId('overdue-report-confirm-received-inv-to-mark').click();

    // รายการหายจากหน้านี้ทันที (ไม่ผ่าน filterUnreceivedPurchaseTax อีกต่อไปเพราะ status ไม่ใช่ pending แล้ว)
    await expect(page.getByTestId('overdue-report-empty')).toBeVisible();

    // ไปโผล่ในรายงานภาษีซื้อของเดือน/ปีที่เลือกไว้ตอนมาร์ค (คนละหน้า อ่าน SWR cache เดียวกัน)
    await page.getByTestId('nav-item-purchase-tax-report').click();
    await page.getByTestId('report-month-filter').selectOption(claimMonth);
    await page.getByTestId('report-year-filter').selectOption(claimYear);
    await expect(page.getByTestId('report-row-inv-to-mark')).toBeVisible();
    await expect(page.getByTestId('report-row-inv-to-mark')).toContainText('TAX-MARK-001');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ตัวกรองเดือน/ปี/สถานะ/ผู้ขาย/ค้นหา ทำงานถูกต้อง และปุ่มล้างตัวกรองรีเซ็ตกลับเป็นค่าเริ่มต้น', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      invoices: [
        {
          id: 'inv-filter-a',
          vendor_name: 'บริษัท กรองเอ จำกัด',
          transaction_date: '2026-07-01',
          description: 'ค่าเช่าสำนักงาน',
          amount_excl_vat: 1000,
          vat_amount: 70,
          status: 'pending',
          expected_date: isoDaysFromNow(5),
          tax_type: 'claimable_vat',
        },
        {
          id: 'inv-filter-b',
          vendor_name: 'บริษัท กรองบี จำกัด',
          transaction_date: '2026-07-01',
          description: 'ค่าน้ำมันรถขนส่ง',
          amount_excl_vat: 2000,
          vat_amount: 140,
          status: 'pending',
          expected_date: isoDaysFromNow(-5),
          tax_type: 'claimable_vat',
        },
      ],
    });
    await gotoOverduePurchaseTax(page);
    await expect(page.getByTestId('overdue-report-kpi-item-count')).toContainText('2');

    // กรองตามสถานะ "เกินกำหนด" — ควรเหลือแค่ inv-filter-b
    await page.getByTestId('overdue-report-status-filter').selectOption('overdue');
    await expect(page.getByTestId('overdue-report-kpi-item-count')).toContainText('1');
    await page.getByTestId('overdue-report-clear-filters').click();
    await expect(page.getByTestId('overdue-report-kpi-item-count')).toContainText('2');

    // กรองตามผู้ขาย
    await page.getByTestId('overdue-report-vendor-filter').selectOption('บริษัท กรองเอ จำกัด');
    await expect(page.getByTestId('overdue-report-kpi-item-count')).toContainText('1');
    await page.getByTestId('overdue-report-clear-filters').click();

    // ค้นหาด้วยคำในรายละเอียด — ต้องกดปุ่ม "ค้นหา" ก่อนถึงจะมีผล (ไม่ใช่ filter สดแบบ dropdown)
    await page.getByTestId('overdue-report-search-input').fill('น้ำมัน');
    await expect(page.getByTestId('overdue-report-kpi-item-count')).toContainText('2'); // ยังไม่กดค้นหา ยังไม่มีผล
    await page.getByTestId('overdue-report-search-submit').click();
    await expect(page.getByTestId('overdue-report-kpi-item-count')).toContainText('1');
    await expect(page.getByTestId('overdue-report-kpi-vendor-count')).toContainText('1');

    await page.getByTestId('overdue-report-clear-filters').click();
    await expect(page.getByTestId('overdue-report-kpi-item-count')).toContainText('2');
    await expect(page.getByTestId('overdue-report-search-input')).toHaveValue('');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('Export Excel/PDF ดาวน์โหลดไฟล์ตามตัวกรองปัจจุบันได้ถูกต้อง และปุ่ม Export ถูก disable เมื่อไม่มีข้อมูล', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      invoices: [
        {
          id: 'inv-export-1',
          vendor_name: 'บริษัท ส่งออกทดสอบ จำกัด',
          transaction_date: '2026-07-01',
          amount_excl_vat: 1000,
          vat_amount: 70,
          reference_no: 'PO-EXPORT-1',
          status: 'pending',
          expected_date: '2026-07-20',
          tax_type: 'claimable_vat',
        },
      ],
    });
    await gotoOverduePurchaseTax(page);
    await expect(page.getByTestId('overdue-report-kpi-item-count')).toContainText('1');

    const [excelDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('overdue-report-export-excel').click(),
    ]);
    const excelPath = await excelDownload.path();
    expect(excelPath).not.toBeNull();
    const excelBuffer = readFileSync(excelPath!);
    expect(excelBuffer.byteLength).toBeGreaterThan(0);
    const workbook = XLSX.read(excelBuffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
    expect(String(aoa[0][0])).toContain('รายงานใบกำกับภาษีซื้อที่ยังไม่ได้รับ');
    const flat = aoa.map((r) => r.join('|')).join('\n');
    expect(flat).toContain('บริษัท ส่งออกทดสอบ จำกัด');
    expect(flat).toContain('PO-EXPORT-1');
    expect(flat).toContain('รวมทั้งสิ้น (1 รายการ)');

    const [pdfDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('overdue-report-export-pdf').click(),
    ]);
    const pdfPath = await pdfDownload.path();
    expect(pdfPath).not.toBeNull();
    const pdfBuffer = readFileSync(pdfPath!);
    expect(pdfBuffer.byteLength).toBeGreaterThan(0);
    expect(pdfBuffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    // เปลี่ยนตัวกรองไปสถานะที่ไม่มีข้อมูล — ปุ่ม export ต้องถูก disable ไม่ให้ export ไฟล์เปล่า
    await page.getByTestId('overdue-report-status-filter').selectOption('no_date');
    await expect(page.getByTestId('overdue-report-empty')).toBeVisible();
    await expect(page.getByTestId('overdue-report-export-excel')).toBeDisabled();
    await expect(page.getByTestId('overdue-report-export-pdf')).toBeDisabled();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });
});
