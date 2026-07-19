'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { Search } from 'lucide-react';
import ProtectedRoute from '@/components/ProtectedRoute';
import Sidebar from '@/components/Sidebar';
import Header from '@/components/Header';
import ComingSoon from '@/components/ComingSoon';
import DashboardOverview from '@/components/DashboardOverview';
import InvoiceForm from '@/components/InvoiceForm';
import InvoiceTable from '@/components/InvoiceTable';
import ExcelImportPanel from '@/components/ExcelImportPanel';
import PurchaseTaxReport from '@/components/PurchaseTaxReport';
import OverduePurchaseTaxReport from '@/components/OverduePurchaseTaxReport';
import ContactsPage from '@/components/ContactsPage';
import BankReconcilePage from '@/components/BankReconcilePage';
import BankReconcileHistoryPage from '@/components/BankReconcileHistoryPage';
import { useAuth } from '@/lib/AuthContext';
import { registerAssistantNavBridge } from '@/lib/assistantNavBridge';
import {
  bulkCreateInvoices,
  cancelInvoice as apiCancelInvoice,
  createInvoice,
  deleteInvoice as apiDeleteInvoice,
  fetchInvoices,
  INVOICES_SWR_KEY,
  markReceived as apiMarkReceived,
  updateInvoice,
  type InvoiceWriteInput,
} from '@/lib/invoiceApi';
import { deriveStatusForTaxType, filterInvoices, sortInvoices } from '@/lib/invoiceLogic';
import { excelRowToWriteInput, type ExcelImportRow } from '@/lib/excelImport';
import { DEFAULT_ACTIVE_ID, findNavLeaf, type NavIntent } from '@/lib/navigation';
import type {
  InvoiceFormInput,
  InvoiceStatus,
  MarkReceivedInput,
  PendingTaxInvoice,
  SortDirection,
  SortField,
  TaxType,
} from '@/types/invoice';

const ACTIVE_NAV_STORAGE_KEY = 'benz_sidebar_active';
// จำนวนรายการต่อหน้าของตารางในหน้า "บันทึกค่าใช้จ่าย" — เพิ่มเข้ามาในรอบปรับโครงสร้าง
// Navigation/Layout (2026-07-15) ตามสเปกที่ขอ Pagination ไว้หลังย้าย KPI/สรุป VAT รายเดือนออกไป
// หน้า Dashboard แล้ว เป็น UI state ล้วนๆ (slice array ฝั่ง client) ไม่แตะ lib/invoiceLogic.ts
// หรือการเรียก API ใดๆ เลย ปรับตัวเลขนี้ได้อิสระในอนาคตถ้าต้องการ
const PAGE_SIZE = 10;

function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// โครง Sidebar + Header (DashboardShell) — เนื้อหาแต่ละเมนูสลับกันแสดงในพื้นที่เนื้อหาด้านขวาผ่าน
// renderActiveContent ด้านล่าง ไม่มี Next.js route แยกต่อเมนู (ทุกเมนูอยู่ใน URL /dashboard เดียว
// สลับด้วย client state — ดู lib/navigation.ts) — คงสถาปัตยกรรมนี้ไว้เหมือนเดิมทุกประการในรอบปรับ
// โครงสร้าง Navigation/Layout (2026-07-15) ที่เพิ่มเมนู "Dashboard" เข้ามาใหม่ด้วย
export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <DashboardShell />
    </ProtectedRoute>
  );
}

// อ่านเมนูที่ active ล่าสุดจาก localStorage (client-only) — ถ้ายังไม่เคยมีค่า (เช่นล็อกอินครั้งแรก
// ในเบราว์เซอร์นี้ หรือค่าเดิมที่บันทึกไว้ชี้ไปเมนูที่ถูกลบไปแล้ว) จะ fallback ไปใช้ DEFAULT_ACTIVE_ID
// เสมอ — เปลี่ยนจาก 'record-expense' เป็น 'dashboard' ในรอบปรับโครงสร้าง Navigation/Layout
// (2026-07-15) ตามที่ผู้ใช้ยืนยันให้ Dashboard เป็นหน้าแรกของระบบ (ดู lib/navigation.ts)
function readInitialActiveId(): string {
  if (typeof window === 'undefined') return DEFAULT_ACTIVE_ID;
  try {
    const saved = localStorage.getItem(ACTIVE_NAV_STORAGE_KEY);
    if (saved && findNavLeaf(saved)) return saved;
  } catch {
    // localStorage ใช้ไม่ได้ (เช่น private mode) — ใช้ค่า default ต่อไป
  }
  return DEFAULT_ACTIVE_ID;
}

