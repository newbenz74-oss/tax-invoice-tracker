'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { downloadBlob } from '@/lib/reportExport';
import { runSimpleReconciliation } from '@/lib/bankReconcileMatching';
import { computeReconcileSessionKpi } from '@/lib/bankReconcileKpi';
import { saveReconcileSession, exportReconcileSessionExcel, updateReconcileSessionStatus } from '@/lib/bankReconcileSessionApi';
import { createDebouncedSaver, type DebouncedSaver } from '@/lib/bankReconcileAutoSave';
import { setBankReconcileDirty } from '@/lib/bankReconcileNavGuard';
import {
  computeDirectionTabCounts,
  computeStatusTabCounts,
  DEFAULT_RESULT_FILTERS,
  filterBankResults,
  filterGLOnlyResults,
  RESULT_DIRECTION_TABS,
  RESULT_DIRECTION_TAB_LABELS,
  RESULT_STATUS_TABS,
  RESULT_STATUS_TAB_LABELS,
  shouldShowGLOnlyTable,
  shouldShowPrimaryTable,
  type ResultFilters,
} from '@/lib/bankReconcileResultFilters';
import { DEFAULT_BANK_REVIEW_FLAGS, DEFAULT_GL_REVIEW_FLAGS } from '@/types/bankReconcile';
import type { BankReviewFlags, BankRow, GLReviewFlags, GLRow, SourceFileType } from '@/types/bankReconcile';
import type { LoadedSessionData, ReconcileSessionStatus, SaveStatus } from '@/types/bankReconcileSession';
import BankReconcileKpiCards from './BankReconcileKpiCards';
import BankReconcileResultTable from './BankReconcileResultTable';
import BankReconcileUnmatchedGL from './BankReconcileUnmatchedGL';
import BankReconcileSessionHeader from './BankReconcileSessionHeader';
import BankReconcileNoteDialog from './BankReconcileNoteDialog';
import BankReconcileTextPromptDialog from './BankReconcileTextPromptDialog';
import BankReconcileConfirmDialog from './BankReconcileConfirmDialog';

type NoteTarget = { kind: 'bank'; id: string } | { kind: 'gl'; id: string };

interface BankReconcileResultsProps {
  bankRows: BankRow[];
  glRows: GLRow[];
  bankFileName: string;
  glFileName: string;
  bankSourceFileType: SourceFileType;
  glSourceFileType: SourceFileType;
  /** null = ไม่มีทางย้อนกลับไปแก้ไขข้อมูลดิบได้อีก (เส้นทางเปิดรอบเดิมจากหน้ารายการ — ดูคอมเมนต์ที่
   * BankReconcilePage.tsx สำหรับเหตุผลที่ตัดเส้นทางนี้ออกสำหรับ session ที่โหลดมาแล้ว) */
  onBack: (() => void) | null;
  onBackToList: () => void;
  /** ไม่ null = เปิดรอบเดิมที่เคยบันทึกไว้แล้ว (ข้อมูล session/ธงตรวจสอบเริ่มต้นมาจากตรงนี้) */
  loadedSession: LoadedSessionData | null;
}

/**
 * หน้าจอผลการกระทบยอด — เขียนใหม่ทั้งไฟล์ 2026-07-17 พร้อมกับการ rebuild โมดูลทั้งโมดูล เป็น orchestrator หลัก
 * ของสเปกส่วน "13-20" (สรุปผล/ตัวกรอง/ตารางผลลัพธ์/ตาราง GL-only/ตรวจสอบ/ค้นหา/Export/บันทึก) ผลกระทบยอด
 * (matchOutput) คำนวณสดจาก bankRows/glRows ทุกครั้งผ่าน runSimpleReconciliation() เสมอ (useMemo) ไม่เคยถูก
 * บันทึกแยกต่างหาก — เมื่อผู้ใช้แก้ธงตรวจสอบ (ทำเครื่องหมาย/หมายเหตุ) จะไม่กระทบผลกระทบยอดเลยตามสเปก ("Flags
 * must never change match result")
 *
 * เก็บโครงสร้าง auto-save/nav-guard/unsaved-changes-protection เดิมของเฟส 4 ไว้ทั้งหมด (generic ล้วนๆ ไม่ผูก
 * กับโมเดลการจับคู่เดิมเลย) แต่ตัดกลไก "ล็อกการแก้ไขเมื่อปิดรอบ"/"validateSessionCompletion"/"audit log"/
 * "PDF export"/"คำนวณใหม่หลายโหมด" ออกทั้งหมด เพราะไม่มีในสเปกใหม่และขัดกับเจตนา "a new and simpler
 * reconciliation workflow" — ดู FINAL SUMMARY ตอนส่งมอบสำหรับรายละเอียดเต็ม
 */
