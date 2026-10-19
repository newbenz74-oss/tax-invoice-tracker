/**
 * "จับคู่อัตโนมัติ (รอยืนยัน)" — เดาคู่ผสมหลายรายการที่ "น่าจะถูก" แล้วค้างไว้ให้ผู้ใช้กดยอมรับเอง
 * (เพิ่มเข้ามา 2026-10-10 ตามคำขอผู้ใช้)
 *
 * โจทย์จากผู้ใช้ตรงๆ: "ยอด Bank Statement คือ 1500 ระบบจะจับคู่ให้อัตโนมัติ ยอด GL 1000 กับ 500 หรือ
 * ตัวเลขอะไรก็ได้ เพื่อให้ได้ครบ 1500 แต่ระบบจะไม่จับคู่แบบนี้ เช่น 1450 กับ 50 ระบบจะไม่นำตัวเลขที่ต่ำกว่า
 * 100 มาจับคู่อัตโนมัติ และระบบจะค้างการจับคู่แบบนี้ให้ฉันกดยอมรับว่าถูกต้อง เพื่อที่เมื่อกดยอมรับจะเด้งไปที่
 * กระทบยอดสำเร็จ"
 *
 * กติกาที่ตกลงกันไว้ (ยืนยันกับผู้ใช้แล้ว):
 * 1. ทำงาน "ต่อจาก" การจับคู่ 1:1 เป๊ะเดิม (reconcileTransactions) โดยดูเฉพาะแถวที่เหลือค้างไม่สำเร็จเท่านั้น
 * 2. ได้ทั้งสองทิศทาง — Bank 1 แถว = GL หลายแถว และ GL 1 แถว = Bank หลายแถว
 * 3. ไม่จำกัดจำนวนแถวที่นำมารวมกัน (ไม่มี N สูงสุดคงที่) — แต่มี "งบประมาณการค้นหา" กันหน้าค้าง ดูด้านล่าง
 * 4. ทุกแถวที่นำมารวมกันต้องอยู่ในช่วงวันที่ที่ผู้ใช้เลือกไว้ (±1 หรือ ±3 วัน) เทียบกับ "แถวเดี่ยว" ฝั่งตรงข้าม
 * 5. ทุกแถวในคู่เดียวกันต้องเป็นประเภทเดียวกัน (รับกับรับ / จ่ายกับจ่าย) เหมือนกติกาเดิมทั้งระบบ
 * 6. แถวที่จำนวนเงิน "ต่ำกว่า 100" ห้ามเป็นสมาชิกของคู่ผสม — ข้อนี้คือตัวที่ปฏิเสธ 1450 + 50 = 1500
 * 7. ผลรวมต้องเท่ากันเป๊ะ ไม่มี tolerance ของจำนวนเงินเลย (เทียบเป็นจำนวนสตางค์ integer เหมือน amountsEqual)
 * 8. 1 แถว อยู่ได้ในข้อเสนอเดียวเท่านั้น — ถ้าชนกันตัดสินด้วยกติกาที่แน่นอน (ดู resolveConflicts ด้านล่าง)
 * 9. ไม่ลงมือจับคู่ให้เอง! ข้อเสนอทั้งหมดไปค้างอยู่ในหมวดที่ 4 ของหน้าจอ รอผู้ใช้กด "ยอมรับ" ทีละรายการ
 *    (แถวที่ถูกเสนอยังอยู่ในตาราง "ไม่สำเร็จ" ตามปกติทุกแถว ไม่ได้ถูกดึงออกไปไหนก่อนผู้ใช้ยอมรับ — ดังนั้น
 *    การกด "ไม่ใช่" (dismiss) ไม่ต้องคืนแถวกลับที่ไหนเลย แค่เลิกเสนอข้อเสนอนั้น)
 *
 * ### ข้อจำกัดที่ต้องยอมรับอย่างตรงไปตรงมา
 *
 * การหา "ชุดย่อยที่ผลรวมเท่ากับค่าเป้าหมาย" (subset-sum) เป็นปัญหา NP-complete — เวลาที่ใช้โตแบบ
 * exponential ตามจำนวนผู้สมัคร และโค้ดนี้รันแบบ synchronous บน main thread ของ browser (เรียกจาก
 * BankReconcileWorkspace.tsx ใน setTimeout(…, 0) เหมือน reconcileTransactions) ไม่มี Web Worker
 * ดังนั้น "หาครบทุกคู่ที่มีอยู่จริงเสมอ" เป็นไปไม่ได้ในทางปฏิบัติ สิ่งที่ทำจริงคือ:
 *
 * - ค้นแบบ iterative deepening: ลองรวม 2 แถวก่อน ไม่เจอค่อยลอง 3 แถว แล้ว 4 แถว ไปเรื่อยๆ ไม่มีเพดาน
 *   คงที่ — ได้ผลพลอยได้ที่ตรงกับความต้องการพอดี คือ "เจอแบบที่ใช้แถวน้อยที่สุดก่อนเสมอ" ซึ่งเป็นคู่ที่
 *   มนุษย์อ่านแล้วเชื่อถือง่ายที่สุด (รวม 2 แถวน่าเชื่อกว่ารวม 9 แถวที่พอดีกันโดยบังเอิญ)
 * - ตัดกิ่งแรงๆ: เรียงผู้สมัครจากมากไปน้อย, ทิ้งกิ่งทันทีที่ผลรวมวิ่งเลย target, และทิ้งกิ่งเมื่อ "ตัวที่
 *   เหลือข้างหน้ารวมกันมากที่สุดก็ยังไม่ถึง target" หรือ "ตัวที่เล็กที่สุดเท่าที่มีรวมกันก็ยังเกิน target"
 * - มี "งบประมาณจำนวนก้าว" (step budget) ทั้งระดับทั้งการคำนวณ และระดับรายแถว — แถวไหนที่ค้นแล้วงบหมด
 *   ก่อนจะได้คำตอบ จะ "ข้าม" แถวนั้นไปเลย ไม่แฮงค์รอ แล้วรายงานกลับทาง budgetExhausted/skippedAnchorCount
 *   ให้ UI เอาไปบอกผู้ใช้ได้ว่าอาจยังมีคู่ผสมที่ระบบยังหาไม่เจอ (เราเลือก "ตอบไม่ครบแต่หน้าไม่ค้าง" แทน
 *   "ตอบครบแต่หน้าค้างเป็นนาที" อย่างตั้งใจ)
 *
 * ค่างบประมาณที่ตั้งไว้ด้านล่างได้มาจากการ "วัดจริง" ไม่ใช่เดา — ดูคอมเมนต์ที่ค่าคงที่แต่ละตัวประกอบ
 *
 * เกร็ดที่น่าสังเกต: กติกา "ห้ามใช้แถวที่ต่ำกว่า 100" ของผู้ใช้ ช่วยเรื่อง performance ไปด้วยโดยไม่ได้ตั้งใจ
 * เพราะมันทำให้จำนวนแถวที่รวมกันได้มากที่สุดถูกจำกัดอยู่ที่ target/100 เสมอ (ยอด 1,500 รวมได้ไม่เกิน 15 แถว)
 * — ถ้าไม่มีกติกานี้ ความลึกของการค้นจะไม่มีขอบเขตบนเลยนอกจากงบประมาณ
 */

