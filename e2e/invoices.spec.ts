import { test, expect } from '@playwright/test';
import { attachConsoleErrorCollector, isoDaysFromNow, setupMockSupabase } from './helpers';

const OWNER = 'user@example.com';

test.describe('Invoice CRUD และ business logic', () => {
  test('เพิ่มรายการใหม่: VAT auto-suggest 7% และคำนวณยอดรวมถูกต้อง', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await page.getByTestId('open-add-form').click();
    await page.getByTestId('select-tax-type').selectOption('claimable_vat');
    await page.getByTestId('input-vendor-name').fill('บริษัท ทดสอบ E2E จำกัด');
    await page.getByTestId('input-transaction-date').fill(isoDaysFromNow(0));
    await page.getByTestId('input-amount').fill('1000');

    await expect(page.getByTestId('input-vat')).toHaveValue('70');
    await expect(page.getByTestId('computed-total')).toContainText('1,070.00');

    await page.getByTestId('submit-invoice-form').click();

    await expect(page.getByText('บริษัท ทดสอบ E2E จำกัด')).toBeVisible();
    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('เลขประจำตัวผู้เสียภาษีไม่บังคับกรอก แต่ถ้ากรอกมาต้องเป็นตัวเลข 13 หลัก', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await page.getByTestId('open-add-form').click();
    await page.getByTestId('select-tax-type').selectOption('claimable_vat');
    await page.getByTestId('input-vendor-name').fill('บริษัท ทดสอบ เลขผู้เสียภาษี จำกัด');
    await page.getByTestId('input-transaction-date').fill(isoDaysFromNow(0));
    await page.getByTestId('input-amount').fill('1000');
    await page.getByTestId('input-vendor-tax-id').fill('123');
    await page.getByTestId('submit-invoice-form').click();

    await expect(page.getByText('เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก')).toBeVisible();

    await page.getByTestId('input-vendor-tax-id').fill('1234567890123');
    await page.getByTestId('submit-invoice-form').click();

    await expect(page.getByText('บริษัท ทดสอบ เลขผู้เสียภาษี จำกัด')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('แก้ไข VAT เองแล้วไม่ถูกเขียนทับเมื่อแก้ยอดก่อนภาษีอีกครั้ง', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await page.getByTestId('open-add-form').click();
    await page.getByTestId('input-amount').fill('1000');
    await expect(page.getByTestId('input-vat')).toHaveValue('70');

    await page.getByTestId('input-vat').fill('50');
    await page.getByTestId('input-amount').fill('2000');

    await expect(page.getByTestId('input-vat')).toHaveValue('50');
    expect(errors).toEqual([]);
  });

  test('validation: ห้ามส่งฟอร์มที่ยังไม่กรอกชื่อผู้ขายและยอดเงิน', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await page.getByTestId('open-add-form').click();
    await page.getByTestId('submit-invoice-form').click();

    await expect(page.getByText('กรุณากรอกชื่อผู้ขาย')).toBeVisible();
    await expect(page.getByTestId('invoice-form')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('แสดง badge aging ตามวันที่คาดว่าจะได้รับเทียบกับวันนี้', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      invoices: [
        {
          id: 'inv-not-due',
          vendor_name: 'ผู้ขาย ยังไม่ถึงกำหนด',
          transaction_date: isoDaysFromNow(-5),
          amount_excl_vat: 100,
          vat_amount: 7,
          expected_date: isoDaysFromNow(5),
        },
        {
          id: 'inv-overdue-mid',
          vendor_name: 'ผู้ขาย เกินกำหนด 10 วัน',
          transaction_date: isoDaysFromNow(-20),
          amount_excl_vat: 100,
          vat_amount: 7,
          expected_date: isoDaysFromNow(-10),
        },
        {
          id: 'inv-overdue-far',
          vendor_name: 'ผู้ขาย เกินกำหนดมาก',
          transaction_date: isoDaysFromNow(-60),
          amount_excl_vat: 100,
          vat_amount: 7,
          expected_date: isoDaysFromNow(-40),
        },
      ],
    });
    await page.goto('/dashboard');
    await page.getByTestId('filter-all').click();

    await expect(page.getByTestId('aging-badge-inv-not-due')).toContainText('ยังไม่ถึงกำหนด');
    await expect(page.getByTestId('aging-badge-inv-overdue-mid')).toContainText('เกินกำหนด 8-14 วัน');
    await expect(page.getByTestId('aging-badge-inv-overdue-far')).toContainText('เกินกำหนดมากกว่า 30 วัน');
    expect(errors).toEqual([]);
  });

  test('แสดงยอดก่อน VAT / VAT ในตาราง การ์ดสถิติ VAT ที่รอรับ และสรุป VAT รายเดือนถูกต้อง', async ({ page }) => {
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
    await page.getByTestId('filter-all').click();

    // คอลัมน์ยอดก่อน VAT และ VAT ต่อแถวในตารางหลัก
    await expect(page.getByTestId('amount-excl-vat-inv-vat-pending')).toHaveText('1,000.00');
    await expect(page.getByTestId('vat-amount-inv-vat-pending')).toHaveText('70.00');
    await expect(page.getByTestId('amount-excl-vat-inv-vat-received')).toHaveText('2,000.00');
    await expect(page.getByTestId('vat-amount-inv-vat-received')).toHaveText('140.00');

    // การ์ดสถิติ "VAT ที่รอรับ" นับเฉพาะรายการ pending (70 บาท ไม่รวมของ received)
    await expect(page.getByTestId('stat-pending-vat')).toContainText('70.00');

    // สรุป VAT รายเดือน — แยกค้างรับ (70) กับได้รับแล้ว (140) ถูกต้อง
    await expect(page.getByTestId(`vat-pending-${currentMonth}`)).toHaveText('70.00');
    await expect(page.getByTestId(`vat-received-${currentMonth}`)).toHaveText('140.00');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('กรองตามสถานะและค้นหาผู้ขาย', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      invoices: [
        {
          id: 'inv-pending-1',
          vendor_name: 'ABC Trading',
          transaction_date: isoDaysFromNow(-3),
          amount_excl_vat: 100,
          vat_amount: 7,
          expected_date: isoDaysFromNow(3),
          status: 'pending',
        },
        {
          id: 'inv-received-1',
          vendor_name: 'XYZ Supplies',
          transaction_date: isoDaysFromNow(-10),
          amount_excl_vat: 200,
          vat_amount: 14,
          status: 'received',
          received_date: isoDaysFromNow(-1),
          tax_invoice_number: 'INV-100',
        },
      ],
    });
    await page.goto('/dashboard');

    // default filter คือ pending — เห็นแค่ ABC
    await expect(page.getByText('ABC Trading')).toBeVisible();
    await expect(page.getByText('XYZ Supplies')).not.toBeVisible();

    await page.getByTestId('filter-received').click();
    await expect(page.getByText('XYZ Supplies')).toBeVisible();
    await expect(page.getByText('ABC Trading')).not.toBeVisible();

    await page.getByTestId('filter-all').click();
    await page.getByTestId('search-input').fill('XYZ');
    await expect(page.getByText('XYZ Supplies')).toBeVisible();
    await expect(page.getByText('ABC Trading')).not.toBeVisible();

    expect(errors).toEqual([]);
  });

  test('ทำเครื่องหมายว่าได้รับแล้วพร้อมกรอกเลขที่ใบกำกับภาษี วันที่ใบกำกับภาษี และเดือน/ปีที่ใช้เครดิต VAT', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      invoices: [
        {
          id: 'inv-to-receive',
          vendor_name: 'ผู้ขาย รอรับ',
          transaction_date: isoDaysFromNow(-5),
          amount_excl_vat: 500,
          vat_amount: 35,
          expected_date: isoDaysFromNow(2),
          status: 'pending',
        },
      ],
    });
    await page.goto('/dashboard');

    await page.getByTestId('mark-received-inv-to-receive').click();

    // ปุ่มยืนยันต้อง disabled อยู่จนกว่าจะกรอกเลขที่ใบกำกับภาษีและวันที่ใบกำกับภาษีครบ (เดือน/ปีที่ใช้
    // เครดิต VAT มีค่าเริ่มต้นเป็นเดือน/ปีปัจจุบันให้อยู่แล้ว ไม่ต้องเลือกใหม่ก็ผ่านได้)
    await expect(page.getByTestId('confirm-received-inv-to-receive')).toBeDisabled();

    await page.getByTestId('tax-invoice-number-input-inv-to-receive').fill('TAX-INV-0042');
    await expect(page.getByTestId('confirm-received-inv-to-receive')).toBeDisabled();

    await page.getByTestId('tax-invoice-date-input-inv-to-receive').fill(isoDaysFromNow(-7));
    await expect(page.getByTestId('confirm-received-inv-to-receive')).toBeEnabled();

    await page.getByTestId('confirm-received-inv-to-receive').click();

    // มาร์คแล้วรายการหลุดจาก filter "รอรับ" (ค่าเริ่มต้น)
    await expect(page.getByText('ผู้ขาย รอรับ')).not.toBeVisible();

    await page.getByTestId('filter-received').click();
    await expect(page.getByText('ผู้ขาย รอรับ')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('ลบรายการต้องกดยืนยันสองขั้นตอน', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      invoices: [
        {
          id: 'inv-to-delete',
          vendor_name: 'ผู้ขาย จะถูกลบ',
          transaction_date: isoDaysFromNow(-1),
          amount_excl_vat: 100,
          vat_amount: 7,
          expected_date: isoDaysFromNow(10),
          status: 'pending',
        },
      ],
    });
    await page.goto('/dashboard');

    const deleteBtn = page.getByTestId('delete-inv-to-delete');
    await expect(page.getByText('ผู้ขาย จะถูกลบ')).toBeVisible();

    await deleteBtn.click();
    await expect(deleteBtn).toHaveText('ยืนยันลบ?');
    // ยังไม่ลบจริงหลังกดครั้งแรก
    await expect(page.getByText('ผู้ขาย จะถูกลบ')).toBeVisible();

    await deleteBtn.click();
    await expect(page.getByText('ผู้ขาย จะถูกลบ')).not.toBeVisible();

    expect(errors).toEqual([]);
  });

  test('แก้ไขรายการที่มีอยู่แล้วบันทึกค่าใหม่', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      invoices: [
        {
          id: 'inv-to-edit',
          vendor_name: 'ชื่อเดิม',
          transaction_date: isoDaysFromNow(-2),
          amount_excl_vat: 100,
          vat_amount: 7,
          expected_date: isoDaysFromNow(5),
          status: 'pending',
        },
      ],
    });
    await page.goto('/dashboard');

    await page.getByTestId('edit-inv-to-edit').click();
    await page.getByTestId('input-vendor-name').fill('ชื่อใหม่หลังแก้ไข');
    await page.getByTestId('submit-invoice-form').click();

    await expect(page.getByText('ชื่อใหม่หลังแก้ไข')).toBeVisible();
    await expect(page.getByText('ชื่อเดิม', { exact: true })).not.toBeVisible();

    expect(errors).toEqual([]);
  });
});

