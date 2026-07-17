import type { Page } from '@playwright/test';
import { installMockSupabase, type MockSeed } from './mockSupabase';

/** ติดตาม console.error / pageerror ทั้งหมดที่เกิดขึ้นระหว่างเทสต์ — ใช้ assert ท้ายเทสต์ว่าต้องว่าง */
export function attachConsoleErrorCollector(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

/** ต้องเรียกก่อน page.goto() เสมอ เพื่อ inject mock Supabase client ก่อนแอปโหลด */
export async function setupMockSupabase(page: Page, seed: MockSeed = {}) {
  await page.addInitScript(installMockSupabase, seed);
}

/** ติดตามว่ามี native dialog (alert/confirm/prompt) เกิดขึ้นระหว่างเทสต์หรือไม่ — ปิด dialog อัตโนมัติทันที
 * (dismiss) เพื่อไม่ให้เทสต์ค้างรอ แล้วบันทึกข้อความไว้ให้ assert ท้ายเทสต์ว่าต้องว่างเสมอ ใช้พิสูจน์ว่าโค้ด
 * ไม่มีการเรียก alert()/confirm()/prompt() เลยตามที่สเปกกำหนด (เช่น Bank Reconcile เฟส 3 ส่วน "13. MANUAL
 * MATCH VALIDATION" ที่ห้ามใช้ alert() แสดง error โดยเด็ดขาด — ต้องแสดงใน Modal/Drawer เองเท่านั้น) */
export function attachDialogGuard(page: Page): string[] {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss();
  });
  return dialogs;
}

/** วันที่ ISO (YYYY-MM-DD) ห่างจากวันนี้ตาม offsetDays (ติดลบ = ในอดีต) — ใช้ทดสอบ aging bucket แบบสัมพัทธ์กับเวลาจริง */
export function isoDaysFromNow(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** ไปหน้า "บันทึกค่าใช้จ่าย" (เมนู Sidebar ชื่อ "บันทึกการจ่ายเงิน" ตั้งแต่รอบปรับลดหมวดให้เหลือเมนูเดียว
 * 2026-07-17 — id/route/component เดิมทุกประการ แค่ label เปลี่ยน) โดยตรง (ไม่ใช่หน้า Dashboard ภาพรวมที่
 * เป็นค่าเริ่มต้นหลัง 2026-07-15) — เทสต์ที่ทดสอบพฤติกรรมของตาราง/ฟอร์ม/filter/pagination ควรเรียก
 * ฟังก์ชันนี้แทน page.goto('/dashboard') ตรงๆ (ตั้งแต่รอบปรับโครงสร้าง Navigation/Layout ที่เปลี่ยน
 * DEFAULT_ACTIVE_ID เป็น 'dashboard' หน้านี้ไม่ใช่หน้าแรกที่เห็นหลัง goto('/dashboard') อีกต่อไป ต้องคลิก
 * เมนูก่อน) — ตั้งแต่รอบปรับโครงสร้าง Sidebar (2026-07-17) เมนูนี้ถูกย้ายเข้าไปซ้อนอยู่ใต้หมวดใหม่ "บัญชี"
 * (accounting) แล้ว แต่หมวดนี้ expand อยู่โดยค่าเริ่มต้นเหมือนหมวดอื่นทั้งหมด (defaultExpandedState) จึง
 * ยังคลิก nav-item ได้ทันทีเหมือนเดิมทุกประการ ไม่ต้องขยายหมวดก่อน */
export async function gotoRecordExpense(page: Page) {
  await page.goto('/dashboard');
  await page.getByTestId('nav-item-record-expense').click();
}

/** ไปหน้า "สมุดรายชื่อ" (ข้อมูลหลัก / Master Data) โดยตรง — เมนูนี้อยู่ในหมวดที่ expand อยู่แล้วโดย
 * ค่าเริ่มต้น (ดู lib/navigation.ts defaultExpandedState) จึงคลิกที่ nav-item ได้เลยไม่ต้องขยายหมวดก่อน */
export async function gotoAddressBook(page: Page) {
  await page.goto('/dashboard');
  await page.getByTestId('nav-item-address-book').click();
}

/** ตั้งเมนู active ตรงๆ ผ่าน localStorage ก่อนโหลดหน้า แล้วค่อย goto('/dashboard') — ใช้แทนการคลิก
 * Sidebar สำหรับเมนูที่ถูกตั้ง hidden: true ไว้ใน lib/navigation.ts (ไม่มี nav-item ให้คลิกใน Sidebar
 * อีกต่อไปตั้งแต่รอบปรับโครงสร้าง Sidebar 2026-07-17 — ดูคอมเมนต์ NavLeaf.hidden) หน้า/component ปลายทาง
 * ยังทำงานได้ครบทุกฟีเจอร์เหมือนเดิมทุกประการ (ผู้ใช้ขอแค่ "เอาออกจากเมนู" ไม่ได้ขอให้ลบหน้าหรือ route
 * ใดๆ) ใช้กลไก persistence เดิมของแอปเอง (ACTIVE_NAV_STORAGE_KEY = 'benz_sidebar_active' ใน
 * app/dashboard/page.tsx อ่านค่านี้ตอน mount ครั้งแรกผ่าน readInitialActiveId() อยู่แล้ว และ validate
 * ผ่าน findNavLeaf ซึ่งหาเจอรายการที่ hidden: true ได้ตามปกติ) จำลองสถานการณ์ "ผู้ใช้เคยอยู่หน้านี้มา
 * ก่อนแล้วรีเฟรช" ซึ่งเป็นพฤติกรรมจริงที่แอปรองรับอยู่แล้ว ไม่ใช่ backdoor ใหม่ที่เพิ่มเข้ามา */
export async function gotoHiddenNavItem(page: Page, id: string) {
  await page.addInitScript((navId) => {
    window.localStorage.setItem('benz_sidebar_active', navId);
  }, id);
  await page.goto('/dashboard');
}

/** ไปหน้า "ภาษีซื้อที่ยังไม่ได้รับ" (เดิมชื่อ "ภาษีซื้อไม่ถึงกำหนด") โดยตรง — เมนูนี้ถูกเอาออกจาก Sidebar
 * แล้วตั้งแต่รอบปรับโครงสร้าง Sidebar (2026-07-17 — "Outstanding Purchase VAT" อยู่ในลิสต์ REMOVE FROM
 * SIDEBAR) หน้า/component/business logic เดิมไม่ถูกแก้ไขเลยแม้แต่บรรทัดเดียว จึงนำทางตรงผ่าน
 * gotoHiddenNavItem แทนการคลิก nav-item ที่ไม่มีอยู่ใน Sidebar อีกต่อไป */
export async function gotoOverduePurchaseTax(page: Page) {
  await gotoHiddenNavItem(page, 'overdue-purchase-tax');
}
