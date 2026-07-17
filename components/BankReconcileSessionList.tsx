'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { CalendarClock, Plus, Search } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { fetchReconcileSessions, RECONCILE_SESSIONS_SWR_KEY, softDeleteReconcileSession } from '@/lib/bankReconcileSessionApi';
import {
  computeSessionStatusCounts,
  DEFAULT_SESSION_LIST_FILTERS,
  filterReconcileSessions,
  SESSION_LIST_TABS,
  SESSION_LIST_TAB_LABELS,
  type SessionListFilters,
} from '@/lib/bankReconcileSessionListLogic';
import { RECONCILE_SESSION_STATUS_BADGE_CLASS, RECONCILE_SESSION_STATUS_LABELS, type ReconcileSession } from '@/types/bankReconcileSession';
import BankReconcileConfirmDialog from './BankReconcileConfirmDialog';

const PAGE_SIZE = 10;

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

interface BankReconcileSessionListProps {
  onCreateNew: () => void;
  onOpenSession: (sessionId: string) => void;
}

/**
 * หน้ารายการ "ประวัติการกระทบยอดธนาคาร" — เขียนใหม่ทั้งไฟล์ 2026-07-17 พร้อมกับการ rebuild โมดูลทั้งโมดูล
 * เรียบง่ายกว่าเดิมมาก (เดิม 16 คอลัมน์ + 7 ตัวกรอง + 7 ปุ่ม action ต่อแถว) ตามเจตนา "a new and simpler
 * reconciliation workflow" ของสเปก — เหลือคอลัมน์ที่มีความหมายกับโมเดลใหม่เท่านั้น (ชื่อรอบ/ไฟล์ Bank/ไฟล์ GL/
 * รายการ Bank/รายการ GL/พบใน GL/ไม่พบใน GL/สถานะ/ผู้สร้าง/วันที่สร้าง) ตัวกรองเหลือแค่ค้นหา + สถานะ ปุ่ม action
 * ต่อแถวเหลือแค่ "เปิด"/"ลบ" (ตัดทำสำเนา/เปลี่ยนชื่อ/ยกเลิกรอบ/Export ออกจากแถว — Export ทำได้จากหน้ารายละเอียด
 * ที่เปิดอยู่แทน ดู BankReconcileSessionHeader.tsx — ไม่มีส่วนใดในสเปกใหม่ 24 ส่วนร้องขอฟีเจอร์เหล่านี้ที่หน้า
 * รายการเลย ระบุไว้ในสรุปผลตอนส่งมอบด้วย) ใช้ตรรกะกรอง/นับจาก lib/bankReconcileSessionListLogic.ts เท่านั้น
 * ไม่มีตรรกะกรอง/นับเขียนซ้ำในไฟล์นี้
 */
