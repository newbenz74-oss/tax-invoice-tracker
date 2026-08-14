'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import useSWR from 'swr';
import { Search, X } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';
import ContactForm from './ContactForm';
import ContactTable from './ContactTable';
import ContactImportPanel from './ContactImportPanel';
import {
  bulkCreateContacts,
  createContact,
  CONTACTS_SWR_KEY,
  deleteContact,
  fetchContacts,
  setContactStatus,
  updateContact,
  type ContactWriteInput,
} from '@/lib/contactApi';
import { computeContactCounts, filterContacts, PARTNER_TYPE_LABELS } from '@/lib/contactLogic';
import { contactRowToWriteInput, type ContactImportRow } from '@/lib/contactExcelImport';
import { buildContactExportBlob, downloadContactBlob } from '@/lib/contactExport';
import type { BusinessPartner, ContactFormInput, EntityType, PartnerType } from '@/types/contact';

const PAGE_SIZE = 10;

type ModalMode = 'add' | 'edit' | 'view';

const MODAL_TITLES: Record<ModalMode, string> = {
  add: 'เพิ่มรายชื่อ',
  edit: 'แก้ไขรายชื่อ',
  view: 'รายละเอียดรายชื่อ',
};

const MODAL_SUBTITLES: Record<ModalMode, string> = {
  add: 'กรอกข้อมูลลูกค้าหรือผู้จัดจำหน่าย',
  edit: 'แก้ไขข้อมูลลูกค้าหรือผู้จัดจำหน่าย',
  view: 'ข้อมูลลูกค้าหรือผู้จัดจำหน่าย',
};

// ตัวเลือกของ Segmented Control (ทั้งหมด/ลูกค้า/ผู้จัดจำหน่าย) — ดึงเป็นค่าคงที่ module-level เดียว ใช้ทั้ง
// render ปุ่ม, หา label, และ arrow-key navigation (handleSegmentedKeyDown) ไม่ต้องเขียนลิสต์ซ้ำหลายที่
const PARTNER_TABS = ['all', 'customer', 'vendor'] as const;

const PARTNER_FILTER_STORAGE_KEY = 'benz_contacts_partner_filter';

// อ่านค่า Segmented Control ล่าสุดจาก localStorage (client-only) — ไม่มีค่าหรือใช้ localStorage ไม่ได้
// (เช่น private mode) ก็ fallback ไปเป็น 'all' เสมอตามสเปก เลียนแบบ pattern เดียวกับ readInitialExpanded
// ใน Sidebar.tsx / readInitialActiveId ใน app/dashboard/page.tsx ทุกประการ
function readInitialPartnerFilter(): PartnerType | 'all' {
  if (typeof window === 'undefined') return 'all';
  try {
    const saved = localStorage.getItem(PARTNER_FILTER_STORAGE_KEY);
    if (saved === 'all' || saved === 'customer' || saved === 'vendor') return saved;
  } catch {
    // localStorage ใช้ไม่ได้ — ใช้ค่า default ต่อไป
  }
  return 'all';
}

// เลือก element ที่ focus ได้ทั้งหมดภายใน container — ใช้ทั้งกับ focus trap (Tab/Shift+Tab วนใน
// modal) และ auto-focus ตอนเปิด modal ครั้งแรก กรอง offsetParent === null ออกเพื่อตัด element ที่ถูก
// ซ่อนด้วย CSS (display: none) ทิ้งไป
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null
  );
}