import { daysBetweenISO, round2 } from './bankReconcileLogic';
import { amountsEqual, createManualMatchGroup, sumAmounts } from './bankReconcileManualMatch';
import type { BankTransaction, DateTolerance, GLTransaction, TransactionType } from '@/types/bankReconcile';
import type { MatchGroup } from '@/types/bankReconcileMatch';

/** จำนวนเงินต่ำสุดที่แถวหนึ่งจะถูก "นำมารวม" เป็นสมาชิกของคู่ผสมได้ (บาท) — ค่าที่ผู้ใช้ระบุมาตรงๆ
 * ("ระบบจะไม่นำตัวเลขที่ต่ำกว่า 100 มาจับคู่อัตโนมัติ") ใช้แบบ ">= 100" ดังนั้น 100.00 พอดียังใช้ได้
 *
 * กติกานี้บังคับกับ "สมาชิก" ของคู่ผสมเท่านั้น ไม่ได้บังคับกับ "แถวเดี่ยว" ฝั่งตรงข้าม (anchor) เพราะแถวเดี่ยว
 * คือรายการจริงที่มีอยู่ในไฟล์ ไม่ใช่ตัวเลขที่ระบบเลือกมารวม — แต่ในทางปฏิบัติแถวเดี่ยวที่ต่ำกว่า 200 ก็ไม่มี
 * ทางเกิดคู่ผสมได้อยู่แล้ว (ต้องมีสมาชิกอย่างน้อย 2 แถว แถวละ >= 100) โค้ดจึงข้ามแถวเดี่ยวพวกนั้นไปตั้งแต่ต้น */
export const MIN_COMBINATION_MEMBER_AMOUNT = 100;

/**
 * งบประมาณรวมทั้งการคำนวณ 1 ครั้ง (นับเป็น "ก้าว" = 1 รอบลูปของการลองหยิบผู้สมัคร 1 ตัวในการค้นหา)
 *
 * ### ตัวเลขที่วัดได้จริง (ไม่ได้เดา)
 *
 * วัดด้วยเคสสังเคราะห์ที่โหดที่สุดเท่าที่สร้างได้ — ข้างละ 300 แถวที่ยังไม่สำเร็จ, วันที่อยู่ในช่วง ±3 วัน
 * กันหมด (ทุกแถวเป็นผู้สมัครของทุกแถว), ยอดซ้ำกันเยอะ, และยอดฝั่งแถวเดี่ยวมีเศษสตางค์ที่ทำให้ "ไม่มีคำตอบ
 * อยู่จริงเลย" (เคสที่แพงที่สุด เพราะต้องค้นจนครบทุกความลึกจึงจะรู้ว่าไม่มี):
 *
 * - ความเร็วที่วัดได้: 110–298 ล้านก้าว/วินาที (ลูป DFS ชั้นในทำงานบน integer ล้วนๆ ไม่ allocate อะไรต่อก้าว)
 * - ถ้า "ไม่ใส่งบเลย": เคสเดียวกันกินไปจนครบ 1,000 ล้านก้าวที่ตั้งเพดานไว้ตอนวัด = 3.4–4.6 วินาที และยัง
 *   ไม่จบจริง → หน้าค้างจนดูเหมือนโปรแกรมแฮงค์ (นี่คือเหตุผลที่ต้องมีงบประมาณ ไม่ใช่กลัวไว้ก่อนลอยๆ)
 * - ด้วยงบที่ตั้งไว้จริงด้านล่าง (8,000,000 ก้าว) เคส 300×300 ทั้ง 4 แบบที่ลอง ใช้เวลา 2.9–58.5 ms
 *   (ใช้ไป 0–6.4 ล้านก้าว) และเคสที่ใหญ่ขึ้นเป็น 600×600 ใช้ 45.2 ms
 * - ลองยืดงบเป็น 20,000,000 ก้าวแล้ววัดซ้ำ: ใช้เวลา 41 ms และ "หาคู่เจอเท่าเดิมเป๊ะ" ในทุกเคสที่ลอง
 *
 * เลือก 8,000,000 เพราะอยู่ในระดับ "กดแล้วติดทันที" (เกณฑ์ที่ใช้: ไม่เกิน ~200 ms บนเครื่องที่วัด และหน้านี้
 * มี loading state "กำลังตรวจสอบ..." รออยู่แล้ว) โดยเผื่อไว้ว่าเครื่องผู้ใช้จริงอาจช้ากว่าเครื่องที่วัด 3-5 เท่า
 * (โน้ตบุ๊กออฟฟิศ/เปิดแท็บเยอะ) ซึ่งกรณีนั้นจะอยู่ราว 0.2-0.3 วินาที — ยังไม่ถึงจุดที่รู้สึกว่าแฮงค์
 *
 * ลองแล้วไม่เอา: 20,000,000 ก้าว — ถอดออกเพราะวัดแล้ว "ไม่ได้อะไรเพิ่มเลย" (จำนวนคู่ที่เจอเท่าเดิม) แต่เพิ่ม
 * เพดานเวลาที่แย่ที่สุดขึ้นอีก 2.5 เท่าบนเครื่องที่ช้า — จ่ายแพงขึ้นโดยไม่ได้ของ
 */