function DashboardShell() {
  const [activeId, setActiveId] = useState<string>(readInitialActiveId);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // สัญญาณเสริม (optional) จากปุ่ม/การ์ดในหน้า Dashboard ภาพรวม เช่น "เพิ่มค่าใช้จ่าย" ควรเปิดฟอร์ม
  // ทันทีที่ไปถึงหน้าบันทึกค่าใช้จ่าย — เพิ่มเข้ามาพร้อมเมนู Dashboard ใหม่ในรอบนี้ (ดู
  // lib/navigation.ts — NavIntent) handleSelect ด้านล่างตั้งค่านี้เป็น null เสมอถ้าไม่ได้ส่ง intent
  // มาด้วยตรงๆ (เช่นคลิกเมนูใน Sidebar ตามปกติ) เพื่อไม่ให้ intent เก่าจากการนำทางครั้งก่อนหลงเหลือ
  //มาปนกับการคลิกเมนูปกติครั้งถัดไป
  const [navIntent, setNavIntent] = useState<NavIntent | null>(null);
  // บันทึกเมนูที่ active ไว้ทุกครั้งที่เปลี่ยน เพื่อให้จำได้ข้าม refresh
  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_NAV_STORAGE_KEY, activeId);
    } catch {
      // เขียน localStorage ไม่ได้ก็ไม่เป็นไร แค่จำเมนูข้าม refresh ไม่ได้
    }
  }, [activeId]);

  const activeEntry = findNavLeaf(activeId);
  const title = activeEntry?.label ?? '';

  // เปลี่ยนจาก function declaration ธรรมดาเป็น useCallback (2026-07-19 พร้อมฟีเจอร์ ACC Reconcile AI
  // Copilot) — เดิมเป็น plain function ไม่มีปัญหาอะไรตอนที่มีแค่ Sidebar/renderActiveContent ใช้งานตรงๆ
  // เท่านั้น (ไม่สนใจ identity ระหว่าง render) แต่ตอนนี้ useEffect ลงทะเบียน nav bridge ด้านล่างต้องใช้ค่านี้
  // เป็น dependency ด้วย ถ้ายังเป็น plain function (identity เปลี่ยนใหม่ทุก render) จะทำให้ effect นั้นรัน
  // ใหม่ทุกครั้งที่ DashboardShell re-render โดยไม่จำเป็นเลย (ไม่ผิดแต่สิ้นเปลือง — ทุกครั้งที่ re-register
  // จะสั่ง AssistantRoot.tsx re-render ตามไปด้วยผ่าน useSyncExternalStore) — เลียนแบบ pattern เดียวกับ
  // closeModal/attemptClose ใน ContactsPage.tsx ทุกประการ ไม่กระทบ behavior หรือ signature ภายนอกของทั้งสอง
  // ฟังก์ชันนี้แม้แต่นิดเดียว (ยังรับ/คืนค่าแบบเดิมทุกประการ ที่เรียกใช้อยู่เดิมทั้งหมดยังทำงานถูกต้องเหมือน
  // เดิม) เพราะ setActiveId/setNavIntent/setMobileNavOpen เป็น setState ที่ identity คงที่อยู่แล้วโดยธรรมชาติ
  const commitNav = useCallback((id: string, intent: NavIntent | null) => {
    setActiveId(id);
    setNavIntent(intent);
    setMobileNavOpen(false);
  }, []);

  const handleSelect = useCallback(
    (id: string, intent: NavIntent | null = null) => {
      commitNav(id, intent);
    },
    [commitNav]
  );

  // ลงทะเบียนความสามารถนำทางจริงของหน้านี้เข้ากับผู้ช่วย AI ที่ mount แยกอยู่ที่ root layout (2026-07-19) —
  // ดู lib/assistantNavBridge.ts ทั้งไฟล์สำหรับเหตุผลที่ใช้ external store + useSyncExternalStore แทน React
  // Context เลิกลงทะเบียน (null) ตอน unmount เสมอ (DashboardShell unmount ทุกครั้งที่ล็อกเอาต์ หรือตอน
  // ProtectedRoute เปลี่ยนกลับไปแสดง null ระหว่างตรวจสอบ auth — ผู้ช่วยจะกลับไปไม่เสนอคำสั่ง "นำทางไปหน้า X"
  // เองอัตโนมัติทันทีที่ไม่มี DashboardShell mount อยู่จริง ถูกต้องตามที่ออกแบบไว้) handleSelect ที่ส่งเข้าไป
  // เป็น navigate ตรงๆ (ไม่ใส่ intent ใดๆ) เพราะ Smart Action ของผู้ช่วยมีแค่ "พาไปหน้า X เฉยๆ" เท่านั้น ไม่มี
  // แนวคิดเปิดฟอร์ม/ตั้ง filter ล่วงหน้าแทนผู้ใช้ (สอดคล้องกับกฎห้าม save/delete/approve/submit แทนผู้ใช้ในสเปก
  // เดิม — ดู types/assistant.ts AssistantNavBridge.navigate ที่รับแค่ id อย่างเดียว ไม่มีช่องให้ส่ง intent)
  useEffect(() => {
    registerAssistantNavBridge({ activeId, pageTitle: title, navigate: handleSelect });
    return () => registerAssistantNavBridge(null);
  }, [activeId, title, handleSelect]);

  return (
    <>
      {/* พื้นหลังภาพทุกหน้า (2026-07-18) — div เปล่า fixed เต็มจอ อยู่หลังทุกอย่างด้วย z-index ต่ำสุด
          (ดูคอมเมนต์เต็มที่ .app-background ใน globals.css ว่าทำไมแยกเป็น div ต่างหากแทนใส่ตรงๆ ที่ wrapper
          ด้านล่าง) เอา bg-page-bg เดิมออกจาก wrapper ด้านล่างด้วย เพราะสีทึบเดิมจะบังภาพนี้ไว้หมดถ้ายังอยู่ */}
      <div className="app-background" aria-hidden="true" />
      <div className="flex min-h-screen">
        <Sidebar
          activeId={activeId}
          onSelect={(id) => handleSelect(id)}
          isOpen={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
        />
        {/* เอฟเฟกต์ fade-in + เลื่อนขึ้นเล็กน้อยตอน DashboardShell mount ทุกครั้ง (2026-07-18) — ทั้งตอนมา
            จากการเข้าสู่ระบบสำเร็จที่หน้า login (ดู app/login/page.tsx enterDashboard) และตอน mount ตรงๆ
            (เช่น refresh หน้า /dashboard ตอน login ค้างอยู่แล้ว) ใช้ CSS animation ล้วนๆ ไม่ต้องมี JS/
            useEffect ควบคุมเพิ่ม (เล่นอัตโนมัติทุกครั้งที่ element มีคลาสนี้ถูก mount) รองรับ
            prefers-reduced-motion ผ่าน media query กลางที่มีอยู่แล้วใน globals.css (บังคับ
            animation-duration แทบเป็น 0 ให้ทุก animation ในระบบรวมถึงอันนี้ด้วย) ตั้งใจใส่ที่ "คอลัมน์
            เนื้อหา" นี้เท่านั้น ไม่ใส่ที่ wrapper ที่ครอบ Sidebar เพราะ Sidebar เป็น position:fixed — ดู
            คอมเมนต์เต็มที่ .dashboard-content-entrance ใน globals.css ว่าทำไม */}
        {/* pb-32 กันชนล่าง (2026-07-19) — ปุ่มลอยผู้ช่วย AI (AssistantBubble, mount จาก root layout, position:
            fixed มุมขวาล่างทุกหน้า) จับจองพื้นที่ตายตัวประมาณ 96px จากมุมขวาล่างของ viewport เสมอ ไม่เลื่อนหนี
            ตาม scroll เพราะไม่ผูกกับตำแหน่งใน document แต่ยึดกับ viewport ตรงๆ หน้าที่เนื้อหายาวพอจะเลื่อนพ้น
            มุมนี้เองเมื่อ scroll ลงสุด แต่หน้าที่มีข้อมูลน้อย (เช่นตารางเหลือแค่ 1-2 แถว) แถวสุดท้ายของตาราง — ซึ่ง
            คอลัมน์ "การจัดการ" มักอยู่ขวาสุดพอดี — อาจตกอยู่ในมุมที่ปุ่มลอยจับจองไว้แม้ scroll ไปสุดหน้าแล้วก็ตาม
            (เพราะปุ่มลอย fixed ไม่ขยับ) ทำให้ผู้ใช้จริงคลิกปุ่มที่ถูกบังไม่ได้เลย — เจอบั๊กนี้จริงจาก
            e2e/overduePurchaseTax.spec.ts ตอนตารางเหลือแถวเดียว ปุ่ม "ได้รับใบกำกับภาษีแล้ว" โดนปุ่มลอยบังสนิท
            (ยืนยันด้วย boundingBox() จริง ไม่ใช่เดา) แก้ที่จุดเดียวตรงนี้ — wrapper กลางที่ครอบทุกหน้าใน
            DashboardShell (ดู renderActiveContent ด้านล่าง) — แทนที่จะไล่แก้ padding ทีละไฟล์หน้าย่อยที่มี
            <main> ของตัวเอง (มีอยู่ ~8-9 ไฟล์) เผื่อระยะไว้ 128px มากกว่าพื้นที่ที่ปุ่มลอยกินจริง (~96px)
            พอสมควรเพื่อความชัวร์ */}
        <div className="dashboard-content-entrance flex min-h-screen flex-1 flex-col pb-32 min-[992px]:ml-[250px]">
          <Header title={title} onMenuClick={() => setMobileNavOpen(true)} />
          {renderActiveContent(activeId, Boolean(activeEntry?.implemented), title, handleSelect, navIntent)}
        </div>
      </div>
    </>
  );
}

