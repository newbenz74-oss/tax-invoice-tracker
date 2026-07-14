import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import * as XLSX from 'xlsx';
import { attachConsoleErrorCollector, isoDaysFromNow, setupMockSupabase } from './helpers';
import { EXCEL_HEADERS, EXCEL_HEADER_ORDER } from '../lib/excelImport';

const OWNER = 'user@example.com';

/** สร้างไฟล์ Excel (.xlsx) เป็น Buffer ในหน่วยความจำ สำหรับอัปโหลดผ่าน setInputFiles โดยไม่ต้องเขียนลงดิสก์ */
function buildWorkbookBuffer(rows: Record<string, unknown>[]): Buffer {
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: EXCEL_HEADER_ORDER });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'รายการ');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

test.describe('นำเข้ารายการจาก Excel', () => {
  test('ดาวน์โหลดเทมเพลต แล้วนำเข้าไฟล์: แถวถูกต้องถูกบันทึก แถวมีปัญหาถูกข้าม', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await page.getByTestId('open-import-panel').click();
    await expect(page.getByTestId('excel-import-panel')).toBeVisible();

    // ปุ่มดาวน์โหลดเทมเพลตต้องทำงานได้จริงในเบราว์เซอร์ (ไม่ throw) — จุดนี้ jsdom/vitest ทดสอบไม่ได้
    // เพราะ URL.createObjectURL และการคลิก <a download> ต้องใช้เบราว์เซอร์จริง
    // หมายเหตุ: ไม่ตรวจสอบชื่อไฟล์ที่ suggestedFilename() คืนมา เพราะ Chromium/CDP ในสภาพแวดล้อม
    // อัตโนมัตินี้รายงานชื่อไฟล์ที่มีอักขระไทยใน download attribute ของ blob: URL ไม่ถูกต้อง
    // (คืนค่า "download" เฉยๆ) แม้ในเบราว์เซอร์จริงของผู้ใช้จะได้ชื่อไทยถูกต้อง — ยืนยันแล้วว่าเป็น
    // ข้อจำกัดของเครื่องมือทดสอบเอง ไม่ใช่บั๊กของแอป (ทดสอบแยกด้วยชื่อไฟล์ภาษาอังกฤษได้ผลถูกต้อง)
    // ตรวจสอบเนื้อหาไฟล์ที่ดาวน์โหลดจริงแทน ซึ่งเป็นการยืนยันที่หนักแน่นกว่าชื่อไฟล์อยู่แล้ว
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('download-template').click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    const downloadedBuffer = readFileSync(downloadPath!);
    expect(downloadedBuffer.byteLength).toBeGreaterThan(0);
    const downloadedWorkbook = XLSX.read(downloadedBuffer, { type: 'buffer' });
    const downloadedSheet = downloadedWorkbook.Sheets[downloadedWorkbook.SheetNames[0]];
    const downloadedRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(downloadedSheet, { defval: '' });
    expect(downloadedRows).toHaveLength(1);
    expect(downloadedRows[0][EXCEL_HEADERS.vendor_name]).toBe('บริษัท ตัวอย่าง จำกัด');

    const buffer = buildWorkbookBuffer([
      {
        [EXCEL_HEADERS.vendor_name]: 'บริษัท นำเข้า หนึ่ง จำกัด',
        [EXCEL_HEADERS.transaction_date]: isoDaysFromNow(0),
        [EXCEL_HEADERS.description]: 'ค่าสินค้า',
        [EXCEL_HEADERS.amount_excl_vat]: 1000,
        [EXCEL_HEADERS.vat_amount]: '',
        [EXCEL_HEADERS.reference_no]: 'PO-100',
        [EXCEL_HEADERS.expected_date]: '',
        [EXCEL_HEADERS.notes]: '',
      },
      {
        [EXCEL_HEADERS.vendor_name]: 'บริษัท นำเข้า สอง จำกัด',
        [EXCEL_HEADERS.transaction_date]: isoDaysFromNow(-1),
        [EXCEL_HEADERS.description]: 'ค่าบริการ',
        [EXCEL_HEADERS.amount_excl_vat]: 2000,
        [EXCEL_HEADERS.vat_amount]: 100,
        [EXCEL_HEADERS.reference_no]: 'PO-101',
        [EXCEL_HEADERS.expected_date]: '',
        [EXCEL_HEADERS.notes]: '',
      },
      {
        // แถวผิดพลาด: ไม่กรอกผู้ขาย — ต้องถูกตีว่ามีปัญหาและไม่ถูกนำเข้า
        [EXCEL_HEADERS.vendor_name]: '',
        [EXCEL_HEADERS.transaction_date]: isoDaysFromNow(0),
        [EXCEL_HEADERS.description]: '',
        [EXCEL_HEADERS.amount_excl_vat]: 500,
        [EXCEL_HEADERS.vat_amount]: '',
        [EXCEL_HEADERS.reference_no]: '',
        [EXCEL_HEADERS.expected_date]: '',
        [EXCEL_HEADERS.notes]: '',
      },
    ]);

    await page.getByTestId('excel-file-input').setInputFiles({
      name: 'นำเข้าทดสอบ.xlsx',
      mimeType: XLSX_MIME,
      buffer,
    });

    await expect(page.getByTestId('valid-count')).toContainText('พร้อมนำเข้า 2 รายการ');
    await expect(page.getByTestId('invalid-count')).toContainText('มีปัญหา 1 รายการ');

    await page.getByTestId('confirm-import').click();

    // แผงนำเข้าปิดหลังนำเข้าสำเร็จ
    await expect(page.getByTestId('excel-import-panel')).not.toBeVisible();

    // ค่าเริ่มต้นของ filter คือ "รอรับ" (pending) — แถวที่ import เข้ามาสถานะ pending จึงต้องเห็นทันที
    await expect(page.getByText('บริษัท นำเข้า หนึ่ง จำกัด')).toBeVisible();
    await expect(page.getByText('บริษัท นำเข้า สอง จำกัด')).toBeVisible();
    // แถวที่ไม่ผ่านการตรวจสอบต้องไม่ถูกบันทึกลงระบบ
    await expect(page.getByText('500.00')).not.toBeVisible();

    // แถวที่ 1: ไม่กรอก VAT มา ต้องถูกเสนอ 7% อัตโนมัติ (1000 + 70 = 1,070.00)
    await expect(page.getByText('1,070.00')).toBeVisible();
    // แถวที่ 2: กรอก VAT เองมา 100 (2000 + 100 = 2,100.00)
    await expect(page.getByText('2,100.00')).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ทุกแถวมีปัญหา — ปุ่มนำเข้าถูกปิดใช้งาน', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await page.getByTestId('open-import-panel').click();

    const buffer = buildWorkbookBuffer([
      {
        [EXCEL_HEADERS.vendor_name]: 'ผู้ขาย ข้อมูลไม่ครบ',
        [EXCEL_HEADERS.transaction_date]: isoDaysFromNow(0),
        [EXCEL_HEADERS.description]: '',
        [EXCEL_HEADERS.amount_excl_vat]: '', // ไม่กรอกยอดก่อน VAT — ทำให้แถวนี้ผิดพลาด
        [EXCEL_HEADERS.vat_amount]: '',
        [EXCEL_HEADERS.reference_no]: '',
        [EXCEL_HEADERS.expected_date]: '',
        [EXCEL_HEADERS.notes]: '',
      },
    ]);

    await page.getByTestId('excel-file-input').setInputFiles({
      name: 'ทดสอบผิดพลาดทั้งหมด.xlsx',
      mimeType: XLSX_MIME,
      buffer,
    });

    await expect(page.getByTestId('invalid-count')).toContainText('มีปัญหา 1 รายการ');
    await expect(page.getByTestId('confirm-import')).toBeDisabled();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('อัปโหลดไฟล์ที่ไม่มีข้อมูลเลย — แจ้งเตือนผู้ใช้', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await page.getByTestId('open-import-panel').click();

    const buffer = buildWorkbookBuffer([]);
    await page.getByTestId('excel-file-input').setInputFiles({
      name: 'ไฟล์ว่าง.xlsx',
      mimeType: XLSX_MIME,
      buffer,
    });

    // ใช้ getByText แทน getByRole('alert') เพราะ Next.js แทรก <div role="alert"> ของตัวเอง
    // (route announcer สำหรับ accessibility) ไว้ในทุกหน้าอยู่แล้ว ทำให้ getByRole('alert') เจอ 2 elements
    await expect(page.getByText('ไม่พบข้อมูลในไฟล์', { exact: false })).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ปิดแผงนำเข้าด้วยปุ่มปิด', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await page.getByTestId('open-import-panel').click();
    await expect(page.getByTestId('excel-import-panel')).toBeVisible();

    await page.getByText('ปิด', { exact: true }).click();
    await expect(page.getByTestId('excel-import-panel')).not.toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });
});
