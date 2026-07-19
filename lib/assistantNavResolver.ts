import { findNavLeaf } from './navigation';

export interface AssistantNavResolution {
  id: string;
  label: string;
  implemented: boolean;
}

/**
 * ตรวจสอบว่า id ที่ผู้ช่วยกำลังจะเสนอนำทางไปนั้น "มีจริง" ใน NAV_STRUCTURE (lib/navigation.ts) หรือไม่ —
 * คืนค่า null ถ้าไม่มีจริง (กัน suggestion ปลอมหลุดออกไปให้ผู้ใช้กดไม่ได้เด็ดขาด) หา id ที่ hidden:true ได้
 * ตามปกติ (เช่น 'overdue-purchase-tax') เพราะ findNavLeaf ถูกออกแบบมาให้หา hidden entry เจอโดยตั้งใจอยู่แล้ว
 * (ดูคอมเมนต์ NavLeaf.hidden ในไฟล์นั้น) — คืนค่า `implemented` ตามจริงเสมอ เพื่อให้ผู้เรียก (เช่น
 * assistantKnowledge.ts หรือ UI ที่แสดงปุ่มแนะนำ) ตัดสินใจเองว่าจะกำกับข้อความ "(ยังไม่เปิดใช้งาน)" หรือไม่
 * — ไม่ใช่หน้าที่ของฟังก์ชันนี้ที่จะตัดสินใจเรื่อง UI copy
 */
export function resolveNavTarget(id: string): AssistantNavResolution | null {
  const leaf = findNavLeaf(id);
  if (!leaf) return null;
  return { id: leaf.id, label: leaf.label, implemented: leaf.implemented };
}

interface NavCommandPhrase {
  targetId: string;
  phrases: string[];
}

/** คำสั่งนำทางที่รู้จัก — รายการคำที่คัดสรรไว้ล่วงหน้าเท่านั้น (ไม่ใช่ intent classifier ทั่วไปที่พยายาม
 * ตีความประโยคอิสระ) เพิ่ม id ใหม่ที่นี่เมื่อมีหน้าใหม่ในระบบ — ทุก targetId ควรมีจริงใน NAV_STRUCTURE
 * (ตรวจสอบผ่าน resolveNavTarget เสมอตอนใช้งานจริง ไม่ได้เชื่อรายการนี้เฉยๆ) */
const NAV_COMMAND_PHRASES: NavCommandPhrase[] = [
  { targetId: 'dashboard', phrases: ['ไปหน้า dashboard', 'เปิด dashboard', 'ไปแดชบอร์ด', 'กลับหน้าแรก'] },
  { targetId: 'bank-reconcile', phrases: ['ไปหน้า bank reconcile', 'เปิด bank reconcile', 'ไปกระทบยอด'] },
  {
    targetId: 'reconcile-history',
    phrases: ['ไปประวัติการกระทบยอด', 'เปิดประวัติการกระทบยอด', 'ไปหน้าประวัติ'],
  },
  {
    targetId: 'record-expense',
    phrases: ['ไปบันทึกการจ่ายเงิน', 'เปิดบันทึกการจ่ายเงิน', 'ไปหน้าค่าใช้จ่าย'],
  },
  { targetId: 'purchase-tax-report', phrases: ['ไปรายงานภาษีซื้อ', 'เปิดรายงานภาษีซื้อ'] },
  { targetId: 'address-book', phrases: ['ไปสมุดรายชื่อ', 'เปิดสมุดรายชื่อ', 'ไปหน้าผู้ติดต่อ'] },
  {
    targetId: 'overdue-purchase-tax',
    phrases: ['ไปภาษีซื้อที่ยังไม่ได้รับ', 'เปิดภาษีซื้อที่ยังไม่ได้รับ'],
  },
];

/** แปลข้อความคำสั่งนำทางเป็นเป้าหมายจริง — คืนค่า null ถ้าข้อความไม่ตรงรูปแบบคำสั่งนำทางที่รู้จักเลย (ปล่อย
 * ให้ matchKnowledge จัดการต่อในฐานะคำถามธรรมดาแทน ไม่ใช่ error) */
export function parseNavigationCommand(query: string): AssistantNavResolution | null {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return null;
  for (const { targetId, phrases } of NAV_COMMAND_PHRASES) {
    if (phrases.some((phrase) => normalized.includes(phrase))) {
      return resolveNavTarget(targetId);
    }
  }
  return null;
}
