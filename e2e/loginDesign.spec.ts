import { test, expect } from '@playwright/test';
import { attachConsoleErrorCollector, setupMockSupabase } from './helpers';

// เทสต์ชุดนี้ครอบคลุมเฉพาะ UI ใหม่ที่เพิ่มเข้ามาตอนปรับดีไซน์หน้า Login (พื้นหลังฟ้า, Card,
// toggle password, ลิงก์ลืมรหัสผ่าน, ไม่มี social login, responsive) — ไม่แตะไฟล์ e2e/auth.spec.ts
// เดิมเลย เพราะไฟล์นั้นคือหลักฐานว่า Logic การ login/signup เดิมไม่ถูกกระทบจากการปรับดีไซน์รอบนี้
test.describe('ดีไซน์หน้า Login ใหม่', () => {
  test('ปุ่มไอคอนตาที่ช่องรหัสผ่านสลับแสดง/ซ่อนรหัสผ่านได้ โดยค่าที่กรอกไว้ไม่หาย', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {});
    await page.goto('/login');

    const passwordInput = page.getByLabel('รหัสผ่าน');
    await passwordInput.fill('mysecret123');
    await expect(passwordInput).toHaveAttribute('type', 'password');

    await page.getByRole('button', { name: 'แสดงรหัส', exact: true }).click();
    await expect(passwordInput).toHaveAttribute('type', 'text');
    await expect(passwordInput).toHaveValue('mysecret123');

    await page.getByRole('button', { name: 'ซ่อนรหัส', exact: true }).click();
    await expect(passwordInput).toHaveAttribute('type', 'password');
    await expect(passwordInput).toHaveValue('mysecret123');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ลิงก์ "ลืมรหัสผ่าน?" แสดงข้อความแจ้งเตือนโดยไม่ error และไม่ submit ฟอร์ม', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {});
    await page.goto('/login');

    await page.getByRole('button', { name: 'ลืมรหัสผ่าน?' }).click();

    await expect(page.getByText('ฟังก์ชันรีเซ็ตรหัสผ่านจะเปิดใช้งานในภายหลัง')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ลิงก์ "สมัครใช้งาน" ใต้ปุ่มเข้าสู่ระบบสลับไป Tab สมัครสมาชิกได้ และซ่อนตัวเองในโหมดสมัครสมาชิก', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {});
    await page.goto('/login');

    await page.getByRole('button', { name: 'สมัครใช้งาน' }).click();

    await expect(page.locator('button[type="submit"]')).toHaveText('สมัครสมาชิก');
    await expect(page.getByRole('button', { name: 'สมัครใช้งาน' })).toHaveCount(0);

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ไม่มีปุ่ม Social Login (Facebook, Google, Apple) และไม่มีเส้นแบ่ง "หรือ" ตามข้อกำหนด', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {});
    await page.goto('/login');

    await expect(page.getByRole('button', { name: /facebook/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /google/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /apple/i })).toHaveCount(0);
    await expect(page.getByText('หรือ', { exact: true })).toHaveCount(0);

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('แสดงผลบนหน้าจอมือถือขนาดเล็กได้โดยไม่เกิด horizontal scroll และยังกรอก/กดปุ่มได้ปกติ', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await page.setViewportSize({ width: 375, height: 667 });
    await setupMockSupabase(page, {});
    await page.goto('/login');

    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasHorizontalScroll).toBe(false);

    await expect(page.getByLabel('อีเมล')).toBeVisible();
    await expect(page.getByLabel('รหัสผ่าน')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });
});
