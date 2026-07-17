'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

interface BankReconcileTextPromptDialogProps {
  testIdPrefix: string;
  title: string;
  subtitle?: string;
  label: string;
  initialValue: string;
  confirmLabel: string;
  onConfirm: (value: string) => void;
  onClose: () => void;
}

/**
 * Dialog ขอข้อความบรรทัดเดียวแบบทั่วไป — ใช้ 2 จุดของเฟส 4: "เปลี่ยนชื่อ" รอบกระทบยอด (สเปกส่วน "6. SESSION
 * LIST PAGE" ปุ่ม "เปลี่ยนชื่อ") และ "ทำสำเนา" (ปุ่ม "ทำสำเนา" — ต้องตั้งชื่อรอบใหม่ก่อนบันทึกเป็น session ใหม่)
 * มิเรอร์ BankReconcileNoteDialog ของเฟส 3 ทุกประการ ต่างแค่ input บรรทัดเดียวแทน textarea — ไม่ validate
 * ความยาว/รูปแบบใดๆ เป็นพิเศษ (แค่ต้องไม่ว่างเปล่า — ปุ่มยืนยันถูก disable ถ้า trim แล้วว่าง)
 */
export default function BankReconcileTextPromptDialog({
  testIdPrefix,
  title,
  subtitle,
  label,
  initialValue,
  confirmLabel,
  onConfirm,
  onClose,
}: BankReconcileTextPromptDialogProps) {
  const [value, setValue] = useState(initialValue);
  const trimmed = value.trim();

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
          <div>
            <h3 className="text-base font-bold text-text">{title}</h3>
            {subtitle && <p className="mt-0.5 text-sm text-text-sub">{subtitle}</p>}
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

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-text">{label}</span>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-3 text-sm text-text"
            data-testid={`${testIdPrefix}-input`}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && trimmed) onConfirm(trimmed);
            }}
          />
        </label>

        <div className="mt-6 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="btn-press rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-text-sub hover:bg-page-bg"
            data-testid={`${testIdPrefix}-cancel`}
          >
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={!trimmed}
            onClick={() => onConfirm(trimmed)}
            className="btn-press rounded-[10px] bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            data-testid={`${testIdPrefix}-confirm`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
