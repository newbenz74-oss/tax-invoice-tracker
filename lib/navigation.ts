import {
  BookUser,
  FileClock,
  FileCheck2,
  FileInput,
  FileOutput,
  Landmark,
  LayoutDashboard,
  Library,
  ScrollText,
  SearchCheck,
  Send,
  RefreshCw,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { InvoiceStatus } from '@/types/invoice';

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

/** สัญญาณเสริม (optional) ที่ส่งไปพร้อมกับการเปลี่ยนเมนู active — เพิ่มเข้ามาพร้อมหน้า Dashboard
 * ภาพรวมใหม่ (รอบปรับโครงสร้าง Navigation/Layout 2026-07-15) เพื่อให้ปุ่ม/การ์ดใน Dashboard พาไปหน้า
 * ปลายทางพร้อม "ทำอะไรต่อทันที" ได้เลย เช่นเปิดฟอร์มเพิ่มรายการ/เปิดแผงนำเข้า Excel/ตั้ง filter สถานะ
 * ไว้ล่วงหน้า — เนื้อหาปลายทาง (ExpenseRecordContent ใน app/dashboard/page.tsx) อ่านค่านี้แค่ตอน mount
 * ครั้งแรกผ่าน useState lazy initializer เท่านั้น (ไม่ใช้ useEffect ตามกฎ react-hooks/set-state-in-effect
 * ที่ยึดถือมาตลอดทั้งโปรเจกต์) ไม่ผูกกับ business logic ใดๆ ทั้งสิ้น เป็นแค่ UI state ล้วนๆ */
export type NavIntent =
  | { type: 'open-form' }
  | { type: 'open-import' }
  | { type: 'filter'; status: InvoiceStatus | 'all' }
  // เพิ่มพร้อมฟีเจอร์ "ภาษีซื้อที่ยังไม่ได้รับ" (2026-07-16) — ปุ่ม "แก้ไข" ของหน้านั้นส่ง intent นี้มา
  // เพื่อพาไปหน้า "บันทึกค่าใช้จ่าย" พร้อมเปิดฟอร์มแก้ไขรายการที่ระบุ invoiceId ไว้ล่วงหน้าทันที (อ่านค่า
  // นี้แค่ตอน mount ครั้งแรกผ่าน useState lazy initializer เหมือน intent ชนิดอื่นๆ ทั้งหมดข้างต้น — ดู
  // ExpenseRecordContent ใน app/dashboard/page.tsx)
  | { type: 'edit-invoice'; invoiceId: string };

export const NAV_STRUCTURE: NavEntry[] = [
  // เพิ่มเข้ามาในรอบปรับโครงสร้าง Navigation/Layout (2026-07-15 เซสชันเดียวกับรอบปรับ Theme) — เป็น
  // NavLeaf เดี่ยว (ไม่ใช่ NavSection ที่มีลูก) แม้สเปกจะเขียนหัวข้อย่อย "ภาพรวมระบบ" ไว้ใต้ Dashboard
  // ก็ตาม เพราะ Dashboard มีเนื้อหาเดียว (หน้าภาพรวม) ไม่มีเมนูย่อยจริงให้ต้องขยาย/ยุบ — ทำเป็น section
  // ที่มีลูกเดียวจะเพิ่มการคลิกเปล่าประโยชน์โดยไม่จำเป็น ใช้ label เดียวกับ PAGE_META ใน Header.tsx
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, implemented: true },
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
      // implemented: true ตั้งแต่ 2026-07-16 (เดิม false มาตลอด ขึ้นหน้า "เร็วๆ นี้") — เฟส 1 เท่านั้น
      // (อัปโหลด + จับคู่คอลัมน์ + พรีวิวข้อมูล) ยังไม่มีการจับคู่รายการ/ผลลัพธ์/export/บันทึกฐานข้อมูลใดๆ
      // ดู components/BankReconcilePage.tsx — ไม่กระทบโครงสร้าง Sidebar หรือเมนูอื่นเลยแม้แต่น้อย
      { id: 'bank-reconcile', label: 'Bank Reconcile', icon: Landmark, implemented: true },
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
      // implemented: true ตั้งแต่ 2026-07-16 (เดิม false มาตลอด ขึ้นหน้า "เร็วๆ นี้") — เปลี่ยนชื่อ label
      // จาก "ภาษีซื้อไม่ถึงกำหนด" เป็น "ภาษีซื้อที่ยังไม่ได้รับ" ตามที่ผู้ใช้อนุญาตไว้เพื่อให้เข้าใจชัดเจน
      // ขึ้นว่าเป็นรายงานติดตามเอกสาร ไม่ใช่รายงานภาษีซื้อสำหรับยื่น ภ.พ.30 (ดูหน้านั้นที่ 'purchase-tax-report')
      { id: 'overdue-purchase-tax', label: 'ภาษีซื้อที่ยังไม่ได้รับ', icon: FileClock, implemented: true },
      { id: 'data-check', label: 'ตรวจสอบข้อมูล', icon: SearchCheck, implemented: false },
    ],
  },
  {
    // เพิ่มเข้ามาพร้อมฟีเจอร์ "สมุดรายชื่อ" (2026-07-16) — หมวด Master Data สำหรับข้อมูลอ้างอิงที่ใช้ร่วม
    // กันหลายฟีเจอร์ในระบบ (เริ่มจากรายชื่อลูกค้า/ผู้จัดจำหน่ายเป็นเมนูแรก) เดิมวางไว้ระหว่าง
    // "บันทึกการจ่ายเงิน" กับ "กระทบยอด" — ย้ายมาไว้ล่างสุด (หลัง "กระทบยอด") ในรอบปรับลำดับ Sidebar
    // (2026-07-17) ตามที่ผู้ใช้ระบุลำดับเมนูใหม่มาโดยตรง — เปลี่ยนแค่ตำแหน่งในอาร์เรย์นี้เท่านั้น id/
    // label/icon/children/implemented ทุกอย่างเดิมไม่แตะเลย
    id: 'master-data',
    label: 'ข้อมูลหลัก (Master Data)',
    icon: Library,
    children: [
      // ตาราง business_partners ใหม่ทั้งหมด ไม่เกี่ยวข้องกับ pending_tax_invoices เดิมเลย — ดู
      // supabase/migration_004_business_partners.sql และ components/ContactsPage.tsx
      { id: 'address-book', label: 'สมุดรายชื่อ', icon: BookUser, implemented: true },
    ],
  },
];

/** เมนูที่ active เป็นค่าเริ่มต้นตอนล็อกอินครั้งแรก (ยังไม่มีค่าใน localStorage) — หน้าแรกของระบบ
 * เปลี่ยนจาก 'record-expense' เป็น 'dashboard' ในรอบปรับโครงสร้าง Navigation/Layout (2026-07-15)
 * ตามที่ผู้ใช้เลือกยืนยันผ่าน AskUserQuestion — ผู้ใช้ที่มี localStorage ค้างค่า 'record-expense' เดิม
 * จาก ก่อนหน้านี้จะยังคงเข้าเมนูนั้นได้ตามปกติทุกครั้งที่ล็อกอิน (ค่าที่เคยบันทึกไว้ยังถูกต้องเสมอ เพราะ
 * 'record-expense' ยังเป็น id ที่มีอยู่จริง) เปลี่ยนแค่ผู้ใช้ใหม่/เบราว์เซอร์ใหม่ที่ยังไม่เคยมีค่านี้เท่านั้น */
export const DEFAULT_ACTIVE_ID = 'dashboard';

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
