import {
  BookUser,
  Calculator,
  FileClock,
  FileInput,
  FileOutput,
  History,
  Landmark,
  LayoutDashboard,
  Library,
  SearchCheck,
  Send,
  type LucideIcon,
} from 'lucide-react';
import type { InvoiceStatus } from '@/types/invoice';

/**
 * โครงสร้างเมนู Sidebar ทั้งหมดของระบบ — แก้ตรงนี้ที่เดียวถ้าต้องการเพิ่ม/ลบ/แก้เมนู
 * `implemented: false` = ยังไม่มีฟีเจอร์จริง คลิกแล้วจะขึ้นหน้า "เร็วๆ นี้" (ComingSoon)
 * `hidden: true` = ไม่แสดงใน Sidebar อีกต่อไป (ดูรายละเอียดที่ NavLeaf.hidden ด้านล่าง) แต่ยังอยู่ใน
 * โครงสร้างนี้เหมือนเดิมทุกประการ เพื่อให้ทุกอย่างที่อ้างอิง id นี้ (findNavLeaf, localStorage เดิมของ
 * ผู้ใช้, ปุ่ม/การ์ดที่นำทางตรงแบบไม่ผ่าน Sidebar) ยังทำงานถูกต้องครบถ้วนต่อไป
 *
 * รองรับเมนูซ้อนได้ไม่จำกัดระดับ — NavSection.children เป็น NavEntry[] (ไม่ใช่ NavLeaf[]) ทำให้หมวด
 * หนึ่งมีหมวดย่อยซ้อนอยู่ข้างในได้
 */