export const DEFAULT_COMBINATION_STEP_BUDGET = 8_000_000;

/**
 * งบประมาณต่อ "แถวเดี่ยว" 1 แถว เมื่อหารงบรวมให้ทุกแถวเท่าๆ กันแล้วได้น้อยกว่าค่านี้ — กันไม่ให้แถวที่หา
 * ไม่เจออยู่แถวเดียวกินงบรวมไปหมดจนแถวที่เหลือทั้งไฟล์ไม่เหลือโอกาสค้นเลย
 *
 * เคสที่ทำให้ต้องมีค่านี้: แถวที่ยอดเป็นเลขแปลกๆ (เช่น 48,317.52) ซึ่งไม่มีคู่ผสมอยู่จริงเลย — การค้นจะไล่
 * ความลึกขึ้นไปเรื่อยๆ จนหมดงบ ถ้าไม่มีเพดานรายแถว แถวแบบนี้แถวแรกของไฟล์จะกินงบทั้งก้อนไปคนเดียว แล้วแถว
 * ที่เหลือจะถูกข้ามหมด (ผลลัพธ์ไม่สม่ำเสมอและอธิบายผู้ใช้ไม่ได้)
 *
 * 25,000 ก้าวครอบคลุมการค้น "รวม 2 แถว" ของกลุ่มผู้สมัครขนาดกลาง (C(200,2) = 19,900) ได้ครบ และครอบคลุม
 * การค้น 3-4 แถวที่ตัดกิ่งได้ดีอย่างสบาย — กลุ่มผู้สมัคร 300 ตัวเต็ม (C(300,2) = 44,850) จะค้นแบบ 2 แถว
 * ไม่ครบถ้าตกมาถึงเพดานนี้ ซึ่งยอมรับได้เพราะนั่นคือเคสที่ไฟล์ใหญ่มากและผู้ใช้ก็ได้รับแจ้งว่าค้นไม่ครบ
 */
export const MIN_COMBINATION_ANCHOR_STEP_BUDGET = 25_000;

/** 1 ข้อเสนอคู่ผสมที่รอผู้ใช้ยอมรับ — โครงสร้างตั้งใจให้ "แปลงเป็น MatchGroup ได้ตรงๆ" เมื่อผู้ใช้กดยอมรับ
 * (bankRows/glRows ชื่อและความหมายเดียวกับใน MatchGroup เป๊ะ) ฝั่งที่เป็นแถวเดี่ยวจะมีสมาชิก 1 แถว อีกฝั่ง
 * มี 2 แถวขึ้นไปเสมอ */
export interface CombinationSuggestion {
  /** id แบบ deterministic สร้างจากฝั่ง+id ของแถวที่เกี่ยวข้องทั้งหมด (ไม่ใช่ crypto.randomUUID()) — ตั้งใจ
   * ทำแบบนี้เพราะผลลัพธ์ของฟังก์ชันนี้ต้อง "เหมือนกันทุกครั้งที่ input เหมือนกัน" ตามที่ตกลงไว้ ถ้าใช้ uuid
   * สุ่ม ผลลัพธ์จะเทียบกันตรงๆ ในเทสต์ไม่ได้ และ React key จะเปลี่ยนทุกครั้งที่คำนวณใหม่โดยไม่จำเป็น
   * (ตอนผู้ใช้กดยอมรับแล้ว groupId ของ MatchGroup ที่ได้ยังเป็น crypto.randomUUID() ตามเดิมทั้งระบบ) */
  suggestionId: string;
  type: TransactionType;
  /** ฝั่งที่เป็น "แถวเดี่ยว" — 'bank' = Bank 1 แถว ต่อ GL หลายแถว, 'gl' = GL 1 แถว ต่อ Bank หลายแถว */
  anchorSide: 'bank' | 'gl';
  bankRows: BankTransaction[];
  glRows: GLTransaction[];
  /** ยอดรวม (เท่ากันทั้งสองฝั่งเสมอตามกติกาข้อ 7) ปัดเศษ 2 ตำแหน่งแล้ว */
  amount: number;
  /** ระยะวันที่ที่ห่างที่สุดระหว่างสมาชิกกับแถวเดี่ยว (หน่วยวัน) — ใช้ทั้งเป็นตัวตัดสินตอนข้อเสนอชนกัน และ
   * แสดงใน UI ให้ผู้ใช้ประเมินเองได้ว่าคู่นี้วันที่เบี้ยวกันแค่ไหน (0 = วันเดียวกันหมด) */
  dateSpread: number;
}

