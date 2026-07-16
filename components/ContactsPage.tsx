'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { Search, X } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
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

  const {
    data: contacts = [],
    error: loadErrorObj,
    isLoading: loading,
    mutate,
  } = useSWR<BusinessPartner[]>(session ? CONTACTS_SWR_KEY : null, fetchContacts);
  const loadError = loadErrorObj instanceof Error ? loadErrorObj.message : loadErrorObj ? 'โหลดข้อมูลไม่สำเร็จ' : null;

  const [partnerFilter, setPartnerFilter] = useState<PartnerType | 'all'>('all');
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

  const counts = useMemo(() => computeContactCounts(contacts), [contacts]);

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
    setPartnerFilter(value);
    setPage(1);
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
      await createContact(payload, session?.user?.id ?? null);
    }
    closeModal();
    await mutate();
  }

  async function handleImportRows(rows: ContactImportRow[]) {
    const inputs = rows.map(contactRowToWriteInput);
    await bulkCreateContacts(inputs, session?.user?.id ?? null);
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
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-8">
      <div className="mb-8 flex flex-col gap-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {(['all', 'customer', 'vendor'] as const).map((pt) => (
              <button
                key={pt}
                onClick={() => handlePartnerFilterChange(pt)}
                className={`btn-press rounded-full px-4 py-2 text-sm font-medium transition-colors duration-[250ms] ${
                  partnerFilter === pt
                    ? 'bg-primary text-white shadow-sm'
                    : 'border border-border bg-white text-text-sub hover:bg-page-bg'
                }`}
                data-testid={`contact-filter-${pt}`}
              >
                {pt === 'all' ? `ทั้งหมด (${counts.all})` : pt === 'customer' ? `ลูกค้า (${counts.customer})` : `ผู้จัดจำหน่าย (${counts.vendor})`}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Search
                size={18}
                className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-text-sub"
                aria-hidden="true"
              />
              <input
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="ค้นหารหัส / ชื่อ / เลขผู้เสียภาษี / เบอร์โทร / Email"
                className="focus-ring-primary h-12 w-64 rounded-xl border border-border bg-white pr-4 pl-10 text-sm text-text placeholder:text-text-sub"
                data-testid="contact-search-input"
              />
            </div>
            <button
              onClick={() => {
                setShowImportPanel(true);
                closeModal();
              }}
              className="btn-press h-12 rounded-[10px] border border-border bg-white px-4 text-sm font-medium text-text hover:bg-page-bg"
              data-testid="open-contact-import-panel"
            >
              นำเข้าจาก Excel
            </button>
            <button
              onClick={handleExportExcel}
              disabled={visibleContacts.length === 0}
              className="btn-press h-12 rounded-[10px] border border-border bg-white px-4 text-sm font-medium text-text hover:bg-page-bg disabled:opacity-50"
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
        <>
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
                  className="btn-press rounded-[10px] border border-border bg-white px-3.5 py-2 text-sm font-medium text-text hover:bg-page-bg disabled:cursor-not-allowed disabled:opacity-50"
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
                  className="btn-press rounded-[10px] border border-border bg-white px-3.5 py-2 text-sm font-medium text-text hover:bg-page-bg disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="contact-pagination-next"
                >
                  ถัดไป
                </button>
              </div>
            </div>
          )}
        </>
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
            className="card-surface flex max-h-[calc(100vh-24px)] w-[calc(100%-24px)] flex-col overflow-hidden rounded-2xl bg-white md:max-h-[calc(100vh-48px)] md:w-[calc(100%-48px)] md:max-w-[900px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="sticky top-0 z-10 flex flex-none items-start justify-between gap-4 border-b border-border bg-white px-6 py-4 sm:px-7"
              data-testid="contact-modal-header"
            >
              <div>
                <h2 className="text-base font-bold text-text">{modalTitle}</h2>
                <p className="mt-0.5 text-xs text-text-sub">{modalSubtitle}</p>
              </div>
              <button
                type="button"
                onClick={attemptClose}
                className="rounded-md p-1 text-text-sub transition-colors duration-[250ms] hover:bg-primary-light"
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
            className="card-surface w-full max-w-sm rounded-2xl bg-white p-6"
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
                className="btn-press rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-text-sub hover:bg-page-bg"
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
