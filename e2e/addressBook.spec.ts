import { test, expect } from '@playwright/test';
import { attachConsoleErrorCollector, gotoAddressBook, setupMockSupabase } from './helpers';

const OWNER = 'user@example.com';

test.describe('สมุดรายชื่อ: นำทางเข้าเมนู และ Header', () => {
  test('คลิกเมนู "สมุดรายชื่อ" ในหมวด "ข้อมูลหลัก (Master Data)" แล้วเห็นหน้าถูกต้อง ไม่มี console error', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoAddressBook(page);

    await expect(page.getByTestId('nav-item-address-book')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 1, name: 'สมุดรายชื่อ' })).toBeVisible();
    await expect(page.getByText('จัดการข้อมูลลูกค้าและผู้จัดจำหน่าย')).toBeVisible();
    await expect(page.getByTestId('coming-soon')).toHaveCount(0);
    // หมวด "ข้อมูลหลัก (Master Data)" ต้อง expand อยู่โดยค่าเริ่มต้น (เหมือนหมวดอื่นทั้งหมด)
    await expect(page.getByTestId('nav-section-master-data')).toHaveAttribute('aria-expanded', 'true');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('เมนูเดิม (Dashboard, บันทึกค่าใช้จ่าย, กระทบยอด ฯลฯ) ยังทำงานปกติหลังเพิ่มเมนูใหม่', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await expect(page.getByTestId('nav-item-dashboard')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

    await page.getByTestId('nav-item-record-expense').click();
    await expect(page.getByRole('heading', { level: 1, name: 'บันทึกค่าใช้จ่าย' })).toBeVisible();
    await expect(page.getByTestId('open-add-form')).toBeVisible();

    await page.getByTestId('nav-item-purchase-tax-report').click();
    await expect(page.getByRole('heading', { level: 1, name: 'รายงานภาษีซื้อ' })).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });
});

test.describe('สมุดรายชื่อ: Segmented Control และค้นหา', () => {
  test('นับจำนวนถูกต้องและกรองตามประเภทได้ทันทีไม่ต้องโหลดหน้าใหม่', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      contacts: [
        { id: 'c1', partner_type: 'customer', contact_code: 'CUS0001', entity_type: 'company', company_name: 'ลูกค้า เอ จำกัด' },
        { id: 'c2', partner_type: 'customer', contact_code: 'CUS0002', entity_type: 'company', company_name: 'ลูกค้า บี จำกัด' },
        { id: 'c3', partner_type: 'vendor', contact_code: 'VEN0001', entity_type: 'company', company_name: 'ผู้จัดจำหน่าย ซี จำกัด' },
      ],
    });
    await gotoAddressBook(page);

    await expect(page.getByTestId('contact-filter-all')).toContainText('ทั้งหมด (3)');
    await expect(page.getByTestId('contact-filter-customer')).toContainText('ลูกค้า (2)');
    await expect(page.getByTestId('contact-filter-vendor')).toContainText('ผู้จัดจำหน่าย (1)');

    await page.getByTestId('contact-filter-vendor').click();
    await expect(page.getByText('ผู้จัดจำหน่าย ซี จำกัด')).toBeVisible();
    await expect(page.getByText('ลูกค้า เอ จำกัด')).not.toBeVisible();

    await page.getByTestId('contact-filter-customer').click();
    await expect(page.getByText('ลูกค้า เอ จำกัด')).toBeVisible();
    await expect(page.getByText('ลูกค้า บี จำกัด')).toBeVisible();
    await expect(page.getByText('ผู้จัดจำหน่าย ซี จำกัด')).not.toBeVisible();

    await page.getByTestId('contact-filter-all').click();
    await expect(page.getByText('ผู้จัดจำหน่าย ซี จำกัด')).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ค้นหาได้จากรหัส ชื่อ นามสกุล ชื่อบริษัท เลขผู้เสียภาษี เบอร์โทร และ Email', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      contacts: [
        {
          id: 'c1',
          partner_type: 'customer',
          contact_code: 'CUS0001',
          entity_type: 'company',
          company_name: 'บริษัท ค้นหาได้ จำกัด',
          tax_id: '1111111111111',
          phone: '02-999-8888',
          email: 'findme@example.com',
        },
        {
          id: 'c2',
          partner_type: 'vendor',
          contact_code: 'VEN0001',
          entity_type: 'individual',
          first_name: 'วิชัย',
          last_name: 'สายใจ',
        },
      ],
    });
    await gotoAddressBook(page);

    await page.getByTestId('contact-search-input').fill('CUS0001');
    await expect(page.getByText('บริษัท ค้นหาได้ จำกัด')).toBeVisible();
    await expect(page.getByText('วิชัย สายใจ')).not.toBeVisible();

    await page.getByTestId('contact-search-input').fill('วิชัย');
    await expect(page.getByText('วิชัย สายใจ')).toBeVisible();
    await expect(page.getByText('บริษัท ค้นหาได้ จำกัด')).not.toBeVisible();

    await page.getByTestId('contact-search-input').fill('1111111111111');
    await expect(page.getByText('บริษัท ค้นหาได้ จำกัด')).toBeVisible();

    await page.getByTestId('contact-search-input').fill('02-999-8888');
    await expect(page.getByText('บริษัท ค้นหาได้ จำกัด')).toBeVisible();

    await page.getByTestId('contact-search-input').fill('findme@example.com');
    await expect(page.getByText('บริษัท ค้นหาได้ จำกัด')).toBeVisible();

    await page.getByTestId('contact-search-input').fill('ไม่มีทางเจอแน่นอน');
    await expect(page.getByTestId('contacts-empty')).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });
});

