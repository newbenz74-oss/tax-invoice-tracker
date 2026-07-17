'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { CalendarClock, Plus, Search } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { downloadBlob } from '@/lib/reportExport';
import {
  cancelReconcileSession,
  duplicateReconcileSession,
  exportReconcileSessionExcel,
  exportReconcileSessionPdf,
  fetchReconcileSessions,
  RECONCILE_SESSIONS_SWR_KEY,
  renameReconcileSession,
  softDeleteReconcileSession,
} from '@/lib/bankReconcileSessionApi';
import {
  computeSessionStatusCounts,
  DEFAULT_SESSION_LIST_FILTERS,
  extractSessionListFilterOptions,
  filterReconcileSessions,
  SESSION_LIST_TABS,
  SESSION_LIST_TAB_LABELS,
  type SessionListFilters,
} from '@/lib/bankReconcileSessionListLogic';
import { RECONCILE_SESSION_STATUS_BADGE_CLASS, RECONCILE_SESSION_STATUS_LABELS, type ReconcileSession, type ReconcileSessionStatus } from '@/types/bankReconcileSession';
import { thaiMonthName } from '@/lib/thaiDate';
import BankReconcileConfirmDialog from './BankReconcileConfirmDialog';
import BankReconcileTextPromptDialog from './BankReconcileTextPromptDialog';

const PAGE_SIZE = 10;
const THB2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

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

function todayISODate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

interface BankReconcileSessionListProps {
  onCreateNew: () => void;
  onOpenSession: (sessionId: string) => void;
}

/** ปุ่มดำเนินการต่อแถวที่กำลังยุ่งอยู่ — เก็บทั้ง sessionId และประเภทเพื่อ disable เฉพาะปุ่มที่กำลังทำงานจริง
 * ในแถวนั้นเท่านั้น (ไม่ disable ทั้งแถวเวลาแค่ export กำลังโหลดอยู่ ผู้ใช้ยังกด "เปิด" แถวอื่นได้ปกติ) */
type RowBusyAction = { sessionId: string; action: 'open' | 'duplicate' | 'rename' | 'export-excel' | 'export-pdf' | 'cancel' | 'delete' };

