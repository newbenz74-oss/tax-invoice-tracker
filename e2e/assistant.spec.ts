import { test, expect } from '@playwright/test';
import { attachConsoleErrorCollector, setupMockSupabase } from './helpers';

const OWNER = 'user@example.com';

/**
 * ผู้ช่วย "ACC Reconcile AI Copilot" (2026-07-19) — mount แบบ global ที่ root layout จึงปรากฏทุกหน้า
 * ตั้งแต่ /login เป็นต้นไป เทสต์ชุดนี้ใช้ Local Mode ล้วนๆ (ไม่ตั้งค่า NEXT_PUBLIC_ASSISTANT_REMOTE_ENABLED
 * เลย ตรงกับค่า default ของ production build จริง) จึงไม่ต้อง mock เครือข่ายใดๆ เพิ่ม — คำถามทุกคำถามในไฟล์
 * นี้ตอบจากฐานความรู้ในเครื่อง (lib/assistantKnowledge.ts) ล้วนๆ
 *
 * หมายเหตุสำคัญเรื่อง Playwright toBeVisible(): แผงแชท (AssistantPanel) mount ค้างไว้เสมอ (ไม่ unmount ตอน
 * ปิด) แล้วสลับสถานะด้วย opacity/transform (ดู .assistant-panel-open/-closed ใน globals.css) — Playwright
 * นับ element ที่ opacity: 0 ว่ายัง "visible" อยู่ (เกณฑ์ของ Playwright ไม่รวม opacity) จึงใช้ toBeVisible()
 * เช็คสถานะเปิด/ปิดไม่ได้ตรงๆ (เจอบั๊กแบบเดียวกันมาแล้วใน sidebar.spec.ts ที่ transform เลื่อนออกนอกจอ) —
 * ในไฟล์นี้ใช้พฤติกรรมจริงแทน: หลังเปิดแผง ช่องพิมพ์ต้อง toBeFocused() ได้ (inert ตัดความสามารถ focus ออก
 * ตอนปิดจริง) และหลังปิด ปุ่มลอย (bubble) ต้อง toBeFocused() แทน (focus-restore)
 */

