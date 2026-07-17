/**
 * ตัวช่วย debounce การบันทึกอัตโนมัติ — เพิ่มเข้ามา 2026-07-16 สำหรับเฟส 4 ส่วน "4. AUTO SAVE"
 *
 * แยกเป็น pure function/closure ล้วนๆ ไม่ผูกกับ React hook โดยตรง (ทดสอบด้วย vi.useFakeTimers() ได้ตรงๆ ไม่
 * ต้อง render component) — components/BankReconcileResults.tsx เรียกใช้ผ่าน useRef เก็บ instance เดียวตลอด
 * อายุของ component แล้วเรียก .schedule() ทุกครั้งที่ state ที่ต้อง auto-save เปลี่ยน (ยืนยัน/ยกเลิกจับคู่,
 * เพิ่ม/แก้หมายเหตุ, ทำเครื่องหมายตรวจสอบ, เปลี่ยนค่าคลาดเคลื่อน, เปลี่ยนสถานะ session) และ .cancel() ตอน
 * unmount (กัน callback ยิงหลัง component ถูกถอดออกไปแล้ว)
 */

export interface DebouncedSaver {
  /** เลื่อนกำหนดเวลาบันทึกออกไปอีก delayMs จากตอนนี้ (เรียกซ้ำก่อนครบกำหนดเดิม = รีเซ็ตนับใหม่ตาม
   * พฤติกรรม debounce มาตรฐาน) */
  schedule(): void;
  /** ยกเลิกกำหนดการที่รอไว้ (ถ้ามี) โดยไม่เรียก callback เลย */
  cancel(): void;
}

/** ค่า debounce เริ่มต้น — อยู่ในช่วง 800-1500ms ตามสเปกตรงๆ ("Debounce save calls (e.g., 800–1500ms)") เลือก
 * ค่ากึ่งกลางช่วงเพื่อสมดุลระหว่างความไวในการเห็นสถานะ "บันทึกแล้ว" กับการไม่ยิง request ถี่เกินไปตอนแก้ไข
 * ต่อเนื่องหลายจุดติดกัน (เช่น พิมพ์หมายเหตุ) */
export const AUTO_SAVE_DEBOUNCE_MS = 1200;

export function createDebouncedSaver(save: () => void, delayMs: number = AUTO_SAVE_DEBOUNCE_MS): DebouncedSaver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule() {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        save();
      }, delayMs);
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