export interface CombinationSuggestionResult {
  suggestions: CombinationSuggestion[];
  /** true = มีแถวที่ค้นไม่จบเพราะงบประมาณหมดก่อน → ผลลัพธ์ "ไม่ครบเท่าที่เป็นไปได้จริง" UI ควรบอกผู้ใช้ */
  budgetExhausted: boolean;
  /** จำนวนแถวเดี่ยวที่ถูกข้ามไปเพราะงบหมด (นับเฉพาะแถวที่มีโอกาสเกิดคู่ผสมได้จริงเท่านั้น) */
  skippedAnchorCount: number;
  /** จำนวนก้าวที่ใช้ไปจริง — ไว้ตรวจสอบ/จูนงบประมาณในเทสต์ ไม่ได้ใช้แสดงใน UI */
  stepsUsed: number;
}

export interface FindCombinationOptions {
  stepBudget?: number;
  anchorStepBudget?: number;
  /** เปลี่ยนเพดานขั้นต่ำของสมาชิกได้ (หน่วยบาท) — มีไว้ให้เทสต์พิสูจน์ว่ากติกานี้เป็นตัวตัดสินจริง ไม่ใช่
   * ให้ UI เอาไปทำเป็นตัวเลือกให้ผู้ใช้ปรับ (ผู้ใช้ระบุ 100 มาเป็นค่าตายตัว) */
  minMemberAmount?: number;
  /**
   * suggestionId ของข้อเสนอที่ผู้ใช้กด "ไม่ใช่" ไปแล้ว — ข้ามตั้งแต่ **ขั้นตอนตัดสินการชนกัน** ไม่ใช่กรองทิ้ง
   * ตอนท้าย (2026-10-19)
   *
   * ความต่างนี้สำคัญมาก: ข้อเสนอที่ถูกข้ามจะ "ไม่จองแถว" ของมันไว้ แถวเหล่านั้นจึงว่างให้ข้อเสนอรองลงมาใช้ได้
   * ถ้าแค่กรองทิ้งตอนท้าย แถวจะยังถูกจองค้างอยู่ ข้อเสนอรองลงมาก็ยังตายอยู่ดี และผู้ใช้จะกด "ไม่ใช่" แล้ว
   * ไม่มีอะไรเกิดขึ้นเลย
   *
   * เคสจริงที่ผู้ใช้แจ้ง 2026-10-19: Bank 125,786.25 ตรงกับ GL 16 แถวรวมกันพอดี (มี 3,880 ซ้ำกัน 11 แถว)
   * แต่ถูกข้อเสนอ 2 แถวของยอดอื่น (เช่น 7,760 = 3,880 × 2) แย่งแถวไปแค่ 2 แถว ทำให้ชุด 16 แถวขาดและหายทั้งใบ
   */
  rejectedSuggestionIds?: ReadonlySet<string>;
}

/** แปลงจำนวนเงินเป็นจำนวนสตางค์ integer — สูตรเดียวกับที่ amountsEqual ใช้เป๊ะ (ดูเหตุผลที่ต้องเทียบเป็น
 * สตางค์แทน float ที่คอมเมนต์ของ amountsEqual ใน bankReconcileManualMatch.ts) การค้นหาทั้งหมดในไฟล์นี้
 * ทำบน integer ล้วนๆ ไม่มีการบวก float สะสมเลย จึงไม่มีทางคลาดเคลื่อนแม้รวมกันหลายสิบแถว */
function toCents(amount: number): number {
  return Math.round(round2(amount) * 100);
}

/** วันที่อ้างอิงสำหรับแปลงวันที่ ISO เป็น "เลขวัน" ตัวเดียว — ใช้ daysBetweenISO ตัวเดิมจาก
 * bankReconcileLogic.ts (ซึ่งคืนค่า absolute) เทียบกับ 1970-01-01 ทุกวันที่ในระบบนี้อยู่หลังปี 1970 เสมอ
 * (มาจากไฟล์ Bank Statement/GL ของกิจการจริง) จึงไม่มีปัญหาเรื่องเครื่องหมาย
 *
 * ทำไมต้องแปลงล่วงหน้า: การคัดผู้สมัครเป็น O(จำนวนแถวเดี่ยว × จำนวนแถวฝั่งตรงข้าม) = 300×300 = 90,000 คู่
 * ถ้าเรียก daysBetweenISO (ซึ่ง split สตริง + Date.UTC) ทุกคู่ จะกลายเป็นค่าใช้จ่ายคงที่ที่ "แพงกว่าตัวการ
 * ค้นหาเอง" — วัดได้ 72.5 ms สำหรับเคส 300×300 ที่ยอดซ้ำกันหมด ทั้งที่การค้นหาจริงใช้ 0 ก้าว (พบจากการวัด
 * ตอนจูนงบประมาณ ไม่ได้คาดไว้ก่อน) แปลงเป็นเลขวันล่วงหน้าแถวละครั้งแล้วเทียบด้วยการลบ integer: เหลือ 2.9 ms */
const DAY_NUMBER_REFERENCE_ISO = '1970-01-01';

function toDayNumbers(rows: SideRow[]): number[] {
  // cache ต่อการเรียก 1 ครั้ง — ข้อมูล 1 เดือนมีวันที่ไม่ซ้ำกันแค่ ~30 ค่า การแปลงจริงจึงเกิดไม่เกิน ~30 ครั้ง
  const cache = new Map<string, number>();
  return rows.map((row) => {
    const hit = cache.get(row.date);
    if (hit !== undefined) return hit;
    const value = daysBetweenISO(DAY_NUMBER_REFERENCE_ISO, row.date);
    cache.set(row.date, value);
    return value;
  });
}

