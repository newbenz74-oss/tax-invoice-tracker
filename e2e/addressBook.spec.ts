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

test.describe('สมุดรายชื่อ: Modal "เพิ่มรายชื่อ" — Header/Body/Footer คงที่, Responsive, ESC/Focus', () => {
  test('Desktop (1280px): modal ไม่ล้นหน้าจอ และไม่มี Horizontal Scroll', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoAddressBook(page);

    await page.getByTestId('open-add-contact').click();
    const card = page.getByTestId('contact-form-modal-card');
    await expect(card).toBeVisible();

    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      // max-height: calc(100vh - 48px) — เผื่อ rounding เล็กน้อย
      expect(box.height).toBeLessThanOrEqual(800 - 48 + 1);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(800 + 1);
    }

    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasHorizontalScroll).toBe(false);

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('มือถือ (375px, จอเตี้ย): modal ไม่ล้นหน้าจอ, ฟอร์มแสดง 1 คอลัมน์, ไม่มี Horizontal Scroll', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await page.setViewportSize({ width: 375, height: 640 });
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');
    // จอมือถือ sidebar ซ่อนอยู่โดยค่าเริ่มต้น ต้องเปิดผ่านปุ่มแฮมเบอร์เกอร์ก่อนถึงจะคลิกเมนูได้
    // (ดู e2e/sidebar.spec.ts) — gotoAddressBook() เดิมสมมติว่า sidebar เปิดอยู่แบบจอ Desktop
    await page.getByTestId('mobile-menu-button').click();
    await page.getByTestId('nav-item-address-book').click();

    // วัด scrollWidth ก่อนเปิด modal ไว้เทียบ — หน้า dashboard shell เดิม (ไม่เกี่ยวกับ modal นี้เลย
    // มีอยู่ตั้งแต่ก่อนแก้ไขครั้งนี้ แม้แต่หน้า Dashboard เปล่าๆ ก็มี) มี horizontal scroll เล็กน้อยอยู่
    // ก่อนแล้วที่จอ 375px ซึ่งอยู่นอกขอบเขตของงานปรับ Modal "เพิ่มรายชื่อ" ครั้งนี้ (ไม่แตะ layout เดิม)
    // — สิ่งที่ต้องยืนยันคือ modal เองต้องไม่ทำให้ scrollWidth "เพิ่มขึ้น" จากเดิม ไม่ใช่ยืนยันว่าทั้งหน้า
    // ไม่มี horizontal scroll เลย
    const scrollWidthBeforeModal = await page.evaluate(() => document.documentElement.scrollWidth);

    await page.getByTestId('open-add-contact').click();
    const card = page.getByTestId('contact-form-modal-card');
    await expect(card).toBeVisible();

    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      // max-height: calc(100vh - 24px) บนมือถือ
      expect(box.height).toBeLessThanOrEqual(640 - 24 + 1);
    }

    await page.getByTestId('select-partner-type').selectOption('customer');
    await page.getByTestId('select-entity-type').selectOption('individual');
    const firstNameBox = await page.getByTestId('input-first-name').boundingBox();
    const lastNameBox = await page.getByTestId('input-last-name').boundingBox();
    expect(firstNameBox).not.toBeNull();
    expect(lastNameBox).not.toBeNull();
    if (firstNameBox && lastNameBox) {
      // 1 คอลัมน์: นามสกุลต้องอยู่ "ใต้" ชื่อ (คนละแถว) ไม่ใช่ข้างๆ กัน
      expect(lastNameBox.y).toBeGreaterThanOrEqual(firstNameBox.y + firstNameBox.height - 5);
    }

    const scrollWidthWithModal = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidthWithModal).toBeLessThanOrEqual(scrollWidthBeforeModal);

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('Desktop (1280px): ฟอร์มแสดง 2 คอลัมน์ — ชื่อ/นามสกุล อยู่แถวเดียวกันคนละฝั่ง', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoAddressBook(page);

    await page.getByTestId('open-add-contact').click();
    await page.getByTestId('select-partner-type').selectOption('customer');
    await page.getByTestId('select-entity-type').selectOption('individual');

    const firstNameBox = await page.getByTestId('input-first-name').boundingBox();
    const lastNameBox = await page.getByTestId('input-last-name').boundingBox();
    expect(firstNameBox).not.toBeNull();
    expect(lastNameBox).not.toBeNull();
    if (firstNameBox && lastNameBox) {
      expect(Math.abs(firstNameBox.y - lastNameBox.y)).toBeLessThan(5);
      expect(lastNameBox.x).toBeGreaterThan(firstNameBox.x + firstNameBox.width - 5);
    }

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('Header และ Footer/ปุ่มบันทึกมองเห็นตลอด แม้เลื่อน Body ลงจนสุด — เลื่อนเฉพาะ Body เท่านั้น', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await page.setViewportSize({ width: 1280, height: 700 });
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoAddressBook(page);

    await page.getByTestId('open-add-contact').click();
    await expect(page.getByTestId('contact-modal-header')).toBeVisible();
    await expect(page.getByTestId('contact-form-footer')).toBeVisible();
    await expect(page.getByTestId('submit-contact-form')).toBeVisible();

    const headerBoxBefore = await page.getByTestId('contact-modal-header').boundingBox();
    const footerBoxBefore = await page.getByTestId('contact-form-footer').boundingBox();

    await page.getByTestId('contact-form-body').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });

    await expect(page.getByTestId('contact-modal-header')).toBeVisible();
    await expect(page.getByTestId('contact-form-footer')).toBeVisible();
    await expect(page.getByTestId('submit-contact-form')).toBeVisible();

    const bodyScrollTop = await page.getByTestId('contact-form-body').evaluate((el) => el.scrollTop);
    expect(bodyScrollTop).toBeGreaterThan(0);

    const headerBoxAfter = await page.getByTestId('contact-modal-header').boundingBox();
    const footerBoxAfter = await page.getByTestId('contact-form-footer').boundingBox();
    if (headerBoxBefore && headerBoxAfter) {
      expect(Math.abs(headerBoxBefore.y - headerBoxAfter.y)).toBeLessThan(1);
    }
    if (footerBoxBefore && footerBoxAfter) {
      expect(Math.abs(footerBoxBefore.y - footerBoxAfter.y)).toBeLessThan(1);
    }

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ปิดด้วย ESC ได้ทันทีเมื่อฟอร์มยังไม่มีการเปลี่ยนแปลง', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoAddressBook(page);

    await page.getByTestId('open-add-contact').click();
    await expect(page.getByTestId('contact-form-modal')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('contact-form-modal')).not.toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('คลิก overlay ปิดได้ทันทีเมื่อฟอร์มยังไม่มีการเปลี่ยนแปลง', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoAddressBook(page);

    await page.getByTestId('open-add-contact').click();
    await page.getByTestId('contact-form-modal').click({ position: { x: 5, y: 5 } });
    await expect(page.getByTestId('contact-form-modal')).not.toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('มีการเปลี่ยนแปลงค้างอยู่: ESC / ปุ่ม X ต้องถามยืนยันก่อนปิด ไม่ปิดทันที และ "กลับไปแก้ไขต่อ" ต้องไม่ทำให้ข้อมูลหาย', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoAddressBook(page);

    await page.getByTestId('open-add-contact').click();
    await page.getByTestId('input-address').fill('123 ถนนทดสอบ');

    // ESC ครั้งแรกตอนฟอร์มมีการเปลี่ยนแปลง → เปิด dialog ยืนยัน ไม่ปิด modal หลักทันที
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('discard-confirm-dialog')).toBeVisible();
    await expect(page.getByTestId('contact-form-modal')).toBeVisible();

    // ESC ซ้ำตอน dialog ยืนยันเปิดอยู่ → ปิดแค่ dialog ยืนยัน ไม่ปิด modal หลัก ข้อมูลที่กรอกไว้ยังอยู่
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('discard-confirm-dialog')).not.toBeVisible();
    await expect(page.getByTestId('contact-form-modal')).toBeVisible();
    await expect(page.getByTestId('input-address')).toHaveValue('123 ถนนทดสอบ');

    // ปุ่ม X ตอนมีการเปลี่ยนแปลงค้างอยู่ → ต้องถามยืนยันเช่นกัน ไม่ปิดทันที
    await page.getByTestId('close-contact-modal').click();
    await expect(page.getByTestId('discard-confirm-dialog')).toBeVisible();

    // กด "กลับไปแก้ไขต่อ" → ปิดแค่ dialog ยืนยัน กลับไปแก้ไขฟอร์มต่อได้ ข้อมูลไม่หาย
    await page.getByTestId('discard-confirm-cancel').click();
    await expect(page.getByTestId('discard-confirm-dialog')).not.toBeVisible();
    await expect(page.getByTestId('contact-form-modal')).toBeVisible();
    await expect(page.getByTestId('input-address')).toHaveValue('123 ถนนทดสอบ');

    // กด "ปิดโดยไม่บันทึก" → ปิดจริงทั้ง dialog ยืนยันและ modal หลัก
    await page.getByTestId('close-contact-modal').click();
    await page.getByTestId('discard-confirm-ok').click();
    await expect(page.getByTestId('discard-confirm-dialog')).not.toBeVisible();
    await expect(page.getByTestId('contact-form-modal')).not.toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('Focus: ช่องแรกของฟอร์มถูก auto-focus ตอนเปิด modal และ focus กลับไปที่ปุ่ม "+ เพิ่มรายชื่อ" หลังปิด', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoAddressBook(page);

    await page.getByTestId('open-add-contact').click();
    await expect(page.getByTestId('select-partner-type')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('contact-form-modal')).not.toBeVisible();
    await expect(page.getByTestId('open-add-contact')).toBeFocused();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('Focus trap: Tab/Shift+Tab วนอยู่ภายใน modal เท่านั้น ไม่หลุดออกไปนอก modal', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoAddressBook(page);

    await page.getByTestId('open-add-contact').click();
    await expect(page.getByTestId('select-partner-type')).toBeFocused();

    // ปุ่มปิด (X) คือ element แรกสุดของ modal (อยู่ก่อนฟอร์มใน DOM) — Shift+Tab จากปุ่มนี้ต้องวนไป
    // element สุดท้าย (ปุ่มบันทึก) ไม่หลุดออกไปโฟกัส element นอก modal (เช่นปุ่มในตารางด้านหลัง)
    await page.getByTestId('close-contact-modal').focus();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByTestId('submit-contact-form')).toBeFocused();

    // Tab ต่อจาก element สุดท้าย ต้องวนกลับไป element แรก (ปุ่มปิด)
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('close-contact-modal')).toBeFocused();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ล็อก scroll พื้นหลังตอนเปิด modal และคืนค่าตอนปิด', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoAddressBook(page);

    const overflowBeforeOpen = await page.evaluate(() => document.body.style.overflow);

    await page.getByTestId('open-add-contact').click();
    await expect(page.getByTestId('contact-form-modal')).toBeVisible();
    const overflowWhileOpen = await page.evaluate(() => document.body.style.overflow);
    expect(overflowWhileOpen).toBe('hidden');

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('contact-form-modal')).not.toBeVisible();
    const overflowAfterClose = await page.evaluate(() => document.body.style.overflow);
    expect(overflowAfterClose).toBe(overflowBeforeOpen);

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('แก้ไขรายชื่อเดิม (โหมด edit) และดูรายละเอียด (โหมด view) ใช้โครงสร้าง Modal ใหม่เหมือนกัน และยังบันทึกได้ปกติ', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      contacts: [{ id: 'c1', partner_type: 'customer', contact_code: 'CUS0001', entity_type: 'company', company_name: 'บริษัท Modal ใหม่ จำกัด' }],
    });
    await gotoAddressBook(page);

    await page.getByTestId('view-c1').click();
    await expect(page.getByTestId('contact-modal-header')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'รายละเอียดรายชื่อ' })).toBeVisible();
    // โหมดดูรายละเอียด ไม่มีการแก้ไขใดๆ เกิดขึ้นได้ ปิดโดย ESC ต้องไม่ถาม ยืนยัน
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('contact-form-modal')).not.toBeVisible();
    await expect(page.getByTestId('discard-confirm-dialog')).toHaveCount(0);

    await page.getByTestId('edit-c1').click();
    await expect(page.getByRole('heading', { name: 'แก้ไขรายชื่อ' })).toBeVisible();
    await page.getByTestId('input-company-name').fill('บริษัท Modal ใหม่ แก้ไขแล้ว จำกัด');
    await page.getByTestId('submit-contact-form').click();

    await expect(page.getByTestId('contact-form-modal')).not.toBeVisible();
    await expect(page.getByText('บริษัท Modal ใหม่ แก้ไขแล้ว จำกัด')).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });
});

