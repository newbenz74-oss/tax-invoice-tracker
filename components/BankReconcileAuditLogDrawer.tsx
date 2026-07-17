'use client';

import { History, X } from 'lucide-react';
import { RECONCILE_AUDIT_ACTION_LABELS, type ReconcileAuditLogEntry } from '@/types/bankReconcileSession';

interface BankReconcileAuditLogDrawerProps {
  entries: ReconcileAuditLogEntry[];
  loading: boolean;
  onClose: () => void;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

/** ค่าเดิม/ค่าใหม่เก็บเป็น jsonb ชนิด unknown — แสดงเป็นข้อความอ่านง่ายที่สุดเท่าที่ทำได้โดยไม่ต้องรู้โครงสร้าง
 * ล่วงหน้า: string/number/boolean แสดงตรงๆ, object/array แปลงเป็น "key: value" คั่นด้วยจุลภาคสั้นๆ อ่านง่ายกว่า
 * JSON.stringify ดิบๆ, null/undefined แสดงเป็น "-" */
function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    try {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length === 0) return '-';
      return entries.map(([k, v]) => `${k}: ${v === null || v === undefined ? '-' : String(v)}`).join(', ');
    } catch {
      return '-';
    }
  }
  return String(value);
}

/**
 * Drawer "ประวัติการแก้ไข" (สเปกส่วน "12. AUDIT LOG") — แสดงรายการ audit log ทั้งหมดของ session ที่เปิดอยู่
 * เรียงใหม่สุดขึ้นก่อนเสมอ (ตรงกับ fetchReconcileAuditLog ที่ order performed_at ascending: false) แสดงครบ 5
 * คอลัมน์ตามสเปก (วันและเวลา, ผู้ดำเนินการ, รายการที่ทำ, ค่าเดิม, ค่าใหม่, หมายเหตุ) เป็นการ์ดรายการแทนตาราง
 * เพราะค่าเดิม/ค่าใหม่อาจเป็นข้อความยาว การใช้ตารางคอลัมน์ตายตัวจะอ่านยาก — เป็น read-only ล้วนๆ ไม่มี action
 * ใดๆ ในนี้เลย (append-only ตามธรรมชาติของ audit trail — ไม่มีทางแก้ไข/ลบประวัติได้แม้แต่จาก UI)
 */
export default function BankReconcileAuditLogDrawer({ entries, loading, onClose }: BankReconcileAuditLogDrawerProps) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="ประวัติการแก้ไข"
      data-testid="audit-log-drawer"
    >
      <div
        className="card-surface flex max-h-[calc(100vh-24px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white md:max-h-[calc(100vh-48px)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-none items-start justify-between gap-3 border-b border-border px-6 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              <History size={18} aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-base font-bold text-text">ประวัติการแก้ไข</h3>
              <p className="mt-0.5 text-sm text-text-sub">บันทึกทุกการเปลี่ยนแปลงของรอบกระทบยอดนี้ เรียงล่าสุดขึ้นก่อน</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-text-sub hover:bg-page-bg"
            aria-label="ปิด"
            data-testid="audit-log-close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <p className="py-8 text-center text-sm text-text-sub" data-testid="audit-log-loading">
              กำลังโหลดประวัติการแก้ไข...
            </p>
          ) : entries.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-sub" data-testid="audit-log-empty">
              ยังไม่มีประวัติการแก้ไขของรอบกระทบยอดนี้
            </p>
          ) : (
            <ul className="space-y-2.5" data-testid="audit-log-list">
              {entries.map((entry) => (
                <li key={entry.id} className="rounded-xl border border-border bg-page-bg p-3.5 text-sm" data-testid="audit-log-entry">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-text">
                      {RECONCILE_AUDIT_ACTION_LABELS[entry.action_type] ?? entry.action_type}
                    </span>
                    <span className="font-numeric text-xs text-text-sub">{formatDateTime(entry.performed_at)}</span>
                  </div>
                  <p className="mt-1 text-xs text-text-sub">ผู้ดำเนินการ: {entry.performed_by_email ?? '-'}</p>
                  {(entry.old_value !== null || entry.new_value !== null) && (
                    <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                      {entry.old_value !== null && (
                        <div>
                          <span className="text-text-sub">ค่าเดิม: </span>
                          <span className="text-text">{formatAuditValue(entry.old_value)}</span>
                        </div>
                      )}
                      {entry.new_value !== null && (
                        <div>
                          <span className="text-text-sub">ค่าใหม่: </span>
                          <span className="text-text">{formatAuditValue(entry.new_value)}</span>
                        </div>
                      )}
                    </div>
                  )}
                  {entry.action_note && <p className="mt-2 text-xs text-text">หมายเหตุ: {entry.action_note}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