/** รูปร่างแถวขั้นต่ำที่การค้นหาต้องใช้ — ทั้ง BankTransaction และ GLTransaction เข้าเงื่อนไขนี้อยู่แล้ว */
interface SideRow {
  id: string;
  date: string;
  type: TransactionType;
  amount: number;
}

/** ผลการค้นหาดิบ 1 รายการ ก่อนตัดสินเรื่องการชนกันของข้อเสนอ */
interface RawSuggestion {
  anchorSide: 'bank' | 'gl';
  /** ตำแหน่งแถวเดี่ยวใน array ฝั่งตัวเอง (ลำดับเดิมในไฟล์) */
  anchorIndex: number;
  /** ตำแหน่งสมาชิกใน array ฝั่งตรงข้าม เรียงตามลำดับเดิมในไฟล์ */
  memberIndexes: number[];
  type: TransactionType;
  dateSpread: number;
  /** ลำดับรวมข้ามฝั่ง (Bank มาก่อน GL) — ตัวตัดสินสุดท้ายตอนข้อเสนอชนกัน ให้ผลคงที่เสมอ */
  anchorOrder: number;
}

interface SearchState {
  steps: number;
  stepBudget: number;
  anchorStepBudget: number;
  budgetExhausted: boolean;
  skippedAnchorCount: number;
}

/**
 * ค้นหาคู่ผสมของ "แถวเดี่ยว 1 แถว" (anchor) กับสมาชิกหลายแถวฝั่งตรงข้าม — คืนตำแหน่งสมาชิกใน members
 * (ยังไม่เรียง) หรือ null ถ้าไม่เจอ/งบหมด
 *
 * ขั้นตอน:
 * 1. คัดผู้สมัครก่อน: ประเภทเดียวกัน, จำนวนเงิน >= เพดานขั้นต่ำ, จำนวนเงินไม่เกิน target - เพดานขั้นต่ำ
 *    (เพราะต้องเหลือที่ให้สมาชิกอีกอย่างน้อย 1 แถวที่ >= เพดานขั้นต่ำ), วันที่อยู่ในช่วง ±toleranceDays
 * 2. เรียงผู้สมัครจากมากไปน้อย (เสมอกันเรียงตามลำดับเดิมในไฟล์) แล้วทำ prefix sum ไว้ตัดกิ่ง
 * 3. ไล่ความลึก 2, 3, 4, … ขึ้นไปเรื่อยๆ แต่ละความลึกทำ DFS หาชุดที่ผลรวมเท่ากับ target เป๊ะ
 */
function findForAnchor(
  anchor: SideRow,
  anchorDay: number,
  members: SideRow[],
  memberCents: number[],
  memberDays: number[],
  toleranceDays: number,
  minMemberCents: number,
  state: SearchState
): number[] | null {
  const target = toCents(anchor.amount);
  // ต้องมีสมาชิกอย่างน้อย 2 แถว แถวละ >= เพดานขั้นต่ำ — แถวเดี่ยวที่ยอดน้อยกว่านั้นไม่มีทางเกิดคู่ผสมได้
  if (target < minMemberCents * 2) return null;

  const candidateIdx: number[] = [];
  for (let i = 0; i < members.length; i++) {
    const row = members[i];
    if (row.type !== anchor.type) continue;
    const cents = memberCents[i];
    if (cents < minMemberCents) continue;
    if (cents > target - minMemberCents) continue;
    if (Math.abs(memberDays[i] - anchorDay) > toleranceDays) continue;
    candidateIdx.push(i);
  }
  if (candidateIdx.length < 2) return null;

  // เรียงมากไปน้อย เสมอกันใช้ลำดับเดิมในไฟล์ (candidateIdx ถูก push มาตามลำดับไฟล์อยู่แล้ว จึงเทียบ a-b ได้ตรงๆ)
  candidateIdx.sort((a, b) => memberCents[b] - memberCents[a] || a - b);
  const n = candidateIdx.length;
  const cents = candidateIdx.map((idx) => memberCents[idx]);

  // prefix sum: pre[i] = ผลรวมของ cents[0..i-1] — ใช้คำนวณ "ผลรวมมากที่สุด/น้อยที่สุดที่ยังเป็นไปได้" ในเวลา O(1)
  const pre = new Array<number>(n + 1);
  pre[0] = 0;
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + cents[i];

  const anchorLimit = state.steps + state.anchorStepBudget;
  let aborted = false;
  const picked: number[] = [];

  function dfs(start: number, remaining: number, sum: number): boolean {
    const limit = n - remaining; // ต้องเหลือตัวให้หยิบครบ remaining ตัว
    for (let j = start; j <= limit; j++) {
      if (state.steps >= anchorLimit || state.steps >= state.stepBudget) {
        aborted = true;
        return false;
      }
      state.steps++;
      const next = sum + cents[j];

      if (remaining === 1) {
        if (next === target) {
          picked.push(j);
          return true;
        }
        // เรียงมากไปน้อย: ถ้าตัวนี้ยังรวมไม่ถึง target ตัวถัดๆ ไปที่เล็กกว่ายิ่งไม่ถึง → เลิกทั้งชั้นนี้
        if (next < target) return false;
        continue; // next > target → ตัวถัดไปเล็กกว่า อาจพอดี ลองต่อ
      }

      // ตัดกิ่งที่ 1: หยิบตัวใหญ่ที่สุดเท่าที่เหลือข้างหน้ามาให้ครบ remaining-1 ตัวแล้วยังไม่ถึง target →
      // j ถัดๆ ไปเล็กกว่าเดิมยิ่งไม่ถึง เลิกทั้งชั้นนี้ได้เลย
      const bestRest = pre[j + remaining] - pre[j + 1];
      if (next + bestRest < target) return false;

      // ตัดกิ่งที่ 2: หยิบตัวเล็กที่สุดเท่าที่มี (ท้าย array ซึ่งอยู่หลัง j เสมอเพราะ j <= n - remaining) มาให้
      // ครบ remaining-1 ตัวแล้วยังเกิน target → กิ่งนี้ไปไม่รอด แต่ j ถัดไปเล็กกว่า จึงข้ามแค่ j นี้
      const leastRest = pre[n] - pre[n - (remaining - 1)];
      if (next + leastRest > target) continue;

      picked.push(j);
      if (dfs(j + 1, remaining - 1, next)) return true;
      picked.pop();
      if (aborted) return false;
    }
    return false;
  }

  // iterative deepening — ลองน้อยแถวก่อนเสมอ (คู่ที่ใช้แถวน้อยที่สุดคือคู่ที่น่าเชื่อถือที่สุดสำหรับคนอ่าน)
  for (let depth = 2; depth <= n; depth++) {
    // ผลรวมของตัวที่เล็กที่สุด depth ตัวยังเกิน target → depth ที่มากกว่านี้ยิ่งเกิน เลิกไล่ความลึกทั้งหมด
    if (pre[n] - pre[n - depth] > target) break;
    // ผลรวมของตัวที่ใหญ่ที่สุด depth ตัวยังไม่ถึง target → ความลึกนี้เป็นไปไม่ได้ แต่ลึกกว่านี้อาจถึง
    if (pre[depth] < target) continue;

    picked.length = 0;
    if (dfs(0, depth, 0)) {
      return picked.map((j) => candidateIdx[j]);
    }
    if (aborted) {
      state.budgetExhausted = true;
      state.skippedAnchorCount++;
      return null;
    }
  }
  return null;
}

