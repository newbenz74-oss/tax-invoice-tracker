'use client';

import { useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import type { ReconcileSession } from '@/types/bankReconcileSession';

interface BankReconcileReopenDialogProps {
  session: ReconcileSession;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

/**
 * Dialog "เปิดรอบใหม่เพื่อแก้ไข" (สเปกส่วน "11. REOPEN COMPLETED SESSION") — "Require reason + confirmation"
 * ตรงๆ: บังคับกรอกเหตุผลก่อนกดยืนยันเสมอ (ปุ่มยืนยันถูก disable จนกว่าจะกรอก) แสดงข้อมูลการปิดรอบเดิมไว้ให้เห็น
 * ชัดเจนก่อนตัดสินใจ (ผู้ปิดรอบ/วันที่/หมายเหตุเดิม) เพื่อเป็น "strong confirmation" ตามสเปก — ข้อมูลการปิดรอบ
 * เดิมเหล่านี้จะไม่ถูกเขียนทับ/ลบทิ้งเมื่อเปิดใหม่ (ดู reopenReconcileSession ใน lib/bankReconcileSessionApi.ts
 * ที่ preserve completed_by/completed_at/completion_note เดิมไว้ทั้งหมดเสมอ ตามสเปก "Never silently overwrite
 * completed history") จึงแสดงคำอธิบายนี้ไว้ในกล่องเตือนของ dialog ด้วยเพื่อให้ผู้ใช้มั่นใจก่อนกดยืนยัน
 */
export default function BankReconcileReopenDialog({ session, onConfirm, onClose }: BankReconcileReopenDialogProps) {
  const [reason, setReason] = useState('');
  const canConfirm = reason.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="เปิดรอบใหม่เพื่อแก้ไข"
      data-testid="reopen-session-dialog"
    >
      <div className="card-surface w-full max-w-lg rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
              <RotateCcw size={18} aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-base font-bold text-text">เปิดรอบใหม่เพื่อแก้ไข</h3>
              <p className="mt-0.5 text-sm text-text-sub">รอบกระทบยอดนี้ปิดเรียบร้อยแล้ว การเปิดใหม่จะทำให้แก้ไขข้อมูลได้อีกครั้ง</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-text-sub hover:bg-page-bg"
            aria-label="ปิด"
            data-testid="reopen-session-close"
          >
            <X size={18} />
          </button>
        </div>

        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-xl border border-border bg-page-bg p-3.5 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-text-sub">ผู้ปิดรอบเดิม</dt>
            <dd className="mt-0.5 font-medium text-text">{session.completed_by_email ?? '-'}</dd>
          </div>
          <div>
            <dt className="text-xs text-text-sub">วันที่ปิดรอบเดิม</dt>
            <dd className="mt-0.5 font-medium text-text">{session.completed_at ? new Date(session.completed_at).toLocaleString('th-TH') : '-'}</dd>
          </div>
          {session.completion_note && (
            <div className="sm:col-span-2">
              <dt className="text-xs text-text-sub">หมายเหตุการปิดรอบเดิม</dt>
              <dd className="mt-0.5 font-medium text-text">{session.completion_note}</dd>
            </div>
          )}
        </dl>
        <p className="mt-2 text-xs text-text-sub">
          ประวัติการปิดรอบเดิมทั้งหมดจะยังถูกเก็บไว้ครบถ้วน ไม่ถูกลบหรือเขียนทับ — ระบบจะบันทึกการเปิดรอบใหม่นี้เป็นประวัติเพิ่มเติมเท่านั้น
        </p>

        <label className="mt-4 flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-text">
            เหตุผลที่เปิดรอบใหม่ <span className="text-danger">*</span>
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="ระบุเหตุผลที่ต้องการเปิดรอบนี้ขึ้นมาแก้ไขอีกครั้ง"
            className="focus-ring-primary rounded-[10px] border border-border bg-white px-3 py-2.5 text-sm text-text"
            data-testid="reopen-session-reason-input"
            autoFocus
          />
        </label>

        <div className="mt-6 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="btn-press rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-text-sub hover:bg-page-bg"
            data-testid="reopen-session-cancel"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={() => onConfirm(reason.trim())}
            className="btn-press rounded-[10px] bg-warning px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-warning/90 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="reopen-session-confirm"
          >
            ยืนยันเปิดรอบใหม่
          </button>
        </div>
      </div>
    </div>
  );
}
