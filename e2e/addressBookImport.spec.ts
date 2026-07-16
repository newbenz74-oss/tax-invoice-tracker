import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import * as XLSX from 'xlsx';
import { attachConsoleErrorCollector, gotoAddressBook, setupMockSupabase } from './helpers';
import { CONTACT_EXCEL_HEADERS, CONTACT_EXCEL_HEADER_ORDER } from '../lib/contactExcelImport';

const OWNER = 'user@example.com';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** สร้างไฟล์ Excel (.xlsx) เป็น Buffer ในหน่วยความจำ สำหรับอัปโหลดผ่าน setInputFiles โดยไม่ต้องเขียนลงดิสก์ */
function buildWorkbookBuffer(rows: Record<string, unknown>[]): Buffer {
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: CONTACT_EXCEL_HEADER_ORDER });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'สมุดรายชื่อ');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
}

function contactRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    [CONTACT_EXCEL_HEADERS.partner_type]: 'ลูกค้า',
    [CONTACT_EXCEL_HEADERS.contact_code]: 'CUS0001',
    [CONTACT_EXCEL_HEADERS.entity_type]: 'นิติบุคคล',
    [CONTACT_EXCEL_HEADERS.company_name]: 'บริษัท นำเข้าทดสอบ จำกัด',
    [CONTACT_EXCEL_HEADERS.first_name]: '',
    [CONTACT_EXCEL_HEADERS.last_name]: '',
    [CONTACT_EXCEL_HEADERS.tax_id]: '',
    [CONTACT_EXCEL_HEADERS.branch_type]: 'สำนักงานใหญ่',
    [CONTACT_EXCEL_HEADERS.branch_number]: '',
    [CONTACT_EXCEL_HEADERS.address]: '',
    [CONTACT_EXCEL_HEADERS.subdistrict]: '',
    [CONTACT_EXCEL_HEADERS.district]: '',
    [CONTACT_EXCEL_HEADERS.province]: '',
    [CONTACT_EXCEL_HEADERS.postal_code]: '',
    [CONTACT_EXCEL_HEADERS.phone]: '',
    [CONTACT_EXCEL_HEADERS.email]: '',
    [CONTACT_EXCEL_HEADERS.contact_person]: '',
    [CONTACT_EXCEL_HEADERS.note]: '',
    [CONTACT_EXCEL_HEADERS.status]: 'เปิดใช้งาน',
    ...overrides,
  };
}