/** ค้นหาจากฝั่ง anchors ทั้งฝั่ง (เรียกซ้ำ 2 ครั้ง — ครั้งแรก Bank เป็นแถวเดี่ยว ครั้งที่สอง GL เป็นแถวเดี่ยว) */
function searchAnchorSide(
  anchors: SideRow[],
  anchorDays: number[],
  members: SideRow[],
  memberCents: number[],
  memberDays: number[],
  anchorSide: 'bank' | 'gl',
  anchorOrderOffset: number,
  toleranceDays: number,
  minMemberCents: number,
  state: SearchState,
  out: RawSuggestion[]
): void {
  for (let a = 0; a < anchors.length; a++) {
    const anchor = anchors[a];
    const anchorDay = anchorDays[a];
    const target = toCents(anchor.amount);
    const couldHaveCombination = target >= minMemberCents * 2;

    if (state.steps >= state.stepBudget) {
      // งบรวมหมดแล้ว — ไม่ค้นต่อ แต่รายงานให้ตรงว่า "ข้ามแถวที่มีโอกาสเจอจริงไปกี่แถว" (แถวที่ยอดน้อยกว่า
      // 2 เท่าของเพดานขั้นต่ำไม่นับ เพราะยังไงก็ไม่มีคู่ผสม ไม่ได้เสียโอกาสอะไรไป)
      if (couldHaveCombination) {
        state.budgetExhausted = true;
        state.skippedAnchorCount++;
      }
      continue;
    }

    const found = findForAnchor(
      anchor,
      anchorDay,
      members,
      memberCents,
      memberDays,
      toleranceDays,
      minMemberCents,
      state
    );
    if (!found) continue;

    found.sort((x, y) => x - y); // เรียงสมาชิกตามลำดับเดิมในไฟล์ เพื่อให้แสดงใน UI อ่านง่ายและผลลัพธ์คงที่
    let dateSpread = 0;
    for (const idx of found) {
      const diff = Math.abs(memberDays[idx] - anchorDay);
      if (diff > dateSpread) dateSpread = diff;
    }
    out.push({
      anchorSide,
      anchorIndex: a,
      memberIndexes: found,
      type: anchor.type,
      dateSpread,
      anchorOrder: anchorOrderOffset + a,
    });
  }
}

/**
 * หาข้อเสนอคู่ผสมทั้งหมดจากแถวที่ "ยังไม่สำเร็จ" ทั้งสองฝั่ง
 *
 * ส่ง bankUnmatched/glUnmatched (ผลจาก reconcileTransactions) เข้ามาเท่านั้น — ไม่ใช่แถวทั้งไฟล์ เพราะ
 * ฟีเจอร์นี้ทำงานต่อจากการจับคู่ 1:1 เป๊ะ ไม่ใช่แทนที่มัน
 */