export interface NavLeaf {
  id: string;
  label: string;
  icon: LucideIcon;
  implemented: boolean;
  /** อัปเดต 2026-07-17 (รอบปรับโครงสร้าง Sidebar): เมนูที่ผู้ใช้ขอให้ "เอาออกจาก Sidebar" แต่ "ห้ามลบ
   * หน้า/component ใดๆ" — ตั้งค่านี้เป็น true แทนการลบรายการออกจาก NAV_STRUCTURE เพื่อให้ findNavLeaf
   * ยังหา id นี้เจอเหมือนเดิมทุกประการ (จำเป็นมาก เพราะบางเมนู เช่น 'sales-tax-report' ยังถูกเรียกตรงจาก
   * ปุ่ม Quick Action ในหน้า Dashboard ผ่าน onNavigate โดยไม่ผ่าน Sidebar เลย — ถ้าลบออกจากอาร์เรย์นี้จริง
   * findNavLeaf จะคืน null ทำให้ title/implemented ผิดเพี้ยนทันที) ไม่กระทบ routing/business logic ใดๆ
   * ทั้งสิ้น เป็นแค่สัญญาณสำหรับ Sidebar.tsx ว่าไม่ต้อง render รายการนี้เท่านั้น (ดู NavItem ใน
   * components/Sidebar.tsx) — ค่าเริ่มต้นถือเป็น false/undefined (แสดงตามปกติ) ถ้าไม่ระบุ */
  hidden?: boolean;
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
  | { type: 'edit-invoice'; invoiceId: string }
  // เพิ่มพร้อมฟีเจอร์ "ประวัติการกระทบยอด" (2026-07-19) — ปุ่ม "เปิดดู/แก้ไข" ของหน้าประวัติ
  // (BankReconcileHistoryPage.tsx) ส่ง intent นี้มาเพื่อพาไปหน้า "Bank Reconcile" พร้อมโหลดรายการที่
  // บันทึกไว้แล้วมาแสดงทันที (ไม่ต้องอัปโหลดไฟล์ Bank Statement/GL ใหม่เลย) อ่านค่านี้แค่ตอน mount ครั้งแรก
  // ผ่าน useState lazy initializer เหมือน intent ชนิดอื่นๆ ทั้งหมดข้างต้น — ดู BankReconcilePage.tsx
  // (dispatcher เลือกระหว่างเปิดหน้าใหม่กับโหลดจากประวัติ) และ BankReconcileLoadedSession.tsx
  | { type: 'open-reconcile-report'; reportId: string };

// อัปเดต 2026-07-17 (รอบปรับโครงสร้าง Sidebar ตามคำขอผู้ใช้): จัดกลุ่มเมนูใหม่ทั้งหมด — id/label/icon/
// implemented ของทุกเมนูเดิม "ไม่ถูกแก้ไขเลยแม้แต่ค่าเดียว" (ผู้ใช้ระบุชัดเจนว่าห้ามแตะ routing/business
// logic ใดๆ แค่จัดลำดับ/กลุ่มใหม่) มีแค่ 2 อย่างที่เปลี่ยนจริง: (1) ตำแหน่งของแต่ละเมนูในโครงสร้างนี้
// (2) เพิ่ม field ใหม่ `hidden: true` ให้ 3 เมนูที่ผู้ใช้ขอเอาออกจาก Sidebar (ดูคอมเมนต์ NavLeaf.hidden
// ด้านบน) — โครงสร้างใหม่ที่ผู้ใช้ระบุมา:
//   Dashboard
//   Bank Reconcile (ย้ายออกมาเป็นเมนูเดี่ยวระดับบนสุด ไม่ซ้อนใต้หมวดใดๆ อีกต่อไป)
//   บัญชี (Accounting) [หมวดใหม่]
//     ├── บันทึกการจ่ายเงิน
//     └── รายงานภาษีซื้อ
//   ข้อมูลหลัก (Master Data) [เดิม ไม่เปลี่ยน]
//     └── สมุดรายชื่อ
// หมวดเดิม "กระทบยอด" (reconcile) และ "VAT Reconcile" (vat-reconcile) เป็นแค่ตัวครอบ (ไม่มีหน้า/
// component เนื้อหาเป็นของตัวเอง) ถูกยุบเลิกไปทั้งคู่ตามโครงสร้างใหม่ที่ผู้ใช้ระบุ (ไม่มีชื่อนี้อยู่ใน
// โครงสร้างสุดท้ายเลย) ลูกๆ ของทั้งสองหมวดถูกจัดสรรใหม่ทีละตัวตามนี้: 'bank-reconcile' → ย้ายขึ้นเป็น
// เมนูเดี่ยว, 'purchase-tax-report' → ย้ายไปอยู่ใต้ "บัญชี", 'sales-tax-report'/'overdue-purchase-tax'/
// 'data-check' → ตั้ง hidden: true (ผู้ใช้ระบุให้เอาออกจาก Sidebar แต่ "หน้าเหล่านี้อาจยังอยู่ในโปรเจกต์
// ได้ แค่ไม่ต้องแสดงใน Sidebar อีกต่อไป" — ดู e2e/helpers.ts gotoHiddenNavItem() สำหรับวิธีที่เทสต์ใช้
// นำทางตรงไปหน้าเหล่านี้โดยไม่ผ่าน Sidebar)
export const NAV_STRUCTURE: NavEntry[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, implemented: true },
  // เดิมซ้อนอยู่ใต้หมวด "กระทบยอด" (reconcile) — ย้ายขึ้นมาเป็นเมนูเดี่ยวระดับบนสุดตามคำขอ ("This should
  // be a standalone menu. No submenu.") id/label/icon/implemented เดิมทุกประการ ไม่แตะเลย เนื้อหาหน้านี้
  // ยังเป็น placeholder รอออกแบบใหม่เหมือนเดิม (ดู case 'bank-reconcile' ใน app/dashboard/page.tsx)
  { id: 'bank-reconcile', label: 'Bank Reconcile', icon: Landmark, implemented: true },
  // เมนูใหม่ (2026-07-19) พร้อมฟีเจอร์ "จับคู่เอง + บันทึกประวัติ" — วางเป็นเมนูเดี่ยวระดับบนสุดต่อจาก
  // 'bank-reconcile' โดยตรง (ไม่ซ้อนใต้เมนูใดๆ) ตามที่ผู้ใช้ระบุ ("ไปอยู่ในเมนูใหม่เลยเลย") สอดคล้องกับที่
  // 'bank-reconcile' เองก็ถูกจงใจวางเป็นเมนูเดี่ยวไม่มี submenu อยู่แล้วเช่นกัน ไอคอน History ยังไม่เคยถูกใช้
  // ที่ไหนใน NAV_STRUCTURE นี้มาก่อน เลือกเพราะสื่อความหมาย "บันทึกของกิจกรรมที่ผ่านมา" ตรงตัว
  { id: 'reconcile-history', label: 'ประวัติการกระทบยอด', icon: History, implemented: true },
  {
    // หมวดใหม่ทั้งหมด (2026-07-17) — ไอคอน Calculator เลือกใหม่เพราะยังไม่เคยถูกใช้ที่ไหนในระบบ (ไอคอน
    // เดิมของหมวด "กระทบยอด"/RefreshCw และ "VAT Reconcile"/FileCheck2 เลิกใช้ไปพร้อมการยุบทั้งสองหมวดนี้)
    id: 'accounting',
    label: 'บัญชี',
    icon: Calculator,
    children: [
      // เดิมเป็นเมนูเดี่ยวระดับบนสุด — ย้ายเข้ามาอยู่ในหมวด "บัญชี" ตามคำขอ id/label/icon/implemented
      // เดิมทุกประการ ("These pages already exist. Only move them into this new Accounting group.")
      { id: 'record-expense', label: 'บันทึกการจ่ายเงิน', icon: Send, implemented: true },
      // เดิมซ้อนอยู่ใต้หมวด "กระทบยอด" > "VAT Reconcile" (2 ชั้น) — ย้ายเข้ามาอยู่ในหมวด "บัญชี" โดยตรง
      // (1 ชั้น) ตามโครงสร้างใหม่ที่ผู้ใช้ระบุ id/label/icon/implemented เดิมทุกประการ
      { id: 'purchase-tax-report', label: 'รายงานภาษีซื้อ', icon: FileInput, implemented: true },
    ],
  },
  {
    // หมวด "ข้อมูลหลัก (Master Data)" — ไม่เปลี่ยนแปลงเลยในรอบปรับโครงสร้างนี้ (ตำแหน่ง/id/label/icon/
    // children เดิมทุกประการ) ตามที่ผู้ใช้ระบุ ("Keep ข้อมูลหลัก (Master Data)")
    id: 'master-data',
    label: 'ข้อมูลหลัก (Master Data)',
    icon: Library,
    children: [
      { id: 'address-book', label: 'สมุดรายชื่อ', icon: BookUser, implemented: true },
    ],
  },
  // ตั้งแต่บรรทัดนี้ลงไปคือ 3 เมนูที่ผู้ใช้ขอให้ "เอาออกจาก Sidebar" (hidden: true) — ไม่ได้ลบทิ้ง ไม่ได้
  // แก้ id/label/icon/implemented ใดๆ เลยแม้แต่ค่าเดียว อยู่ตรงไหนของอาร์เรย์นี้ก็ได้เพราะไม่ถูก render
  // อยู่แล้ว (จัดกลุ่มไว้ท้ายสุดเพื่อให้อ่านง่ายว่านี่คือ "เมนูที่ซ่อนอยู่" ทั้งหมด)
  {
    // เดิมซ้อนอยู่ใต้ "กระทบยอด" > "VAT Reconcile" — หมวด "VAT Reconcile" ถูกยุบเลิกไปทั้งหมด (ดูคอมเมนต์
    // ด้านบน) เมนูนี้จึงย้ายขึ้นมาเป็นระดับบนสุดของอาร์เรย์แทน แต่ตั้ง hidden: true ไว้ตามคำขอ ("Sales VAT
    // Report" อยู่ในลิสต์ REMOVE FROM SIDEBAR) ยังคง implemented: false เหมือนเดิม (ขึ้นหน้า "เร็วๆ นี้"
    // เท่าที่เคยเป็นมา) และยังเข้าถึงได้ปกติผ่านปุ่ม Quick Action "รายงานภาษีขาย" ในหน้า Dashboard (ดู
    // components/DashboardOverview.tsx onNavigate?.('sales-tax-report')) ซึ่งเป็นเหตุผลหลักที่ต้องคง
    // รายการนี้ไว้ใน NAV_STRUCTURE ไม่ใช่ลบทิ้ง — ไม่งั้นปุ่มนั้นจะพังทันที (findNavLeaf คืน null)
    id: 'sales-tax-report',
    label: 'รายงานภาษีขาย',
    icon: FileOutput,
    implemented: false,
    hidden: true,
  },
  // เดิมซ้อนอยู่ใต้หมวด "กระทบยอด" โดยตรง ("Outstanding Purchase VAT" อยู่ในลิสต์ REMOVE FROM SIDEBAR)
  // ยังคง implemented: true เหมือนเดิมทุกประการ (หน้า/component/business logic เดิมไม่ถูกแก้ไขเลย) แค่
  // ไม่มีทางเข้าถึงผ่าน Sidebar อีกต่อไปแล้วตามคำขอผู้ใช้
  {
    id: 'overdue-purchase-tax',
    label: 'ภาษีซื้อที่ยังไม่ได้รับ',
    icon: FileClock,
    implemented: true,
    hidden: true,
  },
  // เดิมซ้อนอยู่ใต้หมวด "กระทบยอด" โดยตรง ("Data Validation" อยู่ในลิสต์ REMOVE FROM SIDEBAR) ยังคง
  // implemented: false เหมือนเดิม (ขึ้นหน้า "เร็วๆ นี้" เท่าที่เคยเป็นมา)
  { id: 'data-check', label: 'ตรวจสอบข้อมูล', icon: SearchCheck, implemented: false, hidden: true },
];

