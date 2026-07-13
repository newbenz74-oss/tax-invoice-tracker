import { test, expect } from '@playwright/test';
import { attachConsoleErrorCollector, isoDaysFromNow, setupMockSupabase } from './helpers';

const OWNER = 'user@example.com';

test.describe('Invoice CRUD และ business logic', () => {
  test('เพิ่มรายการใหม่: VAT auto-suggest 7% และคำนวณยอดรวมถูกต้อง', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await page.getByTestId('open-add-form').click();
    await page.getByTestId('input-vendor-name').fill('บริษัท ทดสอบ E2E จำกัด');
    await page.getByTestId('input-transaction-date').fill(isoDaysFromNow(0));
    await page.getByTestId('input-amount').fill('1000');

    await expect(page.getByTestId('input-vat')).toHaveValue('70');
    await expect(page.getByTestId('computed-total')).toContainText('1,070.00');

    await page.getByTestId('submit-invoice-form').click();

    await expect(page.getByText('บริษัท ทดสอบ E2E จำกัด')).toBeVisible();
    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
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

  test('ทำเครื่องหมายว่าได้รับแล้วพร้อมกรอกเลขที่ใบกำกับภาษี', async ({ page }) => {
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
    await page.getByTestId('tax-invoice-number-input-inv-to-receive').fill('TAX-INV-0042');
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