export function findCombinationSuggestions(
  bankUnmatched: BankTransaction[],
  glUnmatched: GLTransaction[],
  toleranceDays: DateTolerance,
  options: FindCombinationOptions = {}
): CombinationSuggestionResult {
  const stepBudget = options.stepBudget ?? DEFAULT_COMBINATION_STEP_BUDGET;
  const rejectedSuggestionIds = options.rejectedSuggestionIds ?? new Set<string>();
  // งบต่อแถวเดี่ยว: หารงบรวมให้ทุกแถวเท่าๆ กัน แต่ไม่ต่ำกว่าเพดานขั้นต่ำ — ตั้งใจให้ "ไฟล์เล็กค้นลึก ไฟล์ใหญ่
  // ค้นกว้าง" โดยอัตโนมัติ: ไฟล์ที่เหลือไม่สำเร็จ 20 แถว แต่ละแถวได้งบหลายแสนก้าว (ค้นได้ลึกมาก เจอคู่ผสม
  // แถวเยอะได้) ส่วนไฟล์ที่เหลือ 600 แถว แต่ละแถวได้เท่าเพดานขั้นต่ำ (ค้นตื้นกว่า แต่ได้ค้นครบทุกแถวมากขึ้น
  // ไม่ใช่แถวแรกๆ กินงบไปหมด) — ถ้าเรียกเองจาก options.anchorStepBudget จะใช้ค่านั้นตรงๆ (ไว้ให้เทสต์คุมได้)
  const anchorCount = bankUnmatched.length + glUnmatched.length;
  const state: SearchState = {
    steps: 0,
    stepBudget,
    anchorStepBudget:
      options.anchorStepBudget ??
      Math.max(MIN_COMBINATION_ANCHOR_STEP_BUDGET, Math.floor(stepBudget / Math.max(1, anchorCount))),
    budgetExhausted: false,
    skippedAnchorCount: 0,
  };
  const minMemberCents = toCents(options.minMemberAmount ?? MIN_COMBINATION_MEMBER_AMOUNT);

  const bankCents = bankUnmatched.map((row) => toCents(row.amount));
  const glCents = glUnmatched.map((row) => toCents(row.amount));
  const bankDays = toDayNumbers(bankUnmatched);
  const glDays = toDayNumbers(glUnmatched);

  const raw: RawSuggestion[] = [];
  // ฝั่ง Bank เป็นแถวเดี่ยวก่อนเสมอ (Bank Statement เป็น master dataset ของทั้งโมดูลนี้ตามสเปกเดิม) แล้วค่อย
  // ค้นฝั่ง GL เป็นแถวเดี่ยว — ลำดับนี้มีผลตอนข้อเสนอชนกันด้วย (ดู anchorOrder) จึงกำหนดไว้ตายตัวไม่สลับ
  searchAnchorSide(
    bankUnmatched,
    bankDays,
    glUnmatched,
    glCents,
    glDays,
    'bank',
    0,
    toleranceDays,
    minMemberCents,
    state,
    raw
  );
  searchAnchorSide(
    glUnmatched,
    glDays,
    bankUnmatched,
    bankCents,
    bankDays,
    'gl',
    bankUnmatched.length,
    toleranceDays,
    minMemberCents,
    state,
    raw
  );

  // ### ตัดสินเมื่อข้อเสนอชนกัน (ใช้แถวเดียวกันซ้ำ)
  // เรียงตาม: สมาชิกน้อยที่สุดก่อน → วันที่เบี้ยวน้อยที่สุด → ลำดับเดิมในไฟล์ แล้วไล่รับแบบ greedy เฉพาะ
  // ข้อเสนอที่ทุกแถวยังว่างอยู่ ตัวตัดสินสามชั้นนี้ไม่มีทางเสมอกันได้ทั้งหมด (ชั้นสุดท้ายคือ anchorOrder ซึ่ง
  // ไม่ซ้ำกันเลยข้ามฝั่ง) → ผลลัพธ์เหมือนกันทุกครั้งที่ input เหมือนกัน 100%
  //
  // ลองแล้วไม่เอา: หา "ชุดข้อเสนอที่ครอบคลุมแถวได้มากที่สุด" แบบ optimal (maximum set packing) — เป็นปัญหา
  // NP-hard อีกชั้น และผลลัพธ์ที่ได้ก็ไม่ได้ "ถูกกว่า" ในสายตาผู้ใช้ เพราะทุกข้อเสนอรอผู้ใช้ตรวจเองอยู่แล้ว
  raw.sort(
    (a, b) => a.memberIndexes.length - b.memberIndexes.length || a.dateSpread - b.dateSpread || a.anchorOrder - b.anchorOrder
  );

  const usedBank = new Set<string>();
  const usedGl = new Set<string>();
  const accepted: Array<{ suggestion: CombinationSuggestion; anchorOrder: number }> = [];

  for (const item of raw) {
    let bankRows: BankTransaction[];
    let glRows: GLTransaction[];
    let anchorId: string;
    let memberIds: string[];

    if (item.anchorSide === 'bank') {
      const anchorRow = bankUnmatched[item.anchorIndex];
      const memberRows = item.memberIndexes.map((idx) => glUnmatched[idx]);
      bankRows = [anchorRow];
      glRows = memberRows;
      anchorId = anchorRow.id;
      memberIds = memberRows.map((row) => row.id);
    } else {
      const anchorRow = glUnmatched[item.anchorIndex];
      const memberRows = item.memberIndexes.map((idx) => bankUnmatched[idx]);
      bankRows = memberRows;
      glRows = [anchorRow];
      anchorId = anchorRow.id;
      memberIds = memberRows.map((row) => row.id);
    }

    const suggestionId = `${item.anchorSide}:${anchorId}=>${memberIds.join('+')}`;

    // ผู้ใช้ปฏิเสธใบนี้ไปแล้ว → ข้ามไปเลยโดย **ไม่จองแถว** ปล่อยให้ใบรองลงมาเข้ามาใช้แถวเหล่านี้แทนได้
    // (ต้องเช็คก่อนการจองแถวด้านล่างเสมอ ไม่งั้นจะไม่ต่างอะไรกับการกรองทิ้งตอนท้าย)
    if (rejectedSuggestionIds.has(suggestionId)) continue;

    // เช็คแถวชนกันหลังจากนั้น — ย้ายมารวมไว้ที่เดียวเพื่อให้ลำดับ "ปฏิเสธก่อน แล้วค่อยเช็คชน" ชัดเจน
    if (bankRows.some((row) => usedBank.has(row.id))) continue;
    if (glRows.some((row) => usedGl.has(row.id))) continue;

    // ตรวจซ้ำด้วยเครื่องมือชุดเดียวกับที่การจับคู่เองใช้ (sumAmounts + amountsEqual) — การค้นหาทำบน integer
    // สตางค์อยู่แล้วจึงไม่ควรมีทางพลาด แต่ถ้าพลาดขึ้นมาจริงเราเลือก "ไม่เสนอ" ดีกว่าเสนอคู่ที่ยอดไม่ตรง
    const bankTotal = sumAmounts(bankRows);
    const glTotal = sumAmounts(glRows);
    if (!amountsEqual(bankTotal, glTotal)) continue;

    bankRows.forEach((row) => usedBank.add(row.id));
    glRows.forEach((row) => usedGl.add(row.id));

    accepted.push({
      anchorOrder: item.anchorOrder,
      suggestion: {
        suggestionId,
        type: item.type,
        anchorSide: item.anchorSide,
        bankRows,
        glRows,
        amount: bankTotal,
        dateSpread: item.dateSpread,
      },
    });
  }

  // เรียงผลลัพธ์สุดท้ายตามลำดับแถวเดี่ยวในไฟล์ (Bank ก่อน GL) ไม่ใช่ตามลำดับที่ใช้ตัดสินการชนกัน — ผู้ใช้
  // ไล่ตรวจเทียบกับไฟล์ต้นฉบับจากบนลงล่าง ไม่ได้สนใจว่าข้อเสนอไหนถูกตัดสินก่อนหลัง
  accepted.sort((a, b) => a.anchorOrder - b.anchorOrder);
  const suggestions = accepted.map((item) => item.suggestion);

  return {
    suggestions,
    budgetExhausted: state.budgetExhausted,
    skippedAnchorCount: state.skippedAnchorCount,
    stepsUsed: state.steps,
  };
}