test.describe('สมุดรายชื่อ: เพิ่ม/แก้ไข/ดูรายละเอียด', () => {
  test('เพิ่มรายชื่อนิติบุคคล: รหัสถูกเสนอให้อัตโนมัติตามประเภทที่เลือก และแก้ไขเองได้ก่อนบันทึก', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoAddressBook(page);

    await page.getByTestId('open-add-contact').click();
    await expect(page.getByTestId('contact-form-modal')).toBeVisible();

    await page.getByTestId('select-partner-type').selectOption('customer');
    await expect(page.getByTestId('input-contact-code')).toHaveValue('CUS0001');

    await page.getByTestId('select-entity-type').selectOption('company');
    await expect(page.getByTestId('input-company-name')).toBeVisible();
    await page.getByTestId('input-company-name').fill('บริษัท ทดสอบเพิ่มรายชื่อ จำกัด');
    await page.getByTestId('input-province').fill('กรุงเทพมหานคร');

    await page.getByTestId('submit-contact-form').click();

    await expect(page.getByTestId('contact-form-modal')).not.toBeVisible();
    await expect(page.getByText('บริษัท ทดสอบเพิ่มรายชื่อ จำกัด')).toBeVisible();
    await expect(page.getByTestId('contact-filter-all')).toContainText('ทั้งหมด (1)');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('เพิ่มรายชื่อบุคคลธรรมดา: รหัสขึ้นต้นด้วย VEN เมื่อเลือกผู้จัดจำหน่าย', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoAddressBook(page);

    await page.getByTestId('open-add-contact').click();
    await page.getByTestId('select-partner-type').selectOption('vendor');
    await expect(page.getByTestId('input-contact-code')).toHaveValue('VEN0001');

    await page.getByTestId('select-entity-type').selectOption('individual');
    await page.getByTestId('input-first-name').fill('สมหญิง');
    await page.getByTestId('input-last-name').fill('ตั้งใจ');
    await page.getByTestId('submit-contact-form').click();

    await expect(page.getByText('สมหญิง ตั้งใจ')).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('validation: ฟอร์มว่างเปล่าแสดง error ใต้ฟิลด์ ไม่ใช้ browser alert', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoAddressBook(page);

    await page.getByTestId('open-add-contact').click();
    await page.getByTestId('submit-contact-form').click();

    await expect(page.getByText('กรุณาเลือกประเภท', { exact: true })).toBeVisible();
    await expect(page.getByText('กรุณาเลือกประเภทบุคคล')).toBeVisible();
    await expect(page.getByText('กรุณากรอกรหัส')).toBeVisible();
    await expect(page.getByTestId('contact-form-modal')).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('validation: นิติบุคคลไม่กรอกชื่อบริษัท / บุคคลธรรมดาไม่กรอกชื่อ-นามสกุล', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoAddressBook(page);

    await page.getByTestId('open-add-contact').click();
    await page.getByTestId('select-partner-type').selectOption('customer');
    await page.getByTestId('select-entity-type').selectOption('company');
    await page.getByTestId('submit-contact-form').click();
    await expect(page.getByText('กรุณากรอกชื่อบริษัท')).toBeVisible();

    await page.getByTestId('select-entity-type').selectOption('individual');
    await page.getByTestId('submit-contact-form').click();
    await expect(page.getByText('กรุณากรอกชื่อ')).toBeVisible();
    await expect(page.getByText('กรุณากรอกนามสกุล')).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('validation: เลขประจำตัวผู้เสียภาษีไม่บังคับ แต่ถ้ากรอกต้องครบ 13 หลัก', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoAddressBook(page);

    await page.getByTestId('open-add-contact').click();
    await page.getByTestId('select-partner-type').selectOption('customer');
    await page.getByTestId('select-entity-type').selectOption('company');
    await page.getByTestId('input-company-name').fill('บริษัท ทดสอบเลขภาษี จำกัด');
    await page.getByTestId('input-tax-id').fill('123');
    await page.getByTestId('submit-contact-form').click();

    await expect(page.getByText('เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก')).toBeVisible();

    await page.getByTestId('input-tax-id').fill('1234567890123');
    await page.getByTestId('submit-contact-form').click();
    await expect(page.getByText('บริษัท ทดสอบเลขภาษี จำกัด')).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('validation: รหัสซ้ำกับรายชื่อที่มีอยู่แล้วถูกบล็อกไว้', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      contacts: [{ id: 'c1', partner_type: 'customer', contact_code: 'CUS0001', entity_type: 'company', company_name: 'บริษัท เดิม จำกัด' }],
    });
    await gotoAddressBook(page);

    await page.getByTestId('open-add-contact').click();
    await page.getByTestId('select-partner-type').selectOption('customer');
    // รหัสที่เสนอให้อัตโนมัติต้องเป็น CUS0002 (ต่อจากรหัสเดิมที่มีอยู่) ไม่ใช่ CUS0001 ซ้ำ
    await expect(page.getByTestId('input-contact-code')).toHaveValue('CUS0002');

    // จงใจแก้รหัสให้ซ้ำกับของเดิมเพื่อทดสอบ validation
    await page.getByTestId('input-contact-code').fill('CUS0001');
    await page.getByTestId('select-entity-type').selectOption('company');
    await page.getByTestId('input-company-name').fill('บริษัท ใหม่ จำกัด');
    await page.getByTestId('submit-contact-form').click();

    await expect(page.getByText('รหัสนี้ถูกใช้ไปแล้ว')).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('validation: เลือก "สาขาที่" ต้องกรอกเลขสาขา 5 หลัก', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoAddressBook(page);

    await page.getByTestId('open-add-contact').click();
    await page.getByTestId('select-partner-type').selectOption('customer');
    await page.getByTestId('select-entity-type').selectOption('company');
    await page.getByTestId('input-company-name').fill('บริษัท ทดสอบสาขา จำกัด');

    await expect(page.getByTestId('input-branch-number')).toHaveCount(0);
    await page.getByTestId('select-branch-type').selectOption('branch');
    await expect(page.getByTestId('input-branch-number')).toBeVisible();

    await page.getByTestId('submit-contact-form').click();
    await expect(page.getByText('กรุณากรอกเลขที่สาขา')).toBeVisible();

    await page.getByTestId('input-branch-number').fill('123');
    await page.getByTestId('submit-contact-form').click();
    await expect(page.getByText('เลขที่สาขาต้องเป็นตัวเลข 5 หลัก เช่น 00001')).toBeVisible();

    await page.getByTestId('input-branch-number').fill('00001');
    await page.getByTestId('submit-contact-form').click();
    await expect(page.getByText('บริษัท ทดสอบสาขา จำกัด')).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('แก้ไขรายชื่อที่มีอยู่แล้วบันทึกค่าใหม่ได้', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      contacts: [{ id: 'c1', partner_type: 'customer', contact_code: 'CUS0001', entity_type: 'company', company_name: 'ชื่อเดิม จำกัด' }],
    });
    await gotoAddressBook(page);

    await page.getByTestId('edit-c1').click();
    await expect(page.getByRole('heading', { name: 'แก้ไขรายชื่อ' })).toBeVisible();
    await page.getByTestId('input-company-name').fill('ชื่อใหม่หลังแก้ไข จำกัด');
    await page.getByTestId('submit-contact-form').click();

    await expect(page.getByText('ชื่อใหม่หลังแก้ไข จำกัด')).toBeVisible();
    await expect(page.getByText('ชื่อเดิม จำกัด', { exact: true })).not.toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ดูรายละเอียด: ทุกฟิลด์ปิดใช้งาน ไม่มีปุ่มบันทึก และสลับไปโหมดแก้ไขได้โดยไม่ต้องปิด modal', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      contacts: [{ id: 'c1', partner_type: 'customer', contact_code: 'CUS0001', entity_type: 'company', company_name: 'บริษัท ดูรายละเอียด จำกัด' }],
    });
    await gotoAddressBook(page);

    await page.getByTestId('view-c1').click();
    await expect(page.getByRole('heading', { name: 'รายละเอียดรายชื่อ' })).toBeVisible();
    await expect(page.getByTestId('input-company-name')).toBeDisabled();
    await expect(page.getByTestId('submit-contact-form')).toHaveCount(0);

    await page.getByTestId('switch-to-edit').click();
    await expect(page.getByRole('heading', { name: 'แก้ไขรายชื่อ' })).toBeVisible();
    await expect(page.getByTestId('input-company-name')).toBeEnabled();
    await page.getByTestId('input-company-name').fill('บริษัท แก้ไขจากมุมมองรายละเอียด จำกัด');
    await page.getByTestId('submit-contact-form').click();

    await expect(page.getByText('บริษัท แก้ไขจากมุมมองรายละเอียด จำกัด')).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ปิดใช้งาน/เปิดใช้งาน: สลับสถานะได้จากตารางโดยตรง', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      contacts: [{ id: 'c1', partner_type: 'customer', contact_code: 'CUS0001', entity_type: 'company', company_name: 'บริษัท สลับสถานะ จำกัด', status: 'active' }],
    });
    await gotoAddressBook(page);

    await expect(page.getByTestId('status-badge-c1')).toHaveText('เปิดใช้งาน');
    await page.getByTestId('toggle-status-c1').click();
    await expect(page.getByTestId('status-badge-c1')).toHaveText('ไม่ใช้งาน');
    await expect(page.getByTestId('toggle-status-c1')).toHaveText('เปิดใช้งาน');

    await page.getByTestId('toggle-status-c1').click();
    await expect(page.getByTestId('status-badge-c1')).toHaveText('เปิดใช้งาน');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ลบรายชื่อต้องผ่าน Confirmation Dialog — ยกเลิกแล้วไม่ลบ, ยืนยันแล้วลบจริง', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      contacts: [{ id: 'c1', partner_type: 'customer', contact_code: 'CUS0001', entity_type: 'company', company_name: 'บริษัท จะถูกลบ จำกัด' }],
    });
    await gotoAddressBook(page);

    await page.getByTestId('delete-c1').click();
    await expect(page.getByTestId('delete-confirm-dialog')).toBeVisible();
    await expect(page.getByText('ยืนยันการลบรายชื่อ')).toBeVisible();

    // กดยกเลิกใน dialog — แถวต้องยังอยู่
    await page.getByTestId('delete-confirm-dialog').getByText('ยกเลิก').click();
    await expect(page.getByTestId('delete-confirm-dialog')).not.toBeVisible();
    await expect(page.getByText('บริษัท จะถูกลบ จำกัด')).toBeVisible();

    await page.getByTestId('delete-c1').click();
    await page.getByTestId('confirm-delete').click();
    await expect(page.getByText('บริษัท จะถูกลบ จำกัด')).not.toBeVisible();
    await expect(page.getByTestId('contacts-empty')).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });
});
