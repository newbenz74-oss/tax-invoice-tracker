'use client';

/** ระยะเวลาที่เอฟเฟกต์ไฮไลต์แสดงก่อนล้างตัวเองอัตโนมัติ (มิลลิวินาที) */
const HIGHLIGHT_DURATION_MS = 2400;
const HIGHLIGHT_CLASS = 'assistant-highlight-glow';

let clearTimer: ReturnType<typeof setTimeout> | null = null;
let currentElement: Element | null = null;

/**
 * เลื่อนจอไปหาและไฮไลต์ element จริงที่มีอยู่บนหน้าปัจจุบัน ณ ขณะนี้ตาม CSS selector ที่ให้มา (อ้างอิง
 * data-testid ที่มีอยู่แล้วในระบบเสมอ — ตั้งใจไม่สร้าง attribute data-assistant-id คู่ขนานใหม่ทั่วทั้งแอป
 * ดูเหตุผลเต็มในแผนงาน) คืนค่า true/false ว่าหา element เจอไหม เพื่อให้ผู้เรียก (handleSuggestionClick ใน
 * components/AssistantRoot.tsx — ตัดสินใจให้เป็นคนเรียกแทน AssistantPanel.tsx เพราะเป็นคนถือ setMessages
 * อยู่แล้ว จะได้ต่อข้อความแจ้งเตือนกลับเข้าไปในแชทได้ตรงๆ) ตอบสนองได้อย่างตรงไปตรงมาเมื่อเป้าหมายที่ถามถึงไม่ได้
 * render อยู่จริงตอนนี้ (เช่น ปุ่มที่อยู่หลัง modal ที่ยังไม่เปิด หรือ section ที่ยุบอยู่) แทนที่จะเงียบเฉยๆ
 * โดยไม่บอกผู้ใช้เลย
 */
export function highlightElement(selector: string): boolean {
  if (typeof document === 'undefined') return false;

  const element = document.querySelector(selector);
  if (!element) return false;

  clearHighlight();

  const prefersReducedMotion =
    typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  element.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'center' });
  element.classList.add(HIGHLIGHT_CLASS);
  currentElement = element;

  clearTimer = setTimeout(() => {
    clearHighlight();
  }, HIGHLIGHT_DURATION_MS);

  return true;
}

/** ล้างเอฟเฟกต์ไฮไลต์ปัจจุบัน (ถ้ามี) — เรียกเองได้ตอนปิด panel หรือถามคำถามใหม่ ไม่ต้องรอ timer เดิมหมด
 * เวลาก่อน เรียกซ้ำตอนไม่มีไฮไลต์ค้างอยู่เลยก็ปลอดภัย ไม่มีผลอะไร */
export function clearHighlight(): void {
  if (clearTimer) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }
  if (currentElement) {
    currentElement.classList.remove(HIGHLIGHT_CLASS);
    currentElement = null;
  }
}
