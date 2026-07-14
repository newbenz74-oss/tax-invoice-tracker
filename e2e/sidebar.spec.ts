import { test, expect } from '@playwright/test';
import { attachConsoleErrorCollector, setupMockSupabase } from './helpers';

const OWNER = 'user@example.com';

test.describe('Sidebar navigation', () => {
  test('เมนู "บันทึกค่าใช้จ่าย" active เป็นค่าเริ่มต้น และเห็นเนื้อหา Dashboard เดิม', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await expect(page.getByTestId('nav-item-record-expense')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 1, name: 'บันทึกค่าใช้จ่าย' })).toBeVisible();
    await expect(page.getByTestId('open-add-form')).toBeVisible();
    await expect(page.getByTestId('coming-soon')).toHaveCount(0);

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('คลิกเมนูที่ยังไม่มีฟีเจอร์จริงแสดงหน้า "เร็วๆ นี้" แทน Dashboard โดยไม่มี error', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await page.getByTestId('nav-item-payment-report').click();

    await expect(page.getByTestId('coming-soon')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'รายงานจ่ายเงิน' })).toBeVisible();
    await expect(page.getByTestId('open-add-form')).toHaveCount(0);
    await expect(page.getByTestId('nav-item-payment-report')).toHaveAttribute('aria-current', 'page');
    // Header (อีเมล/ปุ่มออกจากระบบ) ต้องยังอยู่ครบแม้ไม่ได้อยู่หน้า Dashboard
    await expect(page.getByRole('button', { name: 'ออกจากระบบ' })).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ยุบ/ขยายหมวดเมนูได้ และซ่อน/แสดงเมนูย่อยตามสถานะ', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await expect(page.getByTestId('nav-item-record-expense')).toBeVisible();
    await expect(page.getByTestId('nav-section-payments')).toHaveAttribute('aria-expanded', 'true');

    await page.getByTestId('nav-section-payments').click();

    await expect(page.getByTestId('nav-section-payments')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('nav-item-record-expense')).not.toBeVisible();

    await page.getByTestId('nav-section-payments').click();
    await expect(page.getByTestId('nav-item-record-expense')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('จำเมนูที่เลือกและสถานะยุบ/ขยายไว้ข้าม refresh (localStorage)', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await page.getByTestId('nav-section-payments').click(); // ยุบหมวด "บันทึกการจ่ายเงิน"
    await page.getByTestId('nav-item-bank-reconcile').click(); // เลือกเมนู "Bank Reconcile" ในหมวด "กระทบยอด"

    await expect(page.getByRole('heading', { level: 1, name: 'Bank Reconcile' })).toBeVisible();

    await page.reload();

    await expect(page.getByTestId('nav-item-bank-reconcile')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 1, name: 'Bank Reconcile' })).toBeVisible();
    await expect(page.getByTestId('nav-section-payments')).toHaveAttribute('aria-expanded', 'false');

    expect(errors).toEqual([]);
  });

  test('มือถือ: ซ่อน sidebar โดยค่าเริ่มต้น เปิดผ่านปุ่มแฮมเบอร์เกอร์ และปิดเมื่อคลิก overlay', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await expect(page.getByTestId('mobile-menu-button')).toBeVisible();
    await expect(page.getByTestId('sidebar-overlay')).toHaveCount(0);
    // sidebar ถูกเลื่อนออกนอกจอด้านซ้าย (x ติดลบ) — ใช้ boundingBox แทน toBeVisible() เพราะ
    // element ที่ซ่อนด้วย CSS transform ยังนับเป็น "visible" ตามเกณฑ์ของ Playwright
    await expect
      .poll(async () => (await page.getByTestId('sidebar').boundingBox())?.x)
      .toBeLessThan(0);

    await page.getByTestId('mobile-menu-button').click();
    await expect(page.getByTestId('sidebar-overlay')).toBeVisible();
    await expect
      .poll(async () => (await page.getByTestId('sidebar').boundingBox())?.x)
      .toBe(0);
    await expect(page.getByTestId('nav-item-record-expense')).toBeVisible();

    await page.getByTestId('sidebar-overlay').click();
    await expect(page.getByTestId('sidebar-overlay')).toHaveCount(0);
    await expect
      .poll(async () => (await page.getByTestId('sidebar').boundingBox())?.x)
      .toBeLessThan(0);

    expect(errors).toEqual([]);
  });

  test('มือถือ: คลิกเมนูแล้วปิด sidebar อัตโนมัติ', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await page.getByTestId('mobile-menu-button').click();
    await expect(page.getByTestId('sidebar-overlay')).toBeVisible();

    await page.getByTestId('nav-item-payment-report').click();

    await expect(page.getByTestId('sidebar-overlay')).toHaveCount(0);
    await expect(page.getByTestId('coming-soon')).toBeVisible();

    expect(errors).toEqual([]);
  });
});
