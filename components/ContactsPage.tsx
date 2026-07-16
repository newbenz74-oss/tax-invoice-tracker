'use client';

import { useMemo, useState } from 'react';
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

// หน้า "สมุดรายชื่อ" (ข้อมูลหลัก / Master Data) — ตารางใหม่ business_partners ไม่เกี่ยวข้องกับ
// pending_tax_invoices เลย ใช้ SWR key แยกต่างหาก (CONTACTS_SWR_KEY) จึงไม่แชร์ cache หรือกระทบการ
// โหลดข้อมูลของหน้า "บันทึกค่าใช้จ่าย"/"รายงานภาษีซื้อ" แต่อย่างใด — โครงสร้างหน้าเลียนแบบ
// ExpenseRecordContent (app/dashboard/page.tsx) และ PurchaseTaxReport.tsx: Segmented Control +
// ค้นหา + ปุ่ม action ด้านบน, ตาราง + pagination ด้านล่าง ต่างกันตรงฟอร์มเพิ่ม/แก้ไข/ดูรายละเอียดใช้
// Modal overlay จริง (ตามสเปกที่ระบุ "Modal หรือ Drawer") แทนการขยายแบบ inline card เหมือนฟอร์มใบกำกับภาษี
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

  const [modalMode, setModalMode] = useState<'add' | 'edit' | 'view' | null>(null);
  const [selectedContact, setSelectedContact] = useState<BusinessPartner | null>(null);
  const [showImportPanel, setShowImportPanel] = useState(false);

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

  function closeModal() {
    setModalMode(null);
    setSelectedContact(null);
  }

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

  const modalTitle = modalMode === 'view' ? 'รายละเอียดรายชื่อ' : modalMode === 'edit' ? 'แก้ไขรายชื่อ' : 'เพิ่มรายชื่อใหม่';

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
              onClick={() => {
                setSelectedContact(null);
                setModalMode('add');
                setShowImportPanel(false);
              }}
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
            onView={(c) => {
              setSelectedContact(c);
              setModalMode('view');
            }}
            onEdit={(c) => {
              setSelectedContact(c);
              setModalMode('edit');
            }}
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
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 py-8 sm:items-center"
          onClick={closeModal}
          data-testid="contact-form-modal"
          role="dialog"
          aria-modal="true"
          aria-label={modalTitle}
        >
          <div
            className="card-surface w-full max-w-3xl rounded-2xl bg-white p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold text-text">{modalTitle}</h2>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-md p-1 text-text-sub transition-colors duration-[250ms] hover:bg-primary-light"
                aria-label="ปิด"
              >
                <X size={20} />
              </button>
            </div>
            <ContactForm
              key={selectedContact?.id ?? 'new'}
              editingContact={selectedContact}
              existingContacts={contacts}
              readOnly={modalMode === 'view'}
              onSubmit={handleFormSubmit}
              onCancel={closeModal}
              onRequestEdit={modalMode === 'view' ? () => setModalMode('edit') : undefined}
            />
          </div>
        </div>
      )}
    </main>
  );
}
