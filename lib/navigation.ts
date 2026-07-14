import {
  FileClock,
  FileCheck2,
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
  children: NavLeaf[];
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
      { id: 'vat-reconcile', label: 'VAT Reconcile', icon: FileCheck2, implemented: false },
      { id: 'overdue-purchase-tax', label: 'ภาษีซื้อไม่ถึงกำหนด', icon: FileClock, implemented: false },
      { id: 'data-check', label: 'ตรวจสอบข้อมูล', icon: SearchCheck, implemented: false },
    ],
  },
];

/** เมนูที่ active เป็นค่าเริ่มต้นตอนล็อกอินครั้งแรก (ยังไม่มีค่าใน localStorage) — หน้าแรกของระบบ */
export const DEFAULT_ACTIVE_ID = 'record-expense';

/** หา NavLeaf จาก id (ทั้ง top-level และที่อยู่ในหมวดย่อย) — คืน null ถ้าไม่พบ */
export function findNavLeaf(id: string): NavLeaf | null {
  for (const entry of NAV_STRUCTURE) {
    if (isNavSection(entry)) {
      const found = entry.children.find((child) => child.id === id);
      if (found) return found;
    } else if (entry.id === id) {
      return entry;
    }
  }
  return null;
}

/** id ของทุกหมวด (section) ที่มี children — ใช้ตั้งค่า default expand/collapse */
export function allSectionIds(): string[] {
  return NAV_STRUCTURE.filter(isNavSection).map((s) => s.id);
}