export default function BankReconcileResults({
  bankRows: initialBankRows,
  glRows: initialGlRows,
  bankFileName,
  glFileName,
  bankSourceFileType,
  glSourceFileType,
  onBack,
  onBackToList,
  loadedSession,
}: BankReconcileResultsProps) {
  const { session: authSession } = useAuth();
  const actor = { id: authSession?.user?.id ?? null, email: authSession?.user?.email ?? null };

  const [bankRows, setBankRows] = useState(loadedSession?.bankRows ?? initialBankRows);
  const [glRows, setGlRows] = useState(loadedSession?.glRows ?? initialGlRows);
  const [bankReviewFlags, setBankReviewFlags] = useState<Record<string, BankReviewFlags>>(loadedSession?.bankReviewFlags ?? {});
  const [glReviewFlags, setGlReviewFlags] = useState<Record<string, GLReviewFlags>>(loadedSession?.glReviewFlags ?? {});

  const [sessionId, setSessionId] = useState<string | null>(loadedSession?.session.id ?? null);
  const [sessionName, setSessionName] = useState(loadedSession?.session.session_name ?? '');
  const [status, setStatus] = useState<ReconcileSessionStatus | null>(loadedSession?.session.status ?? null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(loadedSession?.session.updated_at ?? null);
  const [completedByEmail, setCompletedByEmail] = useState<string | null>(loadedSession?.session.completed_by_email ?? null);
  const [completedAt, setCompletedAt] = useState<string | null>(loadedSession?.session.completed_at ?? null);

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(loadedSession === null);
  const [filters, setFilters] = useState<ResultFilters>(DEFAULT_RESULT_FILTERS);
  const [noteTarget, setNoteTarget] = useState<NoteTarget | null>(null);
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [showToggleStatusConfirm, setShowToggleStatusConfirm] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);

  const matchOutput = useMemo(() => runSimpleReconciliation(bankRows, glRows), [bankRows, glRows]);
  const kpi = useMemo(() => computeReconcileSessionKpi(matchOutput), [matchOutput]);

  const visibleBankResults = useMemo(
    () => filterBankResults(matchOutput.bankResults, filters, bankReviewFlags),
    [matchOutput, filters, bankReviewFlags]
  );
  const visibleGLOnlyResults = useMemo(
    () => filterGLOnlyResults(matchOutput.glOnlyResults, filters, glReviewFlags),
    [matchOutput, filters, glReviewFlags]
  );
  const statusTabCounts = useMemo(
    () => computeStatusTabCounts(matchOutput, filters, bankReviewFlags, glReviewFlags),
    [matchOutput, filters, bankReviewFlags, glReviewFlags]
  );
  const directionTabCounts = useMemo(
    () => computeDirectionTabCounts(matchOutput, filters, bankReviewFlags, glReviewFlags),
    [matchOutput, filters, bankReviewFlags, glReviewFlags]
  );

  useEffect(() => {
    setBankReconcileDirty(dirty);
  }, [dirty]);

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  const saverRef = useRef<DebouncedSaver | null>(null);
  if (saverRef.current === null) {
    saverRef.current = createDebouncedSaver(() => {
      void performSave();
    });
  }
  useEffect(() => () => saverRef.current?.cancel(), []);

  function markDirtyAndScheduleSave() {
    setDirty(true);
    // auto-save เฉพาะ session ที่เคยบันทึกครั้งแรกแล้วเท่านั้น (มีชื่อ/sessionId แล้ว) — ก่อนบันทึกครั้งแรก
    // ต้องกดปุ่ม "บันทึก" เองเพื่อตั้งชื่อรอบก่อนเสมอ (ดู handleSaveClick ด้านล่าง)
    if (sessionId !== null) saverRef.current?.schedule();
  }

  async function performSave(nameOverride?: string) {
    setSaveStatus('saving');
    setSaveError(null);
    try {
      const result = await saveReconcileSession({
        sessionId,
        sessionName: nameOverride ?? sessionName,
        bankFileName,
        glFileName,
        bankSourceFileType,
        glSourceFileType,
        bankRows,
        glRows,
        bankReviewFlags,
        glReviewFlags,
        status: status ?? 'in_progress',
        actor,
      });
      setSessionId(result.session.id);
      setSessionName(result.session.session_name);
      setStatus(result.session.status);
      setUpdatedAt(result.session.updated_at);
      setCompletedByEmail(result.session.completed_by_email);
      setCompletedAt(result.session.completed_at);
      setBankRows(result.bankRows);
      setGlRows(result.glRows);
      setBankReviewFlags(result.bankReviewFlags);
      setGlReviewFlags(result.glReviewFlags);
      setSaveStatus('saved');
      setDirty(false);
    } catch (err) {
      console.error('[BankReconcileResults] บันทึกรอบกระทบยอดไม่สำเร็จ', err);
      setSaveStatus('error');
      setSaveError('บันทึกรอบกระทบยอดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    }
  }

  function handleSaveClick() {
    if (sessionId === null) {
      setShowNamePrompt(true);
      return;
    }
    void performSave();
  }

  async function handleExportExcel() {
    if (sessionId === null) return;
    try {
      const blob = await exportReconcileSessionExcel(sessionId);
      downloadBlob(blob, `กระทบยอดธนาคาร-${sessionName}.xlsx`);
    } catch (err) {
      console.error('[BankReconcileResults] Export Excel ไม่สำเร็จ', err);
      setSaveError('Export Excel ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    }
  }

  async function handleToggleStatusConfirm() {
    if (sessionId === null || status === null) return;
    setShowToggleStatusConfirm(false);
    const nextStatus: ReconcileSessionStatus = status === 'completed' ? 'in_progress' : 'completed';
    try {
      const updated = await updateReconcileSessionStatus(sessionId, nextStatus, actor);
      setStatus(updated.status);
      setUpdatedAt(updated.updated_at);
      setCompletedByEmail(updated.completed_by_email);
      setCompletedAt(updated.completed_at);
    } catch (err) {
      console.error('[BankReconcileResults] เปลี่ยนสถานะรอบกระทบยอดไม่สำเร็จ', err);
      setSaveError('เปลี่ยนสถานะรอบกระทบยอดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    }
  }

  function attemptLeave(action: () => void) {
    if (dirty) {
      setPendingLeave(() => action);
    } else {
      action();
    }
  }

  function updateBankFlag(bankRowId: string, patch: Partial<BankReviewFlags>) {
    setBankReviewFlags((prev) => ({ ...prev, [bankRowId]: { ...(prev[bankRowId] ?? DEFAULT_BANK_REVIEW_FLAGS), ...patch } }));
    markDirtyAndScheduleSave();
  }

  function updateGlFlag(glRowId: string, patch: Partial<GLReviewFlags>) {
    setGlReviewFlags((prev) => ({ ...prev, [glRowId]: { ...(prev[glRowId] ?? DEFAULT_GL_REVIEW_FLAGS), ...patch } }));
    markDirtyAndScheduleSave();
  }

  function updateFilters(patch: Partial<ResultFilters>) {
    setFilters((prev) => ({ ...prev, ...patch }));
  }

  return (
    <div className="space-y-5" data-testid="bank-reconcile-results">
      <BankReconcileSessionHeader
        sessionName={sessionName}
        status={status}
        saveStatus={saveStatus}
        updatedAt={updatedAt}
        completedByEmail={completedByEmail}
        completedAt={completedAt}
        hasSavedSession={sessionId !== null}
        onSave={handleSaveClick}
        onExportExcel={() => void handleExportExcel()}
        onToggleStatus={() => setShowToggleStatusConfirm(true)}
      />

      {saveError && (
        <p role="alert" className="rounded-[10px] border border-danger/20 bg-danger/10 px-3.5 py-2.5 text-sm text-danger" data-testid="reconcile-save-error">
          {saveError}
        </p>
      )}

      <BankReconcileKpiCards kpi={kpi} />

      {/* สเปกส่วน "14. SEGMENTED CONTROL" + "18. SEARCH AND FILTER" */}
      <div className="card-surface space-y-4 rounded-2xl p-4" data-testid="reconcile-filter-bar">
        <div className="flex flex-wrap gap-4">
          <div role="tablist" aria-label="กรองตามสถานะ" className="flex flex-wrap gap-1 rounded-full border border-border bg-white p-1" data-testid="reconcile-status-tabs">
            {RESULT_STATUS_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={filters.statusTab === tab}
                onClick={() => updateFilters({ statusTab: tab })}
                className={`btn-press rounded-full px-3.5 py-2 text-xs font-medium transition-colors ${filters.statusTab === tab ? 'bg-primary text-white shadow-sm' : 'text-text-sub hover:text-primary'}`}
                data-testid={`reconcile-status-tab-${tab}`}
              >
                {RESULT_STATUS_TAB_LABELS[tab]} ({statusTabCounts[tab].toLocaleString('th-TH')})
              </button>
            ))}
          </div>

          <div role="tablist" aria-label="กรองตามประเภทรายการ" className="flex flex-wrap gap-1 rounded-full border border-border bg-white p-1" data-testid="reconcile-direction-tabs">
            {RESULT_DIRECTION_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={filters.directionTab === tab}
                onClick={() => updateFilters({ directionTab: tab })}
                className={`btn-press rounded-full px-3.5 py-2 text-xs font-medium transition-colors ${filters.directionTab === tab ? 'bg-primary text-white shadow-sm' : 'text-text-sub hover:text-primary'}`}
                data-testid={`reconcile-direction-tab-${tab}`}
              >
                {RESULT_DIRECTION_TAB_LABELS[tab]} ({directionTabCounts[tab].toLocaleString('th-TH')})
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[220px] flex-1 flex-col gap-1.5 text-sm">
            <span className="font-medium text-text">ค้นหา</span>
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-sub" aria-hidden="true" />
              <input
                type="text"
                value={filters.search}
                onChange={(e) => updateFilters({ search: e.target.value })}
                placeholder="รายละเอียด / เลขที่เอกสาร GL / จำนวนเงิน"
                className="focus-ring-primary h-11 w-full rounded-[10px] border border-border bg-white pr-3 pl-9 text-sm text-text"
                data-testid="reconcile-search-input"
              />
            </div>
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-text">ตั้งแต่วันที่</span>
            <input
              type="date"
              value={filters.dateFrom ?? ''}
              onChange={(e) => updateFilters({ dateFrom: e.target.value || null })}
              className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-3 text-sm text-text"
              data-testid="reconcile-filter-date-from"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-text">ถึงวันที่</span>
            <input
              type="date"
              value={filters.dateTo ?? ''}
              onChange={(e) => updateFilters({ dateTo: e.target.value || null })}
              className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-3 text-sm text-text"
              data-testid="reconcile-filter-date-to"
            />
          </label>
          <label className="flex w-32 flex-col gap-1.5 text-sm">
            <span className="font-medium text-text">ยอดขั้นต่ำ</span>
            <input
              type="number"
              value={filters.amountMin}
              onChange={(e) => updateFilters({ amountMin: e.target.value })}
              className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-3 text-sm text-text"
              data-testid="reconcile-filter-amount-min"
            />
          </label>
          <label className="flex w-32 flex-col gap-1.5 text-sm">
            <span className="font-medium text-text">ยอดสูงสุด</span>
            <input
              type="number"
              value={filters.amountMax}
              onChange={(e) => updateFilters({ amountMax: e.target.value })}
              className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-3 text-sm text-text"
              data-testid="reconcile-filter-amount-max"
            />
          </label>
          <label className="flex w-40 flex-col gap-1.5 text-sm">
            <span className="font-medium text-text">การตรวจสอบ</span>
            <select
              value={filters.reviewedFilter}
              onChange={(e) => updateFilters({ reviewedFilter: e.target.value as ResultFilters['reviewedFilter'] })}
              className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-2 text-sm text-text"
              data-testid="reconcile-filter-reviewed"
            >
              <option value="all">ทั้งหมด</option>
              <option value="reviewed">ตรวจสอบแล้ว</option>
              <option value="not_reviewed">ยังไม่ตรวจสอบ</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => setFilters(DEFAULT_RESULT_FILTERS)}
            className="btn-press h-11 rounded-[10px] border border-border bg-white px-4 text-sm font-medium text-text-sub hover:bg-page-bg"
            data-testid="reconcile-clear-filters"
          >
            ล้างตัวกรอง
          </button>
        </div>
      </div>

      {shouldShowPrimaryTable(filters.statusTab) && (
        <BankReconcileResultTable
          rows={visibleBankResults}
          reviewFlags={bankReviewFlags}
          onToggleNeedsGlEntry={(id) => updateBankFlag(id, { needsGlEntry: !(bankReviewFlags[id]?.needsGlEntry ?? false) })}
          onToggleReviewed={(id) => updateBankFlag(id, { reviewed: !(bankReviewFlags[id]?.reviewed ?? false) })}
          onEditNote={(id) => setNoteTarget({ kind: 'bank', id })}
        />
      )}

      {shouldShowGLOnlyTable(filters.statusTab) && (
        <BankReconcileUnmatchedGL
          rows={visibleGLOnlyResults}
          reviewFlags={glReviewFlags}
          onToggleNeedsGlReview={(id) => updateGlFlag(id, { needsGlReview: !(glReviewFlags[id]?.needsGlReview ?? false) })}
          onToggleReviewed={(id) => updateGlFlag(id, { reviewed: !(glReviewFlags[id]?.reviewed ?? false) })}
          onEditNote={(id) => setNoteTarget({ kind: 'gl', id })}
        />
      )}

      <div className="flex flex-wrap justify-between gap-2.5 pt-2">
        <button
          type="button"
          onClick={() => attemptLeave(onBackToList)}
          className="btn-press rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-text-sub hover:bg-page-bg"
          data-testid="results-back-to-list"
        >
          ← กลับไปหน้ารายการ
        </button>
        {onBack && (
          <button
            type="button"
            onClick={() => attemptLeave(onBack)}
            className="btn-press rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-text-sub hover:bg-page-bg"
            data-testid="results-back-to-preview"
          >
            ย้อนกลับไปแก้ไขข้อมูล
          </button>
        )}
      </div>

      {noteTarget && (
        <BankReconcileNoteDialog
          title="เพิ่ม/แก้ไขหมายเหตุ"
          subtitle={
            noteTarget.kind === 'bank'
              ? bankRows.find((r) => r.id === noteTarget.id)?.description || ''
              : glRows.find((r) => r.id === noteTarget.id)?.description || ''
          }
          initialNote={(noteTarget.kind === 'bank' ? bankReviewFlags[noteTarget.id] : glReviewFlags[noteTarget.id])?.reviewNote ?? ''}
          onSave={(note) => {
            if (noteTarget.kind === 'bank') updateBankFlag(noteTarget.id, { reviewNote: note });
            else updateGlFlag(noteTarget.id, { reviewNote: note });
            setNoteTarget(null);
          }}
          onClose={() => setNoteTarget(null)}
        />
      )}

      {showNamePrompt && (
        <BankReconcileTextPromptDialog
          testIdPrefix="save-session"
          title="บันทึกรอบกระทบยอด"
          subtitle="ตั้งชื่อรอบกระทบยอดนี้ (แก้ไขภายหลังได้)"
          label="ชื่อรอบกระทบยอด"
          initialValue={sessionName || `กระทบยอด ${bankFileName}`}
          confirmLabel="บันทึกรอบกระทบยอด"
          onConfirm={(name) => {
            setSessionName(name);
            setShowNamePrompt(false);
            void performSave(name);
          }}
          onClose={() => setShowNamePrompt(false)}
        />
      )}

      {showToggleStatusConfirm && status && (
        <BankReconcileConfirmDialog
          testIdPrefix="toggle-status"
          title={status === 'completed' ? 'เปิดกลับมาแก้ไข' : 'ทำเครื่องหมายว่าเสร็จสมบูรณ์'}
          message={
            status === 'completed'
              ? 'ต้องการเปิดรอบกระทบยอดนี้กลับมาแก้ไขอีกครั้งหรือไม่?'
              : 'ต้องการทำเครื่องหมายรอบกระทบยอดนี้ว่าเสร็จสมบูรณ์หรือไม่? ยังแก้ไข/บันทึกต่อได้ตามปกติภายหลัง'
          }
          confirmLabel="ยืนยัน"
          onConfirm={() => void handleToggleStatusConfirm()}
          onClose={() => setShowToggleStatusConfirm(false)}
        />
      )}

      {pendingLeave && (
        <BankReconcileConfirmDialog
          testIdPrefix="unsaved-changes"
          title="มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก"
          message="ต้องการออกจากหน้านี้โดยไม่บันทึกการเปลี่ยนแปลงหรือไม่?"
          confirmLabel="ออกโดยไม่บันทึก"
          danger
          onConfirm={() => {
            const action = pendingLeave;
            setPendingLeave(null);
            action();
          }}
          onClose={() => setPendingLeave(null)}
        />
      )}
    </div>
  );
}
