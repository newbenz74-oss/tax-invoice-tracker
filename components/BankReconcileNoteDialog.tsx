'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

interface BankReconcileNoteDialogProps {
  /** ข้อความหัวเรื่อง — "เพิ่มหมายเหตุ" หรือ "แก้ไขหมายเหตุ" แล้วแต่ว่ามีหมายเหตุเดิมอยู่แล้วหรือไม่ */
  title: string;
  /** บรรทัดบริบทใต้หัวเรื่อง เช่น รายละเอียด Bank ของแถวที่กำลังแก้ไข */
  subtitle: string;
  initialNote: string;
  onSave: (note: string) => void;
  onClose: () => void;
}

/**
 * Modal เล็กสำหรับเพิ่ม/แก้ไขหมายเหตุ (เฟส 3 ส่วน "8. NOTES") — ใช้ร่วมกันทั้งหมายเหตุรายแถว (RowNote ก่อนจับคู่)
 * และหมายเหตุของกลุ่มจับคู่ด้วยตนเอง (MatchGroup.note ผ่านปุ่ม "แก้ไขหมายเหตุ" ใน Group Detail Drawer) —
 * component นี้ไม่รู้ว่าจะบันทึกไปที่ไหน แค่ส่งข้อความสุดท้ายกลับผ่าน onSave ให้ผู้เรียกตัดสินใจเอง มิเรอร์สไตล์
 * modal เดียวกับ BankReconcileDetailDrawer/BankReconcileCandidatesModal ของเฟส 2 ทุกประการ (ไม่สร้าง pattern
 * ใหม่) — ใช้ textarea ธรรมดา ไม่มี rich text ตามที่สเปกไม่ได้เรียกร้องอะไรเพิ่มเติม
 */
export default function BankReconcileNoteDialog({ title, subtitle, initialNote, onSave, onClose }: BankReconcileNoteDialogProps) {
  const [note, setNote] = useState(initialNote);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="note-dialog"
    >
      <div
        className="card-surface w-full max-w-md rounded-2xl bg-white p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-text">{title}</h3>
            <p className="mt-0.5 text-sm text-text-sub">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-text-sub hover:bg-page-bg"
            aria-label="ปิด"
            data-testid="note-dialog-close"
          >
            <X size={18} />
          </button>
        </div>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-text">หมายเหตุ</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            placeholder="ระบุหมายเหตุ..."
            className="focus-ring-primary rounded-[10px] border border-border bg-white px-3 py-2.5 text-sm text-text"
            data-testid="note-dialog-input"
            autoFocus
          />
        </label>

        <div className="mt-6 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="btn-press rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-text-sub hover:bg-page-bg"
            data-testid="note-dialog-cancel"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={() => onSave(note)}
            className="btn-press rounded-[10px] bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover"
            data-testid="note-dialog-save"
          >
            บันทึกหมายเหตุ
          </button>
        </div>
      </div>
    </div>
  );
}