export default function BankReconcileSessionList({ onCreateNew, onOpenSession }: BankReconcileSessionListProps) {
  const { session: authSession } = useAuth();
  const actor = { id: authSession?.user?.id ?? null, email: authSession?.user?.email ?? null };

  const {
    data: sessions = [],
    error: loadErrorObj,
    isLoading: loading,
    mutate,
  } = useSWR<ReconcileSession[]>(authSession ? RECONCILE_SESSIONS_SWR_KEY : null, fetchReconcileSessions);
  const loadError = loadErrorObj ? 'โหลดประวัติการกระทบยอดธนาคารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' : null;

  const [filters, setFilters] = useState<SessionListFilters>(DEFAULT_SESSION_LIST_FILTERS);
  const [page, setPage] = useState(1);
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deletingSession, setDeletingSession] = useState<ReconcileSession | null>(null);

  const counts = useMemo(() => computeSessionStatusCounts(sessions), [sessions]);
  const visibleSessions = useMemo(() => filterReconcileSessions(sessions, filters), [sessions, filters]);

  const totalPages = Math.max(1, Math.ceil(visibleSessions.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedSessions = useMemo(
    () => visibleSessions.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [visibleSessions, safePage]
  );

  function updateFilters(patch: Partial<SessionListFilters>) {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  }

  async function handleDeleteConfirm() {
    if (!deletingSession) return;
    setActionError(null);
    setBusySessionId(deletingSession.id);
    try {
      await softDeleteReconcileSession(deletingSession.id, actor);
      await mutate();
      setDeletingSession(null);
    } catch {
      setActionError('ลบรอบกระทบยอดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setBusySessionId(null);
    }
  }

  return (
    <div className="space-y-5" data-testid="bank-reconcile-session-list">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="tablist" aria-label="กรองตามสถานะรอบกระทบยอด" className="flex flex-wrap gap-1 rounded-full border border-border bg-white p-1" data-testid="session-list-tabs">
          {SESSION_LIST_TABS.map((tab) => {
            const isActive = filters.tab === tab;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => updateFilters({ tab })}
                className={`btn-press rounded-full px-4 py-2 text-sm font-medium transition-colors ${isActive ? 'bg-primary text-white shadow-sm' : 'text-text-sub hover:text-primary'}`}
                data-testid={`session-list-tab-${tab}`}
              >
                {SESSION_LIST_TAB_LABELS[tab]} ({counts[tab].toLocaleString('th-TH')})
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onCreateNew}
          className="btn-press flex h-12 items-center gap-1.5 rounded-[10px] bg-primary px-4 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover"
          data-testid="session-list-create-new"
        >
          <Plus size={16} aria-hidden="true" />
          สร้างรอบกระทบยอดใหม่
        </button>
      </div>

      <div className="card-surface flex flex-wrap items-end gap-3 rounded-2xl p-4" data-testid="session-list-filters">
        <label className="flex min-w-[260px] flex-1 flex-col gap-1.5 text-sm">
          <span className="font-medium text-text">ค้นหา</span>
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-sub" aria-hidden="true" />
            <input
              type="text"
              value={filters.search}
              onChange={(e) => updateFilters({ search: e.target.value })}
              placeholder="ชื่อรอบ / ชื่อไฟล์"
              className="focus-ring-primary h-11 w-full rounded-[10px] border border-border bg-white pr-3 pl-9 text-sm text-text"
              data-testid="session-list-search-input"
            />
          </div>
        </label>
        <button
          type="button"
          onClick={() => {
            setFilters(DEFAULT_SESSION_LIST_FILTERS);
            setPage(1);
          }}
          className="btn-press h-11 rounded-[10px] border border-border bg-white px-4 text-sm font-medium text-text-sub hover:bg-page-bg"
          data-testid="session-list-clear-filters"
        >
          ล้างตัวกรอง
        </button>
      </div>

      {(loadError || actionError) && (
        <p role="alert" className="rounded-[10px] border border-danger/20 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
          {loadError || actionError}
        </p>
      )}

      {loading ? (
        <p className="py-12 text-center text-sm text-text-sub">กำลังโหลดข้อมูล...</p>
      ) : visibleSessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-card-bg p-12 text-center text-sm text-text-sub" data-testid="session-list-empty">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-light text-primary">
            <CalendarClock size={22} aria-hidden="true" />
          </div>
          <p>{sessions.length === 0 ? 'ยังไม่มีรอบกระทบยอดธนาคาร เริ่มสร้างรอบแรกได้เลย' : 'ไม่พบรอบกระทบยอดที่ตรงกับตัวกรองนี้'}</p>
        </div>
      ) : (
        <div>
          <div className="card-surface overflow-x-auto rounded-2xl">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-table-header">
                <tr>
                  {['ชื่อรอบกระทบยอด', 'ไฟล์ Bank', 'ไฟล์ GL', 'รายการ Bank', 'รายการ GL', 'พบใน GL', 'ไม่พบใน GL', 'สถานะ', 'ผู้สร้าง', 'วันที่สร้าง'].map((h) => (
                    <th key={h} className="px-[14px] py-[14px] text-left text-xs font-semibold whitespace-nowrap text-text-sub">
                      {h}
                    </th>
                  ))}
                  <th className="px-[14px] py-[14px] text-right text-xs font-semibold whitespace-nowrap text-text-sub">การจัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {paginatedSessions.map((s, index) => (
                  <tr
                    key={s.id}
                    data-testid={`session-row-${s.id}`}
                    className={`transition-colors duration-150 hover:bg-table-row-hover ${index % 2 === 1 ? 'bg-table-row-zebra' : ''}`}
                  >
                    <td className="px-[14px] py-[14px] font-medium whitespace-nowrap text-text">{s.session_name}</td>
                    <td className="px-[14px] py-[14px] whitespace-nowrap text-text-sub">{s.bank_file_name}</td>
                    <td className="px-[14px] py-[14px] whitespace-nowrap text-text-sub">{s.gl_file_name}</td>
                    <td className="font-numeric px-[14px] py-[14px] whitespace-nowrap text-text-sub">{s.bank_row_count.toLocaleString('th-TH')}</td>
                    <td className="font-numeric px-[14px] py-[14px] whitespace-nowrap text-text-sub">{s.gl_row_count.toLocaleString('th-TH')}</td>
                    <td className="font-numeric px-[14px] py-[14px] whitespace-nowrap text-success">{s.found_count.toLocaleString('th-TH')}</td>
                    <td className="font-numeric px-[14px] py-[14px] whitespace-nowrap text-danger">{s.bank_not_found_count.toLocaleString('th-TH')}</td>
                    <td className="px-[14px] py-[14px] whitespace-nowrap">
                      <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${RECONCILE_SESSION_STATUS_BADGE_CLASS[s.status]}`} data-testid={`session-status-badge-${s.id}`}>
                        {RECONCILE_SESSION_STATUS_LABELS[s.status]}
                      </span>
                    </td>
                    <td className="px-[14px] py-[14px] whitespace-nowrap text-text-sub">{s.created_by_email || '-'}</td>
                    <td className="font-numeric px-[14px] py-[14px] whitespace-nowrap text-text-sub">{formatDateTime(s.created_at)}</td>
                    <td className="px-[14px] py-[14px] whitespace-nowrap">
                      <div className="flex flex-nowrap justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => onOpenSession(s.id)}
                          className="btn-press rounded-[10px] border border-border px-2.5 py-1.5 text-xs font-medium text-text-sub hover:bg-page-bg"
                          data-testid={`session-open-${s.id}`}
                        >
                          เปิด
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingSession(s)}
                          disabled={busySessionId === s.id}
                          className="btn-press rounded-[10px] border border-danger/40 px-2.5 py-1.5 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
                          data-testid={`session-delete-${s.id}`}
                        >
                          ลบ
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3" data-testid="session-list-pagination">
            <p className="text-xs text-text-sub">
              แสดง {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, visibleSessions.length)} จาก {visibleSessions.length} รายการ
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage(safePage - 1)}
                className="btn-press rounded-[10px] border border-border bg-white px-3.5 py-2 text-sm font-medium text-text hover:bg-page-bg disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="session-list-pagination-prev"
              >
                ก่อนหน้า
              </button>
              <span className="text-xs text-text-sub" data-testid="session-list-pagination-page-indicator">
                หน้า {safePage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage(safePage + 1)}
                className="btn-press rounded-[10px] border border-border bg-white px-3.5 py-2 text-sm font-medium text-text hover:bg-page-bg disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="session-list-pagination-next"
              >
                ถัดไป
              </button>
            </div>
          </div>
        </div>
      )}

      {deletingSession && (
        <BankReconcileConfirmDialog
          testIdPrefix="delete-session"
          title="ลบรอบกระทบยอด"
          message={`ต้องการลบรอบกระทบยอด "${deletingSession.session_name}" ออกจากรายการหรือไม่? สามารถติดต่อผู้ดูแลระบบเพื่อกู้คืนได้ในภายหลัง`}
          confirmLabel="ยืนยันลบ"
          danger
          onConfirm={handleDeleteConfirm}
          onClose={() => setDeletingSession(null)}
        />
      )}
    </div>
  );
}
