import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import * as XLSX from 'xlsx';
import { attachConsoleErrorCollector, gotoHiddenNavItem, setupMockSupabase } from './helpers';

const OWNER = 'user@example.com';

function buddhistYear(gregorianYear: number): number {
  return gregorianYear + 543;
}

// เปลี่ยนชื่อ describe block จาก "VAT Reconcile > Purchase Tax Report" เป็น "บัญชี > Purchase VAT
// Report" ตามโครงสร้าง Sidebar ใหม่ (รอบปรับโครงสร้าง Sidebar 2026-07-17) — หมวด "VAT Reconcile"
// (vat-reconcile) ถูกยุบเลิกไปทั้งหมดแล้ว เมนู "รายงานภาษีซื้อ" ย้ายไปอยู่ใต้หมวดใหม่ "บัญชี" (accounting)
// แทน (id/component/business logic ของหน้ารายงานเองไม่ถูกแก้ไขเลยแม้แต่บรรทัดเดียว)
test.describe('รายงานภาษีซื้อ (บัญชี > Purchase VAT Report)', () => {
  test('ขยายเมนู "บัญชี" เห็นเมนูย่อยรายงานภาษีซื้อ (รายงานภาษีขายถูกซ่อนจาก Sidebar แล้ว ไม่แสดงที่นี่)', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    // ทุกหมวดขยายอยู่แล้วโดยค่าเริ่มต้น รวมหมวดใหม่ "บัญชี" ด้วย
    await expect(page.getByTestId('nav-section-accounting')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('nav-item-purchase-tax-report')).toBeVisible();
    // "รายงานภาษีขาย" (sales-tax-report) ถูกเอาออกจาก Sidebar แล้วตามคำขอผู้ใช้ (หน้ายังอยู่ในโปรเจกต์
    // เข้าถึงได้ผ่าน Quick Action ในหน้า Dashboard ตามเดิม — ดู dashboardOverview.spec.ts) จึงต้องไม่มี
    // nav-item นี้ปรากฏใน Sidebar อีกต่อไป
    await expect(page.getByTestId('nav-item-sales-tax-report')).toHaveCount(0);

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  // เมนูนี้ถูกเอาออกจาก Sidebar แล้ว (รอบปรับโครงสร้าง Sidebar 2026-07-17 — "Sales VAT Report" อยู่ใน
  // ลิสต์ REMOVE FROM SIDEBAR) หน้า/component เดิมไม่ถูกแก้ไขเลย นำทางตรงผ่าน gotoHiddenNavItem แทนการ
  // คลิก Sidebar ที่ไม่มี nav-item นี้ให้คลิกอีกต่อไป
  test('เมนูรายงานภาษีขายยังไม่เปิดใช้งาน แสดงหน้า "เร็วๆ นี้" (ยังไม่ทำรอบนี้ตามที่ตกลงกัน)', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoHiddenNavItem(page, 'sales-tax-report');

    await expect(page.getByTestId('coming-soon')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'รายงานภาษีขาย' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('กรองตามเดือน/ปีที่ใช้เครดิต VAT ไม่ใช่วันที่ใบกำกับภาษีหรือวันที่ได้รับเอกสาร (ตัวอย่างจากสเปก)', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    const now = new Date();
    const currentMonthNum = now.getMonth() + 1;
    // เดือนถัดจากเดือนปัจจุบันเสมอ (ต่างจากเดือนปัจจุบันโดยคณิตศาสตร์การันตี) — ทำให้เทสต์นี้ไม่ขึ้นกับ
    // ว่าวันที่รันจริงคือเดือนไหน และบังคับให้ต้องเปลี่ยน filter จริงถึงจะเห็นรายการ ไม่ใช่เห็นเพราะค่า
    // เริ่มต้นของ filter บังเอิญตรงกัน
    const claimMonth = (currentMonthNum % 12) + 1;
    const claimYear = buddhistYear(claimMonth === 1 ? now.getFullYear() + 1 : now.getFullYear());
    const otherMonth = currentMonthNum;
    const otherYear = buddhistYear(now.getFullYear());

    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      invoices: [
        {
          id: 'inv-worked-example',
          vendor_name: 'บริษัท ตัวอย่าง จำกัด',
          transaction_date: '2026-06-28',
          amount_excl_vat: 1000,
          vat_amount: 70,
          status: 'received',
          received_date: '2026-07-05', // บริษัทได้รับเอกสารจริง 5 กรกฎาคม
          tax_invoice_number: 'TAX-INV-9999',
          tax_invoice_date: '2026-06-28', // ใบกำกับภาษีลงวันที่ 28 มิถุนายน
          vendor_tax_id: '1234567890123',
          vat_claim_month: claimMonth, // นำไปใช้เครดิต VAT ของเดือนถัดไป (คนละเดือนกับสองวันที่ข้างต้น)
          vat_claim_year: claimYear,
        },
      ],
    });
    await page.goto('/dashboard');
    await page.getByTestId('nav-item-purchase-tax-report').click();
    await expect(page.getByRole('heading', { level: 1, name: 'รายงานภาษีซื้อ' })).toBeVisible();

    // ตั้ง filter ไปที่เดือน/ปีอื่น (ไม่ใช่เดือนที่ใช้เครดิต VAT) — ต้องไม่เจอรายการนี้เลย
    await page.getByTestId('report-month-filter').selectOption(String(otherMonth));
    await page.getByTestId('report-year-filter').selectOption(String(otherYear));
    await expect(page.getByTestId('report-empty')).toBeVisible();

    // ตั้ง filter ไปที่เดือน/ปีที่ใช้เครดิต VAT จริง — ต้องเจอรายการ พร้อมคอลัมน์ครบตามสเปก
    await page.getByTestId('report-month-filter').selectOption(String(claimMonth));
    await page.getByTestId('report-year-filter').selectOption(String(claimYear));

    const row = page.getByTestId('report-row-inv-worked-example');
    await expect(row).toBeVisible();
    await expect(row).toContainText('28/06/2026'); // วันที่ใบกำกับภาษี (ไม่ใช่วันที่ได้รับเอกสาร 05/07)
    await expect(row).toContainText('TAX-INV-9999');
    await expect(row).toContainText('บริษัท ตัวอย่าง จำกัด');
    await expect(row).toContainText('1234567890123');

    // แถวสรุปยอดรวมท้ายตารางถูกต้อง
    await expect(page.getByTestId('report-total-excl-vat')).toContainText('1,000.00');
    await expect(page.getByTestId('report-total-vat')).toContainText('70.00');
    await expect(page.getByTestId('report-total-amount')).toContainText('1,070.00');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('รายการที่ยังไม่ได้รับ (pending) ไม่ปรากฏในรายงานภาษีซื้อ', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      invoices: [
        {
          id: 'inv-still-pending',
          vendor_name: 'ผู้ขาย ยังไม่ได้รับ',
          transaction_date: '2026-07-01',
          amount_excl_vat: 100,
          vat_amount: 7,
          status: 'pending',
        },
      ],
    });
    await page.goto('/dashboard');
    await page.getByTestId('nav-item-purchase-tax-report').click();

    await expect(page.getByTestId('report-empty')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('ปุ่ม Export Excel/PDF ดาวน์โหลดไฟล์ได้เมื่อมีข้อมูล และถูก disable เมื่อไม่มีข้อมูลในช่วงที่เลือก', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    const now = new Date();
    const claimMonth = now.getMonth() + 1;
    const claimYear = buddhistYear(now.getFullYear());

    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      invoices: [
        {
          id: 'inv-export',
          vendor_name: 'บริษัท ส่งออกรายงาน จำกัด',
          transaction_date: '2026-07-01',
          amount_excl_vat: 1000,
          vat_amount: 70,
          status: 'received',
          received_date: '2026-07-05',
          tax_invoice_number: 'TAX-EXPORT-001',
          tax_invoice_date: '2026-07-01',
          vat_claim_month: claimMonth,
          vat_claim_year: claimYear,
        },
      ],
    });
    await page.goto('/dashboard');
    await page.getByTestId('nav-item-purchase-tax-report').click();
    await expect(page.getByTestId('report-row-inv-export')).toBeVisible();

    // หมายเหตุ: ไม่ตรวจสอบชื่อไฟล์ที่ suggestedFilename() คืนมา เพราะ Chromium/CDP ในสภาพแวดล้อม
    // อัตโนมัตินี้รายงานชื่อไฟล์ที่มีอักขระไทยใน download attribute ของ blob: URL ไม่ถูกต้อง (คืนค่า
    // "download" เฉยๆ) แม้ในเบราว์เซอร์จริงของผู้ใช้จะได้ชื่อไทยถูกต้อง — เป็นข้อจำกัดของเครื่องมือ
    // ทดสอบเอง ไม่ใช่บั๊กของแอป (ดูหมายเหตุเดียวกันใน e2e/excelImport.spec.ts) ตรวจสอบเนื้อหาไฟล์ที่
    // ดาวน์โหลดจริงแทน ซึ่งเป็นการยืนยันที่หนักแน่นกว่าชื่อไฟล์อยู่แล้ว
    const [excelDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-excel').click(),
    ]);
    const excelPath = await excelDownload.path();
    expect(excelPath).not.toBeNull();
    const excelBuffer = readFileSync(excelPath!);
    expect(excelBuffer.byteLength).toBeGreaterThan(0);
    const excelWorkbook = XLSX.read(excelBuffer, { type: 'buffer' });
    const excelSheet = excelWorkbook.Sheets[excelWorkbook.SheetNames[0]];
    const excelAoa = XLSX.utils.sheet_to_json<unknown[]>(excelSheet, { header: 1 });
    expect(String(excelAoa[0][0])).toContain('รายงานภาษีซื้อ');
    expect(excelAoa.some((r) => r.includes('TAX-EXPORT-001'))).toBe(true);
    expect(excelAoa.some((r) => r.join('|').includes('รวมทั้งสิ้น'))).toBe(true);

    const [pdfDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-pdf').click(),
    ]);
    const pdfPath = await pdfDownload.path();
    expect(pdfPath).not.toBeNull();
    const pdfBuffer = readFileSync(pdfPath!);
    expect(pdfBuffer.byteLength).toBeGreaterThan(0);
    expect(pdfBuffer.subarray(0, 5).toString('ascii')).toBe('%PDF-'); // ไฟล์ PDF ที่ถูกต้องต้องขึ้นต้นด้วย magic bytes นี้เสมอ

    // เปลี่ยน filter ไปเดือนที่ไม่มีข้อมูล — ปุ่ม export ต้องถูก disable ไม่ให้ export ไฟล์เปล่า
    const emptyMonth = (claimMonth % 12) + 1;
    const emptyYear = emptyMonth === 1 ? claimYear + 1 : claimYear;
    await page.getByTestId('report-month-filter').selectOption(String(emptyMonth));
    await page.getByTestId('report-year-filter').selectOption(String(emptyYear));
    await expect(page.getByTestId('report-empty')).toBeVisible();
    await expect(page.getByTestId('export-excel')).toBeDisabled();
    await expect(page.getByTestId('export-pdf')).toBeDisabled();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('รายการไม่มี VAT และมี VAT แต่ไม่ใช้เครดิต VAT ไม่ปรากฏในรายงานภาษีซื้อ แม้สถานะและข้อมูลใบกำกับภาษีครบ', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    const now = new Date();
    const claimMonth = now.getMonth() + 1;
    const claimYear = buddhistYear(now.getFullYear());

    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      invoices: [
        {
          id: 'inv-report-no-vat',
          vendor_name: 'ผู้ขาย รายงานไม่มีVAT',
          transaction_date: '2026-07-01',
          amount_excl_vat: 100,
          vat_amount: 0,
          status: 'received',
          received_date: '2026-07-01',
          tax_invoice_number: 'SHOULD-NOT-APPEAR-1',
          tax_invoice_date: '2026-07-01',
          vat_claim_month: claimMonth,
          vat_claim_year: claimYear,
          tax_type: 'no_vat',
        },
        {
          id: 'inv-report-non-claimable',
          vendor_name: 'ผู้ขาย รายงานไม่ใช้เครดิต',
          transaction_date: '2026-07-01',
          amount_excl_vat: 200,
          vat_amount: 14,
          status: 'received',
          received_date: '2026-07-01',
          tax_invoice_number: 'SHOULD-NOT-APPEAR-2',
          tax_invoice_date: '2026-07-01',
          vat_claim_month: claimMonth,
          vat_claim_year: claimYear,
          tax_type: 'non_claimable_vat',
        },
        {
          id: 'inv-report-claimable',
          vendor_name: 'ผู้ขาย รายงานปกติ',
          transaction_date: '2026-07-01',
          amount_excl_vat: 300,
          vat_amount: 21,
          status: 'received',
          received_date: '2026-07-01',
          tax_invoice_number: 'SHOULD-APPEAR',
          tax_invoice_date: '2026-07-01',
          vat_claim_month: claimMonth,
          vat_claim_year: claimYear,
          tax_type: 'claimable_vat',
        },
      ],
    });
    await page.goto('/dashboard');
    await page.getByTestId('nav-item-purchase-tax-report').click();
    await page.getByTestId('report-month-filter').selectOption(String(claimMonth));
    await page.getByTestId('report-year-filter').selectOption(String(claimYear));

    await expect(page.getByTestId('report-row-inv-report-claimable')).toBeVisible();
    await expect(page.getByTestId('report-row-inv-report-no-vat')).toHaveCount(0);
    await expect(page.getByTestId('report-row-inv-report-non-claimable')).toHaveCount(0);
    await expect(page.getByText('SHOULD-NOT-APPEAR-1')).not.toBeVisible();
    await expect(page.getByText('SHOULD-NOT-APPEAR-2')).not.toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('รายการเก่าที่ tax_type เป็น NULL (ก่อนมีฟีเจอร์จำแนกประเภทภาษี) ยังปรากฏในรายงานภาษีซื้อได้ตามเดิม', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    const now = new Date();
    const claimMonth = now.getMonth() + 1;
    const claimYear = buddhistYear(now.getFullYear());

    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      invoices: [
        {
          id: 'inv-legacy-in-report',
          vendor_name: 'ผู้ขาย ข้อมูลเก่าในรายงาน',
          transaction_date: '2026-07-01',
          amount_excl_vat: 400,
          vat_amount: 28,
          status: 'received',
          received_date: '2026-07-01',
          tax_invoice_number: 'LEGACY-001',
          tax_invoice_date: '2026-07-01',
          vat_claim_month: claimMonth,
          vat_claim_year: claimYear,
          // ไม่ระบุ tax_type — จำลองข้อมูลเก่าก่อนมีฟีเจอร์นี้ (NULL ในฐานข้อมูลจริง)
        },
      ],
    });
    await page.goto('/dashboard');
    await page.getByTestId('nav-item-purchase-tax-report').click();
    await page.getByTestId('report-month-filter').selectOption(String(claimMonth));
    await page.getByTestId('report-year-filter').selectOption(String(claimYear));

    await expect(page.getByTestId('report-row-inv-legacy-in-report')).toBeVisible();
    await expect(page.getByText('LEGACY-001')).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });
});
