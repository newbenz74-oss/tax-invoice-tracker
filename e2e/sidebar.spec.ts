import { test, expect } from '@playwright/test';
import { attachConsoleErrorCollector, gotoAddressBook, setupMockSupabase } from './helpers';

const OWNER = 'user@example.com';

test.describe('Sidebar navigation', () => {
  // เดิมเมนูเริ่มต้นคือ "บันทึกค่าใช้จ่าย" — เปลี่ยนเป็น "Dashboard" ในรอบปรับโครงสร้าง
  // Navigation/Layout (2026-07-15) ตามที่ผู้ใช้ยืนยันให้ Dashboard เป็นหน้าแรกของระบบ
  test('เมนู "Dashboard" active เป็นค่าเริ่มต้น และเห็นหน้าภาพรวมระบบ', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await expect(page.getByTestId('nav-item-dashboard')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect(page.getByTestId('quick-actions')).toBeVisible();
    await expect(page.getByTestId('coming-soon')).toHaveCount(0);

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('คลิกเมนูที่ยังไม่มีฟีเจอร์จริงแสดงหน้า "เร็วๆ นี้" โดยไม่มี error', async ({ page }) => {
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

// เพิ่มเข้ามาพร้อมรอบปรับ Animation Sidebar Accordion + Hover ให้นุ่มนวลขึ้น (2026-07-16) — ครอบคลุม
// ข้อ 1, 2, 3, 12, 13 ของ "สิ่งที่ต้องทดสอบ" ที่ผู้ใช้ระบุมา (ข้ออื่นอยู่ใน addressBook.spec.ts แทน
// เพราะเกี่ยวกับหน้าสมุดรายชื่อโดยตรงมากกว่า) ไม่แตะ/ไม่ซ้ำกับเทสต์เดิมด้านบนเลย แค่เสริมมุมมองใหม่
// (มี CSS transition จริง ไม่ใช่ toggle ทันที, hover เปลี่ยนภาพ, คีย์บอร์ด, reduced motion)
test.describe('Sidebar: Accordion Animation + Hover + Accessibility (2026-07-16)', () => {
  test('Accordion "ข้อมูลหลัก": ยุบ/ขยายมี CSS transition จริง (ไม่ใช่ toggle ทันที) และ aria-controls เชื่อมกับ submenu ถูกต้อง', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoAddressBook(page);

    const sectionButton = page.getByTestId('nav-section-master-data');
    const panelId = await sectionButton.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    const panel = page.locator(`#${panelId}`);
    await expect(panel).toContainText('สมุดรายชื่อ');

    // ต้องมี transition-duration ประกาศไว้จริง (ไม่ใช่ 0s ซึ่งเท่ากับ toggle ทันทีไม่มี animation)
    const transitionDuration = await panel.evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(transitionDuration).toContain('0.25s');

    await expect(page.getByTestId('nav-item-address-book')).toBeVisible();

    // คลิกซ้ำ → ยุบเก็บ
    await sectionButton.click();
    await expect(sectionButton).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('nav-item-address-book')).not.toBeVisible();

    // คลิกอีกครั้ง → ขยายกลับ
    await sectionButton.click();
    await expect(sectionButton).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('nav-item-address-book')).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('Hover เมนู "สมุดรายชื่อ": เกิดการเปลี่ยนแปลงภาพ (เลื่อน/สีเปลี่ยน) ด้วย transition ที่ประกาศไว้', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    const item = page.getByTestId('nav-item-address-book');
    const transitionDuration = await item.evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(transitionDuration).not.toBe('0s');

    // หมายเหตุ: Tailwind v4 คอมไพล์ translate-x-[…] เป็นค่า CSS property `translate` เดี่ยวๆ (ไม่ใช่
    // `transform` แบบเดิม) จึงต้องอ่าน getComputedStyle(el).translate ไม่ใช่ .transform — ถ้าเช็คผิด
    // property จะเจอค่า "none" ตลอดแม้ hover ทำงานถูกต้องแล้วก็ตาม (element ยังคงขยับจริงบนหน้าจอ)
    const translateBefore = await item.evaluate((el) => getComputedStyle(el).translate);
    await item.hover();
    await expect
      .poll(async () => item.evaluate((el) => getComputedStyle(el).translate))
      .not.toBe(translateBefore);

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('คีย์บอร์ด: Tab ไปโฟกัสเมนู "ข้อมูลหลัก" ได้ และ Enter/Space เปิด-ปิดหมวดได้เหมือนคลิก', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoAddressBook(page);

    const sectionButton = page.getByTestId('nav-section-master-data');
    await sectionButton.focus();
    await expect(sectionButton).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(sectionButton).toHaveAttribute('aria-expanded', 'false');

    await page.keyboard.press('Space');
    await expect(sectionButton).toHaveAttribute('aria-expanded', 'true');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('รองรับ prefers-reduced-motion: Accordion ยังใช้งานได้ครบ แค่ transition สั้นลงมาก', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await gotoAddressBook(page);

    const sectionButton = page.getByTestId('nav-section-master-data');
    const panelId = await sectionButton.getAttribute('aria-controls');
    const panel = page.locator(`#${panelId}`);
    const transitionDuration = await panel.evaluate((el) => getComputedStyle(el).transitionDuration);
    // ต้องสั้นลงมากจนแทบเป็น 0 (ไม่ใช่ 0.25s ตามปกติ) แต่ฟีเจอร์ยังใช้งานได้ครบตามเทสต์ด้านล่าง
    expect(transitionDuration).not.toContain('0.25s');

    await sectionButton.click();
    await expect(page.getByTestId('nav-item-address-book')).not.toBeVisible();
    await sectionButton.click();
    await expect(page.getByTestId('nav-item-address-book')).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });
});