test.describe('ACC Reconcile AI Copilot — ปุ่มลอย + แผงแชท', () => {
  test('ปุ่มลอยของผู้ช่วยแสดงบนหน้า Login (ก่อนเข้าสู่ระบบ)', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {});
    await page.goto('/login');

    await expect(page.getByTestId('assistant-bubble')).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ปุ่มลอยของผู้ช่วยแสดงบนหน้า Dashboard (หลังเข้าสู่ระบบ)', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await expect(page.getByTestId('assistant-bubble')).toBeVisible();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('คลิกปุ่มลอยเปิดแผงพร้อมข้อความทักทาย ปิดด้วยปุ่ม X แล้ว focus กลับไปที่ปุ่มลอย', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await page.getByTestId('assistant-bubble').click();

    // ช่องพิมพ์ focus อัตโนมัติทันทีที่เปิด (ดู AssistantPanel.tsx) — พิสูจน์ทางอ้อมว่าแผงเปิดจริง (ไม่ใช่
    // แค่ inert ปัจจุบันเป็น true ค้างอยู่ ซึ่งจะทำให้ focus() นี้ทำงานไม่ได้เลย)
    await expect(page.getByTestId('assistant-input')).toBeFocused();
    await expect(page.getByTestId('assistant-message-assistant').first()).toContainText(
      'ACC Reconcile AI Copilot'
    );

    const panel = page.getByTestId('assistant-panel');
    await expect(panel).toHaveClass(/assistant-panel-open/);
    expect(await panel.evaluate((el) => (el as HTMLElement).inert)).toBe(false);

    await page.getByTestId('close-assistant-panel').click();

    await expect(page.getByTestId('assistant-bubble')).toBeFocused();
    await expect(panel).toHaveClass(/assistant-panel-closed/);
    expect(await panel.evaluate((el) => (el as HTMLElement).inert)).toBe(true);

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ปิดแผงด้วยปุ่ม ESC ได้เช่นกัน', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await page.getByTestId('assistant-bubble').click();
    await expect(page.getByTestId('assistant-input')).toBeFocused();

    await page.keyboard.press('Escape');

    await expect(page.getByTestId('assistant-bubble')).toBeFocused();

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ถามคำถามที่มีอยู่ในฐานความรู้ ได้คำตอบและปุ่มแนะนำที่ตรงประเด็น', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await page.getByTestId('assistant-bubble').click();
    await page.getByTestId('assistant-input').fill('สมุดรายชื่อใช้งานยังไง');
    await page.getByTestId('send-assistant-message').click();

    // ข้อความผู้ใช้ต้องขึ้นก่อน ตามด้วยคำตอบจาก entry 'address-book-howto' (lib/assistantKnowledge.ts)
    await expect(page.getByTestId('assistant-message-user').last()).toContainText('สมุดรายชื่อใช้งานยังไง');
    await expect(page.getByTestId('assistant-message-assistant').last()).toContainText(
      'จัดการรายชื่อลูกค้า/ผู้จัดจำหน่าย'
    );
    await expect(page.getByTestId('assistant-suggestion-chip').first()).toBeVisible();
    // pending indicator ต้องหายไปแล้วหลังตอบเสร็จ (จับคู่ในเครื่องล้วนๆ ไม่มีการรอเครือข่ายจริง)
    await expect(page.getByTestId('assistant-pending-indicator')).toHaveCount(0);
    // ช่องพิมพ์ต้องว่างและกลับมาพิมพ์ได้ต่อทันที
    await expect(page.getByTestId('assistant-input')).toHaveValue('');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  // ปุ่มส่ง (send-assistant-message) ตั้งใจไม่ใช้ type="submit" (ดูคอมเมนต์ใน AssistantPanel.tsx — ชนกับ
  // selector button[type="submit"] แบบกว้างๆ ของเทสต์หน้า Login เดิม) เทสต์นี้ยืนยันว่าฟอร์มที่มีช่องข้อความ
  // เดียวและไม่มีปุ่ม submit เลยยัง implicit-submit ตอนกด Enter ได้ตามปกติ (พฤติกรรมมาตรฐานของ HTML) จึงไม่
  // เสียความสามารถ "กด Enter เพื่อส่ง" ไปจากการเปลี่ยนนี้เลย
  test('กด Enter ในช่องพิมพ์ส่งข้อความได้เหมือนกดปุ่มส่ง', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await page.getByTestId('assistant-bubble').click();
    await page.getByTestId('assistant-input').fill('สมุดรายชื่อใช้งานยังไง');
    await page.getByTestId('assistant-input').press('Enter');

    await expect(page.getByTestId('assistant-message-user').last()).toContainText('สมุดรายชื่อใช้งานยังไง');
    await expect(page.getByTestId('assistant-message-assistant').last()).toContainText(
      'จัดการรายชื่อลูกค้า/ผู้จัดจำหน่าย'
    );

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ถามคำถามที่ไม่รู้จัก ได้ข้อความสำรองแทนที่จะเงียบหรือค้าง', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await page.getByTestId('assistant-bubble').click();
    // คำถามที่ไม่ตรง keyword ของหัวข้อความรู้ใดๆ เลยสักตัวใน lib/assistantKnowledge.ts และไม่ตรงรูปแบบคำสั่ง
    // นำทางใน lib/assistantNavResolver.ts เลยเช่นกัน (ตรวจสอบแล้วว่าไม่ชนกับ keyword ใดๆ ในฐานความรู้)
    await page.getByTestId('assistant-input').fill('พรุ่งนี้ฝนจะตกไหมคะ');
    await page.getByTestId('send-assistant-message').click();

    await expect(page.getByTestId('assistant-message-assistant').last()).toContainText(
      'ดิฉันไม่แน่ใจว่าเข้าใจคำถามถูกต้องหรือเปล่า'
    );
    // ไม่มีปุ่มแนะนำแนบมากับข้อความสำรอง (ไม่มีอะไรให้กดต่อ)
    await expect(page.getByTestId('assistant-suggestion-chip')).toHaveCount(0);

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('พิมพ์คำสั่งนำทาง กดปุ่มแนะนำแล้วเปลี่ยนเมนูจริงในแอป', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

    await page.getByTestId('assistant-bubble').click();
    // ตรงกับวลีคำสั่งนำทางใน NAV_COMMAND_PHRASES (lib/assistantNavResolver.ts) เป้าหมาย 'address-book'
    await page.getByTestId('assistant-input').fill('ไปสมุดรายชื่อ');
    await page.getByTestId('send-assistant-message').click();

    const navigateChip = page.getByTestId('assistant-suggestion-chip').filter({ hasText: 'ไปหน้า สมุดรายชื่อ' });
    await expect(navigateChip).toBeVisible();
    await navigateChip.click();

    // เมนูจริงในแอปเปลี่ยนไปหน้า "สมุดรายชื่อ" (ผ่าน nav bridge ที่ DashboardShell ลงทะเบียนไว้)
    await expect(page.getByRole('heading', { level: 1, name: 'สมุดรายชื่อ' })).toBeVisible();
    await expect(page.getByTestId('nav-item-address-book')).toHaveAttribute('aria-current', 'page');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('สั่งไฮไลต์ element จริงที่ render อยู่บนหน้าปัจจุบัน เลื่อนจอไปหาและเรืองแสง', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');
    // อยู่หน้า Dashboard อยู่แล้ว (ค่าเริ่มต้น) — entry 'dashboard-overview' มี pageScope: 'dashboard' และมี
    // ปุ่มแนะนำ highlight ชี้ไปที่ [data-testid="quick-actions"] ซึ่งมีอยู่จริงบนหน้านี้
    await expect(page.getByTestId('quick-actions')).toBeVisible();

    await page.getByTestId('assistant-bubble').click();
    await page.getByTestId('assistant-input').fill('ภาพรวม');
    await page.getByTestId('send-assistant-message').click();

    const highlightChip = page.getByTestId('assistant-suggestion-chip').filter({ hasText: 'ดูปุ่มทางลัด' });
    await expect(highlightChip).toBeVisible();
    await highlightChip.click();

    await expect(page.getByTestId('quick-actions')).toHaveClass(/assistant-highlight-glow/);

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('สั่งไฮไลต์ element ที่ไม่ได้ render อยู่บนหน้าปัจจุบัน ผู้ช่วยแจ้งเตือนแทนที่จะเงียบ', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');
    // ยังอยู่หน้า Dashboard (ไม่ใช่หน้า "บันทึกการจ่ายเงิน") — ปุ่ม [data-testid="open-import-panel"] ของ
    // entry 'record-expense-excel-import' จึงไม่ได้ render อยู่จริงตอนนี้
    await expect(page.getByTestId('open-import-panel')).toHaveCount(0);

    await page.getByTestId('assistant-bubble').click();
    await page.getByTestId('assistant-input').fill('นำเข้า excel');
    await page.getByTestId('send-assistant-message').click();

    const highlightChip = page.getByTestId('assistant-suggestion-chip').filter({ hasText: 'ดูปุ่มนำเข้าจาก Excel' });
    await expect(highlightChip).toBeVisible();
    await highlightChip.click();

    await expect(page.getByTestId('assistant-message-assistant').last()).toContainText('ไม่พบองค์ประกอบนี้ในหน้าปัจจุบัน');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ปุ่มแนะนำ "นำทาง" ตอนอยู่หน้า Login แจ้งเตือนแทนที่จะเงียบ (ยังไม่มี nav bridge ก่อนเข้าสู่ระบบ)', async ({
    page,
  }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, {});
    await page.goto('/login');

    await page.getByTestId('assistant-bubble').click();
    await page.getByTestId('assistant-input').fill('ไปสมุดรายชื่อ');
    await page.getByTestId('send-assistant-message').click();

    const navigateChip = page.getByTestId('assistant-suggestion-chip').filter({ hasText: 'ไปหน้า สมุดรายชื่อ' });
    await expect(navigateChip).toBeVisible();
    await navigateChip.click();

    // ต้องยังอยู่หน้า Login เหมือนเดิม (ไม่มีที่ให้นำทางไปจริงก่อน login) พร้อมข้อความแจ้งเตือนแทนการเงียบ
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId('assistant-message-assistant').last()).toContainText('ต้องเข้าสู่ระบบก่อน');

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('ล้างการสนทนา กลับไปเหลือแค่ข้อความทักทายข้อความเดียว', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await page.getByTestId('assistant-bubble').click();
    await page.getByTestId('assistant-input').fill('สมุดรายชื่อใช้งานยังไง');
    await page.getByTestId('send-assistant-message').click();
    await expect(page.getByTestId('assistant-message-user')).toHaveCount(1);
    await expect(page.getByTestId('assistant-message-assistant')).toHaveCount(2); // ทักทาย + คำตอบ

    await page.getByTestId('clear-assistant-chat').click();

    await expect(page.getByTestId('assistant-message-user')).toHaveCount(0);
    await expect(page.getByTestId('assistant-message-assistant')).toHaveCount(1);
    await expect(page.getByTestId('assistant-message-assistant').first()).toContainText(
      'ACC Reconcile AI Copilot'
    );

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('จำสถานะเปิด/ปิดแผงไว้ข้าม refresh (localStorage benz_assistant_open)', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    await page.getByTestId('assistant-bubble').click();
    await expect(page.getByTestId('assistant-input')).toBeFocused();

    await page.reload();

    // เปิดแผงกลับมาอัตโนมัติหลัง refresh (persisted state) — เช็คผ่าน inert เพราะ toBeVisible() ไม่แยกแยะ
    // สถานะนี้ได้ (ดู docblock บนสุดของไฟล์นี้)
    const panel = page.getByTestId('assistant-panel');
    await expect.poll(async () => panel.evaluate((el) => (el as HTMLElement).inert)).toBe(false);

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });

  test('มือถือ: ปุ่มลอยและแผงแชทอยู่ในขอบเขตจอ ไม่ล้นออกไปนอกจอ', async ({ page }) => {
    const errors = attachConsoleErrorCollector(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await setupMockSupabase(page, { loggedInAs: OWNER, users: [{ email: OWNER, password: 'x' }] });
    await page.goto('/dashboard');

    const bubble = page.getByTestId('assistant-bubble');
    await expect(bubble).toBeVisible();
    const bubbleBox = await bubble.boundingBox();
    expect(bubbleBox).not.toBeNull();
    if (bubbleBox) {
      expect(bubbleBox.x).toBeGreaterThanOrEqual(0);
      expect(bubbleBox.x + bubbleBox.width).toBeLessThanOrEqual(375);
    }

    await bubble.click();
    await expect(page.getByTestId('assistant-input')).toBeFocused();

    const panelBox = await page.getByTestId('assistant-panel').boundingBox();
    expect(panelBox).not.toBeNull();
    if (panelBox) {
      expect(panelBox.x).toBeGreaterThanOrEqual(0);
      expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(375);
      expect(panelBox.y).toBeGreaterThanOrEqual(0);
      expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(800);
    }

    expect(errors, `พบ console error: ${errors.join(', ')}`).toEqual([]);
  });
});