// เดิมเลือกระหว่าง DashboardContent (record-expense)/PurchaseTaxReport/ComingSoon — เพิ่มเคส
// 'dashboard' เข้ามาในรอบปรับโครงสร้าง Navigation/Layout (2026-07-15) เมนูที่ implemented: false
// ทุกอันยังคงขึ้น ComingSoon เหมือนเดิมทุกประการ
function renderActiveContent(
  activeId: string,
  implemented: boolean,
  title: string,
  // เสริมใหม่ (optional): เผื่อให้เนื้อหาด้านในเปลี่ยนเมนูที่ active ได้เอง พร้อมส่ง intent ไปด้วยได้
  // เช่นปุ่ม "ดูรายงานทั้งหมด →" ใน MonthlyVatSummary หรือการ์ด KPI/Quick Actions ในหน้า Dashboard
  onNavigate?: (id: string, intent?: NavIntent) => void,
  navIntent?: NavIntent | null,
) {
  if (!implemented) return <ComingSoon label={title} />;
  switch (activeId) {
    case 'dashboard':
      return <DashboardOverview onNavigate={onNavigate} />;
    case 'record-expense':
      return <ExpenseRecordContent initialIntent={navIntent ?? null} />;
    case 'purchase-tax-report':
      return <PurchaseTaxReport />;
    case 'overdue-purchase-tax':
      return <OverduePurchaseTaxReport onNavigate={onNavigate} />;
    case 'address-book':
      return <ContactsPage />;
    // Bank Reconcile เวอร์ชันออกแบบใหม่ทั้งหมด (2026-07-17) — เดิมเป็นรายงานเปรียบเทียบ Bank Statement กับ
    // GL ล้วนๆ ไม่มี prop ใดๆ ที่ต้องส่งเข้าไป — ตั้งแต่ฟีเจอร์ "จับคู่เอง + บันทึกประวัติ" (2026-07-19)
    // ส่ง navIntent ต่อเข้าไปด้วยแล้ว (รูปแบบเดียวกับ record-expense ด้านบน) เพื่อรองรับปุ่ม "เปิดดู/แก้ไข"
    // จากหน้าประวัติ (BankReconcileHistoryPage.tsx) ที่ต้องพากลับมาหน้านี้พร้อม intent ชนิด
    // 'open-reconcile-report' — BankReconcilePage.tsx (dispatcher) เป็นผู้ตัดสินใจว่าจะแสดง Workspace ใหม่
    // หรือโหลดจากประวัติจาก intent นี้
    case 'bank-reconcile':
      return <BankReconcilePage initialIntent={navIntent ?? null} />;
    // หน้าประวัติของฟีเจอร์ "จับคู่เอง + บันทึกประวัติ" (2026-07-19) — ปุ่ม "เปิดดู/แก้ไข" แต่ละแถวในหน้านี้
    // ส่ง onNavigate('bank-reconcile', {type:'open-reconcile-report', reportId}) กลับมาที่ case ด้านบน
    case 'reconcile-history':
      return <BankReconcileHistoryPage onNavigate={onNavigate} />;
    default:
      return <ComingSoon label={title} />;
  }
}

