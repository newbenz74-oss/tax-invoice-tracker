'use client';

import { AlertTriangle, X } from 'lucide-react';
import type { MatchBankRow, MatchGLRow, MatchGroup } from '@/types/bankReconcile';

const THB2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

interface BankReconcileUndoConfirmDialogProps {
  group: MatchGroup;
  bankRows: MatchBankRow[];
  glRows: MatchGLRow[];
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Modal ยืนยันการยกเลิกการจับคู่ด้วยตนเอง (เฟส 3 ส่วน "6. UNDO MATCH") — แสดงรายการ Bank/GL ที่จะถูกยกเลิกครบ
 * ตามสเปกตรงๆ พร้อมคำเตือนว่าแถว GL จะกลับมาใช้ได้อีก ต้องกดยืนยันก่อนเสมอ (ไม่มีทางยกเลิกโดยไม่ตั้งใจ) —
 * เรียกใช้ได้ทั้งจากปุ่ม "ยกเลิกการจับคู่" ในตารางหลักและใน Group Detail Drawer (component เดียวกัน)
 */
export default function BankReconcileUndoConfirmDialog({
  group,
  bankRows,
  glRows,
  onConfirm,
  onClose,
}: BankReconcileUndoConfirmDialogProps) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="ยืนยันการยกเลิกจับคู่"
      data-testid="undo-match-dialog"
    >
      <div
        className="card-surface w-full max-w-lg rounded-2xl bg-white p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger">
              <AlertTriangle size={18} aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-base font-bold text-text">ยืนยันการยกเลิกการจับคู่</h3>
              <p className="mt-0.5 text-sm text-text-sub">
                รายการ GL ที่เกี่ยวข้องจะกลับไปเป็น &quot;ยังไม่ได้จับคู่&quot; และพร้อมให้เลือกจับคู่ใหม่ได้ทันที
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-text-sub hover:bg-page-bg"
            aria-label="ปิด"
            data-testid="undo-match-close"
          >
            <X size={18} />
          </button>
        </div>

        <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-text-sub">รายการ Bank ({bankRows.length})</h4>
        <ul className="space-y-1.5 rounded-xl border border-border bg-page-bg p-3 text-sm">
          {bankRows.map((b) => (
            <li key={b.bank_row_id} className="flex justify-between gap-3">
              <span className="text-text-sub">
                {formatDate(b.bank_date)} · {b.bank_description || '-'}
              </span>
              <span className="font-numeric font-medium text-text">{b.bank_amount.toLocaleString('th-TH', THB2)}</span>
            </li>
          ))}
        </ul>

        <h4 className="mb-2 mt-4 text-xs font-bold uppercase tracking-wide text-text-sub">รายการ GL ({glRows.length})</h4>
        <ul className="space-y-1.5 rounded-xl border border-border bg-page-bg p-3 text-sm">
          {glRows.map((g) => (
            <li key={g.gl_row_id} className="flex justify-between gap-3">
              <span className="text-text-sub">
                {formatDate(g.gl_date)} · {g.gl_document_no || '-'} · {g.gl_description || '-'}
              </span>
              <span className="font-numeric font-medium text-text">{g.gl_amount.toLocaleString('th-TH', THB2)}</span>
            </li>
          ))}
        </ul>

        {group.note && (
          <p className="mt-3 text-xs text-text-sub">
            หมายเหตุเดิม: <span className="text-text">{group.note}</span>
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="btn-press rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-text-sub hover:bg-page-bg"
            data-testid="undo-match-cancel"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="btn-press rounded-[10px] bg-danger px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-danger/90"
            data-testid="undo-match-confirm"
          >
            ยืนยันการยกเลิกจับคู่
          </button>
        </div>
      </div>
    </div>
  );
}
