import { test, expect } from '@playwright/test';
import { attachConsoleErrorCollector, setupMockSupabase } from './helpers';

// เทสต์ชุดนี้ครอบคลุมเฉพาะเอฟเฟกต์เปลี่ยนหน้า Login → Dashboard ที่เพิ่มเข้ามา (2026-07-18): ปุ่ม
// "เข้าสู่ระบบ" แสดง loading/ปิดกดซ้ำ, การ์ด/พื้นหลัง/light sweep ตอนเข้าสู่ระบบสำเร็จ, เข้าหน้า Dashboard
// ยังคงทำงานถูกต้อง, เข้าสู่ระบบไม่สำเร็จต้องไม่เล่นเอฟเฟกต์และไม่เปลี่ยนหน้า, และ prefers-reduced-motion
// ต้องปิดเอฟเฟกต์ภาพทั้งหมด — ไม่แตะไฟล์ e2e/auth.spec.ts เดิมเลย (หลักฐานว่า logic login/signup เดิม
// ไม่ถูกกระทบ) เทสต์ชุดนี้เสริมเฉพาะพฤติกรรมใหม่ของรอบนี้เท่านั้น
test.describe('เอฟเฟกต์เปลี่ยนหน้า Login → Dashboard', () => {
  test('กำลังเข้าสู่ระบบ: ปุ่มแสดง spinner + ข้อความ "กำลังเข้าสู่ระบบ..." และถูกปิดใช้งานจนกว่าจะเข้าหน้า Dashboard', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { users: [{ email: 'user@example.com', password: 'correct-password' }] });
    await page.goto('/login');

    await page.getByLabel('อีเมล').fill('user@example.com');
    await page.getByLabel('รหัสผ่าน').fill('correct-password');

    const submitButton = page.locator('button[type="submit"]');
    await submitButton.click();

    // ต้องยังอยู่ในสถานะ "ยุ่ง" (disabled + ข้อความ + spinner) อย่างน้อยจนกว่า EXIT_TRANSITION_MS
    // (700ms) จะผ่านไป — enterDashboard() การันตีดีเลย์ขั้นต่ำนี้ก่อนนำทางจริงเสมอ (ดู
    // app/login/page.tsx) ตรวจทุกอย่าง (disabled/ข้อความ/spinner) พร้อมกันในการเรียกเดียวผ่าน
    // evaluate() แทนการเรียก expect() แยกหลายครั้ง เพื่อลดโอกาส "แข่งเวลา" กับ navigation ที่อาจเกิดขึ้น
    // ถ้าเครื่องช้าลงชั่วคราว (เช่น รันเทสต์คู่ขนานหลายตัวพร้อมกัน) — แต่ละ round-trip แยกกันมีโอกาสเจอ
    // ช่วงที่ scheduler ดีเลย์สะสมข้ามเส้น 700ms ได้ถ้าเรียกทีละครั้ง
    await expect(submitButton).toBeDisabled();
    const buttonState = await submitButton.evaluate((el) => ({
      text: el.textContent ?? '',
      hasSpinner: el.querySelector('svg') !== null,
    }));
    expect(buttonState.text).toContain('กำลังเข้าสู่ระบบ...');
    expect(buttonState.hasSpinner).toBe(true);

    // สุดท้ายต้องเข้าหน้า Dashboard ได้จริงเหมือนเดิมทุกประการ (ไม่ใช่แค่ล่าช้าเฉยๆ)
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('เข้าสู่ระบบสำเร็จ: การ์ดย่อ+จาง พื้นหลังเบลอ และ light sweep ปรากฏขึ้นระหว่างเปลี่ยนหน้า', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { users: [{ email: 'user@example.com', password: 'correct-password' }] });
    await page.goto('/login');

    await page.getByLabel('อีเมล').fill('user@example.com');
    await page.getByLabel('รหัสผ่าน').fill('correct-password');
    await page.locator('button[type="submit"]').click();

    // การ์ด login ต้องได้คลาส exiting (scale+fade) และ light sweep ต้อง mount ขึ้นมา — ทั้งคู่เกิดขึ้น
    // ทันทีที่เข้าสู่ระบบสำเร็จ (ก่อน setTimeout 600ms) จึงตรวจได้ทันทีหลังคลิกโดยไม่ต้องรอ
    await expect(page.locator('.login-card-exiting')).toBeVisible();
    await expect(page.getByTestId('login-light-sweep')).toBeVisible();

    await expect(page).toHaveURL(/\/dashboard/);
    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('เข้าสู่ระบบไม่สำเร็จ: ไม่เล่นเอฟเฟกต์ ไม่เปลี่ยนหน้า และปุ่มกลับมากดได้ปกติ', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { users: [{ email: 'user@example.com', password: 'correct-password' }] });
    await page.goto('/login');

    await page.getByLabel('อีเมล').fill('user@example.com');
    await page.getByLabel('รหัสผ่าน').fill('wrong-password');
    await page.locator('button[type="submit"]').click();

    await expect(page.getByTestId('auth-error')).toContainText('ไม่ถูกต้อง');
    await expect(page).toHaveURL(/\/login/);

    // ต้องไม่มีเอฟเฟกต์ใดๆ เล่นเลยเมื่อเข้าสู่ระบบไม่สำเร็จ — ไม่มีการ์ด exiting ค้าง ไม่มี light sweep
    // ปรากฏ และปุ่มต้องกลับมาเป็นข้อความ/สถานะปกติ (ไม่ถูก disabled ค้าง) ให้กดใหม่ได้ทันที
    await expect(page.locator('.login-card-exiting')).toHaveCount(0);
    await expect(page.getByTestId('login-light-sweep')).toHaveCount(0);
    const submitButton = page.locator('button[type="submit"]');
    await expect(submitButton).toBeEnabled();
    await expect(submitButton).toHaveText('เข้าสู่ระบบ');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('รองรับ prefers-reduced-motion: เข้าหน้า Dashboard ได้ปกติ แต่ไม่มี light sweep หรือเอฟเฟกต์ภาพใดๆ เล่นเลย', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setupMockSupabase(page, { users: [{ email: 'user@example.com', password: 'correct-password' }] });
    await page.goto('/login');

    await page.getByLabel('อีเมล').fill('user@example.com');
    await page.getByLabel('รหัสผ่าน').fill('correct-password');
    await page.locator('button[type="submit"]').click();

    // เปิด reduced-motion ไว้ — enterDashboard() ต้องข้าม setTimeout แล้วนำทางทันที ไม่มี light sweep
    // mount ขึ้นมาเลยแม้แต่เฟรมเดียว (เงื่อนไข exiting && !prefersReducedMotion ใน JSX กันไว้ตั้งแต่ต้น
    // ไม่ใช่แค่ปิดด้วย CSS) ต้องยังเข้าหน้า Dashboard ได้ถูกต้องเหมือนเดิมทุกประการ
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByTestId('login-light-sweep')).toHaveCount(0);
    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });
});
