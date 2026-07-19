import { round2 } from './bankReconcileLogic';
import type { BankTransaction, GLTransaction, MatchedPair, TransactionType } from '@/types/bankReconcile';
import type { MatchGroup } from '@/types/bankReconcileMatch';

/** ผลรวมจำนวนเงินของแถวที่ส่งเข้ามา ปัดเศษ 2 ตำแหน่งเสมอ (round2 ตัวเดียวกับที่ reconcileTransactions ใช้ —
 * ไม่สร้างฟังก์ชันปัดเศษซ้ำ) */
export function sumAmounts(rows: Array<{ amount: number }>): number {
  return round2(rows.reduce((total, row) => total + row.amount, 0));
}

/** เทียบจำนวนเงินสองค่าว่า "เท่ากันจริง" หรือไม่ โดยเทียบเป็นจำนวนสตางค์ (integer) แทนการเทียบ float ตรงๆ
 * ด้วย === — กันปัญหาแบบ 0.1 + 0.2 !== 0.3 แบบเบ็ดเสร็จ (round2 อย่างเดียวไม่พอ เพราะ 100.005 ปัดได้สอง
 * ทางที่ต่างกันเล็กน้อยในบางกรณี การเทียบที่ scale เป็นสตางค์แล้วปัดเป็น integer ก่อนเทียบเท่านั้นที่แม่นยำ
 * 100% สำหรับจำนวนเงิน) */
export function amountsEqual(a: number, b: number): boolean {
  return Math.round(round2(a) * 100) === Math.round(round2(b) * 100);
}

export interface ManualMatchSelection {
  bankRows: BankTransaction[];
  glRows: GLTransaction[];
}

export type ManualMatchReason = 'ok' | 'empty-bank' | 'empty-gl' | 'amount-mismatch' | 'type-mismatch';

export interface ManualMatchValidation {
  canConfirm: boolean;
  bankTotal: number;
  glTotal: number;
  /** bankTotal - glTotal ปัดเศษ 2 ตำแหน่งแล้ว — ใช้แสดงผลต่างสดๆ ใน toolbar ระหว่างที่ผู้ใช้ยังติ๊กไม่ครบ */
  difference: number;
  reason: ManualMatchReason;
}

/**
 * ตรวจสอบว่าแถว Bank + GL ที่ผู้ใช้ติ๊กเลือกไว้ "ยืนยันจับคู่" ได้หรือยัง — เงื่อนไขทั้งหมดต้องผ่านครบ:
 * 1. ต้องติ๊กอย่างน้อยฝั่งละ 1 แถว (ห้ามยืนยันกลุ่มที่ว่างฝั่งใดฝั่งหนึ่ง)
 * 2. ทุกแถวที่ติ๊กไว้ (ทั้งสองฝั่งรวมกัน) ต้องมีประเภท (รับ/จ่าย) เดียวกันหมด — กติกาเดียวกับที่
 *    reconcileTransactions ใช้ในการจับคู่อัตโนมัติ (รับจับคู่กับรับเท่านั้น จ่ายจับคู่กับจ่ายเท่านั้น) เพื่อ
 *    ไม่ให้จับคู่เงินเข้ากับเงินออกโดยไม่ตั้งใจ
 * 3. ผลรวมจำนวนเงินฝั่ง Bank ต้องเท่ากับผลรวมฝั่ง GL เป๊ะ (เทียบผ่าน amountsEqual กันปัญหา floating point)
 *
 * bankTotal/glTotal/difference คำนวณคืนกลับมาเสมอไม่ว่าจะผ่านเงื่อนไขหรือไม่ เพื่อให้ UI แสดงยอดรวมสดๆ ได้
 * ตลอดเวลาที่ผู้ใช้กำลังติ๊กเลือกอยู่ ไม่ใช่แค่ตอนที่ครบเงื่อนไขแล้วเท่านั้น
 */
export function validateManualMatch(selection: ManualMatchSelection): ManualMatchValidation {
  const { bankRows, glRows } = selection;
  const bankTotal = sumAmounts(bankRows);
  const glTotal = sumAmounts(glRows);
  const difference = round2(bankTotal - glTotal);

  if (bankRows.length === 0) {
    return { canConfirm: false, bankTotal, glTotal, difference, reason: 'empty-bank' };
  }
  if (glRows.length === 0) {
    return { canConfirm: false, bankTotal, glTotal, difference, reason: 'empty-gl' };
  }

  const types = new Set<TransactionType>([...bankRows.map((row) => row.type), ...glRows.map((row) => row.type)]);
  if (types.size > 1) {
    return { canConfirm: false, bankTotal, glTotal, difference, reason: 'type-mismatch' };
  }

  if (!amountsEqual(bankTotal, glTotal)) {
    return { canConfirm: false, bankTotal, glTotal, difference, reason: 'amount-mismatch' };
  }

  return { canConfirm: true, bankTotal, glTotal, difference, reason: 'ok' };
}

/** สร้าง MatchGroup แบบ 'manual' จากแถวที่ติ๊กเลือกไว้ — เรียกได้เฉพาะเมื่อ validateManualMatch(selection)
 * .canConfirm เป็น true เท่านั้น (ฟังก์ชันนี้ตรวจซ้ำเองอีกครั้งและ throw ถ้าไม่ผ่าน กันกรณี UI มีบั๊กเรียกผิด
 * จังหวะ ไม่ใช่แค่พึ่งพาว่าปุ่มถูก disable ไว้ถูกต้องเท่านั้น) */
export function createManualMatchGroup(selection: ManualMatchSelection): MatchGroup {
  const validation = validateManualMatch(selection);
  if (!validation.canConfirm) {
    throw new Error(`ไม่สามารถยืนยันจับคู่ได้ (เหตุผล: ${validation.reason})`);
  }
  return {
    groupId: crypto.randomUUID(),
    matchType: 'manual',
    type: selection.bankRows[0].type,
    bankRows: selection.bankRows,
    glRows: selection.glRows,
  };
}

/** ห่อผลลัพธ์จาก reconcileTransactions() (MatchedPair[] แบบ 1:1 เดิม ไม่แตะอัลกอริทึมเลย) ให้เป็น
 * MatchGroup[] แบบ 'auto' — 1 pair ต่อ 1 group เสมอ (bankRows/glRows ยาวเส้นละ 1) เพื่อให้
 * BankReconcileMatchedTable แสดงผลลัพธ์อัตโนมัติและผลลัพธ์จับคู่เองในตารางเดียวกันด้วยโครงสร้างเดียวกัน */
export function wrapAutoMatchesAsGroups(matched: MatchedPair[]): MatchGroup[] {
  return matched.map((pair) => ({
    groupId: crypto.randomUUID(),
    matchType: 'auto',
    type: pair.bank.type,
    bankRows: [pair.bank],
    glRows: [pair.gl],
  }));
}
