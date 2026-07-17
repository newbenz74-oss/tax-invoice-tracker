'use client';

import { useState } from 'react';
import { Save, X } from 'lucide-react';

export interface SaveSessionDialogValues {
  sessionName: string;
  bankName: string;
  bankAccountNo: string;
  periodStart: string;
  periodEnd: string;
}

interface BankReconcileSaveSessionDialogProps {
  initialValues: SaveSessionDialogValues;
  onSave: (values: SaveSessionDialogValues) => void;
  onClose: () => void;
}

/**
 * Dialog กรอกข้อมูลรอบกระทบยอด ก่อนบันทึกครั้งแรก (สเปกส่วน "1. RECONCILIATION SESSION" — "created on or
 * before the user clicks บันทึกรอบกระทบยอด") ถามเฉพาะฟิลด์ที่มีความหมายต่อผู้ใช้โดยตรงเท่านั้น
 * (session_name/bank_name/bank_account_no/period_start/period_end) — ฟิลด์ที่เหลือทั้งหมดของ session
 * (bank_row_count, KPI ต่างๆ, สถานะ, ผู้สร้าง ฯลฯ) คำนวณ/เติมอัตโนมัติเสมอไม่ต้องให้ผู้ใช้กรอกเอง (ดู
 * saveReconcileSession ใน lib/bankReconcileSessionApi.ts) เปิดครั้งเดียวตอน "บันทึกรอบกระทบยอด" ครั้งแรกของ
 * session ใหม่เท่านั้น (sessionId ยังเป็น null) การบันทึกซ้ำ/auto-save ครั้งถัดๆ ไปของ session เดิมไม่เปิด
 * dialog นี้อีก (ใช้ค่าที่กรอกไว้ครั้งแรกต่อไปเรื่อยๆ แก้ไขทีหลังได้ผ่านปุ่ม "เปลี่ยนชื่อ" ในหน้ารายการเท่านั้น
 * ตามสเปกส่วน "6. SESSION LIST PAGE" ที่มีแค่ปุ่มเปลี่ยนชื่อ ไม่มีปุ่มแก้ไขข้อมูล metadata อื่น)
 * ชื่อรอบกระทบยอดเป็นฟิลด์บังคับเดียว (ฟิลด์อื่นเป็น text/date ธรรมดา ไม่บังคับ เพราะสเปกไม่ได้ระบุว่าบังคับ)
 */
export default function BankReconcileSaveSessionDialog({
  initialValues,
  onSave,
  onClose,
}: BankReconcileSaveSessionDialogProps) {
  const [values, setValues] = useState<SaveSessionDialogValues>(initialValues);
  const canSave = values.sessionName.trim().length > 0;

  function update<K extends keyof SaveSessionDialogValues>(key: K, value: SaveSessionDialogValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="บันทึกรอบกระทบยอด"
      data-testid="save-session-dialog"
    >
      <div className="card-surface w-full max-w-lg rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Save size={18} aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-base font-bold text-text">บันทึกรอบกระทบยอด</h3>
              <p className="mt-0.5 text-sm text-text-sub">ตั้งชื่อและระบุข้อมูลของรอบกระทบยอดนี้ (แก้ไขภายหลังได้ผ่านปุ่ม &quot;เปลี่ยนชื่อ&quot;)</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-text-sub hover:bg-page-bg"
            aria-label="ปิด"
            data-testid="save-session-close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
            <span className="font-medium text-text">
              ชื่อรอบกระทบยอด <span className="text-danger">*</span>
            </span>
            <input
              type="text"
              value={values.sessionName}
              onChange={(e) => update('sessionName', e.target.value)}
              placeholder="เช่น กระทบยอดบัญชีกระแสรายวัน กรกฎาคม 2569"
              className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-3 text-sm text-text"
              data-testid="save-session-name-input"
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-text">ธนาคาร</span>
            <input
              type="text"
              value={values.bankName}
              onChange={(e) => update('bankName', e.target.value)}
              className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-3 text-sm text-text"
              data-testid="save-session-bank-name-input"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-text">เลขที่บัญชี</span>
            <input
              type="text"
              value={values.bankAccountNo}
              onChange={(e) => update('bankAccountNo', e.target.value)}
              className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-3 text-sm text-text"
              data-testid="save-session-account-no-input"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-text">วันที่เริ่มต้น</span>
            <input
              type="date"
              value={values.periodStart}
              onChange={(e) => update('periodStart', e.target.value)}
              className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-3 text-sm text-text"
              data-testid="save-session-period-start-input"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-text">วันที่สิ้นสุด</span>
            <input
              type="date"
              value={values.periodEnd}
              onChange={(e) => update('periodEnd', e.target.value)}
              className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-3 text-sm text-text"
              data-testid="save-session-period-end-input"
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="btn-press rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-text-sub hover:bg-page-bg"
            data-testid="save-session-cancel"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => onSave({ ...values, sessionName: values.sessionName.trim() })}
            className="btn-press rounded-[10px] bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="save-session-confirm"
          >
            บันทึกรอบกระทบยอด
          </button>
        </div>
      </div>
    </div>
  );
}