// หน้า "สมุดรายชื่อ" (ข้อมูลหลัก / Master Data) — ตารางใหม่ business_partners ไม่เกี่ยวข้องกับ
// pending_tax_invoices เลย ใช้ SWR key แยกต่างหาก (CONTACTS_SWR_KEY) จึงไม่แชร์ cache หรือกระทบการ
// โหลดข้อมูลของหน้า "บันทึกค่าใช้จ่าย"/"รายงานภาษีซื้อ" แต่อย่างใด — โครงสร้างหน้าเลียนแบบ
// ExpenseRecordContent (app/dashboard/page.tsx) และ PurchaseTaxReport.tsx: Segmented Control +
// ค้นหา + ปุ่ม action ด้านบน, ตาราง + pagination ด้านล่าง ต่างกันตรงฟอร์มเพิ่ม/แก้ไข/ดูรายละเอียดใช้
// Modal overlay จริง (ตามสเปกที่ระบุ "Modal หรือ Drawer") แทนการขยายแบบ inline card เหมือนฟอร์มใบกำกับภาษี
//
// โครงสร้าง Modal (ปรับปรุง 2026-07): การ์ด modal เป็น flex-col ที่ถูกจำกัดความสูงด้วย max-height
// (calc(100vh-24px) มือถือ / calc(100vh-48px) จอใหญ่) แบ่งเป็น 3 โซนคงที่ — Header (flex-none, sticky
// อยู่นอกส่วนที่ scroll ได้) / ContactForm ซึ่งข้างในแบ่ง Body ที่ scroll ได้ (flex-1 min-h-0
// overflow-y-auto) กับ Footer ปุ่มบันทึก/ยกเลิกที่ sticky bottom เสมอ (ดู ContactForm.tsx) — ทำให้
// Header/Footer มองเห็นตลอด เลื่อนได้เฉพาะ Body เท่านั้น ไม่กระทบ logic การบันทึกเดิมแต่อย่างใด
export default function ContactsPage() {
  const { session } = useAuth();
  const { selectedCompanyId } = useCompany();

  const {
    data: contacts = [],
    error: loadErrorObj,
    isLoading: loading,
    mutate,
  } = useSWR<BusinessPartner[]>(
    session && selectedCompanyId ? [CONTACTS_SWR_KEY, selectedCompanyId] : null,
    () => fetchContacts(selectedCompanyId!)
  );
  const loadError = loadErrorObj instanceof Error ? loadErrorObj.message : loadErrorObj ? 'โหลดข้อมูลไม่สำเร็จ' : null;

  const [partnerFilter, setPartnerFilter] = useState<PartnerType | 'all'>(readInitialPartnerFilter);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [modalMode, setModalMode] = useState<ModalMode | null>(null);
  const [selectedContact, setSelectedContact] = useState<BusinessPartner | null>(null);
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const isOpen = modalMode !== null;

  // element ที่ถูกคลิก/focus อยู่ก่อนเปิด modal (ปุ่ม "+ เพิ่มรายชื่อ" หรือปุ่มในแถวตาราง) — เก็บไว้
  // เพื่อคืน focus กลับไปให้หลังปิด modal
  const triggerElementRef = useRef<HTMLElement | null>(null);
  // การ์ด modal ทั้งใบ (Header + ContactForm) — ใช้ทำ focus trap (Tab/Shift+Tab วนในนี้)
  const modalCardRef = useRef<HTMLDivElement>(null);
  // ครอบเฉพาะ ContactForm (ไม่รวม Header) — ใช้หา "ช่องแรกของฟอร์ม" สำหรับ auto-focus ตอนเปิด
  const formWrapperRef = useRef<HTMLDivElement>(null);
  // dialog ยืนยันการปิดโดยไม่บันทึก — ใช้ทำ focus trap แยกตอน dialog นี้เปิดอยู่
  const discardDialogRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);

  // Segmented Control (2026-08-14 ตัดระบบ "Sliding Pill Indicator" ที่วางตำแหน่ง/ความกว้างด้วย
  // getBoundingClientRect() ผ่าน ref ออกทั้งหมด — ผู้ใช้ยืนยันด้วยสกรีนช็อตจริงว่าแท็บไฮไลต์สีฟ้าเลื่อนไปอยู่
  // ผิดตำแหน่ง ไม่ตรงกับตัวหนังสือปุ่มที่เลือกจริง (คาดว่าเกี่ยวกับ html { zoom: 70% } ใน globals.css ทำให้ค่า
  // ตำแหน่ง/ขนาดที่วัดได้จาก getBoundingClientRect ไม่ตรงกับที่ควรจะเป็นในบางจังหวะ) แทนที่จะไล่แก้ปัญหา
  // timing/zoom ที่วัดผลจริงไม่ได้ในสภาพแวดล้อมนี้ เปลี่ยนมาใช้ pattern เดียวกับแท็บกรองสถานะในหน้า
  // "บันทึกการจ่ายเงิน" (app/dashboard/page.tsx) ที่ใช้อยู่แล้วในระบบนี้เหมือนกัน — ใส่สี bg-primary ตรงๆ ที่
  // ปุ่ม active ผ่าน conditional className แทน ไม่ต้องวัด DOM เลย ตัดปัญหาการเลื่อนผิดตำแหน่งได้ที่ต้นตอ
  const tabRefs = useRef<Partial<Record<(typeof PARTNER_TABS)[number], HTMLButtonElement | null>>>({});
  // wrapper รอบตาราง+pagination — ใช้เล่น animation "dip" ซ้ำทุกครั้งที่เปลี่ยน Segmented Control ผ่าน
  // classList โดยตรง (ดู handlePartnerFilterChange) ไม่ใช้ React state/useEffect เช่นกัน
  const tableWrapperRef = useRef<HTMLDivElement>(null);

  const counts = useMemo(() => computeContactCounts(contacts), [contacts]);

  // บันทึกตัวเลือก Segmented Control ล่าสุดไว้ทุกครั้งที่เปลี่ยน เพื่อให้จำได้ข้าม refresh (ตามสเปก —
  // เลียนแบบ pattern เดียวกับ expanded/activeId ที่มีอยู่แล้วในระบบทุกประการ)
  useEffect(() => {
    try {
      localStorage.setItem(PARTNER_FILTER_STORAGE_KEY, partnerFilter);
    } catch {
      // เขียน localStorage ไม่ได้ก็ไม่เป็นไร แค่จำตัวเลือกข้าม refresh ไม่ได้
    }
  }, [partnerFilter]);

  const visibleContacts = useMemo(
    () => filterContacts(contacts, { partnerType: partnerFilter, search }),
    [contacts, partnerFilter, search]
  );

  const totalPages = Math.max(1, Math.ceil(visibleContacts.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedContacts = useMemo(
    () => visibleContacts.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [visibleContacts, safePage]
  );

  function handlePartnerFilterChange(value: PartnerType | 'all') {
    if (value === partnerFilter) return;
    setPartnerFilter(value);
    setPage(1);

    // เล่น animation "dip" (จางลงเล็กน้อย+เลื่อนขึ้นแล้วกลับมาปกติ) ซ้ำทุกครั้งที่เปลี่ยน Segmented
    // Control โดยตรงผ่าน DOM ref (ไม่ใช้ React state/useEffect) — ลบคลาสออกก่อน บังคับ reflow (อ่าน
    // offsetWidth ในเงื่อนไข if เพื่อไม่ให้ชน eslint no-unused-expressions) แล้วใส่คลาสกลับเข้าไปใหม่
    // เป็นเทคนิคมาตรฐานสำหรับ "restart" CSS animation เดิมซ้ำโดยไม่ต้อง remount ContactTable เลย (การ
    // remount จะรีเซ็ต state ภายในตาราง เช่น dialog ยืนยันลบที่อาจเปิดค้างอยู่ ซึ่งไม่ควรเกิดขึ้น) ข้อมูล
    // ในตารางเองสลับตามปกติของ React ระหว่างช่วงกลาง animation (opacity ต่ำสุด) ทำให้ดูเหมือน fade
    // out/in ต่อเนื่องโดยไม่ต้องหน่วงข้อมูลจริงเลย — ดูรายละเอียดเพิ่มเติมที่คอมเมนต์
    // .table-filter-transition ใน app/globals.css
    const el = tableWrapperRef.current;
    if (el) {
      el.classList.remove('table-filter-transition');
      if (el.offsetWidth >= 0) {
        el.classList.add('table-filter-transition');
      }
    }
  }

  // Arrow key navigation สำหรับ Segmented Control (role=tablist) — ตามแนวทาง WAI-ARIA APG "automatic
  // activation": ArrowLeft/ArrowRight เลื่อน focus ไปแท็บถัดไป/ก่อนหน้าแล้วเลือกทันที (Home/End ไปแท็บ
  // แรก/สุดท้าย) เสริมจาก Tab+Enter/Space ที่ปุ่ม <button> รองรับเองอยู่แล้วโดยธรรมชาติ
  function handleSegmentedKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const currentIndex = PARTNER_TABS.indexOf(partnerFilter);
    let nextIndex: number | null = null;
    if (e.key === 'ArrowRight') nextIndex = (currentIndex + 1) % PARTNER_TABS.length;
    else if (e.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + PARTNER_TABS.length) % PARTNER_TABS.length;
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = PARTNER_TABS.length - 1;

    if (nextIndex !== null) {
      e.preventDefault();
      const nextValue = PARTNER_TABS[nextIndex];
      handlePartnerFilterChange(nextValue);
      tabRefs.current[nextValue]?.focus();
    }
  }

  function handleSearchChange(value: string) {
    setSearch(value);
    setPage(1);
  }

  // ปิด modal แบบไม่มีเงื่อนไข (ใช้หลังบันทึกสำเร็จ, หลังกดยืนยัน "ปิดโดยไม่บันทึก", ฯลฯ) — reset
  // ทั้ง selectedContact, formDirty และ showDiscardConfirm กลับสู่ค่าเริ่มต้นเสมอ
  const closeModal = useCallback(() => {
    setModalMode(null);
    setSelectedContact(null);
    setFormDirty(false);
    setShowDiscardConfirm(false);
  }, []);

  // จุดเดียวที่ใช้ "พยายามปิด" modal (overlay click, ปุ่ม X, ปุ่ม ยกเลิก, ปุ่ม ESC) — ถ้าฟอร์มไม่มีการ
  // เปลี่ยนแปลง (formDirty=false) ปิดได้ทันที ถ้ามีการเปลี่ยนแปลงค้างอยู่ ให้เปิด dialog ยืนยันก่อน
  // แทนที่จะปิดตรงๆ (ป้องกันข้อมูลที่กรอกไว้หายโดยไม่ตั้งใจ)
  const attemptClose = useCallback(() => {
    if (formDirty) {
      setShowDiscardConfirm(true);
      return;
    }
    closeModal();
  }, [formDirty, closeModal]);

  function openAddModal() {
    triggerElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedContact(null);
    setModalMode('add');
    setShowImportPanel(false);
  }

  function openViewModal(contact: BusinessPartner) {
    triggerElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedContact(contact);
    setModalMode('view');
  }

  function openEditModal(contact: BusinessPartner) {
    triggerElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedContact(contact);
    setModalMode('edit');
  }

  // ล็อกการ scroll ของพื้นหลังตอนเปิด modal (เลียนแบบ pattern เดิมใน Sidebar.tsx สำหรับ overlay มือถือ)
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  // auto-focus ช่องแรกของฟอร์มตอน "เปิด" modal เท่านั้น (ไม่ใช่ทุกครั้งที่ modalMode เปลี่ยน เช่นตอน
  // สลับ view → edit ด้วยปุ่ม "แก้ไข" ระหว่าง modal ยังเปิดอยู่) จึงเช็คด้วย wasOpenRef ว่าเพิ่งเปลี่ยน
  // จากปิด → เปิดจริงๆ
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      const wrapper = formWrapperRef.current;
      if (wrapper) {
        getFocusableElements(wrapper)[0]?.focus();
      }
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  // คืน focus กลับไปยัง element ที่เปิด modal (ปุ่ม + เพิ่มรายชื่อ / ปุ่มในแถวตาราง) หลัง modal ปิดสนิท
  useEffect(() => {
    if (isOpen) return;
    const trigger = triggerElementRef.current;
    if (!trigger) return;
    triggerElementRef.current = null;
    trigger.focus();
  }, [isOpen]);

  // auto-focus ปุ่มใน dialog ยืนยันการปิดโดยไม่บันทึก (โฟกัสปุ่ม "กลับไปแก้ไขต่อ" ซึ่งเป็นตัวเลือกที่
  // ปลอดภัยกว่า เป็นปุ่มแรกใน DOM จึงเป็น focusable[0] เสมอ)
  useEffect(() => {
    if (!showDiscardConfirm) return;
    const dialog = discardDialogRef.current;
    if (dialog) {
      getFocusableElements(dialog)[0]?.focus();
    }
  }, [showDiscardConfirm]);

  // ESC ปิด modal (ผ่าน attemptClose เดียวกับ overlay click จึงถามยืนยันก่อนถ้ามีการแก้ไขค้างอยู่
  // เหมือนกัน — ถ้า dialog ยืนยันเปิดอยู่แล้ว ESC จะปิดแค่ dialog ยืนยัน ไม่ปิด modal หลักทันที) +
  // focus trap วน Tab/Shift+Tab อยู่ภายใน modal (หรือภายใน dialog ยืนยัน ถ้ากำลังเปิดอยู่)
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (showDiscardConfirm) {
          setShowDiscardConfirm(false);
        } else {
          attemptClose();
        }
        return;
      }

      if (e.key === 'Tab') {
        const container = showDiscardConfirm ? discardDialogRef.current : modalCardRef.current;
        if (!container) return;
        const focusable = getFocusableElements(container);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;

        if (e.shiftKey) {
          if (active === first || !container.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last || !container.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, showDiscardConfirm, attemptClose]);

  async function handleFormSubmit(input: ContactFormInput) {
    const payload: ContactWriteInput = {
      partner_type: input.partner_type as PartnerType,
      contact_code: input.contact_code,
      entity_type: input.entity_type as EntityType,
      company_name: input.entity_type === 'company' ? input.company_name.trim() || null : null,
      first_name: input.entity_type === 'individual' ? input.first_name.trim() || null : null,
      last_name: input.entity_type === 'individual' ? input.last_name.trim() || null : null,
      tax_id: input.tax_id.trim() || null,
      branch_type: input.branch_type,
      branch_number: input.branch_type === 'branch' ? input.branch_number.trim() || null : null,
      address: input.address.trim() || null,
      subdistrict: input.subdistrict.trim() || null,
      district: input.district.trim() || null,
      province: input.province.trim() || null,
      postal_code: input.postal_code.trim() || null,
      phone: input.phone.trim() || null,
      email: input.email.trim() || null,
      contact_person: input.contact_person.trim() || null,
      note: input.note.trim() || null,
      status: input.status,
    };

    if (selectedContact) {
      await updateContact(selectedContact.id, payload);
    } else {
      await createContact(payload, session?.user?.id ?? null, selectedCompanyId!);
    }
    closeModal();
    await mutate();
  }

  async function handleImportRows(rows: ContactImportRow[]) {
    const inputs = rows.map(contactRowToWriteInput);
    await bulkCreateContacts(inputs, session?.user?.id ?? null, selectedCompanyId!);
    setShowImportPanel(false);
    await mutate();
  }

  async function handleToggleStatus(contact: BusinessPartner) {
    await setContactStatus(contact.id, contact.status === 'active' ? 'inactive' : 'active');
    await mutate();
  }

  async function handleDelete(contact: BusinessPartner) {
    await deleteContact(contact.id);
    await mutate();
  }

  function handleExportExcel() {
    // Export เคารพ filter (Segmented Control) + คำค้นหาปัจจุบันเสมอตามสเปก — ใช้ visibleContacts
    // (ก่อนตัดหน้า pagination) ไม่ใช่ paginatedContacts เพราะ pagination เป็นแค่การแสดงผล ไม่ควรจำกัด
    // จำนวนแถวที่ export ออกไป
    const blob = buildContactExportBlob(visibleContacts);
    const scopeLabel = partnerFilter === 'all' ? 'ทั้งหมด' : PARTNER_TYPE_LABELS[partnerFilter];
    downloadContactBlob(blob, `สมุดรายชื่อ-${scopeLabel}.xlsx`);
  }

  const modalTitle = modalMode ? MODAL_TITLES[modalMode] : '';
  const modalSubtitle = modalMode ? MODAL_SUBTITLES[modalMode] : '';

  return (
    // ขยายจาก max-w-6xl (1152px) เป็น max-w-[1400px] (2026-08-14 ตามคำขอผู้ใช้ "ตารางขยับซ้ายและขวาเพิ่มให้
    // กว้างหน่อย") ให้ตารางมีที่ว่างซ้าย-ขวาเพิ่มขึ้น — ใช้ค่าเดียวกับ WhtCertificateHistoryPage.tsx (หน้า
    // ตาราง/รายการที่กว้างกว่าค่าเริ่มต้น max-w-6xl/max-w-4xl ของหน้าฟอร์ม/ตั้งค่าทั่วไปในระบบนี้อยู่แล้ว)
    <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-8 sm:px-8">
      <div className="mb-8 flex flex-col gap-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Segmented Control — role=tablist/tab + aria-selected ตามสเปก Accessibility, รองรับ
              ArrowLeft/ArrowRight/Home/End (handleSegmentedKeyDown) นอกเหนือจาก Tab+Enter/Space ที่
              <button> รองรับเองอยู่แล้ว ไฮไลต์ปุ่ม active ใช้ bg-primary ตรงๆ ผ่าน conditional className
              ไม่มีกลไก sliding indicator/DOM measurement แล้ว (ดูคอมเมนต์ที่ประกาศ tabRefs ด้านบน) */}
          <div
            role="tablist"
            aria-label="กรองประเภทรายชื่อ"
            onKeyDown={handleSegmentedKeyDown}
            // สีตัวหนังสือในหน้านี้ (2026-08-12 — สรุปหลักการสุดท้าย) — จุดที่เป็นกล่องขาวทึบจริงๆ ของตัวเอง
            // (มี bg-white ติดอยู่บน element นั้นตรงๆ เช่น search box, ปุ่ม toolbar, segmented control, หัว
            // modal แบบ sticky) ใช้ text-gray-800/text-gray-500/placeholder:text-gray-400 ถูกต้องแล้ว เพราะ
            // bg-white ของ Tailwind ใช้งานได้ปกติเมื่อไม่ได้ติดอยู่บน element เดียวกับ .card-surface — ส่วน
            // การ์ด/โมดัลที่ติดคลาส .card-surface (พื้นกระจกเข้มเสมอ ชนะ bg-white ตาม CSS Cascade Layers ดู
            // app/globals.css) องค์ประกอบที่วางตรงบนพื้นนั้น (ไม่มีกล่องขาวของตัวเองอีกชั้น) ต้องใช้สีอ่อน
            // text-text/text-text-sub เท่านั้น (เช่น dialog "ยังไม่ได้บันทึกข้อมูล" ด้านล่าง)
            className="entrance-animate entrance-delay-1 flex flex-wrap gap-1 rounded-full border border-border bg-white p-1"
            data-testid="contact-segmented-control"
          >
            {PARTNER_TABS.map((pt) => {
              const isActive = partnerFilter === pt;
              return (
                <button
                  key={pt}
                  ref={(el) => {
                    tabRefs.current[pt] = el;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => handlePartnerFilterChange(pt)}
                  className={`btn-press rounded-full px-4 py-2 text-sm font-medium transition-colors duration-[220ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                    isActive ? 'bg-primary text-white shadow-sm' : 'text-gray-500 hover:text-primary'
                  }`}
                  data-testid={`contact-filter-${pt}`}
                >
                  {pt === 'all' ? `ทั้งหมด (${counts.all})` : pt === 'customer' ? `ลูกค้า (${counts.customer})` : `ผู้จัดจำหน่าย (${counts.vendor})`}
                </button>
              );
            })}
          </div>

          <div
            className="entrance-animate entrance-delay-2 flex flex-wrap gap-2"
            data-testid="contact-toolbar-actions"
          >
            <div className="relative">
              <Search
                size={18}
                className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-gray-400"
                aria-hidden="true"
              />
              <input
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="ค้นหารหัส / ชื่อ / เลขผู้เสียภาษี / เบอร์โทร / Email"
                className="focus-ring-primary h-12 w-64 rounded-xl border border-border bg-white pr-4 pl-10 text-sm text-gray-800 placeholder:text-gray-400"
                data-testid="contact-search-input"
              />
            </div>
            <button
              onClick={() => {
                setShowImportPanel(true);
                closeModal();
              }}
              className="btn-press h-12 rounded-[10px] border border-border bg-white px-4 text-sm font-medium text-gray-700 hover:bg-page-bg"
              data-testid="open-contact-import-panel"
            >
              นำเข้าจาก Excel
            </button>
            <button
              onClick={handleExportExcel}
              disabled={visibleContacts.length === 0}
              className="btn-press h-12 rounded-[10px] border border-border bg-white px-4 text-sm font-medium text-gray-700 hover:bg-page-bg disabled:opacity-50"
              data-testid="export-contacts-excel"
            >
              ส่งออก Excel
            </button>
            <button
              onClick={openAddModal}
              className="btn-press h-12 rounded-[10px] bg-primary px-4 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover"
              data-testid="open-add-contact"
            >
              + เพิ่มรายชื่อ
            </button>
          </div>
        </div>
      </div>

      {showImportPanel && (
        <div className="card-surface mb-8 rounded-2xl p-6">
          <h2 className="mb-4 text-sm font-bold text-text">นำเข้ารายชื่อจาก Excel</h2>
          <ContactImportPanel
            onImport={handleImportRows}
            onClose={() => setShowImportPanel(false)}
            existingContacts={contacts}
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
        // wrapper รอบตาราง+pagination ทั้งก้อน — ทำ 2 หน้าที่: (1) entrance-animate/-delay-3 (staggered
        // entrance ตอนเปิดหน้าครั้งแรก) (2) เป้าหมายของ table-filter-transition (dip animation ตอนเปลี่ยน
        // Segmented Control — ดู handlePartnerFilterChange/tableWrapperRef) ไม่แตะ thead/tbody ข้างใน
        // ContactTable เลยสักนิด (ครอบทั้งก้อนจากข้างนอก) จึง Header ตารางไม่มีทางหายระหว่าง transition
        <div
          ref={tableWrapperRef}
          className="entrance-animate entrance-delay-3"
          data-testid="contact-table-wrapper"
        >
          <ContactTable
            contacts={paginatedContacts}
            onView={openViewModal}
            onEdit={openEditModal}
            onToggleStatus={handleToggleStatus}
            onDelete={handleDelete}
          />

          {visibleContacts.length > 0 && (
            <div className="mt-4 flex items-center justify-between gap-3" data-testid="contact-pagination">
              <p className="text-xs text-text-sub">
                แสดง {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, visibleContacts.length)} จาก{' '}
                {visibleContacts.length} รายการ
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage(safePage - 1)}
                  className="btn-press rounded-[10px] border border-border bg-white px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-page-bg disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="contact-pagination-prev"
                >
                  ก่อนหน้า
                </button>
                <span className="text-xs text-text-sub" data-testid="contact-pagination-page-indicator">
                  หน้า {safePage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage(safePage + 1)}
                  className="btn-press rounded-[10px] border border-border bg-white px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-page-bg disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="contact-pagination-next"
                >
                  ถัดไป
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {modalMode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40"
          onClick={attemptClose}
          data-testid="contact-form-modal"
          role="dialog"
          aria-modal="true"
          aria-label={modalTitle}
        >
          <div
            ref={modalCardRef}
            data-testid="contact-form-modal-card"
            className="card-surface card-surface-modal flex max-h-[calc(100vh-24px)] w-[calc(100%-24px)] flex-col overflow-hidden rounded-2xl bg-white md:max-h-[calc(100vh-48px)] md:w-[calc(100%-48px)] md:max-w-[900px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="sticky top-0 z-10 flex flex-none items-start justify-between gap-4 border-b border-border bg-white px-6 py-4 sm:px-7"
              data-testid="contact-modal-header"
            >
              <div>
                <h2 className="text-base font-bold text-gray-800">{modalTitle}</h2>
                <p className="mt-0.5 text-xs text-gray-500">{modalSubtitle}</p>
              </div>
              <button
                type="button"
                onClick={attemptClose}
                className="rounded-md p-1 text-gray-500 transition-colors duration-[250ms] hover:bg-primary-light"
                aria-label="ปิด"
                data-testid="close-contact-modal"
              >
                <X size={20} />
              </button>
            </div>

            <div ref={formWrapperRef} className="flex min-h-0 flex-1 flex-col">
              <ContactForm
                key={selectedContact?.id ?? 'new'}
                editingContact={selectedContact}
                existingContacts={contacts}
                readOnly={modalMode === 'view'}
                onSubmit={handleFormSubmit}
                onCancel={attemptClose}
                onRequestEdit={modalMode === 'view' ? () => setModalMode('edit') : undefined}
                onDirtyChange={setFormDirty}
              />
            </div>
          </div>
        </div>
      )}

      {showDiscardConfirm && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowDiscardConfirm(false)}
          data-testid="discard-confirm-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="ยืนยันการปิดโดยไม่บันทึก"
        >
          <div
            ref={discardDialogRef}
            className="card-surface card-surface-modal w-full max-w-sm rounded-2xl bg-white p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-text">ยังไม่ได้บันทึกข้อมูล</h3>
            <p className="mt-2 text-sm text-text-sub">
              คุณมีการเปลี่ยนแปลงข้อมูลที่ยังไม่ได้บันทึก หากปิดตอนนี้ข้อมูลที่กรอกไว้จะหายไป ต้องการปิดโดยไม่บันทึกใช่หรือไม่?
            </p>
            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowDiscardConfirm(false)}
                className="btn-press rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-gray-500 hover:bg-page-bg"
                data-testid="discard-confirm-cancel"
              >
                กลับไปแก้ไขต่อ
              </button>
              <button
                type="button"
                onClick={closeModal}
                className="btn-press rounded-[10px] bg-danger px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-danger/90"
                data-testid="discard-confirm-ok"
              >
                ปิดโดยไม่บันทึก
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