test.describe('สมุดรายชื่อ: นำเข้าจาก Excel (แยกจากการนำเข้า Excel ของหน้าบันทึกค่าใช้จ่ายโดยสิ้นเชิง)', () => {
  test('ดาวน์โหลดเทมเพลต แล้วนำเข้าไฟล์: แถวถูกต้องถูกบันทึก แถวมีปัญหาถูกบล็อก', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoAddressBook(page);

    await page.getByTestId('open-contact-import-panel').click();
    await expect(page.getByTestId('contact-import-panel')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('download-contact-template').click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    const downloadedBuffer = readFileSync(downloadPath!);
    expect(downloadedBuffer.byteLength).toBeGreaterThan(0);
    const downloadedWorkbook = XLSX.read(downloadedBuffer, { type: 'buffer' });
    const downloadedSheet = downloadedWorkbook.Sheets[downloadedWorkbook.SheetNames[0]];
    const downloadedRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(downloadedSheet, { defval: '' });
    expect(downloadedRows).toHaveLength(2);
    expect(downloadedRows[0][CONTACT_EXCEL_HEADERS.contact_code]).toBe('CUS0001');
    expect(downloadedRows[1][CONTACT_EXCEL_HEADERS.contact_code]).toBe('VEN0001');

    const buffer = buildWorkbookBuffer([
      contactRow({ [CONTACT_EXCEL_HEADERS.contact_code]: 'CUS0100', [CONTACT_EXCEL_HEADERS.company_name]: 'บริษัท นำเข้าหนึ่ง จำกัด' }),
      contactRow({
        [CONTACT_EXCEL_HEADERS.partner_type]: 'ผู้จัดจำหน่าย',
        [CONTACT_EXCEL_HEADERS.contact_code]: 'VEN0100',
        [CONTACT_EXCEL_HEADERS.entity_type]: 'บุคคลธรรมดา',
        [CONTACT_EXCEL_HEADERS.company_name]: '',
        [CONTACT_EXCEL_HEADERS.first_name]: 'สมชาย',
        [CONTACT_EXCEL_HEADERS.last_name]: 'นำเข้าสอง',
      }),
      contactRow({
        // แถวผิดพลาด: นิติบุคคลไม่กรอกชื่อบริษัท — ต้องถูกบล็อกไม่ให้นำเข้า
        [CONTACT_EXCEL_HEADERS.contact_code]: 'CUS0101',
        [CONTACT_EXCEL_HEADERS.company_name]: '',
      }),
    ]);

    await page.getByTestId('contact-excel-file-input').setInputFiles({
      name: 'นำเข้าทดสอบ.xlsx',
      mimeType: XLSX_MIME,
      buffer,
    });

    await expect(page.getByTestId('contact-import-summary-count')).toContainText('2 รายการ');
    await expect(page.getByTestId('contact-import-summary-error-count')).toContainText('1 รายการ');
    await expect(page.getByTestId('contact-import-row-include-4')).toBeDisabled();

    await page.getByTestId('confirm-contact-import').click();

    await expect(page.getByTestId('contact-import-panel')).not.toBeVisible();
    await expect(page.getByText('บริษัท นำเข้าหนึ่ง จำกัด')).toBeVisible();
    await expect(page.getByText('สมชาย นำเข้าสอง')).toBeVisible();
    await expect(page.getByTestId('contact-filter-all')).toContainText('ทั้งหมด (2)');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('รหัสซ้ำกันเองภายในไฟล์เดียวกัน — ทั้งสองแถวถูกบล็อกไม่ให้นำเข้า', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoAddressBook(page);

    await page.getByTestId('open-contact-import-panel').click();
    const buffer = buildWorkbookBuffer([
      contactRow({ [CONTACT_EXCEL_HEADERS.contact_code]: 'CUS0001', [CONTACT_EXCEL_HEADERS.company_name]: 'บริษัท หนึ่ง จำกัด' }),
      contactRow({ [CONTACT_EXCEL_HEADERS.contact_code]: 'CUS0001', [CONTACT_EXCEL_HEADERS.company_name]: 'บริษัท สอง จำกัด' }),
    ]);
    await page.getByTestId('contact-excel-file-input').setInputFiles({
      name: 'รหัสซ้ำในไฟล์.xlsx',
      mimeType: XLSX_MIME,
      buffer,
    });

    await expect(page.getByTestId('contact-import-summary-error-count')).toContainText('2 รายการ');
    await expect(page.getByTestId('contact-import-row-2')).toContainText('รหัสนี้ซ้ำกับแถวอื่นในไฟล์เดียวกัน');
    await expect(page.getByTestId('contact-import-row-3')).toContainText('รหัสนี้ซ้ำกับแถวอื่นในไฟล์เดียวกัน');
    await expect(page.getByTestId('confirm-contact-import')).toBeDisabled();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('รหัสซ้ำกับรายชื่อที่มีอยู่แล้วในระบบ — ถูกบล็อกไม่ให้นำเข้า', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      contacts: [{ id: 'c1', partner_type: 'customer', contact_code: 'CUS0001', entity_type: 'company', company_name: 'บริษัท มีอยู่แล้ว จำกัด' }],
    });
    await gotoAddressBook(page);

    await page.getByTestId('open-contact-import-panel').click();
    const buffer = buildWorkbookBuffer([contactRow({ [CONTACT_EXCEL_HEADERS.contact_code]: 'CUS0001' })]);
    await page.getByTestId('contact-excel-file-input').setInputFiles({
      name: 'รหัสซ้ำของเดิม.xlsx',
      mimeType: XLSX_MIME,
      buffer,
    });

    await expect(page.getByTestId('contact-import-row-2')).toContainText('รหัสนี้มีอยู่แล้วในระบบ');
    await expect(page.getByTestId('confirm-contact-import')).toBeDisabled();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ทุกแถวมีปัญหา — ปุ่มนำเข้าถูกปิดใช้งาน', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoAddressBook(page);

    await page.getByTestId('open-contact-import-panel').click();
    const buffer = buildWorkbookBuffer([contactRow({ [CONTACT_EXCEL_HEADERS.contact_code]: '' })]);
    await page.getByTestId('contact-excel-file-input').setInputFiles({
      name: 'ทดสอบผิดพลาดทั้งหมด.xlsx',
      mimeType: XLSX_MIME,
      buffer,
    });

    await expect(page.getByTestId('contact-import-summary-error-count')).toContainText('1 รายการ');
    await expect(page.getByTestId('confirm-contact-import')).toBeDisabled();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('อัปโหลดไฟล์ที่ไม่มีข้อมูลเลย — แจ้งเตือนผู้ใช้', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoAddressBook(page);

    await page.getByTestId('open-contact-import-panel').click();
    const buffer = buildWorkbookBuffer([]);
    await page.getByTestId('contact-excel-file-input').setInputFiles({
      name: 'ไฟล์ว่าง.xlsx',
      mimeType: XLSX_MIME,
      buffer,
    });

    await expect(page.getByText('ไม่พบข้อมูลในไฟล์', { exact: false })).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ปิดแผงนำเข้าด้วยปุ่มปิด', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoAddressBook(page);

    await page.getByTestId('open-contact-import-panel').click();
    await expect(page.getByTestId('contact-import-panel')).toBeVisible();
    await page.getByTestId('contact-import-panel').getByText('ปิด', { exact: true }).click();
    await expect(page.getByTestId('contact-import-panel')).not.toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });
});

test.describe('สมุดรายชื่อ: ส่งออก Excel เคารพ filter และคำค้นหาปัจจุบัน', () => {
  test('ส่งออกตอนเลือก filter "ลูกค้า" ได้เฉพาะลูกค้าเท่านั้น ไม่รวมผู้จัดจำหน่าย', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      contacts: [
        { id: 'c1', partner_type: 'customer', contact_code: 'CUS0001', entity_type: 'company', company_name: 'ลูกค้า เอ จำกัด' },
        { id: 'c2', partner_type: 'vendor', contact_code: 'VEN0001', entity_type: 'company', company_name: 'ผู้จัดจำหน่าย บี จำกัด' },
      ],
    });
    await gotoAddressBook(page);

    await page.getByTestId('contact-filter-customer').click();

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-contacts-excel').click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    const buffer = readFileSync(downloadPath!);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

    expect(rows).toHaveLength(1);
    expect(rows[0]['รหัส']).toBe('CUS0001');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ส่งออกตอนมีคำค้นหา ได้เฉพาะรายการที่ตรงกับคำค้นหาเท่านั้น', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      contacts: [
        { id: 'c1', partner_type: 'customer', contact_code: 'CUS0001', entity_type: 'company', company_name: 'บริษัท ค้นเจอ จำกัด' },
        { id: 'c2', partner_type: 'customer', contact_code: 'CUS0002', entity_type: 'company', company_name: 'บริษัท อื่น จำกัด' },
      ],
    });
    await gotoAddressBook(page);

    await page.getByTestId('contact-search-input').fill('ค้นเจอ');

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-contacts-excel').click();
    const download = await downloadPromise;
    const buffer = readFileSync((await download.path())!);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });

    expect(rows).toHaveLength(1);
    expect(rows[0]['รหัส']).toBe('CUS0001');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ไม่มีรายชื่อให้ส่งออก — ปุ่มถูกปิดใช้งาน', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoAddressBook(page);

    await expect(page.getByTestId('export-contacts-excel')).toBeDisabled();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });
});