/**
 * หน้ารายการ "ประวัติการกระทบยอดธนาคาร" (สเปกส่วน "6. SESSION LIST PAGE" / "7. SESSION SEARCH AND FILTER")
 * — เพิ่มเข้ามาสำหรับเฟส 4 (2026-07-16) เป็นจุดเริ่มต้นใหม่ของฟีเจอร์ Bank Reconcile (ก่อนหน้านี้ผู้ใช้ต้อง
 * อัปโหลดไฟล์ใหม่ทุกครั้งเพราะยังไม่มีการบันทึกฐานข้อมูล — ดู components/BankReconcilePage.tsx สำหรับจุดที่
 * เพิ่ม step 'list' นี้เป็นขั้นตอนแรกก่อน 'upload') ใช้ตรรกะกรอง/นับล้วนๆ จาก
 * lib/bankReconcileSessionListLogic.ts (ทดสอบแยกต่างหากแล้วด้วย unit test) หน้านี้เป็นแค่ชั้นแสดงผล/
 * เรียกใช้ Supabase ผ่าน lib/bankReconcileSessionApi.ts เท่านั้น ไม่มีตรรกะกรอง/นับเขียนซ้ำในไฟล์นี้เลย
 *
 * คอลัมน์ตาราง 16 คอลัมน์ตามสเปก — สเปกไม่ได้ระบุรายชื่อคอลัมน์ทั้ง 16 ไว้ตรงๆ ในข้อความที่มีอยู่ ณ ตอนสร้าง
 * (มีแต่จำนวน "16 columns") จึงเลือกคอลัมน์ที่ครอบคลุมทุกฟิลด์ของ ReconcileSession ที่มีประโยชน์ต่อการสแกน
 * รายการอย่างสมเหตุสมผลที่สุดแทน (เป็นดุลยพินิจที่ตัดสินใจเอง ระบุไว้ในสรุปผลตอนส่งมอบด้วย): ชื่อรอบ, ธนาคาร,
 * เลขที่บัญชี, ช่วงวันที่, สถานะ, จำนวนรายการ Bank, จำนวนรายการ GL, กระทบยอดแล้ว, ยืนยันด้วยตนเอง, ต้อง
 * ตรวจสอบ, ไม่พบใน GL, GL ไม่พบใน Bank, ผลต่างสุทธิ, ผู้สร้าง, วันที่สร้าง, อัปเดตล่าสุด (= 16 คอลัมน์)
 * บวกคอลัมน์ "การจัดการ" แยกต่างหาก (ไม่นับรวมใน 16) — ครอบด้วย overflow-x-auto เพราะกว้างมาก
 *
 * ปุ่ม action ต่อแถว 6 อย่างตามสเปก (เปิด/ทำสำเนา/เปลี่ยนชื่อ/Export/ยกเลิก/ลบ) — "Export" แยกเป็น 2 ปุ่ม
 * ที่เป็นรูปธรรม (Excel/PDF) แทนปุ่มเดียวที่ต้องเลือกอีกทีตามแนวทางเดียวกับ BankReconcileSessionHeader.tsx
 * (รวมเป็น 7 ปุ่มจริงในหน้าจอ) — Export PDF จากหน้ารายการใช้โหมด 'summary' เสมอ (ไม่มีตัวเลือกโหมดในแถว
 * ตารางที่พื้นที่จำกัด — ต้องการฉบับเต็มให้เปิด session แล้ว Export จากหน้ารายละเอียดแทน)
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
  const [busy, setBusy] = useState<RowBusyAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [renamingSession, setRenamingSession] = useState<ReconcileSession | null>(null);
  const [duplicatingSession, setDuplicatingSession] = useState<ReconcileSession | null>(null);
  const [cancellingSession, setCancellingSession] = useState<ReconcileSession | null>(null);
  const [deletingSession, setDeletingSession] = useState<ReconcileSession | null>(null);

  const counts = useMemo(() => computeSessionStatusCounts(sessions), [sessions]);
  const filterOptions = useMemo(() => extractSessionListFilterOptions(sessions), [sessions]);
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

  function isBusy(sessionId: string, action?: RowBusyAction['action']) {
    if (!busy || busy.sessionId !== sessionId) return false;
    return action ? busy.action === action : true;
  }

  async function runRowAction(sessionId: string, action: RowBusyAction['action'], fn: () => Promise<void>) {
    setActionError(null);
    setBusy({ sessionId, action });
    try {
      await fn();
    } catch {
      setActionError('ดำเนินการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setBusy(null);
    }
  }

  async function handleRenameConfirm(newName: string) {
    if (!renamingSession) return;
    await runRowAction(renamingSession.id, 'rename', async () => {
      await renameReconcileSession(renamingSession.id, newName);
      await mutate();
      setRenamingSession(null);
    });
  }

  async function handleDuplicateConfirm(newName: string) {
    if (!duplicatingSession) return;
    await runRowAction(duplicatingSession.id, 'duplicate', async () => {
      await duplicateReconcileSession(duplicatingSession.id, newName, actor);
      await mutate();
      setDuplicatingSession(null);
    });
  }

  async function handleCancelConfirm() {
    if (!cancellingSession) return;
    await runRowAction(cancellingSession.id, 'cancel', async () => {
      await cancelReconcileSession(cancellingSession.id, actor);
      await mutate();
      setCancellingSession(null);
    });
  }

  async function handleDeleteConfirm() {
    if (!deletingSession) return;
    await runRowAction(deletingSession.id, 'delete', async () => {
      await softDeleteReconcileSession(deletingSession.id, actor);
      await mutate();
      setDeletingSession(null);
    });
  }

  async function handleExportExcel(s: ReconcileSession) {
    await runRowAction(s.id, 'export-excel', async () => {
      const blob = await exportReconcileSessionExcel(s.id);
      downloadBlob(blob, `กระทบยอดธนาคาร-${s.session_name}.xlsx`);
    });
  }

  async function handleExportPdf(s: ReconcileSession) {
    await runRowAction(s.id, 'export-pdf', async () => {
      const blob = await exportReconcileSessionPdf(s.id, 'summary', authSession?.user?.email ?? '', todayISODate());
      downloadBlob(blob, `กระทบยอดธนาคาร-${s.session_name}.pdf`);
    });
  }

  return (
    <div className="space-y-5" data-testid="bank-reconcile-session-list">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="tablist"
          aria-label="กรองตามสถานะรอบกระทบยอด"
          className="flex flex-wrap gap-1 rounded-full border border-border bg-white p-1"
          data-testid="session-list-tabs"
        >
          {SESSION_LIST_TABS.map((tab) => {
            const isActive = filters.tab === tab;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => updateFilters({ tab })}
                className={`btn-press rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'bg-primary text-white shadow-sm' : 'text-text-sub hover:text-primary'
                }`}
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
        <label className="flex min-w-[220px] flex-1 flex-col gap-1.5 text-sm">
          <span className="font-medium text-text">ค้นหา</span>
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-sub" aria-hidden="true" />
            <input
              type="text"
              value={filters.search}
              onChange={(e) => updateFilters({ search: e.target.value })}
              placeholder="ชื่อรอบ / ชื่อไฟล์ / เลขที่บัญชี"
              className="focus-ring-primary h-11 w-full rounded-[10px] border border-border bg-white pr-3 pl-9 text-sm text-text"
              data-testid="session-list-search-input"
            />
          </div>
        </label>

        <label className="flex w-28 flex-col gap-1.5 text-sm">
          <span className="font-medium text-text">ปี</span>
          <select
            value={filters.year}
            onChange={(e) => updateFilters({ year: e.target.value })}
            className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-2 text-sm text-text"
            data-testid="session-list-filter-year"
          >
            <option value="">ทั้งหมด</option>
            {filterOptions.years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>

        <label className="flex w-36 flex-col gap-1.5 text-sm">
          <span className="font-medium text-text">เดือน</span>
          <select
            value={filters.month}
            onChange={(e) => updateFilters({ month: e.target.value })}
            className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-2 text-sm text-text"
            data-testid="session-list-filter-month"
          >
            <option value="">ทั้งหมด</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={String(m)}>
                {thaiMonthName(m)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex w-40 flex-col gap-1.5 text-sm">
          <span className="font-medium text-text">ธนาคาร</span>
          <select
            value={filters.bankName}
            onChange={(e) => updateFilters({ bankName: e.target.value })}
            className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-2 text-sm text-text"
            data-testid="session-list-filter-bank"
          >
            <option value="">ทั้งหมด</option>
            {filterOptions.bankNames.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>

        <label className="flex w-40 flex-col gap-1.5 text-sm">
          <span className="font-medium text-text">เลขที่บัญชี</span>
          <select
            value={filters.bankAccountNo}
            onChange={(e) => updateFilters({ bankAccountNo: e.target.value })}
            className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-2 text-sm text-text"
            data-testid="session-list-filter-account"
          >
            <option value="">ทั้งหมด</option>
            {filterOptions.bankAccountNos.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>

        <label className="flex w-40 flex-col gap-1.5 text-sm">
          <span className="font-medium text-text">สถานะ</span>
          <select
            value={filters.status}
            onChange={(e) => updateFilters({ status: e.target.value as ReconcileSessionStatus | '' })}
            className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-2 text-sm text-text"
            data-testid="session-list-filter-status"
          >
            <option value="">ทั้งหมด</option>
            {(Object.keys(RECONCILE_SESSION_STATUS_LABELS) as ReconcileSessionStatus[]).map((st) => (
              <option key={st} value={st}>
                {RECONCILE_SESSION_STATUS_LABELS[st]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex w-48 flex-col gap-1.5 text-sm">
          <span className="font-medium text-text">ผู้สร้าง</span>
          <select
            value={filters.createdByEmail}
            onChange={(e) => updateFilters({ createdByEmail: e.target.value })}
            className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-2 text-sm text-text"
            data-testid="session-list-filter-creator"
          >
            <option value="">ทั้งหมด</option>
            {filterOptions.createdByEmails.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-text">ตั้งแต่วันที่</span>
          <input
            type="date"
            value={filters.dateFrom ?? ''}
            onChange={(e) => updateFilters({ dateFrom: e.target.value || null })}
            className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-3 text-sm text-text"
            data-testid="session-list-filter-date-from"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-text">ถึงวันที่</span>
          <input
            type="date"
            value={filters.dateTo ?? ''}
            onChange={(e) => updateFilters({ dateTo: e.target.value || null })}
            className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-3 text-sm text-text"
            data-testid="session-list-filter-date-to"
          />
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
        <div
          className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-card-bg p-12 text-center text-sm text-text-sub"
          data-testid="session-list-empty"
        >
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
                  {[
                    'ชื่อรอบกระทบยอด',
                    'ธนาคาร',
                    'เลขที่บัญชี',
                    'ช่วงวันที่',
                    'สถานะ',
                    'รายการ Bank',
                    'รายการ GL',
                    'กระทบยอดแล้ว',
                    'ยืนยันด้วยตนเอง',
                    'ต้องตรวจสอบ',
                    'ไม่พบใน GL',
                    'GL ไม่พบใน Bank',
                    'ผลต่างสุทธิ',
                    'ผู้สร้าง',
                    'วันที่สร้าง',
                    'อัปเดตล่าสุด',
                  ].map((h) => (
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
                    <td className="px-[14px] py-[14px] whitespace-nowrap text-text-sub">{s.bank_name || '-'}</td>
                    <td className="font-numeric px-[14px] py-[14px] whitespace-nowrap text-text-sub">{s.bank_account_no || '-'}</td>
                    <td className="px-[14px] py-[14px] whitespace-nowrap text-text-sub">
                      {s.period_start || s.period_end ? `${formatDate(s.period_start)} - ${formatDate(s.period_end)}` : '-'}
                    </td>
                    <td className="px-[14px] py-[14px] whitespace-nowrap">
                      <span
                        className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${RECONCILE_SESSION_STATUS_BADGE_CLASS[s.status]}`}
                        data-testid={`session-status-badge-${s.id}`}
                      >
                        {RECONCILE_SESSION_STATUS_LABELS[s.status]}
                      </span>
                    </td>
                    <td className="font-numeric px-[14px] py-[14px] whitespace-nowrap text-text-sub">{s.bank_row_count.toLocaleString('th-TH')}</td>
                    <td className="font-numeric px-[14px] py-[14px] whitespace-nowrap text-text-sub">{s.gl_row_count.toLocaleString('th-TH')}</td>
                    <td className="font-numeric px-[14px] py-[14px] whitespace-nowrap text-text-sub">{s.matched_count.toLocaleString('th-TH')}</td>
                    <td className="font-numeric px-[14px] py-[14px] whitespace-nowrap text-text-sub">{s.manual_match_count.toLocaleString('th-TH')}</td>
                    <td className="font-numeric px-[14px] py-[14px] whitespace-nowrap text-text-sub">{s.review_count.toLocaleString('th-TH')}</td>
                    <td className="font-numeric px-[14px] py-[14px] whitespace-nowrap text-text-sub">{s.unmatched_bank_count.toLocaleString('th-TH')}</td>
                    <td className="font-numeric px-[14px] py-[14px] whitespace-nowrap text-text-sub">{s.unmatched_gl_count.toLocaleString('th-TH')}</td>
                    <td className="font-numeric px-[14px] py-[14px] whitespace-nowrap text-text-sub">{s.net_difference.toLocaleString('th-TH', THB2)}</td>
                    <td className="px-[14px] py-[14px] whitespace-nowrap text-text-sub">{s.created_by_email || '-'}</td>
                    <td className="font-numeric px-[14px] py-[14px] whitespace-nowrap text-text-sub">{formatDateTime(s.created_at)}</td>
                    <td className="px-[14px] py-[14px] whitespace-nowrap text-text-sub">
                      {formatDateTime(s.updated_at)}
                      {s.updated_by_email && <span className="block text-xs">{s.updated_by_email}</span>}
                    </td>
                    <td className="px-[14px] py-[14px] whitespace-nowrap">
                      <div className="flex flex-nowrap justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => onOpenSession(s.id)}
                          className="btn-press rounded-[10px] border border-border px-2 py-1 text-xs font-medium text-text-sub hover:bg-page-bg"
                          data-testid={`session-open-${s.id}`}
                        >
                          เปิด
                        </button>
                        <button
                          type="button"
                          onClick={() => setDuplicatingSession(s)}
                          disabled={isBusy(s.id, 'duplicate')}
                          className="btn-press rounded-[10px] border border-border px-2 py-1 text-xs font-medium text-text-sub hover:bg-page-bg disabled:opacity-50"
                          data-testid={`session-duplicate-${s.id}`}
                        >
                          ทำสำเนา
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenamingSession(s)}
                          disabled={isBusy(s.id, 'rename')}
                          className="btn-press rounded-[10px] border border-border px-2 py-1 text-xs font-medium text-text-sub hover:bg-page-bg disabled:opacity-50"
                          data-testid={`session-rename-${s.id}`}
                        >
                          เปลี่ยนชื่อ
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExportExcel(s)}
                          disabled={isBusy(s.id, 'export-excel')}
                          className="btn-press rounded-[10px] border border-border px-2 py-1 text-xs font-medium text-text-sub hover:bg-page-bg disabled:opacity-50"
                          data-testid={`session-export-excel-${s.id}`}
                        >
                          {isBusy(s.id, 'export-excel') ? 'กำลัง Export...' : 'Export Excel'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExportPdf(s)}
                          disabled={isBusy(s.id, 'export-pdf')}
                          className="btn-press rounded-[10px] border border-border px-2 py-1 text-xs font-medium text-text-sub hover:bg-page-bg disabled:opacity-50"
                          data-testid={`session-export-pdf-${s.id}`}
                        >
                          {isBusy(s.id, 'export-pdf') ? 'กำลัง Export...' : 'Export PDF'}
                        </button>
                        {(s.status === 'draft' || s.status === 'in_progress' || s.status === 'reopened') && (
                          <button
                            type="button"
                            onClick={() => setCancellingSession(s)}
                            disabled={isBusy(s.id, 'cancel')}
                            className="btn-press rounded-[10px] border border-warning/40 px-2 py-1 text-xs font-medium text-warning hover:bg-warning/10 disabled:opacity-50"
                            data-testid={`session-cancel-${s.id}`}
                          >
                            ยกเลิก
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setDeletingSession(s)}
                          disabled={isBusy(s.id, 'delete')}
                          className="btn-press rounded-[10px] border border-danger/40 px-2 py-1 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
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
              แสดง {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, visibleSessions.length)} จาก{' '}
              {visibleSessions.length} รายการ
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

      {renamingSession && (
        <BankReconcileTextPromptDialog
          testIdPrefix="rename-session"
          title="เปลี่ยนชื่อรอบกระทบยอด"
          label="ชื่อรอบกระทบยอด"
          initialValue={renamingSession.session_name}
          confirmLabel="บันทึกชื่อใหม่"
          onConfirm={handleRenameConfirm}
          onClose={() => setRenamingSession(null)}
        />
      )}

      {duplicatingSession && (
        <BankReconcileTextPromptDialog
          testIdPrefix="duplicate-session"
          title="ทำสำเนารอบกระทบยอด"
          subtitle="สร้างรอบกระทบยอดใหม่จากข้อมูลชุดเดียวกัน (สถานะเริ่มต้นเป็นแบบร่างเสมอ)"
          label="ชื่อรอบกระทบยอดใหม่"
          initialValue={`${duplicatingSession.session_name} (สำเนา)`}
          confirmLabel="สร้างสำเนา"
          onConfirm={handleDuplicateConfirm}
          onClose={() => setDuplicatingSession(null)}
        />
      )}

      {cancellingSession && (
        <BankReconcileConfirmDialog
          testIdPrefix="cancel-session"
          title="ยกเลิกรอบกระทบยอด"
          message={`ต้องการยกเลิกรอบกระทบยอด "${cancellingSession.session_name}" หรือไม่? ข้อมูลจะยังคงอยู่และดูย้อนหลังได้เสมอ`}
          confirmLabel="ยืนยันยกเลิก"
          danger
          onConfirm={handleCancelConfirm}
          onClose={() => setCancellingSession(null)}
        />
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
