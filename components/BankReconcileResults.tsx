'use client';

import { useMemo, useState } from 'react';
import {
  Banknote,
  CheckCircle2,
  CircleCheck,
  Clock,
  FileX,
  Landmark,
  Layers,
  SearchX,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { normalizeBankRows, normalizeGLRows } from '@/lib/bankReconcileNormalize';
import { isBankMappingComplete, isGLMappingComplete } from '@/lib/bankReconcileValidation';
import { toMatchBankRows, toMatchGLRows } from '@/lib/bankReconcileMatching';
import { computeGLOnlyTotal, DATE_TOLERANCE_DAYS, DATE_TOLERANCE_LABELS, DEFAULT_DATE_TOLERANCE } from '@/lib/bankReconcileMatchLogic';
import { buildMatchGroup, deriveMatchType, mergeManualMatches, undoMatchGroup } from '@/lib/bankReconcileManualMatch';
import {
  AMOUNT_TOLERANCE_LABELS,
  computeReconcileRowSummary,
  computeReconcileTabCounts,
  DEFAULT_AMOUNT_TOLERANCE,
  DEFAULT_RECONCILE_ROW_FILTERS,
  filterReconcileRows,
  formatGroupSummary,
  RECONCILE_TAB_LABELS,
  resolveAmountTolerance,
  type ReconcileRowFilters,
  type ReconcileTab,
} from '@/lib/bankReconcileManualMatchLogic';
import type {
  AmountToleranceOption,
  BankColumnMapping,
  DateToleranceOption,
  GLColumnMapping,
  MatchGLRow,
  MatchGroup,
  ReconcileRow,
  ReviewFlag,
  RowNote,
  UploadedFileState,
} from '@/types/bankReconcile';
import BankReconcileResultTable from './BankReconcileResultTable';
import BankReconcileCandidatesModal from './BankReconcileCandidatesModal';
import BankReconcileDetailDrawer from './BankReconcileDetailDrawer';
import BankReconcileUnmatchedGL from './BankReconcileUnmatchedGL';
import BankReconcileNoteDialog from './BankReconcileNoteDialog';
import BankReconcileUndoConfirmDialog from './BankReconcileUndoConfirmDialog';
import BankReconcileConfirmMatchDialog from './BankReconcileConfirmMatchDialog';
import BankReconcileMatchDrawer from './BankReconcileMatchDrawer';
import BankReconcileGroupDetailDrawer from './BankReconcileGroupDetailDrawer';

const THB2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

interface BankReconcileResultsProps {
  bankFile: UploadedFileState | null;
  glFile: UploadedFileState | null;
  bankMapping: BankColumnMapping;
  glMapping: GLColumnMapping;
  onBack: () => void;
}

const SEGMENTED_TABS: ReconcileTab[] = [
  'all',
  'matched_exact',
  'matched_tolerance',
  'confirmed',
  'ambiguous',
  'pending_review',
  'review_required',
  'not_found_in_gl',
];

const TOLERANCE_OPTIONS: DateToleranceOption[] = ['same_day', '1_day', '3_days', '7_days'];
const AMOUNT_TOLERANCE_OPTIONS: AmountToleranceOption[] = ['zero', 'small', 'one', 'custom'];

/** เป้าหมายที่กำลังแก้ไขหมายเหตุอยู่ — แถวเดี่ยว (RowNote ก่อนจับคู่) หรือกลุ่มจับคู่ด้วยตนเอง (MatchGroup.note)
 * เก็บแค่ id ไม่เก็บ object เต็ม เพื่อ derive ค่าล่าสุดจาก state จริงเสมอ (ดูหมายเหตุที่ viewingGroupId ด้านล่าง) */
type NoteEditTarget = { kind: 'row'; bankRowId: string } | { kind: 'group'; groupId: string };

/**
 * เฟส 3 ของ Bank Reconcile — เพิ่มเครื่องมือจับคู่รายการด้วยตนเอง (Manual Reconciliation) เข้าไปในเฟส 2 เดิม
 * ทำหน้าที่เป็น orchestrator เดียวที่คุมทุกอย่างเหมือนเดิม แค่เพิ่มชั้น "จับคู่ด้วยตนเอง" คั่นก่อนแสดงผล:
 * normalize (เฟส 1 เดิม ไม่แตะ) -> แปลงเป็นมุมมองจับคู่ (เฟส 2 เดิม ไม่แตะ) -> mergeManualMatches() (เฟส 3 ใหม่
 * — กรองแถวที่จับคู่ด้วยตนเองแล้วออกก่อน แล้วเรียก runReconciliationMatch() เดิมของเฟส 2 ตรงๆ กับส่วนที่เหลือ
 * แล้วผสานกลับ) -> กรอง/นับ/สรุป (เฟส 3 ใหม่ ขนานกับของเฟส 2) -> ส่งต่อให้ตาราง/การ์ด/Modal/Drawer แสดงผล
 * ทุกอย่างยังเป็น client-side ล้วนๆ ในหน่วยความจำเบราว์เซอร์เท่านั้นเหมือนเดิม ไม่มีการบันทึกฐานข้อมูล/persist
 * session ใดๆ ตามสเปกเฟส 3 ตรงๆ ("Do not implement save session, database persistence... yet — Phase 4")
 *
 * state ใหม่ทั้งหมดของเฟส 3 (matchGroups/reviewFlags/notes/amountToleranceOption/selectedBankIds) อยู่ในหน่วยความจำ
 * ล้วนๆ เหมือนกับ flaggedIds เดิมของเฟส 2 ทุกประการ (หายเมื่อรีเฟรชหน้า) — ปุ่ม "ทำเครื่องหมายรอตรวจสอบ" เดิม
 * ของเฟส 2 ถูกอัปเกรดให้ผูกกับ ReviewFlag ของเฟส 3 แทน flaggedIds Set เดิม (พฤติกรรม/DOM/testid ที่ผู้ใช้เห็น
 * เหมือนเดิมทุกประการ แค่โครงสร้างข้อมูลภายในเก็บ reviewed_by/reviewed_at เพิ่มตามสเปกเฟส 3 ส่วน "7. MARK FOR
 * REVIEW" — เป็นดุลยพินิจที่ตัดสินใจเอง ระบุไว้ในสรุปผล เพราะสองฟีเจอร์นี้ใช้ปุ่ม/ป้ายกำกับเดียวกันเป๊ะตามสเปก)
 *
 * Dialog/Drawer ที่เปิดอยู่ทั้งหมดเก็บแค่ "id" ไม่เก็บ object เต็ม (viewingGroupId ไม่ใช่ viewingGroup object) แล้ว
 * derive ค่าจริงจาก state ล่าสุดทุกครั้งที่ render (rowById.get(id)/matchGroups.find(...)) กัน bug ข้อมูลค้าง
 * (stale) เวลามีการแก้ไขบางอย่าง (เช่น แก้หมายเหตุ) ขณะที่ modal เดิมยังเปิดค้างอยู่ — ปลอดภัยกว่าการเก็บ
 * snapshot object ไว้ตรงๆ ซึ่งจะไม่อัปเดตตามการเปลี่ยนแปลงของ state ต้นทางเอง
 */
export default function BankReconcileResults({
  bankFile,
  glFile,
  bankMapping,
  glMapping,
  onBack,
}: BankReconcileResultsProps) {
  const { session } = useAuth();
  const currentUserEmail = session?.user?.email ?? '';

  const [dateTolerance, setDateTolerance] = useState<DateToleranceOption>(DEFAULT_DATE_TOLERANCE);
  const [amountToleranceOption, setAmountToleranceOption] = useState<AmountToleranceOption>(DEFAULT_AMOUNT_TOLERANCE);
  const [customAmountTolerance, setCustomAmountTolerance] = useState(0);
  const [filters, setFilters] = useState<ReconcileRowFilters>(DEFAULT_RECONCILE_ROW_FILTERS);
  const [searchDraft, setSearchDraft] = useState('');

  // เฟส 3: ความสัมพันธ์การจับคู่ด้วยตนเองทั้งหมด เก็บแยกจากข้อมูล Bank/GL ต้นฉบับเสมอ (ไม่แก้ไข matchBankRows/
  // matchGLRows ที่ไหนเลยทั้งไฟล์นี้ ตามสเปก "Store matching relationships separately from Bank and GL data")
  const [matchGroups, setMatchGroups] = useState<MatchGroup[]>([]);
  const [reviewFlags, setReviewFlags] = useState<Record<string, ReviewFlag>>({});
  const [notes, setNotes] = useState<Record<string, RowNote>>({});
  const [selectedBankIds, setSelectedBankIds] = useState<Set<string>>(new Set());

  // Dialog/Drawer ที่เปิดอยู่ — เก็บ id ล้วนๆ (ดูหมายเหตุด้านบน)
  const [viewingDetailId, setViewingDetailId] = useState<string | null>(null);
  const [viewingCandidatesId, setViewingCandidatesId] = useState<string | null>(null);
  const [confirmingSuggestedId, setConfirmingSuggestedId] = useState<string | null>(null);
  const [matchDrawerBankIds, setMatchDrawerBankIds] = useState<string[] | null>(null);
  const [undoingGroupId, setUndoingGroupId] = useState<string | null>(null);
  const [viewingGroupId, setViewingGroupId] = useState<string | null>(null);
  const [noteEditTarget, setNoteEditTarget] = useState<NoteEditTarget | null>(null);

  const filesReady =
    Boolean(bankFile?.validation.valid) &&
    Boolean(glFile?.validation.valid) &&
    isBankMappingComplete(bankMapping) &&
    isGLMappingComplete(glMapping);

  const normalizedBank = useMemo(
    () => (bankFile ? normalizeBankRows(bankFile.table, bankMapping) : []),
    [bankFile, bankMapping]
  );
  const normalizedGL = useMemo(() => (glFile ? normalizeGLRows(glFile.table, glMapping) : []), [glFile, glMapping]);

  const matchBankRows = useMemo(
    () => (bankFile ? toMatchBankRows(bankFile.table, normalizedBank) : []),
    [bankFile, normalizedBank]
  );
  const matchGLRows = useMemo(
    () => (glFile ? toMatchGLRows(glFile.table, normalizedGL) : []),
    [glFile, normalizedGL]
  );

  const toleranceDays = DATE_TOLERANCE_DAYS[dateTolerance];
  const amountTolerance = useMemo(
    () => resolveAmountTolerance(amountToleranceOption, customAmountTolerance),
    [amountToleranceOption, customAmountTolerance]
  );

  // หัวใจของเฟส 3 — ผสานผลจับคู่ด้วยตนเองเข้ากับเอนจินอัตโนมัติเดิมของเฟส 2 (ดูหมายเหตุยาวที่
  // mergeManualMatches ใน lib/bankReconcileManualMatch.ts)
  const mergedOutput = useMemo(
    () =>
      mergeManualMatches({
        matchBankRows,
        matchGLRows,
        toleranceDays,
        matchGroups,
        reviewFlags,
        notes,
      }),
    [matchBankRows, matchGLRows, toleranceDays, matchGroups, reviewFlags, notes]
  );

  const rowById = useMemo(() => new Map(mergedOutput.rows.map((r) => [r.bank.bank_row_id, r] as const)), [mergedOutput.rows]);

  const tabCounts = useMemo(() => computeReconcileTabCounts(mergedOutput.rows), [mergedOutput.rows]);
  const glOnlyTotal = useMemo(() => computeGLOnlyTotal(mergedOutput.glOnlyResults), [mergedOutput.glOnlyResults]);
  const summary = useMemo(
    () => computeReconcileRowSummary(mergedOutput.rows, mergedOutput.glOnlyResults.length, glOnlyTotal),
    [mergedOutput.rows, mergedOutput.glOnlyResults, glOnlyTotal]
  );
  const filteredRows = useMemo(() => filterReconcileRows(mergedOutput.rows, filters), [mergedOutput.rows, filters]);

  // ---- derive ข้อมูลของ dialog/drawer ที่เปิดอยู่จาก id เสมอ (ไม่เก็บ snapshot) ----
  const viewingDetail = viewingDetailId ? rowById.get(viewingDetailId) ?? null : null;
  const viewingCandidates = viewingCandidatesId ? rowById.get(viewingCandidatesId) ?? null : null;
  const confirmingSuggested = confirmingSuggestedId ? rowById.get(confirmingSuggestedId) ?? null : null;
  const matchDrawerBankRows = useMemo(
    () => (matchDrawerBankIds ? matchBankRows.filter((b) => matchDrawerBankIds.includes(b.bank_row_id)) : null),
    [matchDrawerBankIds, matchBankRows]
  );
  const undoingGroup = undoingGroupId ? matchGroups.find((g) => g.match_group_id === undoingGroupId) ?? null : null;
  const undoingGroupBankRows = useMemo(
    () => (undoingGroup ? matchBankRows.filter((b) => undoingGroup.bank_transaction_ids.includes(b.bank_row_id)) : []),
    [undoingGroup, matchBankRows]
  );
  const undoingGroupGLRows = useMemo(
    () => (undoingGroup ? matchGLRows.filter((g) => undoingGroup.gl_transaction_ids.includes(g.gl_row_id)) : []),
    [undoingGroup, matchGLRows]
  );
  const viewingGroup = viewingGroupId ? matchGroups.find((g) => g.match_group_id === viewingGroupId) ?? null : null;
  const viewingGroupBankRows = useMemo(
    () => (viewingGroup ? matchBankRows.filter((b) => viewingGroup.bank_transaction_ids.includes(b.bank_row_id)) : []),
    [viewingGroup, matchBankRows]
  );
  const viewingGroupGLRows = useMemo(
    () => (viewingGroup ? matchGLRows.filter((g) => viewingGroup.gl_transaction_ids.includes(g.gl_row_id)) : []),
    [viewingGroup, matchGLRows]
  );
  const noteEditContext = useMemo(() => {
    if (!noteEditTarget) return null;
    if (noteEditTarget.kind === 'group') {
      const group = matchGroups.find((g) => g.match_group_id === noteEditTarget.groupId);
      if (!group) return null;
      return { title: 'แก้ไขหมายเหตุ', subtitle: formatGroupSummary(group), initialNote: group.note };
    }
    const row = rowById.get(noteEditTarget.bankRowId);
    if (!row) return null;
    return {
      title: row.note ? 'แก้ไขหมายเหตุ' : 'เพิ่มหมายเหตุ',
      subtitle: row.bank.bank_description || '-',
      initialNote: row.note?.note ?? '',
    };
  }, [noteEditTarget, matchGroups, rowById]);

  function handleTabClick(tab: ReconcileTab) {
    setFilters((prev) => ({ ...prev, tab }));
  }

  function handleSearchSubmit() {
    setFilters((prev) => ({ ...prev, search: searchDraft }));
  }

  function handleClearFilters() {
    setSearchDraft('');
    setFilters(DEFAULT_RECONCILE_ROW_FILTERS);
  }

  function handleToggleReviewFlag(row: ReconcileRow) {
    const id = row.bank.bank_row_id;
    setReviewFlags((prev) => {
      const next = { ...prev };
      if (next[id]) {
        delete next[id];
      } else {
        next[id] = { review_required: true, reviewed_by: currentUserEmail, reviewed_at: new Date().toISOString() };
      }
      return next;
    });
  }

  function handleEditNote(row: ReconcileRow) {
    setNoteEditTarget(
      row.matchGroup ? { kind: 'group', groupId: row.matchGroup.match_group_id } : { kind: 'row', bankRowId: row.bank.bank_row_id }
    );
  }

  function handleSaveNote(noteText: string) {
    if (!noteEditTarget) return;
    if (noteEditTarget.kind === 'group') {
      const groupId = noteEditTarget.groupId;
      setMatchGroups((prev) => prev.map((g) => (g.match_group_id === groupId ? { ...g, note: noteText } : g)));
    } else {
      const id = noteEditTarget.bankRowId;
      setNotes((prev) => ({
        ...prev,
        [id]: { note: noteText, updated_by: currentUserEmail, updated_at: new Date().toISOString() },
      }));
    }
    setNoteEditTarget(null);
  }

  function handleToggleSelectBank(bankRowId: string) {
    setSelectedBankIds((prev) => {
      const next = new Set(prev);
      if (next.has(bankRowId)) next.delete(bankRowId);
      else next.add(bankRowId);
      return next;
    });
  }

  function handleCombineSelectedBankRows() {
    if (selectedBankIds.size < 2) return;
    setMatchDrawerBankIds(Array.from(selectedBankIds));
  }

  function handleConfirmSuggested(note: string, suggestedGL: MatchGLRow) {
    if (!confirmingSuggested) return;
    const group = buildMatchGroup({
      matchGroupId: `mg-${crypto.randomUUID()}`,
      matchType: deriveMatchType(1, 1, 'suggested'),
      bankRows: [confirmingSuggested.bank],
      glRows: [suggestedGL],
      matchedBy: currentUserEmail,
      matchedAt: new Date().toISOString(),
      note,
      amountTolerance,
      autoMatchScore: confirmingSuggested.matchScore,
      autoMatchReason: confirmingSuggested.matchReason,
    });
    setMatchGroups((prev) => [...prev, group]);
    setConfirmingSuggestedId(null);
  }

  function handleMatchDrawerConfirm(selectedGLRows: MatchGLRow[], note: string) {
    if (!matchDrawerBankRows || matchDrawerBankRows.length === 0) return;
    const group = buildMatchGroup({
      matchGroupId: `mg-${crypto.randomUUID()}`,
      matchType: deriveMatchType(matchDrawerBankRows.length, selectedGLRows.length, 'manual'),
      bankRows: matchDrawerBankRows,
      glRows: selectedGLRows,
      matchedBy: currentUserEmail,
      matchedAt: new Date().toISOString(),
      note,
      amountTolerance,
      autoMatchScore: null,
      autoMatchReason: null,
    });
    setMatchGroups((prev) => [...prev, group]);
    setSelectedBankIds(new Set());
    setMatchDrawerBankIds(null);
  }

  function handleUndoMatchFromRow(row: ReconcileRow) {
    if (!row.matchGroup) return;
    setUndoingGroupId(row.matchGroup.match_group_id);
  }

  function handleRequestUndoFromGroupDrawer() {
    if (!viewingGroupId) return;
    setUndoingGroupId(viewingGroupId);
    setViewingGroupId(null);
  }

  function handleUndoConfirmed() {
    if (!undoingGroupId) return;
    setMatchGroups((prev) => undoMatchGroup(prev, undoingGroupId));
    setUndoingGroupId(null);
  }

  function handleRequestEditMatch() {
    if (!viewingGroupId) return;
    const group = matchGroups.find((g) => g.match_group_id === viewingGroupId);
    if (!group) return;
    setMatchGroups((prev) => undoMatchGroup(prev, viewingGroupId));
    setViewingGroupId(null);
    setMatchDrawerBankIds(group.bank_transaction_ids);
  }

  if (!filesReady) {
    return (
      <div
        className="card-surface rounded-2xl border border-dashed border-border bg-card-bg p-12 text-center text-sm text-text-sub"
        data-testid="reconcile-results-empty"
      >
        กรุณาอัปโหลดและตรวจสอบไฟล์ในขั้นตอนก่อนหน้า
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="reconcile-results">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onBack}
          className="btn-press rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-text hover:bg-page-bg"
          data-testid="done-back-to-mapping"
        >
          ← กลับไปแก้ไขการจับคู่คอลัมน์
        </button>
      </div>

      <div className="card-surface flex flex-wrap items-center gap-3 rounded-2xl p-4">
        <label htmlFor="date-tolerance-select" className="text-sm font-medium text-text">
          ช่วงวันที่ที่ยอมรับได้ (Date Tolerance)
        </label>
        <select
          id="date-tolerance-select"
          value={dateTolerance}
          onChange={(e) => setDateTolerance(e.target.value as DateToleranceOption)}
          className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-3 text-sm text-text"
          data-testid="date-tolerance-select"
        >
          {TOLERANCE_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {DATE_TOLERANCE_LABELS[opt]}
            </option>
          ))}
        </select>

        <span className="hidden h-8 w-px bg-border sm:block" aria-hidden="true" />

        <label htmlFor="amount-tolerance-select" className="text-sm font-medium text-text">
          ค่าคลาดเคลื่อนของยอดเงินที่ยอมรับได้ (Amount Tolerance)
        </label>
        <select
          id="amount-tolerance-select"
          value={amountToleranceOption}
          onChange={(e) => setAmountToleranceOption(e.target.value as AmountToleranceOption)}
          className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-3 text-sm text-text"
          data-testid="amount-tolerance-select"
        >
          {AMOUNT_TOLERANCE_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {AMOUNT_TOLERANCE_LABELS[opt]}
            </option>
          ))}
        </select>
        {amountToleranceOption === 'custom' && (
          <input
            type="number"
            min={0}
            step={0.01}
            value={customAmountTolerance}
            onChange={(e) => setCustomAmountTolerance(Number(e.target.value))}
            className="focus-ring-primary h-11 w-32 rounded-[10px] border border-border bg-white px-3 text-sm text-text"
            data-testid="amount-tolerance-custom-input"
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <KpiCard
          testId="kpi-total-bank"
          icon={Landmark}
          iconBg="bg-primary/15"
          iconColor="text-primary"
          label="รายการ Bank ทั้งหมด"
          value={summary.totalBank.toLocaleString('th-TH')}
        />
        <KpiCard
          testId="kpi-matched-exact"
          icon={CheckCircle2}
          iconBg="bg-success/15"
          iconColor="text-success"
          label="กระทบยอดเรียบร้อย"
          value={summary.matchedExact.toLocaleString('th-TH')}
        />
        <KpiCard
          testId="kpi-matched-tolerance"
          icon={CircleCheck}
          iconBg="bg-primary/15"
          iconColor="text-primary"
          label="น่าจะตรงกัน"
          value={summary.matchedTolerance.toLocaleString('th-TH')}
        />
        <KpiCard
          testId="kpi-confirmed-manual"
          icon={ShieldCheck}
          iconBg="bg-teal-100"
          iconColor="text-teal-700"
          label="ยืนยันด้วยตนเอง"
          value={summary.confirmedManual.toLocaleString('th-TH')}
        />
        <KpiCard
          testId="kpi-ambiguous"
          icon={Layers}
          iconBg="bg-orange-100"
          iconColor="text-orange-700"
          label="พบหลายรายการ"
          value={summary.ambiguous.toLocaleString('th-TH')}
        />
        <KpiCard
          testId="kpi-pending-review"
          icon={Clock}
          iconBg="bg-warning/15"
          iconColor="text-warning"
          label="รอตรวจสอบ"
          value={summary.pendingReview.toLocaleString('th-TH')}
        />
        <KpiCard
          testId="kpi-not-found-gl"
          icon={SearchX}
          iconBg="bg-danger/15"
          iconColor="text-danger"
          label="ไม่พบใน GL"
          value={summary.notFoundInGL.toLocaleString('th-TH')}
        />
        <KpiCard
          testId="kpi-not-found-bank"
          icon={FileX}
          iconBg="bg-purple-100"
          iconColor="text-purple-700"
          label="GL ไม่พบใน Bank"
          value={summary.notFoundInBank.toLocaleString('th-TH')}
        />
        <KpiCard
          testId="kpi-total-difference"
          icon={Banknote}
          iconBg="bg-page-bg"
          iconColor="text-text-sub"
          label="ผลต่างรวม (บาท)"
          value={summary.totalDifference.toLocaleString('th-TH', THB2)}
        />
      </div>

      <div className="flex flex-wrap gap-2" data-testid="reconcile-segmented-control">
        {SEGMENTED_TABS.map((tab) => {
          const isActive = filters.tab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => handleTabClick(tab)}
              className={`btn-press rounded-full px-4 py-2 text-xs font-semibold ${
                isActive
                  ? 'bg-primary text-white shadow-sm'
                  : 'border border-border bg-white text-text-sub hover:bg-page-bg'
              }`}
              data-testid={`reconcile-tab-${tab}`}
            >
              {RECONCILE_TAB_LABELS[tab]} ({tabCounts[tab].toLocaleString('th-TH')})
            </button>
          );
        })}
      </div>

      <div className="card-surface flex flex-wrap items-end gap-3 rounded-2xl p-4">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1.5 text-sm">
          <span className="font-medium text-text">ค้นหา</span>
          <input
            type="text"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearchSubmit();
            }}
            placeholder="รายละเอียด Bank, เลขที่เอกสาร GL, รายละเอียด GL, จำนวนเงิน, หมายเหตุ, ผู้ยืนยัน"
            className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-3 text-sm text-text"
            data-testid="reconcile-search-input"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-text">ตั้งแต่วันที่</span>
          <input
            type="date"
            value={filters.dateFrom ?? ''}
            onChange={(e) => setFilters((prev) => ({ ...prev, dateFrom: e.target.value || null }))}
            className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-3 text-sm text-text"
            data-testid="reconcile-date-from"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-text">ถึงวันที่</span>
          <input
            type="date"
            value={filters.dateTo ?? ''}
            onChange={(e) => setFilters((prev) => ({ ...prev, dateTo: e.target.value || null }))}
            className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-3 text-sm text-text"
            data-testid="reconcile-date-to"
          />
        </label>
        <label className="flex w-32 flex-col gap-1.5 text-sm">
          <span className="font-medium text-text">ยอดต่ำสุด</span>
          <input
            type="number"
            value={filters.amountMin ?? ''}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, amountMin: e.target.value === '' ? null : Number(e.target.value) }))
            }
            className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-3 text-sm text-text"
            data-testid="reconcile-amount-min"
          />
        </label>
        <label className="flex w-32 flex-col gap-1.5 text-sm">
          <span className="font-medium text-text">ยอดสูงสุด</span>
          <input
            type="number"
            value={filters.amountMax ?? ''}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, amountMax: e.target.value === '' ? null : Number(e.target.value) }))
            }
            className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-3 text-sm text-text"
            data-testid="reconcile-amount-max"
          />
        </label>
        <button
          type="button"
          onClick={handleSearchSubmit}
          className="btn-press h-11 rounded-[10px] bg-primary px-4 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover"
          data-testid="reconcile-search-submit"
        >
          ค้นหา
        </button>
        <button
          type="button"
          onClick={handleClearFilters}
          className="btn-press h-11 rounded-[10px] border border-border bg-white px-4 text-sm font-medium text-text-sub hover:bg-page-bg"
          data-testid="reconcile-clear-filters"
        >
          ล้างตัวกรอง
        </button>
      </div>

      {selectedBankIds.size > 0 && (
        <div
          className="card-surface flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4"
          data-testid="reconcile-combine-bar"
        >
          <p className="text-sm font-medium text-text">
            เลือกไว้ {selectedBankIds.size} รายการ — รวมรายการ Bank เหล่านี้เพื่อจับคู่กับ GL รายการเดียวกัน
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSelectedBankIds(new Set())}
              className="btn-press rounded-[10px] border border-border bg-white px-3.5 py-2 text-xs font-medium text-text-sub hover:bg-page-bg"
              data-testid="reconcile-combine-clear"
            >
              ล้างการเลือก
            </button>
            <button
              type="button"
              disabled={selectedBankIds.size < 2}
              onClick={handleCombineSelectedBankRows}
              className="btn-press rounded-[10px] bg-primary px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="reconcile-combine-confirm"
            >
              รวมรายการ Bank เพื่อจับคู่
            </button>
          </div>
        </div>
      )}

      <BankReconcileResultTable
        results={filteredRows}
        selectedBankIds={selectedBankIds}
        onToggleSelect={handleToggleSelectBank}
        onViewDetail={(row) => setViewingDetailId(row.bank.bank_row_id)}
        onViewCandidates={(row) => setViewingCandidatesId(row.bank.bank_row_id)}
        onToggleReviewFlag={handleToggleReviewFlag}
        onEditNote={handleEditNote}
        onConfirmSuggested={(row) => setConfirmingSuggestedId(row.bank.bank_row_id)}
        onSelectGL={(row) => setMatchDrawerBankIds([row.bank.bank_row_id])}
        onUndoMatch={handleUndoMatchFromRow}
        onViewGroup={(group) => setViewingGroupId(group.match_group_id)}
      />

      <BankReconcileUnmatchedGL glOnlyResults={mergedOutput.glOnlyResults} />

      {viewingDetail && (
        <BankReconcileDetailDrawer
          result={viewingDetail}
          onViewGroup={(group) => {
            setViewingDetailId(null);
            setViewingGroupId(group.match_group_id);
          }}
          onClose={() => setViewingDetailId(null)}
        />
      )}
      {viewingCandidates && (
        <BankReconcileCandidatesModal result={viewingCandidates} onClose={() => setViewingCandidatesId(null)} />
      )}
      {confirmingSuggested && (
        <BankReconcileConfirmMatchDialog
          row={confirmingSuggested}
          onConfirm={handleConfirmSuggested}
          onClose={() => setConfirmingSuggestedId(null)}
        />
      )}
      {matchDrawerBankRows && matchDrawerBankRows.length > 0 && (
        <BankReconcileMatchDrawer
          bankRows={matchDrawerBankRows}
          glRows={matchGLRows}
          consumedBankIds={mergedOutput.consumedBankIds}
          consumedGLIds={mergedOutput.consumedGLIds}
          autoUsedGLIds={mergedOutput.autoUsedGLIds}
          amountTolerance={amountTolerance}
          onConfirm={handleMatchDrawerConfirm}
          onClose={() => setMatchDrawerBankIds(null)}
        />
      )}
      {undoingGroup && (
        <BankReconcileUndoConfirmDialog
          group={undoingGroup}
          bankRows={undoingGroupBankRows}
          glRows={undoingGroupGLRows}
          onConfirm={handleUndoConfirmed}
          onClose={() => setUndoingGroupId(null)}
        />
      )}
      {viewingGroup && (
        <BankReconcileGroupDetailDrawer
          group={viewingGroup}
          bankRows={viewingGroupBankRows}
          glRows={viewingGroupGLRows}
          onRequestEditMatch={handleRequestEditMatch}
          onRequestUndoMatch={handleRequestUndoFromGroupDrawer}
          onRequestEditNote={() => setNoteEditTarget({ kind: 'group', groupId: viewingGroup.match_group_id })}
          onClose={() => setViewingGroupId(null)}
        />
      )}
      {noteEditContext && (
        <BankReconcileNoteDialog
          title={noteEditContext.title}
          subtitle={noteEditContext.subtitle}
          initialNote={noteEditContext.initialNote}
          onSave={handleSaveNote}
          onClose={() => setNoteEditTarget(null)}
        />
      )}
    </div>
  );
}

function KpiCard({
  testId,
  icon: Icon,
  iconBg,
  iconColor,
  label,
  value,
}: {
  testId: string;
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
  label: string;
  value: string;
}) {
  return (
    <div className="card-surface card-hover-lift rounded-2xl p-5" data-testid={testId}>
      <div className={`flex h-10 w-10 items-center justify-center rounded-full ${iconBg} ${iconColor}`}>
        <Icon size={18} aria-hidden="true" />
      </div>
      <p className="font-numeric mt-3 text-xl font-bold text-text" data-testid={`${testId}-value`}>
        {value}
      </p>
      <p className="mt-1 text-xs text-text-sub">{label}</p>
    </div>
  );
}
