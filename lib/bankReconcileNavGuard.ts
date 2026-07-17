/**
 * กลไกแจ้งเตือน "มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก" ตอนพยายามออกจากหน้า Bank Reconcile ผ่านเมนู Sidebar —
 * เพิ่มเข้ามา 2026-07-16 สำหรับเฟส 4 ส่วน "5. UNSAVED CHANGES PROTECTION"
 *
 * ทำไมต้องมีไฟล์นี้แยกต่างหาก: app/dashboard/page.tsx (DashboardShell) เป็นจุดเดียวที่รู้ว่าผู้ใช้กำลังจะสลับ
 * เมนูใน Sidebar (คลิกเมนูอื่น) แต่ state "dirty" (มีการเปลี่ยนแปลงที่ยังไม่บันทึก) อยู่ลึกใน
 * components/BankReconcileResults.tsx ซึ่งไม่ได้ mount อยู่ตลอด (ถูก unmount ทันทีที่ activeId เปลี่ยนไปเมนู
 * อื่น ตามสถาปัตยกรรม client-state switch เดิมของทั้งแอปใน lib/navigation.ts) จึงส่ง React state/callback ตรงๆ
 * ข้ามสองไฟล์นี้ไม่ได้สะดวก ใช้ module-level flag ธรรมดาแทน (เขียนจาก BankReconcileResults ทุกครั้งที่ dirty
 * state เปลี่ยน อ่านจาก DashboardShell ตอนจะสลับเมนู) ผูกกับฟีเจอร์ Bank Reconcile เท่านั้นโดยเจตนา — เมนูอื่น
 * ทั้งหมดไม่เคยเรียก isBankReconcileDirty() เลย จึงทำงานเหมือนเดิมทุกประการ ไม่มีผลกระทบใดๆ ต่อเมนูอื่น
 * ตามข้อจำกัดส่วน "20. IMPORTANT RESTRICTIONS" ("do not modify Sidebar structure") — ไฟล์นี้และจุดที่แก้ไขใน
 * app/dashboard/page.tsx ไม่แตะ components/Sidebar.tsx เลยแม้แต่บรรทัดเดียว
 */

let dirty = false;

export function setBankReconcileDirty(value: boolean): void {
  dirty = value;
}

export function isBankReconcileDirty(): boolean {
  return dirty;
}

/** รีเซ็ตกลับเป็น false เสมอ — ใช้ตอน mount ของ BankReconcilePage (กันค่าเก่าจาก session ก่อนหน้าค้างข้าม
 * การนำทางเข้า-ออกเมนูนี้หลายรอบ) และเป็นประโยชน์สำหรับ unit test ที่ต้องการสถานะเริ่มต้นที่แน่นอน */
export function resetBankReconcileDirty(): void {
  dirty = false;
}
