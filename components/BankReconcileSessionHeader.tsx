'use client';

import { Calculator, FileSpreadsheet, FileText, History, Lock, RotateCcw, Save } from 'lucide-react';
import {
  PDF_REPORT_MODE_LABELS,
  RECONCILE_SESSION_STATUS_BADGE_CLASS,
  RECONCILE_SESSION_STATUS_LABELS,
  SAVE_STATUS_LABELS,
  type PdfReportMode,
  type ReconcileSessionStatus,
  type SaveStatus,
} from '@/types/bankReconcileSession';

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return '-';
  return `${d}/${m}/${y}`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

interface BankReconcileSessionHeaderProps {
  sessionName: string;
  bankName: string | null;
  bankAccountNo: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** null = ยังไม่เคยบันทึกรอบนี้เลยสักครั้ง (สถานะยังไม่มีความหมายจริงจนกว่าจะบันทึกครั้งแรก) */
  status: ReconcileSessionStatus | null;
  saveStatus: SaveStatus;
  updatedAt: string | null;
  completedByEmail: string | null;
  completedAt: string | null;
  completionNote: string | null;
  hasSavedSession: boolean;
  isReadOnly: boolean;
  pdfMode: PdfReportMode;
  onPdfModeChange: (mode: PdfReportMode) => void;
  onSave: () => void;
  onExportExcel: () => void;
  onExportPdf: () => void;
  onRecalculate: () => void;
  onComplete: () => void;
  onReopen: () => void;
  onViewAuditLog: () => void;
}

/**
 * แถบหัวข้อของรอบกระทบยอดที่เปิดอยู่ (สเปกส่วน "19. UI DESIGN" — "Opened session header shows: session name,
 * bank account, period, status badge, save status, last updated time. Action buttons: บันทึก, Export Excel,
 * Export PDF, ปิดรอบกระทบยอด... Completed sessions: read-only appearance, completion banner, reopen action
 * separated from normal actions. Sticky action header if helpful.") ทำ sticky ไว้ที่ด้านบนของพื้นที่เนื้อหา
 * (ไม่ทับ Header หลักของแอป) เพื่อให้ปุ่มบันทึก/Export ยังกดได้เสมอแม้เลื่อนตารางผลลัพธ์ยาวๆ ลงไป
 *
 * ปุ่ม "เปิดรอบใหม่เพื่อแก้ไข" ของ session ที่ completed แล้วแยกกลุ่มออกจากปุ่มปกติชัดเจนตามสเปกตรงๆ (คนละแถว/
 * คนละสไตล์สี — ปุ่มปกติ Export ยังอยู่แถวเดิม ส่วนปุ่มเปิดรอบใหม่อยู่ในกล่องแบนเนอร์สีเหลืองแยกต่างหาก) ป้องกัน
 * การกดพลาดระหว่างสองแอ็กชันที่ผลต่างกันมาก (ดูข้อมูลอย่างเดียว vs เปิดกลับมาแก้ไขได้)
 */
