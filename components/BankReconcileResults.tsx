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
  type LucideIcon,
} from 'lucide-react';
import { normalizeBankRows, normalizeGLRows } from '@/lib/bankReconcileNormalize';
import { isBankMappingComplete, isGLMappingComplete } from '@/lib/bankReconcileValidation';
import { runReconciliationMatch, toMatchBankRows, toMatchGLRows } from '@/lib/bankReconcileMatching';
import {
  computeReconcileSummary,
  computeStatusCounts,
  DATE_TOLERANCE_DAYS,
  DATE_TOLERANCE_LABELS,
  DEFAULT_DATE_TOLERANCE,
  DEFAULT_RECONCILE_FILTERS,
  filterBankResults,
  type ReconcileFilters,
} from '@/lib/bankReconcileMatchLogic';
import type {
  BankColumnMapping,
  BankMatchResult,
  BankRowMatchStatus,
  DateToleranceOption,
  GLColumnMapping,
  UploadedFileState,
} from '@/types/bankReconcile';
import BankReconcileResultTable from './BankReconcileResultTable';
import BankReconcileCandidatesModal from './BankReconcileCandidatesModal';
import BankReconcileDetailDrawer from './BankReconcileDetailDrawer';
import BankReconcileUnmatchedGL from './BankReconcileUnmatchedGL';

const THB2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

interface BankReconcileResultsProps {
  bankFile: UploadedFileState | null;
  glFile: UploadedFileState | null;
  bankMapping: BankColumnMapping;
  glMapping: GLColumnMapping;
  onBack: () => void;
}

const SEGMENTED_TABS: Array<{ value: BankRowMatchStatus | 'all'; label: string }> = [
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'matched_exact', label: 'เรียบร้อย' },
  { value: 'matched_tolerance', label: 'น่าจะตรงกัน' },
  { value: 'ambiguous', label: 'พบหลายรายการ' },
  { value: 'pending_review', label: 'รอตรวจสอบ' },
  { value: 'not_found_in_gl', label: 'ไม่พบใน GL' },
];

const TOLERANCE_OPTIONS: DateToleranceOption[] = ['same_day', '1_day', '3_days', '7_days'];

/**
 * เฟส 2 ของ Bank Reconcile — เครื่องมือจับคู่รายการ + ตารางผลลัพธ์ ทำหน้าที่เป็น orchestrator เดียวที่คุม
 * ทุกอย่าง: normalize (เฟส 1 เดิม ไม่แตะ) -> แปลงเป็นมุมมองจับคู่ (lib/bankReconcileMatching.ts) -> รันจับคู่
 * -> กรอง/นับ/สรุป (lib/bankReconcileMatchLogic.ts) -> ส่งต่อให้ตาราง/การ์ด/Modal แสดงผล ทุกอย่างเป็น
 * client-side ล้วนๆ ในหน่วยความจำเบราว์เซอร์เท่านั้น ไม่มีการบันทึกฐานข้อมูล/persist session ใดๆ ตามสเปกเฟส 2
 * ("Do not create production database records yet... Save session [เป็นเฟสถัดไป]") การทำเครื่องหมาย
 * "รอตรวจสอบ" ด้วยตนเอง (flaggedIds) เป็นแค่ state ชั่วคราวในหน่วยความจำ หายเมื่อรีเฟรชหน้า ไม่ใช่การยืนยัน/
 * แก้ไขผลการจับคู่ใดๆ ("Do not implement manual confirmation or manual selection yet")
 *
 * KPI cards + ตัวนับบน Segmented Control คำนวณจากผลลัพธ์ "ทั้งหมด" เสมอ (matchOutput ทั้งก้อน) ไม่ผูกกับ
 * search/filters/แท็บที่เลือกอยู่ในขณะนั้น — เป็นดุลยพินิจที่ตัดสินใจเอง (ธรรมเนียม overview dashboard ทั่วไป
 * ที่ตัวเลขสรุปต้องนิ่ง ไม่กระโดดตามตัวกรองที่ผู้ใช้กำลังไล่ดูอยู่) เปลี่ยนค่าจริงเฉพาะตอน tolerance เปลี่ยน
 * หรือรันจับคู่ใหม่เท่านั้น ส่วนตัวกรอง/ค้นหา/Segmented Control มีผลแค่กับ "ตาราง" ที่แสดงผลด้านล่าง
 */
export default function BankReconcileResults({
  bankFile,
  glFile,
  bankMapping,
  glMapping,
  onBack,
}: BankReconcileResultsProps) {
  const [dateTolerance, setDateTolerance] = useState<DateToleranceOption>(DEFAULT_DATE_TOLERANCE);
  const [filters, setFilters] = useState<ReconcileFilters>(DEFAULT_RECONCILE_FILTERS);
  const [searchDraft, setSearchDraft] = useState('');
  const [flaggedIds, setFlaggedIds] = useState<Set<string>>(new Set());
  const [viewingDetail, setViewingDetail] = useState<BankMatchResult | null>(null);
  const [viewingCandidates, setViewingCandidates] = useState<BankMatchResult | null>(null);

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

  const matchOutput = useMemo(
    () => runReconciliationMatch(matchBankRows, matchGLRows, toleranceDays),
    [matchBankRows, matchGLRows, toleranceDays]
  );

  const statusCounts = useMemo(() => computeStatusCounts(matchOutput.bankResults), [matchOutput]);
  const summary = useMemo(
    () => computeReconcileSummary(matchOutput.bankResults, matchOutput.glOnlyResults),
    [matchOutput]
  );

  const filteredResults = useMemo(() => filterBankResults(matchOutput.bankResults, filters), [matchOutput, filters]);

  function handleStatusTabClick(status: BankRowMatchStatus | 'all') {
    setFilters((prev) => ({ ...prev, status }));
  }

  function handleSearchSubmit() {
    setFilters((prev) => ({ ...prev, search: searchDraft }));
  }

  function handleClearFilters() {
    setSearchDraft('');
    setFilters(DEFAULT_RECONCILE_FILTERS);
  }

  function toggleFlag(result: BankMatchResult) {
    setFlaggedIds((prev) => {
      const next = new Set(prev);
      if (next.has(result.bank.bank_row_id)) next.delete(result.bank.bank_row_id);
      else next.add(result.bank.bank_row_id);
      return next;
    });
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
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
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
          const count = tab.value === 'all' ? summary.totalBank : statusCounts[tab.value];
          const isActive = filters.status === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => handleStatusTabClick(tab.value)}
              className={`btn-press rounded-full px-4 py-2 text-xs font-semibold ${
                isActive
                  ? 'bg-primary text-white shadow-sm'
                  : 'border border-border bg-white text-text-sub hover:bg-page-bg'
              }`}
              data-testid={`reconcile-tab-${tab.value}`}
            >
              {tab.label} ({count.toLocaleString('th-TH')})
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
            placeholder="รายละเอียด Bank, เลขที่เอกสาร GL, รายละเอียด GL, จำนวนเงิน"
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

      <BankReconcileResultTable
        results={filteredResults}
        flaggedIds={flaggedIds}
        onViewDetail={setViewingDetail}
        onViewCandidates={setViewingCandidates}
        onTogglePendingFlag={toggleFlag}
      />

      <BankReconcileUnmatchedGL glOnlyResults={matchOutput.glOnlyResults} />

      {viewingDetail && <BankReconcileDetailDrawer result={viewingDetail} onClose={() => setViewingDetail(null)} />}
      {viewingCandidates && (
        <BankReconcileCandidatesModal result={viewingCandidates} onClose={() => setViewingCandidates(null)} />
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
