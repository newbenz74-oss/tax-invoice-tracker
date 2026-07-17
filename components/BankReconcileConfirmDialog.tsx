'use client';

import { AlertTriangle, HelpCircle, X } from 'lucide-react';
import type { ReactNode } from 'react';

interface BankReconcileConfirmDialogProps {
  /** ใช้ต่อท้าย data-testid ของทุก element ในนี้ (เช่น "cancel-session" -> "cancel-session-dialog",
   * "cancel-session-confirm") เพื่อให้แต่ละจุดที่เรียก dialog ทั่วไปนี้ (ยกเลิกรอบ/ลบรอบ/แจ้งเตือนออกจากหน้า
   * โดยไม่บันทึก/ยืนยันคำนวณใหม่แบบล้างข้อมูลเดิม ฯลฯ) มี data-testid ที่ไม่ชนกันเอง ทดสอบแยกจุดได้ชัดเจน */
  testIdPrefix: string;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** true = ปุ่มยืนยันเป็นสีแดง (bg-danger) ใช้กับแอ็กชันที่ทำลาย/ย้อนกลับไม่ได้ (ลบ, ยกเลิก, ล้างข้อมูลเดิม)
   * false = ปุ่มยืนยันเป็นสีน้ำเงินหลัก (bg-primary) ใช้กับแอ็กชันทั่วไปที่แค่ต้องการันตีว่าผู้ใช้ตั้งใจจริง */
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Dialog ยืนยัน 2 ปุ่ม (ยกเลิก/ยืนยัน) แบบทั่วไป — เพิ่มเข้ามาสำหรับเฟส 4 เพื่อใช้ซ้ำกับหลายจุดที่สเปกต้องการแค่
 * "ยืนยันก่อนทำ" ธรรมดาไม่มีฟอร์มอะไรเพิ่มเติม (ต่างจาก BankReconcileUndoConfirmDialog ของเฟส 3 ที่ต้องแสดง
 * รายการ Bank/GL ประกอบด้วยเสมอ จึงไม่ใช้ตัวนี้แทน): แจ้งเตือน "มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก" (สเปกส่วน "5.
 * UNSAVED CHANGES PROTECTION"), ยืนยันยกเลิกรอบ/ลบรอบ (ส่วน "6. SESSION LIST PAGE"), ยืนยันขั้นตอนสุดท้ายของ
 * "ล้างผลเดิมและคำนวณใหม่ทั้งหมด" (ส่วน "8. OPEN EXISTING SESSION" — ต้องการ "strong confirmation") มิเรอร์
 * สไตล์ modal เดียวกับ BankReconcileUndoConfirmDialog ทุกประการ (overlay + card-surface + header ไอคอน+ปุ่มปิด
 * + ปุ่มยกเลิก/ยืนยันมุมขวาล่าง) เพื่อความสม่ำเสมอของ UI ทั้งฟีเจอร์
 */
export default function BankReconcileConfirmDialog({
  testIdPrefix,
  title,
  message,
  confirmLabel,
  cancelLabel = 'ยกเลิก',
  danger = false,
  onConfirm,
  onClose,
}: BankReconcileConfirmDialogProps) {
  const Icon = danger ? AlertTriangle : HelpCircle;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid={`${testIdPrefix}-dialog`}
    >
      <div className="card-surface w-full max-w-md rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                danger ? 'bg-danger/15 text-danger' : 'bg-primary/15 text-primary'
              }`}
            >
              <Icon size={18} aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-base font-bold text-text">{title}</h3>
              <div className="mt-0.5 text-sm text-text-sub">{message}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-text-sub hover:bg-page-bg"
            aria-label="ปิด"
            data-testid={`${testIdPrefix}-close`}
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-6 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="btn-press rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-text-sub hover:bg-page-bg"
            data-testid={`${testIdPrefix}-cancel`}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`btn-press rounded-[10px] px-4 py-2.5 text-sm font-semibold text-white shadow-sm ${
              danger ? 'bg-danger hover:bg-danger/90' : 'bg-primary hover:bg-primary-hover'
            }`}
            data-testid={`${testIdPrefix}-confirm`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