export default function BankReconcileSessionHeader({
  sessionName,
  bankName,
  bankAccountNo,
  periodStart,
  periodEnd,
  status,
  saveStatus,
  updatedAt,
  completedByEmail,
  completedAt,
  completionNote,
  hasSavedSession,
  isReadOnly,
  pdfMode,
  onPdfModeChange,
  onSave,
  onExportExcel,
  onExportPdf,
  onRecalculate,
  onComplete,
  onReopen,
  onViewAuditLog,
}: BankReconcileSessionHeaderProps) {
  return (
    <div className="sticky top-0 z-30 -mx-4 space-y-3 border-b border-border bg-page-bg/95 px-4 pb-4 pt-2 backdrop-blur-sm sm:-mx-8 sm:px-8" data-testid="session-header">
      <div className="card-surface flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-bold text-text" data-testid="session-header-name">
              {sessionName || 'รอบกระทบยอดใหม่ (ยังไม่ได้บันทึก)'}
            </h2>
            {status && (
              <span
                className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${RECONCILE_SESSION_STATUS_BADGE_CLASS[status]}`}
                data-testid="session-header-status-badge"
              >
                {RECONCILE_SESSION_STATUS_LABELS[status]}
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-xs text-text-sub" data-testid="session-header-subtitle">
            {[bankName, bankAccountNo].filter(Boolean).join(' · ') || 'ยังไม่ระบุธนาคาร'}
            {(periodStart || periodEnd) && ` · ${formatDate(periodStart)} - ${formatDate(periodEnd)}`}
            {updatedAt && ` · อัปเดตล่าสุด ${formatDateTime(updatedAt)}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2" data-testid="session-header-actions">
          {saveStatus !== 'idle' && (
            <span
              className={`text-xs font-medium ${saveStatus === 'error' ? 'text-danger' : saveStatus === 'saving' ? 'text-text-sub' : 'text-success'}`}
              role="status"
              data-testid="session-save-status"
            >
              {SAVE_STATUS_LABELS[saveStatus]}
            </span>
          )}

          {!isReadOnly && (
            <button
              type="button"
              onClick={onSave}
              className="btn-press flex items-center gap-1.5 rounded-[10px] bg-primary px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
              disabled={saveStatus === 'saving'}
              data-testid="session-save-button"
            >
              <Save size={15} aria-hidden="true" />
              บันทึก
            </button>
          )}

          {hasSavedSession && !isReadOnly && (
            <button
              type="button"
              onClick={onRecalculate}
              className="btn-press flex items-center gap-1.5 rounded-[10px] border border-border bg-white px-3.5 py-2.5 text-sm font-medium text-text hover:bg-page-bg"
              data-testid="session-recalculate-button"
            >
              <Calculator size={15} aria-hidden="true" />
              คำนวณใหม่
            </button>
          )}

          {hasSavedSession && (
            <button
              type="button"
              onClick={onViewAuditLog}
              className="btn-press flex items-center gap-1.5 rounded-[10px] border border-border bg-white px-3.5 py-2.5 text-sm font-medium text-text hover:bg-page-bg"
              data-testid="session-audit-log-button"
            >
              <History size={15} aria-hidden="true" />
              ประวัติการแก้ไข
            </button>
          )}

          <button
            type="button"
            onClick={onExportExcel}
            disabled={!hasSavedSession}
            title={hasSavedSession ? undefined : 'บันทึกรอบกระทบยอดก่อนจึงจะ Export ได้'}
            className="btn-press flex items-center gap-1.5 rounded-[10px] border border-border bg-white px-3.5 py-2.5 text-sm font-medium text-text hover:bg-page-bg disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="session-export-excel-button"
          >
            <FileSpreadsheet size={15} aria-hidden="true" />
            Export Excel
          </button>

          <div className="flex items-center gap-1.5">
            <select
              value={pdfMode}
              onChange={(e) => onPdfModeChange(e.target.value as PdfReportMode)}
              disabled={!hasSavedSession}
              className="focus-ring-primary h-[42px] rounded-[10px] border border-border bg-white px-2 text-xs text-text disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="session-pdf-mode-select"
              aria-label="รูปแบบรายงาน PDF"
            >
              {(Object.keys(PDF_REPORT_MODE_LABELS) as PdfReportMode[]).map((m) => (
                <option key={m} value={m}>
                  {PDF_REPORT_MODE_LABELS[m]}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onExportPdf}
              disabled={!hasSavedSession}
              title={hasSavedSession ? undefined : 'บันทึกรอบกระทบยอดก่อนจึงจะ Export ได้'}
              className="btn-press flex items-center gap-1.5 rounded-[10px] border border-border bg-white px-3.5 py-2.5 text-sm font-medium text-text hover:bg-page-bg disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="session-export-pdf-button"
            >
              <FileText size={15} aria-hidden="true" />
              Export PDF
            </button>
          </div>

          {hasSavedSession && !isReadOnly && (
            <button
              type="button"
              onClick={onComplete}
              className="btn-press flex items-center gap-1.5 rounded-[10px] bg-success px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-success/90"
              data-testid="session-complete-button"
            >
              <Lock size={15} aria-hidden="true" />
              ปิดรอบกระทบยอด
            </button>
          )}
        </div>
      </div>

      {status === 'completed' && (
        <div
          className="card-surface flex flex-col gap-3 rounded-2xl border border-success/30 bg-success/5 p-4 sm:flex-row sm:items-center sm:justify-between"
          data-testid="session-completed-banner"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
              <Lock size={16} aria-hidden="true" />
            </div>
            <div className="text-sm">
              <p className="font-semibold text-text">รอบกระทบยอดนี้ปิดเรียบร้อยแล้ว</p>
              <p className="mt-0.5 text-xs text-text-sub">
                ผู้ปิดรอบ: {completedByEmail ?? '-'} · วันที่และเวลา: {formatDateTime(completedAt)}
              </p>
              {completionNote && <p className="mt-0.5 text-xs text-text-sub">หมายเหตุการปิดรอบ: {completionNote}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onReopen}
            className="btn-press flex shrink-0 items-center gap-1.5 rounded-[10px] bg-warning px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-warning/90"
            data-testid="session-reopen-button"
          >
            <RotateCcw size={15} aria-hidden="true" />
            เปิดรอบใหม่เพื่อแก้ไข
          </button>
        </div>
      )}
    </div>
  );
}
