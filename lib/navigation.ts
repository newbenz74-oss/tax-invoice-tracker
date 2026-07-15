import {
  FileClock,
  FileCheck2,
  FileInput,
  FileOutput,
  Landmark,
  ScrollText,
  SearchCheck,
  Send,
  RefreshCw,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

/**
 * โครงสร้างเมนู Sidebar ทั้งหมดของระบบ — แก้ตรงนี้ที่เดียวถ้าต้องการเพิ่ม/ลบ/แก้เมนู
 * `implemented: false` = ยังไม่มีฟีเจอร์จริง คลิกแล้วจะขึ้นหน้า "เร็วๆ นี้" (ComingSoon)
 *
 * รองรับเมนูซ้อนได้ไม่จำกัดระดับ (เดิมรองรับแค่ 2 ระดับ: หมวด → เมนู) — NavSection.children
 * เป็น NavEntry[] (ไม่ใช่ NavLeaf[] เหมือนเดิม) ทำให้หมวดหนึ่งมีหมวดย่อยซ้อนอยู่ข้างในได้ เช่น
 * "กระทบยอด" > "VAT Reconcile" > "รายงานภาษีซื้อ"/"รายงานภาษีขาย" (ซ้อน 3 ระดับ)
 */
export interface NavLeaf {
  id: string;
  label: string;
  icon: LucideIcon;
  implemented: boolean;
}

export interface NavSection {
  id: string;
  label: string;
  icon: LucideIcon;
  children: NavEntry[];
}

export type NavEntry = NavLeaf | NavSection;

export function isNavSection(entry: NavEntry): entry is NavSection {
  return 'children' in entry;
}

export const NAV_STRUCTURE: NavEntry[] = [
  {
    id: 'payments',
    label: 'บันทึกการจ่ายเงิน',
    icon: Send,
    children: [
      // เมนูนี้ใช้หน้าเดิมของ Dashboard เป็นเนื้อหาหลัก (สถิติ/ตาราง/filter/นำเข้า Excel/สรุป VAT
      // รายเดือน — logic เดิมทั้งหมดไม่ถูกแก้ ดู DashboardContent ใน app/dashboard/page.tsx) —
      // implemented: true และเป็น DEFAULT_ACTIVE_ID ด้านล่าง ทำให้เป็นหน้าแรกของระบบ
      { id: 'record-expense', label: 'บันทึกค่าใช้จ่าย', icon: Wallet, implemented: true },
      { id: 'payment-report', label: 'รายงานจ่ายเงิน', icon: ScrollText, implemented: false },
    ],
  },
  {
    id: 'reconcile',
    label: 'กระทบยอด',
    icon: RefreshCw,
    children: [
      { id: 'bank-reconcile', label: 'Bank Reconcile', icon: Landmark, implemented: false },
      {
        // เดิมเป็น NavLeaf (implemented: false, ขึ้นหน้า "เร็วๆ นี้") — ปรับเป็น NavSection ที่มี
        // เมนูย่อย 2 อัน ตามสเปกรายงานภาษีซื้อ/ภาษีขาย (VAT Reconcile ทำหน้าที่เป็นแค่หมวดครอบ
        // ไม่ใช่หน้าเนื้อหาเอง จึงไม่มี implemented ของตัวเอง)
        id: 'vat-reconcile',
        label: 'VAT Reconcile',
        icon: FileCheck2,
        children: [
          { id: 'purchase-tax-report', label: 'รายงานภาษีซื้อ', icon: FileInput, implemented: true },
          { id: 'sales-tax-report', label: 'รายงานภาษีขาย', icon: FileOutput, implemented: false },
        ],
      },
      { id: 'overdue-purchase-tax', label: 'ภาษีซื้อไม่ถึงกำหนด', icon: FileClock, implemented: false },
      { id: 'data-check', label: 'ตรวจสอบข้อมูล', icon: SearchCheck, implemented: false },
    ],
  },
];

/** เมนูที่ active เป็นค่าเริ่มต้นตอนล็อกอินครั้งแรก (ยังไม่มีค่าใน localStorage) — หน้าแรกของระบบ */
export const DEFAULT_ACTIVE_ID = 'record-expense';

/** หา NavLeaf จาก id (ทุกระดับความลึก) — คืน null ถ้าไม่พบ หรือถ้า id ที่ให้มาเป็นของ NavSection
 * (section ไม่ใช่หน้าเนื้อหา คลิกได้แค่ขยาย/ยุบ ไม่ใช่ id ที่ใช้กับ activeId) */
export function findNavLeaf(id: string, entries: NavEntry[] = NAV_STRUCTURE): NavLeaf | null {
  for (const entry of entries) {
    if (isNavSection(entry)) {
      const found = findNavLeaf(id, entry.children);
      if (found) return found;
    } else if (entry.id === id) {
      return entry;
    }
  }
  return null;
}

/** id ของทุกหมวด (section) ที่มี children ในทุกระดับความลึก — ใช้ตั้งค่า default expand/collapse */
export function allSectionIds(entries: NavEntry[] = NAV_STRUCTURE): string[] {
  const ids: string[] = [];
  for (const entry of entries) {
    if (isNavSection(entry)) {
      ids.push(entry.id, ...allSectionIds(entry.children));
    }
  }
  return ids;
}
