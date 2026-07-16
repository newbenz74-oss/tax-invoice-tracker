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

/** วันที่ ISO (YYYY-MM-DD) ห่างจากวันนี้ตาม offsetDays (ติดลบ = ในอดีต) — ใช้ทดสอบ aging bucket แบบสัมพัทธ์กับเวลาจริง */
export function isoDaysFromNow(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** ไปหน้า "บันทึกค่าใช้จ่าย" โดยตรง (ไม่ใช่หน้า Dashboard ภาพรวมที่เป็นค่าเริ่มต้นหลัง 2026-07-15) —
 * เทสต์ที่ทดสอบพฤติกรรมของตาราง/ฟอร์ม/filter/pagination ควรเรียกฟังก์ชันนี้แทน page.goto('/dashboard')
 * ตรงๆ (ตั้งแต่รอบปรับโครงสร้าง Navigation/Layout ที่เปลี่ยน DEFAULT_ACTIVE_ID เป็น 'dashboard' หน้า
 * "บันทึกค่าใช้จ่าย" ไม่ใช่หน้าแรกที่เห็นหลัง goto('/dashboard') อีกต่อไป ต้องคลิกเมนูก่อน) */
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
