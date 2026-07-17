import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_SAVE_DEBOUNCE_MS, createDebouncedSaver } from './bankReconcileAutoSave';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createDebouncedSaver', () => {
  it('เรียก save() หลังผ่านไป delayMs นับจากตอนที่เรียก schedule()', () => {
    const save = vi.fn();
    const saver = createDebouncedSaver(save, 1000);
    saver.schedule();
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(999);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('เรียก schedule() ซ้ำก่อนครบกำหนดเดิม = รีเซ็ตนับใหม่ (พฤติกรรม debounce มาตรฐาน)', () => {
    const save = vi.fn();
    const saver = createDebouncedSaver(save, 1000);
    saver.schedule();
    vi.advanceTimersByTime(700);
    saver.schedule(); // รีเซ็ตนับใหม่จากจุดนี้
    vi.advanceTimersByTime(700);
    expect(save).not.toHaveBeenCalled(); // รวมเวลาที่ผ่านมา 1400ms แต่ยังไม่ครบ 1000ms หลัง schedule() ครั้งหลังสุด
    vi.advanceTimersByTime(300);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('เรียก schedule() ถี่ๆ หลายครั้งติดกัน (เช่น พิมพ์หมายเหตุ) ทำให้ save() ถูกเรียกแค่ครั้งเดียว', () => {
    const save = vi.fn();
    const saver = createDebouncedSaver(save, 1000);
    for (let i = 0; i < 10; i++) {
      saver.schedule();
      vi.advanceTimersByTime(100);
    }
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('cancel() ยกเลิกกำหนดการที่รอไว้โดยไม่เรียก save() เลย', () => {
    const save = vi.fn();
    const saver = createDebouncedSaver(save, 1000);
    saver.schedule();
    vi.advanceTimersByTime(500);
    saver.cancel();
    vi.advanceTimersByTime(1000);
    expect(save).not.toHaveBeenCalled();
  });

  it('cancel() ที่ไม่มีกำหนดการรออยู่เลยไม่ throw (ปลอดภัยเรียกซ้ำได้)', () => {
    const save = vi.fn();
    const saver = createDebouncedSaver(save, 1000);
    expect(() => saver.cancel()).not.toThrow();
  });

  it('schedule() ใหม่หลัง save() ถูกเรียกไปแล้วหนึ่งรอบ ยังคงทำงานต่อได้ปกติ (ไม่ใช่ one-shot)', () => {
    const save = vi.fn();
    const saver = createDebouncedSaver(save, 1000);
    saver.schedule();
    vi.advanceTimersByTime(1000);
    expect(save).toHaveBeenCalledTimes(1);
    saver.schedule();
    vi.advanceTimersByTime(1000);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('ค่า debounce เริ่มต้น (AUTO_SAVE_DEBOUNCE_MS) อยู่ในช่วง 800-1500ms ตามสเปก และถูกใช้เมื่อไม่ระบุ delayMs เอง', () => {
    expect(AUTO_SAVE_DEBOUNCE_MS).toBeGreaterThanOrEqual(800);
    expect(AUTO_SAVE_DEBOUNCE_MS).toBeLessThanOrEqual(1500);

    const save = vi.fn();
    const saver = createDebouncedSaver(save);
    saver.schedule();
    vi.advanceTimersByTime(AUTO_SAVE_DEBOUNCE_MS - 1);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
