'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { buddhistYearOptions, currentBuddhistYear, currentMonth, thaiMonthName } from '@/lib/thaiDate';
import type { ReconcileReportStatus } from '@/types/bankReconcileMatch';

export interface BankReconcileSaveInput {
  periodMonth: number;
  periodYear: number;
  status: ReconcileReportStatus;
}

interface BankReconcileSaveDialogProps {
  defaultMonth?: number;
  defaultYear?: number;
  defaultStatus?: ReconcileReportStatus;
  saving: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onConfirm: (input: BankReconcileSaveInput) => void;
}

/** Dialog บันทึกรายการประวัติกระทบยอด (เพิ่มเข้ามา 2026-07-19) — เลือกเดือน/ปี (พ.ศ.) ที่รายการนี้เป็นของ
 * บวกสถานะ (ทำค้างไว้ / เสร็จสมบูรณ์) ทั้งสองสถานะเปิดกลับมาแก้ไขได้เสมอ ไม่มีการล็อกถาวร — ชื่อรายการที่
 * บันทึกจริงคำนวณจากเดือน/ปีที่เลือกเสมอ (เช่น "กระทบยอดเดือนมิถุนายน 2569") ไม่ใช่ free text ที่พิมพ์เอง
 * ตามที่ผู้ใช้ระบุไว้ชัดเจนว่าต้องอิงเดือน/ปีเพื่อเรียกดูย้อนหลังได้สะดวก (ไม่ใช่ชื่อที่ตั้งเองอิสระ)
 *
 * ใช้ pattern เดียวกับ OverdueInvoiceDetailModal.tsx (fixed inset-0 + backdrop คลิกปิดได้ + card-surface +
 * stopPropagation ที่กล่องเนื้อหา) และตัวเลือกเดือน/ปีแบบเดียวกับ PurchaseTaxReport.tsx (lib/thaiDate.ts)
 * เพียงแต่ตัดตัวเลือก "ทั้งปี" ออก เพราะรายการที่บันทึกต้องมีเดือนเดียวเจาะจงเสมอ (month เป็น number ล้วนๆ
 * ไม่ใช่ number | 'all' แบบหน้ารายงาน) — component นี้ไม่เรียก API เอง แค่เก็บ input แล้วส่งออกผ่าน
 * onConfirm เท่านั้น ผู้เรียก (BankReconcileWorkspace) เป็นคนจัดการ saving/errorMessage/เรียก
 * saveReconcileReport จริงทั้งหมด */
export default function BankReconcileSaveDialog({
  defaultMonth,
  defaultYear,
  defaultStatus,
  saving,
  errorMessage,
  onCancel,
  onConfirm,
}: BankReconcileSaveDialogProps) {
  const [month, setMonth] = useState<number>(defaultMonth ?? currentMonth());
  const [year, setYear] = useState<number>(defaultYear ?? currentBuddhistYear());
  const [status, setStatus] = useState<ReconcileReportStatus>(defaultStatus ?? 'draft');

  const reportName = `กระทบยอดเดือน${thaiMonthName(month)} ${year}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label="บันทึกรายการกระทบยอด"
      data-testid="bank-reconcile-save-dialog"
    >
      <div className="card-surface w-full max-w-md rounded-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-text">บันทึกรายการกระทบยอด</h3>
            <p className="mt-0.5 text-sm text-text-sub">เลือกเดือน/ปีที่รายการนี้เป็นของ เพื่อเรียกดูย้อนหลังได้สะดวก</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 rounded-md p-1 text-text-sub hover:bg-page-bg"
            aria-label="ปิด"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text" htmlFor="bank-reconcile-save-month">
              เดือน/ปี
            </label>
            <div className="flex gap-2">
              <select
                id="bank-reconcile-save-month"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="focus-ring-primary flex-1 rounded-[10px] border border-border bg-white/8 px-3.5 py-2.5 text-sm text-text"
                data-testid="bank-reconcile-save-month"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {thaiMonthName(m)}
                  </option>
                ))}
              </select>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                aria-label="ปี"
                className="focus-ring-primary w-28 rounded-[10px] border border-border bg-white/8 px-3.5 py-2.5 text-sm text-text"
                data-testid="bank-reconcile-save-year"
              >
                {buddhistYearOptions().map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <p className="text-xs text-text-sub">ชื่อรายการที่จะบันทึก</p>
            <p className="mt-0.5 text-sm font-medium text-text">{reportName}</p>
          </div>

          <div>
            <span className="mb-1.5 block text-sm font-medium text-text">สถานะ</span>
            <div className="flex rounded-[10px] border border-border bg-white/8 p-1" role="group" aria-label="เลือกสถานะ">
              <button
                type="button"
                onClick={() => setStatus('draft')}
                aria-pressed={status === 'draft'}
                className={`btn-press flex-1 rounded-[8px] px-3.5 py-1.5 text-sm font-medium transition-colors duration-150 ${
                  status === 'draft' ? 'bg-primary text-white' : 'text-text-sub hover:bg-page-bg'
                }`}
                data-testid="bank-reconcile-save-status-draft"
              >
                ทำค้างไว้
              </button>
              <button
                type="button"
                onClick={() => setStatus('complete')}
                aria-pressed={status === 'complete'}
                className={`btn-press flex-1 rounded-[8px] px-3.5 py-1.5 text-sm font-medium transition-colors duration-150 ${
                  status === 'complete' ? 'bg-primary text-white' : 'text-text-sub hover:bg-page-bg'
                }`}
                data-testid="bank-reconcile-save-status-complete"
              >
                เสร็จสมบูรณ์
              </button>
            </div>
          </div>

          {errorMessage && (
            <p className="text-sm text-danger" data-testid="bank-reconcile-save-error">
              {errorMessage}
            </p>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="btn-press rounded-[10px] border border-border bg-white/8 px-4 py-2.5 text-sm font-medium text-text-sub hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="bank-reconcile-save-cancel"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={() => onConfirm({ periodMonth: month, periodYear: year, status })}
            disabled={saving}
            className="btn-press rounded-[10px] bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="bank-reconcile-save-confirm"
          >
            {saving ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </div>
    </div>
  );
}