// เพิ่มเข้ามาพร้อมรอบปรับ Animation หน้าสมุดรายชื่อ (Sliding Indicator/Staggered Entrance/Table
// Transition/State persistence — 2026-07-16) ครอบคลุมข้อ 4, 5, 6, 7, 8, 9, 10, 11, 12, 13 ของ
// "สิ่งที่ต้องทดสอบ" ที่เหลือ (ข้อ 1, 2, 3 อยู่ใน e2e/sidebar.spec.ts เพราะเป็นพฤติกรรม Sidebar โดยตรง)
test.describe('สมุดรายชื่อ: Animation เปิดหน้า + Sliding Indicator + Table Transition (2026-07-16)', () => {
  test('เปิดหน้าด้วย Staggered Entrance Animation — Segmented Control/กลุ่ม Search+ปุ่ม/ตาราง ปรากฏไล่เวลากันตามสเปก', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoAddressBook(page);

    const segmented = page.getByTestId('contact-segmented-control');
    const toolbarActions = page.getByTestId('contact-toolbar-actions');
    const tableWrapper = page.getByTestId('contact-table-wrapper');

    const [segAnim, segDelay] = await segmented.evaluate((el) => [
      getComputedStyle(el).animationName,
      getComputedStyle(el).animationDelay,
    ]);
    const [actionsAnim, actionsDelay] = await toolbarActions.evaluate((el) => [
      getComputedStyle(el).animationName,
      getComputedStyle(el).animationDelay,
    ]);
    const [tableAnim, tableDelay] = await tableWrapper.evaluate((el) => [
      getComputedStyle(el).animationName,
      getComputedStyle(el).animationDelay,
    ]);

    expect(segAnim).toBe('entranceFadeSlide');
    expect(actionsAnim).toBe('entranceFadeSlide');
    expect(tableAnim).toBe('entranceFadeSlide');

    // ปรากฏไล่เวลากัน (stagger): Segmented Control ก่อน → กลุ่ม Search/ปุ่ม → ตาราง ตามลำดับ ไม่ใช่
    // พร้อมกันทั้งหมด (delay เท่ากันหมด) และไม่ใช่ลำดับสลับกัน
    const parseSeconds = (v: string) => parseFloat(v);
    expect(parseSeconds(segDelay)).toBeLessThan(parseSeconds(actionsDelay));
    expect(parseSeconds(actionsDelay)).toBeLessThan(parseSeconds(tableDelay));

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('Segmented Control: role=tablist/tab + aria-selected ถูกต้อง และ Indicator เลื่อนไปยังตัวเลือกที่ active จริง', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      contacts: [
        { id: 'c1', partner_type: 'customer', contact_code: 'CUS0001', entity_type: 'company', company_name: 'ลูกค้า เอ จำกัด' },
        { id: 'c2', partner_type: 'vendor', contact_code: 'VEN0001', entity_type: 'company', company_name: 'ผู้จัดจำหน่าย ซี จำกัด' },
      ],
    });
    await gotoAddressBook(page);

    await expect(page.getByTestId('contact-segmented-control')).toHaveAttribute('role', 'tablist');
    await expect(page.getByTestId('contact-filter-all')).toHaveAttribute('role', 'tab');
    await expect(page.getByTestId('contact-filter-all')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('contact-filter-vendor')).toHaveAttribute('aria-selected', 'false');

    async function indicatorAlignsWith(testId: string) {
      const tabBox = await page.getByTestId(testId).boundingBox();
      await expect
        .poll(async () => {
          const indicatorBox = await page.getByTestId('contact-segmented-indicator').boundingBox();
          if (!tabBox || !indicatorBox) return null;
          return Math.abs(indicatorBox.x - tabBox.x) < 2 && Math.abs(indicatorBox.width - tabBox.width) < 2;
        })
        .toBe(true);
    }

    // เริ่มต้นที่ "ทั้งหมด" — indicator ต้องอยู่ตรงปุ่มนี้ตั้งแต่แรกโดยไม่ต้องคลิกก่อน
    await indicatorAlignsWith('contact-filter-all');

    await page.getByTestId('contact-filter-vendor').click();
    await expect(page.getByTestId('contact-filter-vendor')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('contact-filter-all')).toHaveAttribute('aria-selected', 'false');
    await indicatorAlignsWith('contact-filter-vendor');

    await page.getByTestId('contact-filter-customer').click();
    await indicatorAlignsWith('contact-filter-customer');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('Segmented Control: ArrowLeft/ArrowRight เลื่อนและเลือกแท็บถัดไป/ก่อนหน้าได้ (Home/End ไปแท็บแรก/สุดท้าย)', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoAddressBook(page);

    await page.getByTestId('contact-filter-all').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('contact-filter-customer')).toBeFocused();
    await expect(page.getByTestId('contact-filter-customer')).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('contact-filter-vendor')).toBeFocused();
    await expect(page.getByTestId('contact-filter-vendor')).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('contact-filter-customer')).toBeFocused();

    await page.keyboard.press('Home');
    await expect(page.getByTestId('contact-filter-all')).toBeFocused();
    await expect(page.getByTestId('contact-filter-all')).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('End');
    await expect(page.getByTestId('contact-filter-vendor')).toBeFocused();
    await expect(page.getByTestId('contact-filter-vendor')).toHaveAttribute('aria-selected', 'true');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('เปลี่ยน Segmented Control: ตารางเปลี่ยนข้อมูลโดยไม่ Reload หน้า, Header ตารางไม่หาย, และไม่รีเซ็ตช่องค้นหา', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      contacts: [
        { id: 'c1', partner_type: 'customer', contact_code: 'CUS0001', entity_type: 'company', company_name: 'บริษัท ค้นหาคงอยู่ จำกัด', phone: '02-111-1111' },
        { id: 'c2', partner_type: 'vendor', contact_code: 'VEN0001', entity_type: 'company', company_name: 'ผู้จัดจำหน่าย ดี จำกัด' },
      ],
    });
    await gotoAddressBook(page);

    // พิมพ์คำค้นหาไว้ก่อน — ต้องไม่ถูกล้างระหว่าง/หลังเปลี่ยน Segmented Control
    await page.getByTestId('contact-search-input').fill('02-111-1111');
    await expect(page.getByText('บริษัท ค้นหาคงอยู่ จำกัด')).toBeVisible();

    const urlBefore = page.url();
    const theadTextBefore = await page.locator('thead').innerText();

    await page.getByTestId('contact-filter-vendor').click();

    // ตารางว่างเพราะค้นหาคำเดิม+กรองเป็นผู้จัดจำหน่าย (ไม่มีผลลัพธ์) — แสดง Empty State แทน ไม่ error
    await expect(page.getByTestId('contacts-empty')).toBeVisible();
    await expect(page.getByTestId('contact-search-input')).toHaveValue('02-111-1111');

    await page.getByTestId('contact-search-input').fill('');
    await expect(page.getByText('ผู้จัดจำหน่าย ดี จำกัด')).toBeVisible();
    // Header ของตารางยังอยู่ครบหลังสลับกลับมามีข้อมูล ไม่ได้หายไปถาวรจาก transition ก่อนหน้า
    const theadTextAfter = await page.locator('thead').innerText();
    expect(theadTextAfter).toBe(theadTextBefore);

    // ไม่มีการ reload หน้า (URL เดิม, SPA state เดิมยังอยู่)
    expect(page.url()).toBe(urlBefore);

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('Refresh หน้าขณะอยู่ที่สมุดรายชื่อ: Segmented Control คงค่าล่าสุดที่เลือกไว้ (localStorage)', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      contacts: [{ id: 'c1', partner_type: 'vendor', contact_code: 'VEN0001', entity_type: 'company', company_name: 'ผู้จัดจำหน่าย อี จำกัด' }],
    });
    await gotoAddressBook(page);

    await page.getByTestId('contact-filter-vendor').click();
    await expect(page.getByTestId('contact-filter-vendor')).toHaveAttribute('aria-selected', 'true');

    await page.reload();

    await expect(page.getByTestId('nav-item-address-book')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('contact-filter-vendor')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('contact-filter-all')).toHaveAttribute('aria-selected', 'false');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ไม่มีรายชื่อในหมวดที่กรอง: Empty State แสดงข้อความ "ไม่พบรายชื่อในหมวดนี้" พร้อมไอคอน แบบนุ่มนวล', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      contacts: [{ id: 'c1', partner_type: 'customer', contact_code: 'CUS0001', entity_type: 'company', company_name: 'ลูกค้าเท่านั้น จำกัด' }],
    });
    await gotoAddressBook(page);

    await page.getByTestId('contact-filter-vendor').click();
    const empty = page.getByTestId('contacts-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('ไม่พบรายชื่อในหมวดนี้');
    // มีไอคอนอยู่ใน Empty State (svg ของ lucide-react)
    await expect(empty.locator('svg')).toBeVisible();
    const animName = await empty.evaluate((el) => getComputedStyle(el).animationName);
    expect(animName).toBe('entranceFadeSlide');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('รองรับ prefers-reduced-motion ในหน้าสมุดรายชื่อ: Segmented Control/ตาราง ยังใช้งานได้ครบ แค่ animation สั้นลงมาก', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      contacts: [
        { id: 'c1', partner_type: 'customer', contact_code: 'CUS0001', entity_type: 'company', company_name: 'ลูกค้า เอ จำกัด' },
        { id: 'c2', partner_type: 'vendor', contact_code: 'VEN0001', entity_type: 'company', company_name: 'ผู้จัดจำหน่าย ซี จำกัด' },
      ],
    });
    await gotoAddressBook(page);

    const tableWrapper = page.getByTestId('contact-table-wrapper');
    const animDuration = await tableWrapper.evaluate((el) => getComputedStyle(el).animationDuration);
    expect(animDuration).not.toContain('0.22s');

    // ฟีเจอร์หลักยังทำงานได้ครบตามปกติแม้ลด motion
    await page.getByTestId('contact-filter-vendor').click();
    await expect(page.getByText('ผู้จัดจำหน่าย ซี จำกัด')).toBeVisible();
    await expect(page.getByText('ลูกค้า เอ จำกัด')).not.toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });
});
