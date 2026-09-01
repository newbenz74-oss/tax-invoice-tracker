'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookUser, ChevronDown } from 'lucide-react';
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
  // รวมปุ่ม "ดูรายละเอียด/แก้ไข/เปิด-ปิดใช้งาน/ลบ" เป็นปุ่มเดียว "จัดการ" ที่กดแล้วมีเมนูลอยแสดงตัวเลือกแทน —
  // ปรับให้ตรงกับ pattern ของ InvoiceTable.tsx (หน้า "บันทึกการจ่ายเงิน" ตามคำขอผู้ใช้ 2026-08-14) เดิมโชว์ปุ่ม
  // ทั้ง 4 พร้อมกันทำให้คอลัมน์ดูรก/ล้นบรรทัดในตารางแคบ — คัดลอกโครงสร้าง state/effect มาเป๊ะๆ จากไฟล์นั้น
  const [expandedActionsId, setExpandedActionsId] = useState<string | null>(null);
  // ทิศทางที่เมนู "จัดการ" ที่เปิดอยู่ตอนนี้ควรกางออก (ขึ้น/ลง) — เดิมคำนวณจาก index เทียบกับ contacts.length
  // ("2 แถวสุดท้ายเปิดขึ้นด้านบน") ซึ่งพังทันทีถ้าตารางมีแค่ 1-2 แถว เพราะ "2 แถวสุดท้าย" ก็คือ "ทุกแถว" พอดี
  // ทั้งที่แถวเหล่านั้นอยู่ใกล้ขอบบนจอ (ใต้ thead ทันที) ไม่ใช่ขอบล่าง ทำให้เมนูกางขึ้นแล้วโดนขอบบนจอบัง (แก้
  // 2026-08-26 ตามที่ผู้ใช้แจ้ง — เจอบั๊กเดียวกันนี้ก่อนใน InvoiceTable.tsx แล้ว ดูคอมเมนต์เต็มที่นั่น) เปลี่ยน
  // มาวัดพื้นที่ว่างจริงด้านล่างปุ่มตอนกดเปิดเมนู (ครั้งเดียวตอน onClick ซึ่ง layout นิ่งแล้วแน่นอน ไม่ใช่การวัด
  // ระหว่าง render/transition ที่เคยเจอปัญหาค่าเพี้ยนกับ sliding indicator ใน ContactsPage.tsx)
  const [menuOpensUpward, setMenuOpensUpward] = useState(false);
  // ความสูงโดยประมาณของเมนูเวลามีตัวเลือกครบทุกอัน (ดูรายละเอียด/แก้ไข/เปิด-ปิดใช้งาน/ลบ) เผื่อไว้มากกว่า
  // ความสูงจริงเสมอ ปลอดภัยไว้ก่อน
  const ACTIONS_MENU_MAX_HEIGHT = 200;
  // ตำแหน่งจริงของปุ่ม "จัดการ" ที่กำลังเปิดเมนูอยู่ (มุมบน/ล่าง/ขวา เทียบ viewport) — เพิ่มเข้ามา 2026-08-26
  // (รอบ 2) แก้บั๊กที่ผู้ใช้แจ้งว่าเมนูถูก "กรอบ" ของตารางบังไป แสดงตัวเลือกไม่ครบ — ต้นตอคือ div.card-surface
  // ที่ห่อตารางใช้ overflow-x-auto (จำเป็นสำหรับเลื่อนตารางแนวนอนตอนจอแคบ) แต่ตาม CSS spec ถ้า overflow แกนใด
  // แกนหนึ่งไม่ใช่ visible อีกแกนที่เหลือ (overflow-y ในที่นี้) จะถูกบังคับกลายเป็น auto ไปด้วยเสมอ ทำให้กล่องนี้
  // กลายเป็น scroll container ที่ตัด (clip) เมนู position:absolute ที่กางออกเกินขอบกล่องไปทันที (บั๊กเดียวกับ
  // ที่เจอและแก้ไปแล้วใน InvoiceTable.tsx ดูคอมเมนต์เต็มที่นั่น) — แก้โดย portal เมนูออกไปแปะ document.body ตรงๆ
  // แล้วใช้ position:fixed คำนวณพิกัดจาก getBoundingClientRect() ของปุ่มแทน ไม่ขึ้นกับ overflow ของ ancestor เลย
  const [menuAnchorRect, setMenuAnchorRect] = useState<{ top: number; bottom: number; right: number } | null>(null);

  function handleToggleActionsMenu(e: React.MouseEvent<HTMLButtonElement>, contactId: string) {
    if (expandedActionsId === contactId) {
      setExpandedActionsId(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    setMenuOpensUpward(spaceBelow < ACTIONS_MENU_MAX_HEIGHT);
    setMenuAnchorRect({ top: rect.top, bottom: rect.bottom, right: rect.right });
    setExpandedActionsId(contactId);
  }

  useEffect(() => {
    if (!expandedActionsId) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-row-actions-menu]')) {
        setExpandedActionsId(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [expandedActionsId]);

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

  // แถวที่กำลังเปิดเมนู "จัดการ" อยู่ (ถ้ามี) — ใช้กับเมนูที่ portal ออกไปแปะ document.body ด้านล่าง แทนที่จะ
  // render ซ้อนอยู่ในแถว (ดู menuAnchorRect ด้านบน)
  const expandedContact = expandedActionsId ? (contacts.find((c) => c.id === expandedActionsId) ?? null) : null;

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
                  <td className="whitespace-nowrap px-[18px] py-[18px] text-text">{getContactDisplayName(contact)}</td>
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
                  <td className="px-[18px] py-[18px] text-right">
                    {/* ปุ่มเปิดเมนูเท่านั้น — ตัวเมนูเองย้ายไป portal ที่ document.body แล้ว (ดู expandedContact
                        + menuAnchorRect ด้านบน) ไม่ได้ซ้อนอยู่ในเซลล์นี้อีกต่อไป (แก้บั๊กเมนูโดนกรอบ
                        div.card-surface ตัด) data-row-actions-menu ยังต้องอยู่ที่นี่เหมือนเดิม กันไม่ให้คลิก
                        ปุ่มนี้เองถูกนับเป็น "คลิกนอกเมนู" */}
                    <div data-row-actions-menu>
                      <button
                        type="button"
                        onClick={(e) => handleToggleActionsMenu(e, contact.id)}
                        className="btn-press flex items-center gap-1 rounded-[10px] border border-border px-2.5 py-1.5 text-xs font-medium text-text-sub hover:bg-page-bg"
                        aria-expanded={expandedActionsId === contact.id}
                        data-testid={`manage-actions-${contact.id}`}
                      >
                        จัดการ
                        <ChevronDown
                          size={14}
                          className={`transition-transform duration-200 ${
                            expandedActionsId === contact.id ? 'rotate-180' : ''
                          }`}
                          aria-hidden="true"
                        />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* เมนู "จัดการ" — portal ออกไป document.body ตรงๆ (ดูเหตุผลเต็มที่ menuAnchorRect ด้านบน) แทนที่จะ
          ซ้อนอยู่ในเซลล์ตารางแบบเดิม ใช้ position:fixed คำนวณพิกัดจาก menuAnchorRect ที่จับตอนคลิกปุ่ม —
          เปิดได้ทีละแถวเท่านั้น (expandedActionsId เป็น id เดียว) จึง render แค่ก้อนเดียวพอ */}
      {expandedContact &&
        menuAnchorRect &&
        createPortal(
          <div
            data-row-actions-menu
            className="fixed z-30 w-40 rounded-[10px] border border-border bg-card-bg p-1.5 shadow-lg"
            style={{
              right: window.innerWidth - menuAnchorRect.right,
              ...(menuOpensUpward
                ? { bottom: window.innerHeight - menuAnchorRect.top + 6 }
                : { top: menuAnchorRect.bottom + 6 }),
            }}
          >
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => {
                  setExpandedActionsId(null);
                  onView(expandedContact);
                }}
                className="btn-press w-full rounded-[8px] px-2.5 py-1.5 text-left text-xs font-medium text-text-sub hover:bg-page-bg"
                data-testid={`view-${expandedContact.id}`}
              >
                ดูรายละเอียด
              </button>
              <button
                type="button"
                onClick={() => {
                  setExpandedActionsId(null);
                  onEdit(expandedContact);
                }}
                className="btn-press w-full rounded-[8px] px-2.5 py-1.5 text-left text-xs font-medium text-text-sub hover:bg-page-bg"
                data-testid={`edit-${expandedContact.id}`}
              >
                แก้ไข
              </button>
              <button
                type="button"
                disabled={busyId === expandedContact.id}
                onClick={() => {
                  setExpandedActionsId(null);
                  handleToggleStatus(expandedContact);
                }}
                className="btn-press w-full rounded-[8px] px-2.5 py-1.5 text-left text-xs font-medium text-text-sub hover:bg-page-bg disabled:opacity-50"
                data-testid={`toggle-status-${expandedContact.id}`}
              >
                {expandedContact.status === 'active' ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setExpandedActionsId(null);
                  setDeletingContact(expandedContact);
                }}
                className="btn-press w-full rounded-[8px] px-2.5 py-1.5 text-left text-xs font-medium text-danger hover:bg-danger/10"
                data-testid={`delete-${expandedContact.id}`}
              >
                ลบ
              </button>
            </div>
          </div>,
          document.body
        )}

      {/* ยืนยันการลบ — portal ไป document.body เหมือนกัน (2026-08-26) เพราะเดิมซ้อนอยู่ในต้นไม้ DOM เดียวกับ
          div.entrance-animate ของ ContactsPage.tsx ซึ่งมี fill-mode "both" ค้าง transform ไว้ถาวรหลัง
          animation จบ ทำให้ position:fixed inset-0 ของ modal นี้ถูกตีความเทียบกับกรอบของ wrapper นั้นแทนที่จะ
          เป็น viewport จริง (บั๊กเดียวกับที่เจอและแก้ไปแล้วใน InvoiceTable.tsx ดูคอมเมนต์เต็มที่นั่น) */}
      {deletingContact &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            data-testid="delete-confirm-dialog"
            onClick={() => setDeletingContact(null)}
            role="dialog"
            aria-modal="true"
            aria-label="ยืนยันการลบรายชื่อ"
          >
            {/* การ์ด/โมดัลทั้งระบบเป็นกระจกเข้มเสมอ (card-surface ชนะ bg-white เสมอตาม CSS Cascade Layers — ดู
                คอมเมนต์เต็มใน app/globals.css) จึงใช้สีอ่อน text-text/text-text-sub ให้อ่านออกบนพื้นเข้ม
                (2026-08-12) */}
            <div className="card-surface card-surface-modal w-full max-w-sm rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-base font-bold text-text">ยืนยันการลบรายชื่อ</h3>
              <p className="mt-2 text-sm text-text-sub">
                ต้องการลบ &quot;{getContactDisplayName(deletingContact)}&quot; ({deletingContact.contact_code}) ใช่หรือไม่?
                การลบไม่สามารถย้อนกลับได้
              </p>
              <div className="mt-5 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setDeletingContact(null)}
                  className="btn-press rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-gray-500 hover:bg-page-bg"
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
          </div>,
          document.body
        )}
    </>
  );
}
