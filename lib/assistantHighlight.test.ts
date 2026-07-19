import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearHighlight, highlightElement } from './assistantHighlight';

const HIGHLIGHT_CLASS = 'assistant-highlight-glow';

beforeEach(() => {
  document.body.innerHTML = `
    <button data-testid="target-a">A</button>
    <button data-testid="target-b">B</button>
  `;
  // jsdom ไม่มี implementation จริงของ scrollIntoView (known limitation) — mock เป็น no-op เสมอในเทสต์
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  clearHighlight();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('highlightElement', () => {
  it('เจอ element จริง → คืนค่า true, เลื่อนจอไปหา, และเติมคลาสไฮไลต์', () => {
    const found = highlightElement('[data-testid="target-a"]');
    expect(found).toBe(true);
    const el = document.querySelector('[data-testid="target-a"]');
    expect(el?.classList.contains(HIGHLIGHT_CLASS)).toBe(true);
    expect(el?.scrollIntoView).toHaveBeenCalled();
  });

  it('หา element ไม่เจอ → คืนค่า false ไม่มีผลข้างเคียงใดๆ', () => {
    const found = highlightElement('[data-testid="does-not-exist"]');
    expect(found).toBe(false);
  });

  it('ไฮไลต์ element ใหม่ ต้องล้างไฮไลต์ของ element เดิมก่อนเสมอ (มีไฮไลต์ค้างอยู่ได้แค่ 1 จุด)', () => {
    highlightElement('[data-testid="target-a"]');
    highlightElement('[data-testid="target-b"]');
    const a = document.querySelector('[data-testid="target-a"]');
    const b = document.querySelector('[data-testid="target-b"]');
    expect(a?.classList.contains(HIGHLIGHT_CLASS)).toBe(false);
    expect(b?.classList.contains(HIGHLIGHT_CLASS)).toBe(true);
  });
});

describe('clearHighlight', () => {
  it('ล้างคลาสไฮไลต์ออกจาก element ปัจจุบันได้ทันที', () => {
    highlightElement('[data-testid="target-a"]');
    clearHighlight();
    const el = document.querySelector('[data-testid="target-a"]');
    expect(el?.classList.contains(HIGHLIGHT_CLASS)).toBe(false);
  });

  it('เรียกซ้ำตอนไม่มีไฮไลต์ค้างอยู่เลย ไม่ throw', () => {
    expect(() => clearHighlight()).not.toThrow();
  });

  it('ไฮไลต์ล้างตัวเองอัตโนมัติหลังหมดเวลาที่กำหนด', () => {
    vi.useFakeTimers();
    highlightElement('[data-testid="target-a"]');
    const el = document.querySelector('[data-testid="target-a"]');
    expect(el?.classList.contains(HIGHLIGHT_CLASS)).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(el?.classList.contains(HIGHLIGHT_CLASS)).toBe(false);
  });
});
