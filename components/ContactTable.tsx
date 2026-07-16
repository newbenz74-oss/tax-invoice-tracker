'use client';

import { useState } from 'react';
import { BookUser } from 'lucide-react';
import type { BusinessPartner } from '@/types/contact';
import {
  CONTACT_STATUS_BADGE_CLASS,
  CONTACT_STATUS_LABELS,
  PARTNER_TYPE_BADGE_CLASS,
  PARTNER_TYPE_LABELS,
  formatBranchLabel,
  getContactDisplayName,
} from '@/lib/contactLogic';

interface ContactTableProps {
  contacts: BusinessPartner[];
  onView: (contact: BusinessPartner) => void;
  onEdit: (contact: BusinessPartner) => void;
  onToggleStatus: (contact: BusinessPartner) => Promise<void>;
  onDelete: (contact: BusinessPartner) => Promise<void>;
}

export default function ContactTable({ contacts, onView, onEdit, onToggleStatus, onDelete }: ContactTableProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  // ลบต้องมี Confirmation Dialog ตามสเปก (ไม่ใช่แค่ปุ่มกดสองครั้งแบบ InvoiceTable เดิม) — ใช้ modal
  // แยกต่างหากเพื่อให้ชัดเจนว่าเป็นการกระทำที่ย้อนกลับไม่ได้
  const [deletingContact, setDeletingContact] = useState<BusinessPartner | null>(null);

  async function handleToggleStatus(contact: BusinessPartner) {
    setBusyId(contact.id);
    try {
      await onToggleStatus(contact);
    } finally {
      setBusyId(null);
    }
  }

  async function handleConfirmDelete() {
    if (!deletingContact) return;
    setBusyId(deletingContact.id);
    try {
      await onDelete(deletingContact);
      setDeletingContact(null);
    } finally {
      setBusyId(null);
    }
  }

  if (contacts.length === 0) {
    // Empty State แบบนุ่มนวล — เล่น entrance-animate (fade+slide เบาๆ) ทุกครั้งที่ div นี้ mount ใหม่
    // (เช่นพิมพ์ค้นหาแล้วไม่พบผล หรือกรอง Segmented Control แล้วหมวดนั้นไม่มีรายชื่อเลย) พร้อมไอคอน
    // สมุดรายชื่อ (BookUser — ไอคอนเดียวกับที่ใช้ในเมนู "สมุดรายชื่อ" ของ Sidebar/Header เพื่อความต่อเนื่อง)
    return (
      <div
        className="entrance-animate flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-card-bg p-12 text-center text-sm text-text-sub"
        data-testid="contacts-empty"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-light text-primary">
          <BookUser size={22} aria-hidden="true" />
        </div>
        <p>ไม่พบรายชื่อในหมวดนี้</p>
      </div>
    );
  }

  return (
    <>
      <div className="card-surface overflow-x-auto rounded-2xl">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-table-header">
            <tr>
              <th className="px-[18px] py-[18px] text-left text-xs font-semibold text-text-sub">รหัส</th>
              <th className="px-[18px] py-[18px] text-left text-xs font-semibold text-text-sub">ประเภท</th>
              <th className="px-[18px] py-[18px] text-left text-xs font-semibold text-text-sub">ชื่อ/ชื่อบริษัท</th>
              <th className="px-[18px] py-[18px] text-left text-xs font-semibold text-text-sub">เลขประจำตัวผู้เสียภาษี</th>
              <th className="px-[18px] py-[18px] text-left text-xs font-semibold text-text-sub">สาขา</th>
              <th className="px-[18px] py-[18px] text-left text-xs font-semibold text-text-sub">เบอร์โทรศัพท์</th>
              <th className="px-[18px] py-[18px] text-left text-xs font-semibold text-text-sub">Email</th>
              <th className="px-[18px] py-[18px] text-left text-xs font-semibold text-text-sub">จังหวัด</th>
              <th className="px-[18px] py-[18px] text-left text-xs font-semibold text-text-sub">สถานะ</th>
              <th className="px-[18px] py-[18px] text-right text-xs font-semibold text-text-sub">การจัดการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {contacts.map((contact, index) => {
              const isBusy = busyId === contact.id;
              return (
                <tr
                  key={contact.id}
                  data-testid={`contact-row-${contact.id}`}
                  className={`transition-colors duration-150 hover:bg-table-row-hover ${
                    index % 2 === 1 ? 'bg-table-row-zebra' : ''
                  }`}
                >
                  <td className="font-numeric px-[18px] py-[18px] font-medium text-text">{contact.contact_code}</td>
                  <td className="px-[18px] py-[18px]">
                    <span
                      className={`inline-block w-fit rounded-full px-3.5 py-2 text-xs font-medium ${PARTNER_TYPE_BADGE_CLASS[contact.partner_type]}`}
                      data-testid={`partner-type-badge-${contact.id}`}
                    >
                      {PARTNER_TYPE_LABELS[contact.partner_type]}
                    </span>
                  </td>
                  <td className="px-[18px] py-[18px] text-text">{getContactDisplayName(contact)}</td>
                  <td className="font-numeric px-[18px] py-[18px] text-text-sub">{contact.tax_id || '-'}</td>
                  <td className="px-[18px] py-[18px] text-text-sub">{formatBranchLabel(contact)}</td>
                  <td className="font-numeric px-[18px] py-[18px] text-text-sub">{contact.phone || '-'}</td>
                  <td className="px-[18px] py-[18px] text-text-sub">{contact.email || '-'}</td>
                  <td className="px-[18px] py-[18px] text-text-sub">{contact.province || '-'}</td>
                  <td className="px-[18px] py-[18px]">
                    <span
                      className={`inline-block w-fit rounded-full px-3.5 py-2 text-xs font-medium ${CONTACT_STATUS_BADGE_CLASS[contact.status]}`}
                      data-testid={`status-badge-${contact.id}`}
                    >
                      {CONTACT_STATUS_LABELS[contact.status]}
                    </span>
                  </td>
                  <td className="px-[18px] py-[18px]">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => onView(contact)}
                        className="btn-press rounded-[10px] border border-border px-2 py-1 text-xs font-medium text-text-sub hover:bg-page-bg"
                        data-testid={`view-${contact.id}`}
                      >
                        ดูรายละเอียด
                      </button>
                      <button
                        type="button"
                        onClick={() => onEdit(contact)}
                        className="btn-press rounded-[10px] border border-border px-2 py-1 text-xs font-medium text-text-sub hover:bg-page-bg"
                        data-testid={`edit-${contact.id}`}
                      >
                        แก้ไข
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleToggleStatus(contact)}
                        className="btn-press rounded-[10px] border border-border px-2 py-1 text-xs font-medium text-text-sub hover:bg-page-bg disabled:opacity-50"
                        data-testid={`toggle-status-${contact.id}`}
                      >
                        {contact.status === 'active' ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingContact(contact)}
                        className="btn-press rounded-[10px] border border-danger/40 px-2 py-1 text-xs font-medium text-danger hover:bg-danger/10"
                        data-testid={`delete-${contact.id}`}
                      >
                        ลบ
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {deletingContact && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          data-testid="delete-confirm-dialog"
          onClick={() => setDeletingContact(null)}
          role="dialog"
          aria-modal="true"
          aria-label="ยืนยันการลบรายชื่อ"
        >
          <div className="card-surface w-full max-w-sm rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-text">ยืนยันการลบรายชื่อ</h3>
            <p className="mt-2 text-sm text-text-sub">
              ต้องการลบ &quot;{getContactDisplayName(deletingContact)}&quot; ({deletingContact.contact_code}) ใช่หรือไม่?
              การลบไม่สามารถย้อนกลับได้
            </p>
            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setDeletingContact(null)}
                className="btn-press rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-text-sub hover:bg-page-bg"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={busyId === deletingContact.id}
                onClick={handleConfirmDelete}
                className="btn-press rounded-[10px] bg-danger px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-danger/90 disabled:opacity-60"
                data-testid="confirm-delete"
              >
                {busyId === deletingContact.id ? 'กำลังลบ...' : 'ลบรายชื่อ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