// เนื้อหาหน้า "บันทึกค่าใช้จ่าย" — เดิมชื่อ DashboardContent (สมัยที่หน้านี้เป็นเนื้อหาเดียวของ
// /dashboard ทั้งหมด) เปลี่ยนชื่อให้ตรงกับบทบาทปัจจุบันในรอบปรับโครงสร้าง Navigation/Layout
// (2026-07-15) เพื่อความชัดเจนระยะยาว — เป็นแค่การเปลี่ยนชื่อฟังก์ชันภายในไฟล์นี้ไฟล์เดียว (ไม่ได้
// export ไปที่อื่น) ไม่กระทบพฤติกรรมใดๆ การเปลี่ยนแปลงจริงของรอบนี้คือ (1) เอา StatsCards/
// MonthlyVatSummary ออก (ย้ายไปอยู่ DashboardOverview แทนแล้ว — component เดิมทั้งสองตัวไม่ถูกแก้ไข
// logic การคำนวณเลยแม้แต่บรรทัดเดียว แค่เปลี่ยนที่ render) (2) เพิ่ม pagination ตามสเปก (3) รับ
// initialIntent จากหน้า Dashboard ได้ (เปิดฟอร์ม/แผงนำเข้า/ตั้ง filter ล่วงหน้า)
function ExpenseRecordContent({ initialIntent }: { initialIntent?: NavIntent | null } = {}) {
  const { session } = useAuth();
  const today = useMemo(() => todayISO(), []);

  // ใช้ SWR แทน useEffect+useState เพื่อดึงข้อมูล — เรียก fetch เฉพาะตอนมี session แล้ว
  // (key เป็น null ถ้ายังไม่ login ทำให้ SWR ไม่ยิง request) และ mutate() เพื่อรีเฟรชหลังแก้ไขข้อมูล
  const {
    data: invoices = [],
    error: loadErrorObj,
    isLoading: loading,
    mutate,
  } = useSWR<PendingTaxInvoice[]>(session ? INVOICES_SWR_KEY : null, fetchInvoices);
  const loadError = loadErrorObj instanceof Error ? loadErrorObj.message : loadErrorObj ? 'โหลดข้อมูลไม่สำเร็จ' : null;

  // statusFilter/showForm/showImportPanel อ่านค่าเริ่มต้นจาก initialIntent ผ่าน lazy initializer ของ
  // useState (ไม่ใช้ useEffect ตามกฎ react-hooks/set-state-in-effect เดิมของโปรเจกต์นี้) — ทำงาน
  // ถูกต้องเพราะ component นี้ mount ใหม่เสมอทุกครั้งที่ activeId เปลี่ยนมาเป็น 'record-expense'
  // (การ์ด/Quick Action ในหน้า Dashboard เปลี่ยน activeId เสมอ ไม่มีทางกดซ้ำตอน activeId เป็น
  // 'record-expense' อยู่แล้ว เพราะสองเมนูนี้แสดงพร้อมกันไม่ได้) จึง mount ใหม่ทุกครั้งที่มี intent จริง
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'all'>(() =>
    initialIntent?.type === 'filter' ? initialIntent.status : 'pending'
  );
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('expected_date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // รายการที่ตรงกับ invoiceId ของ NavIntent ชนิด 'edit-invoice' (ปุ่ม "แก้ไข" จากหน้า "ภาษีซื้อที่ยังไม่
  // ได้รับ" — ดู components/OverduePurchaseTaxReport.tsx) — คำนวณสดทุก render (ไม่ใช้ useMemo/useEffect
  // เพราะไม่จำเป็น เป็นแค่ .find() ธรรมดา) แต่ใช้จริงแค่ตอน mount ครั้งแรกผ่าน useState lazy initializer
  // ของ showForm/editingInvoice ด้านล่างเท่านั้น เหมือน intent ชนิดอื่นๆ ทั้งหมดในไฟล์นี้ — ใช้งานได้ถูกต้อง
  // เพราะหน้าที่ส่ง intent นี้มาใช้ SWR key เดียวกัน (INVOICES_SWR_KEY) เสมอ ทำให้ cache ของ invoices ที่
  // นี่ "อุ่น" อยู่แล้วตั้งแต่ render รอบแรก ไม่ต้องรอ fetch ใหม่ — ถ้าหารายการไม่เจอ (เช่น ถูกลบไปพอดี) ก็
  // แค่ไม่เปิดฟอร์มให้อัตโนมัติเฉยๆ ผู้ใช้ยังเข้าหน้านี้ได้ปกติ ไม่ error ใดๆ
  const editInvoiceMatch =
    initialIntent?.type === 'edit-invoice' ? (invoices.find((inv) => inv.id === initialIntent.invoiceId) ?? null) : null;

  const [showForm, setShowForm] = useState(
    () => initialIntent?.type === 'open-form' || editInvoiceMatch !== null
  );
  const [editingInvoice, setEditingInvoice] = useState<PendingTaxInvoice | null>(() => editInvoiceMatch);
  const [showImportPanel, setShowImportPanel] = useState(() => initialIntent?.type === 'open-import');
  // Pagination (เพิ่มเข้ามาในรอบปรับโครงสร้าง Navigation/Layout 2026-07-15 ตามสเปก) — page state
  // ล้วนๆ ฝั่ง client (slice array ก่อน render) ไม่แตะ lib/invoiceLogic.ts หรือการเรียก API ใดๆ เลย
  const [page, setPage] = useState(1);

  const visibleInvoices = useMemo(() => {
    const filtered = filterInvoices(invoices, { status: statusFilter, search });
    return sortInvoices(filtered, sortField, sortDirection);
  }, [invoices, statusFilter, search, sortField, sortDirection]);

  // จำนวนหน้าคำนวณจากรายการที่กรอง/ค้นหา/เรียงแล้วเสมอ — clamp หน้าปัจจุบันไม่ให้เกินจำนวนหน้าจริง
  // ตรงนี้แทนการเรียก setState ใน effect (เช่นกรณีเปลี่ยน filter/ค้นหาแล้วรายการเหลือน้อยกว่าหน้าที่
  // ค้างอยู่) เพื่อเลี่ยง eslint rule react-hooks/set-state-in-effect เดิมของโปรเจกต์นี้ไปในตัว —
  // ฟังก์ชัน handle*Change ด้านล่างรีเซ็ตกลับหน้า 1 ให้ทันทีตอนเปลี่ยน filter/ค้นหา/เรียงอยู่แล้วด้วย
  // (ประสบการณ์ใช้งานที่ดีกว่าแค่ clamp เฉยๆ) แต่การ clamp ตรงนี้ยังจำเป็นไว้เป็นตัวกันสำรอง
  const totalPages = Math.max(1, Math.ceil(visibleInvoices.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedInvoices = useMemo(
    () => visibleInvoices.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [visibleInvoices, safePage]
  );

  function handleSortChange(field: SortField) {
    if (field === sortField) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
    setPage(1);
  }

  function handleStatusFilterChange(status: InvoiceStatus | 'all') {
    setStatusFilter(status);
    setPage(1);
  }

  function handleSearchChange(value: string) {
    setSearch(value);
    setPage(1);
  }

  async function handleFormSubmit(input: InvoiceFormInput) {
    // ปกติ validateInvoiceForm บังคับให้เลือกประเภทภาษีก่อน submit เสมอ — ยกเว้นกรณีเดียวคือกำลัง
    // แก้ไขรายการเก่าที่ tax_type เป็น NULL อยู่แล้ว (ก่อนมีฟีเจอร์นี้) ซึ่งจะไม่ถูกบังคับ (ดู
    // components/InvoiceForm.tsx taxTypeRequired) ทำให้ input.tax_type ยังเป็น '' ได้ในกรณีนี้เท่านั้น
    // — ถ้าเป็นเช่นนั้นจะไม่ใส่ tax_type/status ลงใน payload เลย (ไม่เดา/ไม่เขียนทับข้อมูลเดิม)
    const taxType: TaxType | null = input.tax_type || null;
    const isNoVat = taxType === 'no_vat';
    const isNonClaimable = taxType === 'non_claimable_vat';

    const payload = {
      vendor_name: input.vendor_name.trim(),
      transaction_date: input.transaction_date,
      description: input.description.trim() || null,
      amount_excl_vat: parseFloat(input.amount_excl_vat) || 0,
      // ไม่มี VAT: บังคับเป็น 0 เสมอไม่ว่าในฟอร์มจะมีค่าเดิมค้างอยู่หรือไม่ (ผู้ใช้อาจสลับประเภทไปมา)
      vat_amount: isNoVat ? 0 : parseFloat(input.vat_amount) || 0,
      reference_no: input.reference_no.trim() || null,
      // วันที่คาดว่าจะได้รับมีความหมายเฉพาะ claimable_vat เท่านั้น (ประเภทอื่นไม่มีขั้นตอนรอ)
      expected_date: isNoVat || isNonClaimable ? null : input.expected_date || null,
      notes: input.notes.trim() || null,
      vendor_tax_id: input.vendor_tax_id.trim() || null,
      // ใส่ tax_type/status, tax_invoice_number/date เฉพาะตอนที่เกี่ยวข้องเท่านั้น (ไม่ใส่ key นั้นๆ
      // เลยแทนที่จะใส่เป็น undefined) เพราะ undefined ที่เป็น key ของ object literal จะถูก
      // Object.assign() ใน mock ทดสอบ copy ทับค่าที่มีอยู่แล้วให้กลายเป็น undefined ไปด้วย (ต่างจาก
      // Supabase จริงที่ JSON.stringify ตัด key ที่เป็น undefined ออกก่อนส่งเสมอ) การไม่ใส่ key เลย
      // ปลอดภัยกับทั้งสองฝั่งเท่ากัน และสำคัญมากตอนแก้ไขรายการ claimable_vat ที่เคยกรอกเลขที่/วันที่
      // ใบกำกับภาษีผ่านขั้นตอน "ได้รับแล้ว" ไว้ก่อนแล้ว — ต้องไม่ถูกเขียนทับด้วยค่าว่าง เช่นเดียวกับ
      // รายการเก่าที่ยังไม่ระบุ tax_type — ต้องไม่ถูกเขียนทับด้วยค่าเดาใดๆ ทั้งสิ้น
      ...(taxType
        ? {
            tax_type: taxType,
            // ไม่มี VAT / มี VAT ไม่ใช้เครดิต: ไม่มีขั้นตอนรอรับใบกำกับภาษี ตั้งเป็น received ทันที
            // มี VAT ใช้เครดิตได้: พฤติกรรมเดิมทุกประการ (pending ตอนสร้างใหม่ / คงสถานะเดิมตอนแก้ไข)
            status: deriveStatusForTaxType(taxType, editingInvoice?.status),
          }
        : {}),
      ...(isNonClaimable
        ? {
            tax_invoice_number: input.tax_invoice_number.trim() || null,
            tax_invoice_date: input.tax_invoice_date || null,
          }
        : {}),
    };

    if (editingInvoice) {
      await updateInvoice(editingInvoice.id, payload);
    } else {
      // ตอนเพิ่มรายการใหม่ ฟอร์มบังคับเลือกประเภทภาษีเสมอ (taxTypeRequired เป็น true) จึงมั่นใจได้ว่า
      // payload มี tax_type/status ครบตามที่ createInvoice ต้องการแน่นอน
      await createInvoice(payload as InvoiceWriteInput, {
        id: session?.user?.id ?? null,
        email: session?.user?.email ?? null,
      });
    }
    setShowForm(false);
    setEditingInvoice(null);
    await mutate();
  }

  async function handleImportRows(rows: ExcelImportRow[]) {
    const inputs = rows.map(excelRowToWriteInput);
    await bulkCreateInvoices(inputs, {
      id: session?.user?.id ?? null,
      email: session?.user?.email ?? null,
    });
    setShowImportPanel(false);
    await mutate();
  }

  async function handleMarkReceived(invoice: PendingTaxInvoice, input: MarkReceivedInput) {
    await apiMarkReceived(invoice.id, input);
    await mutate();
  }

  async function handleCancelInvoice(invoice: PendingTaxInvoice) {
    await apiCancelInvoice(invoice.id);
    await mutate();
  }

  async function handleDelete(invoice: PendingTaxInvoice) {
    await apiDeleteInvoice(invoice.id);
    await mutate();
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-8">
      <div className="mb-8 flex flex-col gap-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* entrance-animate ทั้งหน้า (2026-07-18) — ผู้ใช้ขอให้กดเข้าหน้านี้แล้ว smooth เหมือนหน้า
              "สมุดรายชื่อ" (ContactsPage.tsx) โครงสร้างแถวบนของหน้านี้ (ปุ่มกรองสถานะฝั่งซ้าย + ค้นหา/นำเข้า/
              เพิ่มรายการฝั่งขวา) เหมือนกับแถว Segmented Control + Toolbar Actions ของ ContactsPage เกือบทุก
              ประการ จึงใช้คลาส entrance-animate/entrance-delay-1/2/3 ชุดเดิมจาก globals.css ไล่ตำแหน่งเดียวกัน
              ตรงๆ ได้เลย (ไม่เพิ่มคลาส/tier ใหม่): ปุ่มกรองสถานะ (delay-1) → ค้นหา/นำเข้า/เพิ่มรายการ
              (delay-2) → ตาราง+pagination (delay-3) */}
          {/* bg-white/8 + hover:bg-white/15 (แทน bg-white/hover:bg-page-bg ทึบเดิม) ตามธีมกระจกเข้ม
              (dark glassmorphism, 2026-07-18 รอบ 3) — ฟังก์ชันนี้เพิ่งถูกตั้งฐานใหม่จาก GitHub ตอนทำฟีเจอร์
              entrance-animate เมื่อครู่ ทำให้หลุดจากธีมเข้มไปชั่วคราว ใส่กลับให้ตรงกับไฟล์อื่นๆ ในระบบ */}
          <div className="entrance-animate entrance-delay-1 flex flex-wrap gap-2">
            {(['all', 'pending', 'received', 'cancelled'] as const).map((s) => (
              <button
                key={s}
                onClick={() => handleStatusFilterChange(s)}
                className={`btn-press rounded-full px-4 py-2 text-sm font-medium transition-colors duration-[250ms] ${
                  statusFilter === s
                    ? 'bg-primary text-white shadow-sm'
                    : 'border border-border bg-white/8 text-text-sub hover:bg-white/15'
                }`}
                data-testid={`filter-${s}`}
              >
                {s === 'all' ? 'ทั้งหมด' : s === 'pending' ? 'รอรับ' : s === 'received' ? 'ได้รับแล้ว' : 'ยกเลิก'}
              </button>
            ))}
          </div>

          <div className="entrance-animate entrance-delay-2 flex gap-2">
            <div className="relative">
              <Search
                size={18}
                className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-text-sub"
                aria-hidden="true"
              />
              <input
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="ค้นหาผู้ขาย / เลขที่อ้างอิง / เลขใบกำกับภาษี"
                className="focus-ring-primary h-12 w-64 rounded-xl border border-border bg-white/5 pr-4 pl-10 text-sm text-text placeholder:text-text-sub"
                data-testid="search-input"
              />
            </div>
            <button
              onClick={() => {
                setShowImportPanel(true);
                setShowForm(false);
              }}
              className="btn-press h-12 rounded-[10px] border border-border bg-white/8 px-4 text-sm font-medium text-text hover:bg-white/15"
              data-testid="open-import-panel"
            >
              นำเข้าจาก Excel
            </button>
            <button
              onClick={() => {
                setEditingInvoice(null);
                setShowForm(true);
                setShowImportPanel(false);
              }}
              className="btn-press h-12 rounded-[10px] bg-primary px-4 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover"
              data-testid="open-add-form"
            >
              + เพิ่มรายการ
            </button>
          </div>
        </div>
      </div>

      {showForm && (
        <div className="card-surface mb-8 rounded-2xl p-6">
          <h2 className="mb-4 text-sm font-bold text-text">
            {editingInvoice ? 'แก้ไขรายการ' : 'เพิ่มรายการใหม่'}
          </h2>
          <InvoiceForm
            key={editingInvoice?.id ?? 'new'}
            editingInvoice={editingInvoice}
            onSubmit={handleFormSubmit}
            onCancel={() => {
              setShowForm(false);
              setEditingInvoice(null);
            }}
          />
        </div>
      )}

      {showImportPanel && (
        <div className="card-surface mb-8 rounded-2xl p-6">
          <h2 className="mb-4 text-sm font-bold text-text">นำเข้ารายการจาก Excel</h2>
          <ExcelImportPanel
            onImport={handleImportRows}
            onClose={() => setShowImportPanel(false)}
            existingInvoices={invoices}
          />
        </div>
      )}

      {loadError && (
        <p role="alert" className="mb-4 rounded-[10px] border border-danger/20 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
          {loadError}
        </p>
      )}

      {loading ? (
        <p className="py-12 text-center text-sm text-text-sub">กำลังโหลดข้อมูล...</p>
      ) : (
        // ครอบด้วย div (เดิมเป็น Fragment เปล่า) เพื่อให้มี element จริงสำหรับใส่ entrance-animate/
        // entrance-delay-3 (2026-07-18 — ให้ตรงกับหน้า "สมุดรายชื่อ" ที่ผู้ใช้ขอ) ไม่กระทบ layout เดิมเลย
        // เพราะ <main> ไม่มี flex/grid/space-y ควบคุมระยะห่างระหว่าง element ลูกโดยตรงอยู่แล้ว (InvoiceTable
        // กับ pagination จัดการ margin ของตัวเองด้วย mt-4 ที่ pagination อยู่แล้ว)
        <div className="entrance-animate entrance-delay-3">
          <InvoiceTable
            invoices={paginatedInvoices}
            today={today}
            sortField={sortField}
            sortDirection={sortDirection}
            onSortChange={handleSortChange}
            onEdit={(invoice) => {
              setEditingInvoice(invoice);
              setShowForm(true);
              setShowImportPanel(false);
            }}
            onMarkReceived={handleMarkReceived}
            onCancelInvoice={handleCancelInvoice}
            onDelete={handleDelete}
          />

          {/* Pagination — เพิ่มเข้ามาในรอบปรับโครงสร้าง Navigation/Layout (2026-07-15) ตามสเปก
              หลังย้าย KPI Cards/Summary VAT รายเดือนออกไปหน้า Dashboard แล้ว ซ่อนไปเลยถ้าไม่มีรายการ
              (visibleInvoices.length === 0) เพราะไม่มีอะไรให้เปลี่ยนหน้า */}
          {visibleInvoices.length > 0 && (
            <div className="mt-4 flex items-center justify-between gap-3" data-testid="pagination">
              <p className="text-xs text-text-sub">
                แสดง {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, visibleInvoices.length)} จาก{' '}
                {visibleInvoices.length} รายการ
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage(safePage - 1)}
                  className="btn-press rounded-[10px] border border-border bg-white/8 px-3.5 py-2 text-sm font-medium text-text hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="pagination-prev"
                >
                  ก่อนหน้า
                </button>
                <span className="text-xs text-text-sub" data-testid="pagination-page-indicator">
                  หน้า {safePage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage(safePage + 1)}
                  className="btn-press rounded-[10px] border border-border bg-white/8 px-3.5 py-2 text-sm font-medium text-text hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="pagination-next"
                >
                  ถัดไป
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
