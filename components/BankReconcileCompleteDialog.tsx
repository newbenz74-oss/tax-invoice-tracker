'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Lock, X } from 'lucide-react';
import type { CompletionValidationResult } from '@/types/bankReconcileSession';

interface BankReconcileCompleteDialogProps {
  validation: CompletionValidationResult;
  onConfirm: (completionNote: string | null) => void;
  onClose: () => void;
}

/**
 * Dialog "ปิดรอบกระทบยอด" (สเปกส่วน "9. COMPLETION VALIDATION") — รับผล validateSessionCompletion() ที่
 * orchestrator คำนวณไว้แล้วตรงๆ (ไม่คำนวณเองในนี้ ให้ lib/bankReconcileKpi.ts เป็นแหล่งความจริงเดียวของกฎ
 * ตรวจสอบทั้งหมด) แบ่งการแสดงผลเป็น 2 ระดับตามสเปกตรงๆ: blockingErrors (แสดงแล้ว "ปิดรอบไม่ได้เด็ดขาด" — ปุ่ม
 * ยืนยันถูก disable ทั้งหมด ต้องกลับไปแก้ก่อน) กับ warnings (แสดงแล้วยังปิดรอบได้ แต่ต้องกดยืนยันซ้ำ ตรงกับ
 * ตัวอย่างข้อความสเปกเป๊ะ: "ยังมีรายการไม่พบใน GL จำนวน N รายการ และรายการ GL ไม่พบใน Bank จำนวน N รายการ
 * ต้องการปิดรอบกระทบยอดหรือไม่") หมายเหตุการปิดรอบบังคับกรอกเมื่อ requiresNote=true เท่านั้น (ผลต่าง≠0/มีรายการ
 * ค้าง/มีรายการรอตรวจสอบ) — ปุ่มยืนยันของ dialog นี้ตรวจสอบเงื่อนไขนี้เองก่อนเรียก onConfirm เสมอ (แสดง error
 * ข้อความแทนการปิด dialog เงียบๆ ถ้ายังไม่กรอก)
 */
export default function BankReconcileCompleteDialog({ validation, onConfirm, onClose }: BankReconcileCompleteDialogProps) {
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState(false);

  function handleConfirmClick() {
    if (validation.requiresNote && !note.trim()) {
      setNoteError(true);
      return;
    }
    onConfirm(note.trim() || null);
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="ปิดรอบกระทบยอด"
      data-testid="complete-session-dialog"
    >
      <div
        className="card-surface max-h-[calc(100vh-24px)] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Lock size={18} aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-base font-bold text-text">ปิดรอบกระทบยอด</h3>
              <p className="mt-0.5 text-sm text-text-sub">ตรวจสอบความพร้อมก่อนปิดรอบกระทบยอดนี้</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-text-sub hover:bg-page-bg"
            aria-label="ปิด"
            data-testid="complete-session-close"
          >
            <X size={18} />
          </button>
        </div>

        {validation.blockingErrors.length > 0 && (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3.5" data-testid="complete-session-blocking-errors">
            <p className="flex items-center gap-2 text-sm font-semibold text-danger">
              <AlertTriangle size={16} aria-hidden="true" />
              ยังปิดรอบกระทบยอดไม่ได้ — กรุณาแก้ไขก่อน
            </p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-danger">
              {validation.blockingErrors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {validation.blockingErrors.length === 0 && validation.warnings.length > 0 && (
          <div className="rounded-xl border border-warning/30 bg-warning/10 p-3.5" data-testid="complete-session-warnings">
            <p className="flex items-center gap-2 text-sm font-semibold text-warning">
              <AlertTriangle size={16} aria-hidden="true" />
              {validation.warnings.join(' และ')} ต้องการปิดรอบกระทบยอดหรือไม่
            </p>
          </div>
        )}

        {validation.blockingErrors.length === 0 && validation.warnings.length === 0 && (
          <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 p-3.5 text-sm font-medium text-success" data-testid="complete-session-all-clear">
            <CheckCircle2 size={16} aria-hidden="true" />
            ข้อมูลครบถ้วน พร้อมปิดรอบกระทบยอด
          </div>
        )}

        {validation.blockingErrors.length === 0 && (
          <label className="mt-4 flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-text">
              หมายเหตุการปิดรอบ {validation.requiresNote && <span className="text-danger">*</span>}
            </span>
            <textarea
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                if (e.target.value.trim()) setNoteError(false);
              }}
              rows={3}
              placeholder={validation.requiresNote ? 'จำเป็นต้องระบุ เนื่องจากยังมีผลต่าง/รายการค้าง/รายการรอตรวจสอบ' : 'ระบุหมายเหตุ (ถ้ามี)'}
              className="focus-ring-primary rounded-[10px] border border-border bg-white px-3 py-2.5 text-sm text-text"
              data-testid="complete-session-note-input"
            />
            {noteError && (
              <span className="text-xs text-danger" role="alert" data-testid="complete-session-note-error">
                กรุณาระบุหมายเหตุการปิดรอบก่อนดำเนินการต่อ
              </span>
            )}
          </label>
        )}

        <div className="mt-6 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="btn-press rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-text-sub hover:bg-page-bg"
            data-testid="complete-session-cancel"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={validation.blockingErrors.length > 0}
            onClick={handleConfirmClick}
            className="btn-press rounded-[10px] bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="complete-session-confirm"
          >
            ยืนยันปิดรอบกระทบยอด
          </button>
        </div>
      </div>
    </div>
  );
}
