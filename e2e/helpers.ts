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
 * เมนูก่อน) — เมนูนี้เป็น NavLeaf ระดับบนสุดแล้ว (ไม่ได้ซ้อนอยู่ใต้หมวดใดๆ อีกต่อไป) จึงคลิกได้ทันทีเหมือน
 * เดิมทุกประการ ไม่ต้องขยายหมวดก่อน */
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

/** ไปหน้า "ภาษีซื้อที่ยังไม่ได้รับ" (กระทบยอด > เดิมชื่อ "ภาษีซื้อไม่ถึงกำหนด") โดยตรง — อยู่ใต้หมวด
 * "กระทบยอด" ที่ expand อยู่แล้วโดยค่าเริ่มต้นเช่นเดียวกับหมวดอื่นทั้งหมด (defaultExpandedState) จึงคลิก
 * nav-item ได้เลยเหมือน gotoAddressBook/gotoRecordExpense ไม่ต้องขยายหมวดก่อน */
export async function gotoOverduePurchaseTax(page: Page) {
  await page.goto('/dashboard');
  await page.getByTestId('nav-item-overdue-purchase-tax').click();
}

/** ไปหน้า "Bank Reconcile" (กระทบยอด > เดิมขึ้น "เร็วๆ นี้" มาตลอด) แล้วกด "+ สร้างรอบกระทบยอดใหม่" ต่อทันที
 * เพื่อไปถึงขั้นตอนอัปโหลดไฟล์ — ตั้งแต่เฟส 4 (2026-07-16) หน้านี้เปลี่ยนจุดเริ่มต้นเป็นหน้ารายการ "ประวัติการ
 * กระทบยอดธนาคาร" (step 'list') แทนขั้นตอนอัปโหลดโดยตรงแบบเดิม (ดู components/BankReconcilePage.tsx) ฟังก์ชัน
 * นี้คงพฤติกรรม "ไปถึงขั้นตอนอัปโหลดไฟล์" แบบเดิมทุกประการไว้ให้เทสต์เฟส 1-3 ที่มีอยู่แล้วจำนวนมาก
 * (bankReconcile.spec.ts/bankReconcileMatch.spec.ts/bankReconcileManualMatch.spec.ts) ไม่ต้องแก้ไขเลยแม้แต่
 * บรรทัดเดียว — เทสต์ที่ต้องการทดสอบหน้ารายการเองโดยเฉพาะให้ใช้ gotoBankReconcileList() ด้านล่างแทน */
export async function gotoBankReconcile(page: Page) {
  await page.goto('/dashboard');
  await page.getByTestId('nav-item-bank-reconcile').click();
  await page.getByTestId('session-list-create-new').click();
}

/** ไปหน้า "Bank Reconcile" แล้วหยุดอยู่ที่หน้ารายการ "ประวัติการกระทบยอดธนาคาร" (step 'list') ตรงๆ โดยไม่กด
 * "สร้างรอบกระทบยอดใหม่" ต่อ — ใช้กับเทสต์เฟส 4 ที่ทดสอบหน้ารายการเอง (filter/tab/pagination/แถวแอ็กชัน/เปิดรอบ
 * เดิม) ต่างจาก gotoBankReconcile() ที่คลิกผ่านไปขั้นตอนอัปโหลดไฟล์ให้ทันทีเพื่อความเข้ากันได้ย้อนหลังกับเทสต์
 * เฟส 1-3 เดิม */
export async function gotoBankReconcileList(page: Page) {
  await page.goto('/dashboard');
  await page.getByTestId('nav-item-bank-reconcile').click();
}
