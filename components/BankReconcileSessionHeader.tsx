'use client';

import { FileSpreadsheet, Lock, RotateCcw, Save } from 'lucide-react';
import {
  RECONCILE_SESSION_STATUS_BADGE_CLASS,
  RECONCILE_SESSION_STATUS_LABELS,
  SAVE_STATUS_LABELS,
  type ReconcileSessionStatus,
  type SaveStatus,
} from '@/types/bankReconcileSession';

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
  /** null = ยังไม่เคยบันทึกรอบนี้เลยสักครั้ง */
  status: ReconcileSessionStatus | null;
  saveStatus: SaveStatus;
  updatedAt: string | null;
  completedByEmail: string | null;
  completedAt: string | null;
  hasSavedSession: boolean;
  onSave: () => void;
  onExportExcel: () => void;
  /** สลับสถานะ (ทำเครื่องหมายว่าเสร็จสมบูรณ์ ↔ เปิดกลับมาแก้ไข) — orchestrator เป็นผู้ตัดสินใจว่าจะยืนยันซ้ำ
   * ก่อนเรียกหรือไม่ (ผ่าน BankReconcileConfirmDialog ทั่วไป ไม่ผูกกับ component นี้โดยตรง) */
  onToggleStatus: () => void;
}

/**
 * แถบหัวข้อของรอบกระทบยอดที่เปิดอยู่ — เขียนใหม่ 2026-07-17 ให้เรียบง่ายกว่าเดิมมาก ตามสเปกส่วน "22. UI
 * DESIGN" (คง theme เดิม) ตัดปุ่ม "คำนวณใหม่" (ไม่มีอะไรให้คำนวณใหม่แบบมีตัวเลือกโหมด — การจับคู่คำนวณสดเสมอ
 * อยู่แล้วทุกครั้งที่ bankRows/glRows เปลี่ยน) ปุ่ม "ประวัติการแก้ไข" (ไม่มี audit log แล้ว) และปุ่ม "Export
 * PDF" (สเปกใหม่ขอแค่ Excel) ออกทั้งหมด เหลือแค่: บันทึก, Export Excel, ทำเครื่องหมายว่าเสร็จสมบูรณ์/เปิดกลับมา
 * แก้ไข (ปุ่มเดียวสลับสถานะ ไม่ใช่กลไกล็อกการแก้ไขอีกต่อไป — ดูหมายเหตุที่ types/bankReconcileSession.ts)
 * ทำ sticky ไว้เหมือนเดิมเพื่อให้ปุ่มบันทึก/Export ยังกดได้เสมอแม้เลื่อนตารางผลลัพธ์ยาวๆ ลงไป
 */
export default function BankReconcileSessionHeader({
  sessionName,
  status,
  saveStatus,
  updatedAt,
  completedByEmail,
  completedAt,
  hasSavedSession,
  onSave,
  onExportExcel,
  onToggleStatus,
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
              <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${RECONCILE_SESSION_STATUS_BADGE_CLASS[status]}`} data-testid="session-header-status-badge">
                {RECONCILE_SESSION_STATUS_LABELS[status]}
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-xs text-text-sub" data-testid="session-header-subtitle">
            {updatedAt ? `อัปเดตล่าสุด ${formatDateTime(updatedAt)}` : 'ยังไม่ได้บันทึก'}
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

          <button
            type="button"
            onClick={onSave}
            disabled={saveStatus === 'saving'}
            className="btn-press flex items-center gap-1.5 rounded-[10px] bg-primary px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="session-save-button"
          >
            <Save size={15} aria-hidden="true" />
            บันทึก
          </button>

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

          {hasSavedSession && (
            <button
              type="button"
              onClick={onToggleStatus}
              className={`btn-press flex items-center gap-1.5 rounded-[10px] px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm ${
                status === 'completed' ? 'bg-warning hover:bg-warning/90' : 'bg-success hover:bg-success/90'
              }`}
              data-testid="session-toggle-status-button"
            >
              {status === 'completed' ? <RotateCcw size={15} aria-hidden="true" /> : <Lock size={15} aria-hidden="true" />}
              {status === 'completed' ? 'เปิดกลับมาแก้ไข' : 'ทำเครื่องหมายว่าเสร็จสมบูรณ์'}
            </button>
          )}
        </div>
      </div>

      {status === 'completed' && (
        <div className="card-surface flex items-start gap-3 rounded-2xl border border-success/30 bg-success/5 p-4" data-testid="session-completed-banner">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
            <Lock size={16} aria-hidden="true" />
          </div>
          <div className="text-sm">
            <p className="font-semibold text-text">รอบกระทบยอดนี้ทำเครื่องหมายว่าเสร็จสมบูรณ์แล้ว</p>
            <p className="mt-0.5 text-xs text-text-sub">
              โดย {completedByEmail ?? '-'} · วันที่และเวลา {formatDateTime(completedAt)} — ยังแก้ไข/บันทึกต่อได้ตามปกติ
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
