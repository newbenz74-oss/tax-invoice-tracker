'use client';

import { useState } from 'react';
import { AlertTriangle, Calculator, X } from 'lucide-react';
import { RECALCULATE_MODE_LABELS, type RecalculateMode } from '@/types/bankReconcileSession';

interface BankReconcileRecalculateDialogProps {
  onConfirm: (mode: RecalculateMode) => void;
  onClose: () => void;
}

const MODE_DESCRIPTIONS: Record<RecalculateMode, string> = {
  unmatched_only: 'คำนวณจับคู่อัตโนมัติใหม่เฉพาะรายการ Bank/GL ที่ยังไม่ได้จับคู่เท่านั้น — รายการที่ยืนยันแล้ว (ทั้งอัตโนมัติและด้วยตนเอง) จะไม่เปลี่ยนแปลง',
  all_keep_manual: 'คำนวณข้อเสนอแนะการจับคู่อัตโนมัติใหม่ทั้งหมด แต่ยังคงเก็บรายการที่ยืนยันด้วยตนเอง (Manual Match) ไว้เหมือนเดิมทุกรายการ',
  clear_and_recalculate_all: 'ล้างผลการจับคู่ทั้งหมดที่มีอยู่ (รวมถึง Manual Match ที่ยืนยันไว้แล้ว) แล้วคำนวณจับคู่อัตโนมัติใหม่ทั้งหมดตั้งแต่ต้น',
};

/**
 * Dialog "คำนวณใหม่" (สเปกส่วน "8. OPEN EXISTING SESSION") — เปิดจากปุ่ม "คำนวณใหม่" ตอนดูรอบกระทบยอดที่บันทึก
 * ไว้แล้ว (ระบบไม่รันจับคู่อัตโนมัติซ้ำอัตโนมัติเมื่อเปิด session เดิมที่มีผลอยู่แล้วตามสเปกตรงๆ — ต้องกดปุ่มนี้
 * เอง) แสดงคำเตือนว่าข้อเสนอแนะอาจเปลี่ยนแปลงเสมอ (ไม่ว่าจะเลือกโหมดไหน) ให้เลือก 1 ใน 3 โหมดตามสเปกเป๊ะ — โหมด
 * สุดท้าย "ล้างผลเดิมและคำนวณใหม่ทั้งหมด" ต้องมี strong confirmation เพิ่มเติมตามสเปกตรงๆ ("requires strong
 * confirmation") จึงบังคับกาช่องยืนยันเพิ่มอีกขั้นเฉพาะโหมดนี้เท่านั้นก่อนปุ่มยืนยันจะกดได้ (อีก 2 โหมดกดยืนยัน
 * ได้ทันทีเพราะไม่ทำลายข้อมูลที่ยืนยันด้วยตนเองไว้แล้ว)
 */
export default function BankReconcileRecalculateDialog({ onConfirm, onClose }: BankReconcileRecalculateDialogProps) {
  const [mode, setMode] = useState<RecalculateMode>('unmatched_only');
  const [strongConfirmChecked, setStrongConfirmChecked] = useState(false);

  const needsStrongConfirm = mode === 'clear_and_recalculate_all';
  const canConfirm = !needsStrongConfirm || strongConfirmChecked;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="คำนวณใหม่"
      data-testid="recalculate-dialog"
    >
      <div
        className="card-surface max-h-[calc(100vh-24px)] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Calculator size={18} aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-base font-bold text-text">คำนวณใหม่</h3>
              <p className="mt-0.5 text-sm text-text-sub">ข้อเสนอแนะการจับคู่อัตโนมัติอาจเปลี่ยนแปลงหลังคำนวณใหม่</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-text-sub hover:bg-page-bg"
            aria-label="ปิด"
            data-testid="recalculate-close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-2.5" role="radiogroup" aria-label="เลือกรูปแบบการคำนวณใหม่">
          {(Object.keys(RECALCULATE_MODE_LABELS) as RecalculateMode[]).map((m) => (
            <label
              key={m}
              className={`flex cursor-pointer flex-col gap-1 rounded-xl border p-3.5 text-sm transition-colors ${
                mode === m ? 'border-primary bg-primary/5' : 'border-border bg-white hover:bg-page-bg'
              }`}
              data-testid={`recalculate-option-${m}`}
            >
              <span className="flex items-center gap-2 font-semibold text-text">
                <input
                  type="radio"
                  name="recalculate-mode"
                  checked={mode === m}
                  onChange={() => {
                    setMode(m);
                    setStrongConfirmChecked(false);
                  }}
                  className="h-4 w-4 accent-primary"
                  data-testid={`recalculate-radio-${m}`}
                />
                {RECALCULATE_MODE_LABELS[m]}
              </span>
              <span className="pl-6 text-xs text-text-sub">{MODE_DESCRIPTIONS[m]}</span>
            </label>
          ))}
        </div>

        {needsStrongConfirm && (
          <div className="mt-3 rounded-xl border border-danger/30 bg-danger/5 p-3.5" data-testid="recalculate-strong-confirm-box">
            <p className="flex items-center gap-2 text-sm font-semibold text-danger">
              <AlertTriangle size={16} aria-hidden="true" />
              คำเตือน: การจับคู่ด้วยตนเองที่ยืนยันไว้แล้วทั้งหมดจะถูกล้างทิ้ง
            </p>
            <label className="mt-2 flex items-start gap-2 text-sm text-danger">
              <input
                type="checkbox"
                checked={strongConfirmChecked}
                onChange={(e) => setStrongConfirmChecked(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-danger"
                data-testid="recalculate-strong-confirm-checkbox"
              />
              ฉันเข้าใจและต้องการล้างผลการจับคู่เดิมทั้งหมดเพื่อคำนวณใหม่
            </label>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="btn-press rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-text-sub hover:bg-page-bg"
            data-testid="recalculate-cancel"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={() => onConfirm(mode)}
            className={`btn-press rounded-[10px] px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50 ${
              needsStrongConfirm ? 'bg-danger hover:bg-danger/90' : 'bg-primary hover:bg-primary-hover'
            }`}
            data-testid="recalculate-confirm"
          >
            คำนวณใหม่
          </button>
        </div>
      </div>
    </div>
  );
}