/** เมนูที่ active เป็นค่าเริ่มต้นตอนล็อกอินครั้งแรก (ยังไม่มีค่าใน localStorage) — หน้าแรกของระบบ
 * เปลี่ยนจาก 'record-expense' เป็น 'dashboard' ในรอบปรับโครงสร้าง Navigation/Layout (2026-07-15)
 * ตามที่ผู้ใช้เลือกยืนยันผ่าน AskUserQuestion — ผู้ใช้ที่มี localStorage ค้างค่า 'record-expense' เดิม
 * จาก ก่อนหน้านี้จะยังคงเข้าเมนูนั้นได้ตามปกติทุกครั้งที่ล็อกอิน (ค่าที่เคยบันทึกไว้ยังถูกต้องเสมอ เพราะ
 * 'record-expense' ยังเป็น id ที่มีอยู่จริง) เปลี่ยนแค่ผู้ใช้ใหม่/เบราว์เซอร์ใหม่ที่ยังไม่เคยมีค่านี้เท่านั้น */
export const DEFAULT_ACTIVE_ID = 'dashboard';

/** หา NavLeaf จาก id (ทุกระดับความลึก) — คืน null ถ้าไม่พบ หรือถ้า id ที่ให้มาเป็นของ NavSection
 * (section ไม่ใช่หน้าเนื้อหา คลิกได้แค่ขยาย/ยุบ ไม่ใช่ id ที่ใช้กับ activeId) — หา "เจอ" รายการที่
 * hidden: true ได้ตามปกติเช่นกัน (hidden มีผลแค่กับการ render ใน Sidebar.tsx เท่านั้น ไม่เกี่ยวกับ
 * findNavLeaf เลย — ดูคอมเมนต์ NavLeaf.hidden ด้านบนว่าทำไมถึงสำคัญที่ต้องยังหาเจอ) */
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
