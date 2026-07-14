import { test, expect } from '@playwright/test';
import { attachConsoleErrorCollector, setupMockSupabase } from './helpers';

test.describe('Auth', () => {
  test('สมัครสมาชิกใหม่สำเร็จแล้วเข้าสู่หน้า dashboard', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {});
    await page.goto('/login');

    await page.getByRole('button', { name: 'สมัครสมาชิก' }).click();
    await page.getByLabel('อีเมล').fill('newuser@example.com');
    await page.getByLabel('รหัสผ่าน').fill('password123');
    await page.locator('button[type="submit"]').click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { name: 'บันทึกค่าใช้จ่าย' })).toBeVisible();
    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('สมัครด้วยอีเมลที่มีอยู่แล้วแสดง error', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { users: [{ email: 'existing@example.com', password: 'password123' }] });
    await page.goto('/login');

    await page.getByRole('button', { name: 'สมัครสมาชิก' }).click();
    await page.getByLabel('อีเมล').fill('existing@example.com');
    await page.getByLabel('รหัสผ่าน').fill('password123');
    await page.locator('button[type="submit"]').click();

    await expect(page.getByTestId('auth-error')).toContainText('สมัครสมาชิกไว้แล้ว');
    await expect(page).toHaveURL(/\/login/);
    expect(errors).toEqual([]);
  });

  test('เข้าสู่ระบบด้วยรหัสผ่านผิดแสดง error และไม่เข้าระบบ', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { users: [{ email: 'user@example.com', password: 'correct-password' }] });
    await page.goto('/login');

    await page.getByLabel('อีเมล').fill('user@example.com');
    await page.getByLabel('รหัสผ่าน').fill('wrong-password');
    await page.locator('button[type="submit"]').click();

    await expect(page.getByTestId('auth-error')).toContainText('ไม่ถูกต้อง');
    await expect(page).toHaveURL(/\/login/);
    expect(errors).toEqual([]);
  });

  test('เข้าสู่ระบบด้วยข้อมูลถูกต้องสำเร็จ', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { users: [{ email: 'user@example.com', password: 'correct-password' }] });
    await page.goto('/login');

    await page.getByLabel('อีเมล').fill('user@example.com');
    await page.getByLabel('รหัสผ่าน').fill('correct-password');
    await page.locator('button[type="submit"]').click();

    await expect(page).toHaveURL(/\/dashboard/);
    expect(errors).toEqual([]);
  });

  test('เข้าหน้า dashboard โดยไม่ login ถูกเด้งไปหน้า login', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {});
    await page.goto('/dashboard');

    await expect(page).toHaveURL(/\/login/);
    expect(errors).toEqual([]);
  });

  test('ออกจากระบบกลับไปหน้า login', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: 'user@example.com', users: [{ email: 'user@example.com', password: 'x' }] });
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);

    await page.getByRole('button', { name: 'ออกจากระบบ' }).click();

    await expect(page).toHaveURL(/\/login/);
    expect(errors).toEqual([]);
  });
});