test.describe('จำแนกประเภทภาษี (tax_type): ไม่มี VAT / มี VAT ใช้เครดิต / มี VAT ไม่ใช้เครดิต', () => {
  test('เพิ่มรายการแบบ "ไม่มี VAT": ซ่อนช่อง VAT และวันที่คาดว่าจะได้รับ ยอดรวม = ยอดเงิน ไม่มีขั้นตอนรอรับ', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await page.getByTestId('open-add-form').click();
    await page.getByTestId('select-tax-type').selectOption('no_vat');

    // ช่อง VAT และวันที่คาดว่าจะได้รับต้องถูกซ่อนไปเลยสำหรับประเภท "ไม่มี VAT"
    await expect(page.getByTestId('input-vat')).toHaveCount(0);
    await expect(page.getByTestId('input-expected-date')).toHaveCount(0);

    await page.getByTestId('input-vendor-name').fill('ร้านสะดวกซื้อเอบีซี');
    await page.getByTestId('input-transaction-date').fill(isoDaysFromNow(0));
    await page.getByTestId('input-amount').fill('500');
    await expect(page.getByTestId('computed-total')).toContainText('500.00');

    await page.getByTestId('submit-invoice-form').click();

    // ไม่มี VAT ถูกตั้งสถานะเป็น "ได้รับแล้ว" ทันที (ไม่มีอะไรต้องรอ) จึงไม่โผล่ใน filter ค่าเริ่มต้น (รอรับ)
    await expect(page.getByText('ร้านสะดวกซื้อเอบีซี')).not.toBeVisible();

    await page.getByTestId('filter-all').click();
    const row = page.getByRole('row', { name: /ร้านสะดวกซื้อเอบีซี/ });
    await expect(row).toBeVisible();
    const rowId = (await row.getAttribute('data-testid'))?.replace('invoice-row-', '') ?? '';
    await expect(page.getByTestId(`tax-status-badge-${rowId}`)).toHaveText('ไม่มี VAT');
    // ไม่มี VAT ต้องไม่มีปุ่ม "ได้รับแล้ว" ปรากฏเด็ดขาด (ไม่ผ่านขั้นตอนรอรับใบกำกับภาษี)
    await expect(page.getByTestId(`mark-received-${rowId}`)).toHaveCount(0);

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('เพิ่มรายการแบบ "มี VAT แต่ไม่ใช้เครดิต VAT": กรอกเลขที่ใบกำกับภาษีได้โดยตรง ไม่มีขั้นตอนรอรับ', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await page.getByTestId('open-add-form').click();
    await page.getByTestId('select-tax-type').selectOption('non_claimable_vat');

    await expect(page.getByTestId('input-vat')).toBeVisible();
    await expect(page.getByTestId('input-expected-date')).toHaveCount(0);
    await expect(page.getByTestId('input-tax-invoice-number')).toBeVisible();

    await page.getByTestId('input-vendor-name').fill('บริษัท รับรองลูกค้า จำกัด');
    await page.getByTestId('input-transaction-date').fill(isoDaysFromNow(0));
    await page.getByTestId('input-amount').fill('1000');
    await page.getByTestId('input-tax-invoice-number').fill('TAX-NC-001');
    await page.getByTestId('input-tax-invoice-date').fill(isoDaysFromNow(0));
    await expect(page.getByTestId('computed-total')).toContainText('1,070.00');

    await page.getByTestId('submit-invoice-form').click();

    await expect(page.getByText('บริษัท รับรองลูกค้า จำกัด')).not.toBeVisible();

    await page.getByTestId('filter-all').click();
    const row = page.getByRole('row', { name: /บริษัท รับรองลูกค้า จำกัด/ });
    await expect(row).toBeVisible();
    const rowId = (await row.getAttribute('data-testid'))?.replace('invoice-row-', '') ?? '';
    await expect(page.getByTestId(`tax-status-badge-${rowId}`)).toHaveText('ไม่ใช้เครดิต VAT');
    await expect(page.getByTestId(`mark-received-${rowId}`)).toHaveCount(0);

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('เพิ่มรายการแบบ "มี VAT และใช้เครดิต VAT" ผ่านฟอร์ม แล้วทำเครื่องหมายได้รับแล้วตามขั้นตอนเดิมได้', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await page.getByTestId('open-add-form').click();
    await page.getByTestId('select-tax-type').selectOption('claimable_vat');
    await page.getByTestId('input-vendor-name').fill('บริษัท ซื้อสินค้าหลัก จำกัด');
    await page.getByTestId('input-transaction-date').fill(isoDaysFromNow(-5));
    await page.getByTestId('input-amount').fill('2000');
    await expect(page.getByTestId('input-expected-date')).toBeVisible();
    await page.getByTestId('input-expected-date').fill(isoDaysFromNow(5));
    await page.getByTestId('submit-invoice-form').click();

    // มี VAT ใช้เครดิตได้ ยังคงเข้าสถานะ pending ตามเดิม จึงเห็นใน filter "รอรับ" ค่าเริ่มต้นได้เลย
    const row = page.getByRole('row', { name: /บริษัท ซื้อสินค้าหลัก จำกัด/ });
    await expect(row).toBeVisible();
    const rowId = (await row.getAttribute('data-testid'))?.replace('invoice-row-', '') ?? '';
    await expect(page.getByTestId(`tax-status-badge-${rowId}`)).toHaveText('รอรับใบกำกับภาษี');

    await page.getByTestId(`mark-received-${rowId}`).click();
    await page.getByTestId(`tax-invoice-number-input-${rowId}`).fill('TAX-CL-001');
    await page.getByTestId(`tax-invoice-date-input-${rowId}`).fill(isoDaysFromNow(-5));
    await page.getByTestId(`confirm-received-${rowId}`).click();

    await page.getByTestId('filter-received').click();
    await expect(page.getByTestId(`tax-status-badge-${rowId}`)).toHaveText('ได้รับใบกำกับภาษีแล้ว');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('แก้ไขรายการเก่าที่ยังไม่ระบุประเภทภาษี (tax_type เป็น NULL) แก้ไขฟิลด์อื่นได้โดยไม่ถูกบังคับเลือกประเภทภาษี', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {
      loggedInAs: OWNER,
      users: [{ email: OWNER, password: 'x' }],
      invoices: [
        {
          id: 'inv-legacy-no-type',
          vendor_name: 'ผู้ขาย ข้อมูลเก่า',
          transaction_date: isoDaysFromNow(-30),
          amount_excl_vat: 300,
          vat_amount: 21,
          expected_date: isoDaysFromNow(-20),
          status: 'pending',
          // ไม่ระบุ tax_type — จำลองข้อมูลเก่าก่อนมีฟีเจอร์นี้ (NULL ในฐานข้อมูลจริง)
        },
      ],
    });
    await page.goto('/dashboard');

    // ป้ายสถานะต้องขึ้น "รอตรวจสอบประเภทภาษี" สำหรับข้อมูลเก่าที่ยังไม่ระบุประเภท
    await expect(page.getByTestId('tax-status-badge-inv-legacy-no-type')).toHaveText('รอตรวจสอบประเภทภาษี');

    await page.getByTestId('edit-inv-legacy-no-type').click();
    // ไม่แตะช่องประเภทภาษีเลย (ปล่อยเป็น "-- เลือกประเภทภาษี --") แค่แก้ชื่อผู้ขายแล้วบันทึกทันที
    await page.getByTestId('input-vendor-name').fill('ผู้ขาย ข้อมูลเก่า แก้ไขแล้ว');
    await page.getByTestId('submit-invoice-form').click();

    await expect(page.getByText('ผู้ขาย ข้อมูลเก่า แก้ไขแล้ว')).toBeVisible();
    // ยังคงเป็น "รอตรวจสอบประเภทภาษี" เหมือนเดิม — ไม่มีการเดา/เขียนทับให้เลย
    await expect(page.getByTestId('tax-status-badge-inv-legacy-no-type')).toHaveText('รอตรวจสอบประเภทภาษี');
    // ปุ่ม "ได้รับแล้ว" ต้องยังอยู่เหมือนเดิม (ประเภทที่ถูกซ่อนปุ่มนี้คือ no_vat/non_claimable_vat เท่านั้น
    // ไม่ใช่ NULL — ข้อมูลเก่าที่ยังไม่จำแนกต้องใช้งานได้เหมือนก่อนมีฟีเจอร์นี้ทุกประการ)
    await expect(page.getByTestId('mark-received-inv-legacy-no-type')).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });
});
