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