/**
 * แปลงข้อเสนอที่ผู้ใช้ "ยอมรับ" ให้เป็น MatchGroup จริงที่ไปโผล่ในหมวด "กระทบยอดสำเร็จ"
 *
 * ### ทำไม matchType เป็น 'manual' ไม่ใช่ค่าใหม่
 *
 * ตามความหมายแล้วคู่ที่มาจากข้อเสนอนี้ไม่ใช่ 'auto' เต็มตัว (ระบบเดาให้) และไม่ใช่ 'manual' เต็มตัว (ผู้ใช้
 * ไม่ได้ติ๊กเลือกแถวเอง) ค่าที่ตรงความหมายที่สุดคือค่าที่สามอย่าง 'suggested' — แต่คอลัมน์
 * bank_reconcile_match_groups.match_type ในฐานข้อมูลมี CHECK constraint บังคับไว้แค่ ('auto','manual')
 * การเพิ่มค่าที่สามต้องทำ migration ซึ่งผู้ใช้ขอให้ขออนุมัติก่อนทุกครั้งที่จะแก้ฐานข้อมูล จึงยังไม่ทำ
 *
 * เลือก 'manual' เพราะสาระสำคัญของคู่แบบนี้คือ "ผู้ใช้เป็นคนยืนยันเองว่าถูก" ซึ่งเป็นสิ่งเดียวกับที่ 'manual'
 * สื่ออยู่ (ต่างจาก 'auto' ที่หมายถึงระบบจับคู่ให้โดยไม่มีใครตรวจ) — ผลข้างเคียงที่ยอมรับไว้: ในตาราง
 * "กระทบยอดสำเร็จ" และในไฟล์ประวัติที่บันทึกลงฐานข้อมูล คู่ที่มาจากข้อเสนอจะแยกไม่ออกจากคู่ที่ผู้ใช้ติ๊กเอง
 * (ขึ้น badge "จับคู่เอง" เหมือนกัน) ถ้าวันหนึ่งได้ทำ migration เพิ่มค่า 'suggested' ควรเปลี่ยนมาใช้ค่านั้น
 * แล้วแยก badge ออกจากกัน จะตามรอยย้อนหลังได้ว่าคู่ไหนระบบเดาให้
 */
export function createSuggestedMatchGroup(suggestion: CombinationSuggestion): MatchGroup {
  // ใช้ createManualMatchGroup ตัวเดิมตรงๆ ไม่สร้าง MatchGroup ด้วยมือเอง — ได้การตรวจเงื่อนไขซ้ำ
  // (validateManualMatch: ประเภทเดียวกัน + ยอดรวมเท่ากันเป๊ะ) ติดมาด้วยฟรีๆ และไม่มีโค้ดสร้าง group สองที่
  // ที่อาจแตกต่างกันในอนาคต
  return createManualMatchGroup({ bankRows: suggestion.bankRows, glRows: suggestion.glRows });
}

/** ข้อเสนอที่เกี่ยวข้องกับแถวในชุด id ที่ส่งมา — ใช้ตอนที่แถวถูกดึงออกจากตาราง "ไม่สำเร็จ" ไปแล้วด้วยวิธีอื่น
 * (ผู้ใช้ยอมรับข้อเสนออื่น หรือติ๊กจับคู่เอง) ข้อเสนอที่อ้างถึงแถวเหล่านั้นต้องหายไปด้วย ไม่งั้นจะกดยอมรับ
 * ข้อเสนอที่อ้างแถวซึ่งไม่อยู่ในตารางแล้วได้ (ยอดจะเพี้ยนและแถวเดียวกันจะไปอยู่สองกลุ่มพร้อมกัน) */
export function dropSuggestionsUsingRows(
  suggestions: CombinationSuggestion[],
  bankIds: Set<string>,
  glIds: Set<string>
): CombinationSuggestion[] {
  return suggestions.filter(
    (item) => !item.bankRows.some((row) => bankIds.has(row.id)) && !item.glRows.some((row) => glIds.has(row.id))
  );
}
