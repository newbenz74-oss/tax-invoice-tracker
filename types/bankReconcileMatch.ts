/**
 * ประเภทข้อมูลสำหรับฟีเจอร์ "จับคู่เอง + บันทึกประวัติการกระทบยอด" (เพิ่มเข้ามา 2026-07-19)
 *
 * ไฟล์นี้ต่อยอดจาก types/bankReconcile.ts โดยไม่แก้ไขไฟล์นั้นเลยแม้แต่บรรทัดเดียว — BankTransaction/
 * GLTransaction ยังคงเป็น "1 แถวจากไฟล์ที่ parse แล้ว" เหมือนเดิมทุกประการ, MatchedPair (ผลลัพธ์จาก
 * reconcileTransactions() ใน lib/bankReconcileLogic.ts) ยังคงเป็น 1:1 เท่านั้นเหมือนเดิม ไม่เปลี่ยนแปลง
 *
 * MatchGroup ด้านล่างคือ concept ใหม่ที่ห่อ (wrap) ทั้งผลลัพธ์อัตโนมัติ (1 pair ต่อ 1 group เสมอ) และ
 * ผลลัพธ์จากการติ๊กเลือกเอง (N bank แถว + M gl แถว ต่อ 1 group) ให้อยู่ในรูปแบบเดียวกัน เพื่อให้
 * BankReconcileMatchedTable แสดงผลได้ทั้งสองแบบโดยไม่ต้องแยก logic — ดู lib/bankReconcileManualMatch.ts
 * สำหรับฟังก์ชันที่สร้าง/แปลง MatchGroup เหล่านี้
 *
 * เมื่อผู้ใช้กด "บันทึก" (save) ทั้ง MatchGroup และแถว BankTransaction/GLTransaction ที่อยู่ในนั้น (รวมถึง
 * แถวที่ยังไม่จับคู่) จะถูกส่งไปเก็บจริงในตาราง Supabase 4 ตารางใหม่ (ดู supabase/migration_006_*.sql) —
 * ต่างจาก types/bankReconcile.ts เดิมที่ทุกอย่างอยู่ใน memory ชั่วคราวเท่านั้น ฟีเจอร์นี้คือจุดแรกที่ข้อมูล
 * ของโมดูล Bank Reconcile ถูกบันทึกลงฐานข้อมูลจริง
 */

import type { BankTransaction, GLTransaction, TransactionType } from './bankReconcile';

/** 'auto' = มาจาก reconcileTransactions() (อัลกอริทึมเดิม ไม่แตะต้อง) — group แบบนี้มี bankRows/glRows
 * ยาวเส้นละ 1 เสมอ ('N/A ยาวกว่า 1' ไม่มีทางเกิดจากอัลกอริทึมเดิม)
 * 'manual' = มาจากการติ๊กเลือกเองแล้วกด "ยืนยันจับคู่" — bankRows/glRows ยาวเท่าไหร่ก็ได้ (อย่างน้อยฝั่งละ
 * 1 แถวเสมอ) ตราบใดที่ผลรวมทั้งสองฝั่งเท่ากัน (ดู validateManualMatch) */
export type MatchType = 'auto' | 'manual';

/** สถานะของรายการประวัติที่บันทึกไว้ — ทั้งสองสถานะแก้ไข/เปิดดูซ้ำได้เสมอ ไม่มีสถานะใดที่ล็อกถาวร */
export type ReconcileReportStatus = 'draft' | 'complete';

/** 1 กลุ่มที่กระทบยอดสำเร็จ (แสดงใน "กระทบยอดสำเร็จ") ไม่ว่าจะมาจากอัตโนมัติหรือจับคู่เอง
 *
 * กติกาที่ทุก group ต้องเป็นจริงเสมอ (ดูการบังคับใช้ใน lib/bankReconcileManualMatch.ts):
 * - bankRows.length >= 1 และ glRows.length >= 1 เสมอ (ไม่มี group ที่ว่างฝั่งใดฝั่งหนึ่ง)
 * - ทุกแถวในกลุ่มเดียวกัน (ทั้งสองฝั่งรวมกัน) ต้องมี type เดียวกันเสมอ — เก็บค่านี้ซ้ำไว้ที่ระดับ group
 *   (ฟิลด์ `type` ด้านล่าง) เพื่อไม่ต้องมาคำนวณซ้ำทุกครั้งที่ต้องรู้ทิศทางของทั้ง group
 * - ผลรวม amount ของ bankRows ต้องเท่ากับผลรวม amount ของ glRows เสมอ (เทียบแบบ integer-cents ไม่ใช่ float)
 */
export interface MatchGroup {
  /** ฝั่ง client สร้างด้วย crypto.randomUUID() ตอนจับคู่ (ทั้ง auto และ manual) — หลังบันทึกแล้วโหลดซ้ำ
   * จาก getReportDetail() ค่านี้จะกลายเป็น uuid จริงจากฐานข้อมูล (bank_reconcile_match_groups.id) แทน
   * เพื่อให้ยังคงใช้เป็น React key / data-testid ได้เหมือนเดิมทั้งก่อนและหลังบันทึก */
  groupId: string;
  matchType: MatchType;
  type: TransactionType;
  bankRows: BankTransaction[];
  glRows: GLTransaction[];
}
