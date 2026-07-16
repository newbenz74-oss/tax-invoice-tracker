'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import type { MatchBankRow, MatchGLRow } from '@/types/bankReconcile';
import { computeGroupTotals, classifyManualStatus, describeGLCandidate, validateManualMatch } from '@/lib/bankReconcileManualMatch';
import { MATCH_STATUS_BADGE_CLASS, MATCH_STATUS_LABELS } from '@/lib/bankReconcileMatchLogic';

const THB2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function sameAmount(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function money(n: number): string {
  return n.toLocaleString('th-TH', THB2);
}

function parseAmountSearch(text: string): number | null {
  const cleaned = text.replace(/,/g, '').trim();
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

interface BankReconcileMatchDrawerProps {
  /** แถว Bank ที่จะจับคู่ — คงที่ตลอดอายุของ Drawer (เลือกไว้ก่อนเปิดแล้วเสมอ ไม่มี UI เลือก/ถอด Bank แถวใน
   * นี้) 1 แถว = มาจากปุ่ม "เลือกรายการ GL" ของแต่ละแถว (สเปกส่วน "2. SELECT GL TRANSACTION MANUALLY"), มากกว่า
   * 1 แถว = มาจาก "รวมรายการ Bank เพื่อจับคู่" (สเปกส่วน "4. MULTIPLE BANK TO ONE GL") — component เดียวรองรับ
   * ทั้งสองเคสรวมถึง "1 Bank ต่อหลาย GL" (สเปกส่วน "3.") ด้วย เพราะ match_type คำนวณย้อนหลังจากจำนวนที่เลือก
   * จริงเสมอ (deriveMatchType) ไม่ใช่ path ที่ตายตัวจากทางเข้า — ผู้เรียกรับผิดชอบไม่เปิด Drawer นี้ให้แถว Bank
   * ที่อยู่ใน MatchGroup อื่นอยู่แล้ว (consumedBankIds) เอง (ดูปุ่ม "เลือก" ที่ถูก disable ใน ResultTable) */
  bankRows: MatchBankRow[];
  /** GL ทั้งหมด (ทุกแถว ไม่กรองออก) — แสดงครบเสมอแต่แถวที่ใช้ไปแล้ว (consumedGLIds/autoUsedGLIds) จะถูก disable
   * พร้อม tooltip แทนการซ่อน ตามสเปกส่วน "14. CONCURRENCY SAFETY" ตรงๆ ("disable already-used-elsewhere GL
   * rows with tooltip" ไม่ใช่ "hide") */
  glRows: MatchGLRow[];
  consumedBankIds: Set<string>;
  consumedGLIds: Set<string>;
  autoUsedGLIds: Set<string>;
  amountTolerance: number;
  onConfirm: (selectedGLRows: MatchGLRow[], note: string) => void;
  onClose: () => void;
}

/**
 * Drawer ขนาดใหญ่สำหรับจับคู่ด้วยตนเอง — รวมสเปกเฟส 3 ส่วน "2. SELECT GL TRANSACTION MANUALLY", "3. ONE BANK
 * TO MULTIPLE GL", และ "4. MULTIPLE BANK TO ONE GL" ไว้ใน component เดียว (เลือก GL ได้ตั้งแต่ 1 แถวขึ้นไปเสมอ
 * — เลือก 1 = กรณีพื้นฐานของส่วน 2, เลือกมากกว่า 1 = กรณีของส่วน 3 โดยธรรมชาติ ไม่ต้องแยก UI/component ต่างหาก)
 * bankRows มาจากภายนอกเสมอ (คงที่ ไม่มี UI แก้ในนี้) — 1 แถว = ส่วน 2/3, มากกว่า 1 แถว = ส่วน 4
 *
 * การเรียงลำดับผู้สมัคร GL เริ่มต้นตามสเปก "same amount → closest date → highest match score" — ใช้
 * referenceBank สังเคราะห์ขึ้น (bank_amount = ผลรวม Bank ทั้งหมดที่เลือกไว้เสมอ, bank_date = วันที่ของแถว Bank
 * เดียวถ้ามีแค่ 1 แถว มิฉะนั้นเป็น null เพราะ "วันที่ต่างกัน" ไม่มีนิยามเดียวที่ชัดเจนเมื่อรวมหลายแถว Bank ที่
 * วันที่ต่างกัน — เมื่อ bankRows.length === 1 ผลลัพธ์จะตรงกับที่ resolveSuggestedCandidate ใช้เกณฑ์เดียวกันเป๊ะ)
 *
 * ยอดรวม/ผลต่างคำนวณสดทุกครั้งที่เปลี่ยนตัวเลือกผ่าน computeGroupTotals ตัวเดียวกับที่ buildMatchGroup ใช้จริง
 * ตอนบันทึก (การันตีว่าตัวเลขที่เห็นระหว่างเลือกกับตัวเลขที่บันทึกจริงตรงกันเป๊ะเสมอ) ปุ่มยืนยันเปลี่ยนป้าย/สี
 * เองอัตโนมัติเมื่อผลต่างเกินค่าคลาดเคลื่อน (สเปกส่วน "5. AMOUNT TOLERANCE" — "ยืนยันแบบมีผลต่าง" ต้องมีหมายเหตุ
 * เสมอ) แทนการมีสองปุ่มซ้อนกัน — คลิกปุ่มที่เปลี่ยนป้ายแล้วเองคือการ "override" ตามสเปกในตัว ไม่ต้องมี checkbox
 * ยืนยัน override แยกต่างหากอีกชั้น เรียก validateManualMatch จริงก่อนปล่อยให้กดยืนยันได้เสมอ (ไม่ใช่แค่เชื่อ UI
 * state — ข้อผิดพลาดที่เกิดขึ้นจริงแสดงในนี้เท่านั้น ไม่มีทาง alert() ตามสเปกส่วน "13. MANUAL MATCH VALIDATION")
 */
export default function BankReconcileMatchDrawer({
  bankRows,
  glRows,
  consumedBankIds,
  consumedGLIds,
  autoUsedGLIds,
  amountTolerance,
  onConfirm,
  onClose,
}: BankReconcileMatchDrawerProps) {
  const [selectedGLIds, setSelectedGLIds] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [searchDocNo, setSearchDocNo] = useState('');
  const [searchDescription, setSearchDescription] = useState('');
  const [searchAmount, setSearchAmount] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [amountEqualOnly, setAmountEqualOnly] = useState(false);

  const isMultiBank = bankRows.length > 1;
  const unavailableGLIds = useMemo(
    () => new Set<string>([...consumedGLIds, ...autoUsedGLIds]),
    [consumedGLIds, autoUsedGLIds]
  );
  const bankTotal = useMemo(() => round2(bankRows.reduce((sum, b) => sum + b.bank_amount, 0)), [bankRows]);
  const referenceBank = useMemo(
    () => ({ bank_date: bankRows.length === 1 ? bankRows[0].bank_date : null, bank_amount: bankTotal }),
    [bankRows, bankTotal]
  );

  const filteredCandidates = useMemo(() => {
    const amountSearch = parseAmountSearch(searchAmount);
    return glRows.filter((gl) => {
      if (amountEqualOnly && !sameAmount(gl.gl_amount, bankTotal)) return false;
      if (amountSearch !== null && !sameAmount(gl.gl_amount, amountSearch)) return false;
      if (searchDocNo.trim() && !gl.gl_document_no.toLowerCase().includes(searchDocNo.trim().toLowerCase())) return false;
      if (
        searchDescription.trim() &&
        !gl.gl_description.toLowerCase().includes(searchDescription.trim().toLowerCase())
      )
        return false;
      if (dateFrom && (!gl.gl_date || gl.gl_date < dateFrom)) return false;
      if (dateTo && (!gl.gl_date || gl.gl_date > dateTo)) return false;
      return true;
    });
  }, [glRows, amountEqualOnly, searchAmount, searchDocNo, searchDescription, dateFrom, dateTo, bankTotal]);

  const sortedCandidates = useMemo(() => {
    return [...filteredCandidates].sort((a, b) => {
      const aExact = sameAmount(a.gl_amount, bankTotal);
      const bExact = sameAmount(b.gl_amount, bankTotal);
      if (aExact !== bExact) return aExact ? -1 : 1;
      const aDesc = describeGLCandidate(referenceBank, a);
      const bDesc = describeGLCandidate(referenceBank, b);
      const aDiff = aDesc.dateDiffDays ?? Infinity;
      const bDiff = bDesc.dateDiffDays ?? Infinity;
      if (aDiff !== bDiff) return aDiff - bDiff;
      return bDesc.matchScore - aDesc.matchScore;
    });
  }, [filteredCandidates, referenceBank, bankTotal]);

  const selectedGLRows = useMemo(
    () => glRows.filter((g) => selectedGLIds.has(g.gl_row_id)),
    [glRows, selectedGLIds]
  );
  const liveTotals = useMemo(() => computeGroupTotals(bankRows, selectedGLRows), [bankRows, selectedGLRows]);
  const withinTolerance = liveTotals.amountDifference <= amountTolerance;
  const liveStatus = classifyManualStatus(liveTotals.amountDifference, amountTolerance);

  const validation = useMemo(
    () =>
      validateManualMatch({
        selectedBankIds: bankRows.map((b) => b.bank_row_id),
        selectedGLIds: Array.from(selectedGLIds),
        consumedBankIds,
        consumedGLIds,
        autoUsedGLIds,
        amountDifference: liveTotals.amountDifference,
        amountTolerance,
        overrideConfirmed: !withinTolerance,
        note,
      }),
    [bankRows, selectedGLIds, consumedBankIds, consumedGLIds, autoUsedGLIds, liveTotals.amountDifference, amountTolerance, withinTolerance, note]
  );
  const showValidationErrors = selectedGLIds.size > 0 && validation.errors.length > 0;

  function toggleGL(id: string) {
    if (unavailableGLIds.has(id)) return;
    setSelectedGLIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function resetFilters() {
    setSearchDocNo('');
    setSearchDescription('');
    setSearchAmount('');
    setDateFrom('');
    setDateTo('');
    setAmountEqualOnly(false);
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/40 p-3"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={isMultiBank ? 'รวมรายการ Bank เพื่อจับคู่' : 'เลือกรายการ GL เพื่อจับคู่'}
      data-testid="match-drawer"
    >
      <div
        className="card-surface flex max-h-[calc(100vh-24px)] w-[calc(100%-24px)] flex-col overflow-hidden rounded-2xl bg-white md:max-h-[calc(100vh-48px)] md:w-[calc(100%-48px)] md:max-w-[1000px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="sticky top-0 z-10 flex flex-none items-start justify-between gap-4 border-b border-border bg-white px-6 py-4 sm:px-7"
          data-testid="match-drawer-header"
        >
          <div>
            <h3 className="text-base font-bold text-text">
              {isMultiBank ? 'รวมรายการ Bank เพื่อจับคู่กับ GL' : 'เลือกรายการ GL เพื่อจับคู่'}
            </h3>
            <p className="mt-0.5 text-sm text-text-sub">
              {isMultiBank
                ? `รวม ${bankRows.length} รายการ Bank เข้าด้วยกัน แล้วเลือก GL ที่ตรงกับยอดรวม`
                : 'ค้นหาและเลือกรายการ GL ที่ยังไม่ถูกใช้เพื่อจับคู่กับรายการ Bank นี้'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-text-sub hover:bg-page-bg"
            aria-label="ปิด"
            data-testid="match-drawer-close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 py-5 sm:px-7">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
            <div className="card-surface rounded-xl border border-border bg-page-bg p-3.5">
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-text-sub">
                รายการ Bank ที่จะจับคู่ ({bankRows.length})
              </h4>
              <ul className="space-y-1.5 text-sm">
                {bankRows.map((b) => (
                  <li
                    key={b.bank_row_id}
                    className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 shadow-sm"
                  >
                    <span className="min-w-0 flex-1 truncate text-text-sub">
                      <span className="font-numeric">{formatDate(b.bank_date)}</span> · {b.bank_description || '-'}
                    </span>
                    <span className="font-numeric shrink-0 font-medium text-text">{money(b.bank_amount)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-center justify-between border-t border-border pt-2.5 text-sm">
                <span className="font-medium text-text-sub">ยอดรวม Bank</span>
                <span className="font-numeric text-base font-bold text-text" data-testid="match-drawer-bank-total">
                  {money(bankTotal)} บาท
                </span>
              </div>
            </div>

            <div>
              <div className="mb-3 rounded-xl border border-border bg-page-bg p-3">
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  <label className="flex flex-col gap-1 text-xs text-text-sub">
                    วันที่เริ่มต้น
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="focus-ring-primary h-9 rounded-[8px] border border-border bg-white px-2 text-sm text-text"
                      data-testid="match-drawer-date-from"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-text-sub">
                    วันที่สิ้นสุด
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="focus-ring-primary h-9 rounded-[8px] border border-border bg-white px-2 text-sm text-text"
                      data-testid="match-drawer-date-to"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-text-sub">
                    ยอดเงิน
                    <input
                      type="text"
                      inputMode="decimal"
                      value={searchAmount}
                      onChange={(e) => setSearchAmount(e.target.value)}
                      placeholder="เช่น 10000.00"
                      className="focus-ring-primary h-9 rounded-[8px] border border-border bg-white px-2 text-sm text-text"
                      data-testid="match-drawer-search-amount"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-text-sub">
                    เลขที่เอกสาร
                    <input
                      type="text"
                      value={searchDocNo}
                      onChange={(e) => setSearchDocNo(e.target.value)}
                      className="focus-ring-primary h-9 rounded-[8px] border border-border bg-white px-2 text-sm text-text"
                      data-testid="match-drawer-search-docno"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-text-sub sm:col-span-2">
                    รายละเอียด
                    <input
                      type="text"
                      value={searchDescription}
                      onChange={(e) => setSearchDescription(e.target.value)}
                      className="focus-ring-primary h-9 rounded-[8px] border border-border bg-white px-2 text-sm text-text"
                      data-testid="match-drawer-search-description"
                    />
                  </label>
                </div>
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="inline-flex rounded-[10px] border border-border bg-white p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setAmountEqualOnly(false)}
                      className={`rounded-[8px] px-3 py-1.5 font-medium transition-colors ${
                        !amountEqualOnly ? 'bg-primary text-white' : 'text-text-sub hover:bg-page-bg'
                      }`}
                      data-testid="match-drawer-show-all"
                    >
                      แสดงทั้งหมด
                    </button>
                    <button
                      type="button"
                      onClick={() => setAmountEqualOnly(true)}
                      className={`rounded-[8px] px-3 py-1.5 font-medium transition-colors ${
                        amountEqualOnly ? 'bg-primary text-white' : 'text-text-sub hover:bg-page-bg'
                      }`}
                      data-testid="match-drawer-show-equal-only"
                    >
                      แสดงเฉพาะยอดเท่ากัน
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="text-xs font-medium text-text-sub underline-offset-2 hover:text-text hover:underline"
                    data-testid="match-drawer-reset-filters"
                  >
                    ล้างตัวกรอง
                  </button>
                </div>
              </div>

              {sortedCandidates.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-card-bg p-8 text-center text-sm text-text-sub">
                  ไม่พบรายการ GL ที่ตรงกับเงื่อนไข
                </div>
              ) : (
                <div className="card-surface max-h-[20rem] overflow-auto rounded-xl" data-testid="match-drawer-candidates">
                  <table className="min-w-full divide-y divide-border text-sm">
                    <thead className="sticky top-0 bg-table-header">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-text-sub">เลือก</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-text-sub">วันที่</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-text-sub">เลขที่เอกสาร</th>
                        <th className="min-w-[140px] px-3 py-2 text-left text-xs font-semibold text-text-sub">รายละเอียด</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-text-sub">เดบิต</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-text-sub">เครดิต</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-text-sub">ยอดสุทธิ</th>
                        <th className="px-3 py-2 text-center text-xs font-semibold text-text-sub">วันที่ต่างกัน</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-text-sub">ผลต่าง</th>
                        <th className="px-3 py-2 text-center text-xs font-semibold text-text-sub">คะแนนจับคู่</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {sortedCandidates.map((gl) => {
                        const isUnavailable = unavailableGLIds.has(gl.gl_row_id);
                        const isSelected = selectedGLIds.has(gl.gl_row_id);
                        const desc = !isMultiBank ? describeGLCandidate(referenceBank, gl) : null;
                        return (
                          <tr
                            key={gl.gl_row_id}
                            onClick={() => toggleGL(gl.gl_row_id)}
                            title={isUnavailable ? 'รายการนี้ถูกใช้ในการจับคู่อื่นแล้ว' : undefined}
                            className={`transition-colors duration-150 ${
                              isUnavailable ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-table-row-hover'
                            } ${isSelected ? 'bg-primary/5' : ''}`}
                            data-testid={`match-drawer-candidate-${gl.gl_row_id}`}
                          >
                            <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                disabled={isUnavailable}
                                onChange={() => toggleGL(gl.gl_row_id)}
                                className="h-4 w-4 rounded border-border accent-primary disabled:cursor-not-allowed"
                                aria-label={isUnavailable ? 'รายการนี้ถูกใช้ในการจับคู่อื่นแล้ว' : `เลือก ${gl.gl_document_no || gl.gl_row_id}`}
                                data-testid={`match-drawer-candidate-checkbox-${gl.gl_row_id}`}
                              />
                            </td>
                            <td className="font-numeric px-3 py-2 text-text-sub">{formatDate(gl.gl_date)}</td>
                            <td className="px-3 py-2 text-text-sub">{gl.gl_document_no || '-'}</td>
                            <td className="px-3 py-2 text-text">{gl.gl_description || '-'}</td>
                            <td className="font-numeric px-3 py-2 text-right text-text-sub">{money(gl.gl_debit)}</td>
                            <td className="font-numeric px-3 py-2 text-right text-text-sub">{money(gl.gl_credit)}</td>
                            <td className="font-numeric px-3 py-2 text-right font-semibold text-text">{money(gl.gl_amount)}</td>
                            <td className="font-numeric px-3 py-2 text-center text-text-sub">
                              {desc?.dateDiffDays === undefined || desc?.dateDiffDays === null ? '-' : `${desc.dateDiffDays} วัน`}
                            </td>
                            <td className="font-numeric px-3 py-2 text-right text-text-sub">
                              {money(Math.abs(gl.gl_amount - bankTotal))}
                            </td>
                            <td className="font-numeric px-3 py-2 text-center text-text-sub">{desc ? desc.matchScore : '-'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-border bg-page-bg p-4" data-testid="match-drawer-summary">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <SummaryField label="จำนวนที่เลือก" value={`${selectedGLRows.length} รายการ`} />
              <SummaryField label="ยอดรวม GL ที่เลือก" value={`${money(liveTotals.glTotal)} บาท`} />
              <SummaryField label="ยอดรวม Bank" value={`${money(liveTotals.bankTotal)} บาท`} />
              <SummaryField label="ผลต่าง" value={`${money(liveTotals.amountDifference)} บาท`} />
            </div>
            {selectedGLRows.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2.5 border-t border-border pt-3">
                <span
                  className={`inline-block w-fit rounded-full px-3.5 py-2 text-xs font-medium ${MATCH_STATUS_BADGE_CLASS[liveStatus]}`}
                  data-testid="match-drawer-live-status"
                >
                  {MATCH_STATUS_LABELS[liveStatus]}
                </span>
                {!withinTolerance && (
                  <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
                    <AlertTriangle size={14} aria-hidden="true" />
                    ผลต่างเกินค่าคลาดเคลื่อนที่ตั้งไว้ ({money(amountTolerance)} บาท) — ต้องระบุหมายเหตุก่อนยืนยัน
                  </span>
                )}
              </div>
            )}
          </div>

          <label className="mt-4 flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-text">
              หมายเหตุ {!withinTolerance ? <span className="text-danger">*</span> : '(ไม่บังคับ)'}
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="ระบุหมายเหตุ..."
              className="focus-ring-primary rounded-[10px] border border-border bg-white px-3 py-2.5 text-sm text-text"
              data-testid="match-drawer-note-input"
            />
          </label>

          {showValidationErrors && (
            <div
              role="alert"
              className="mt-3 rounded-[10px] border border-danger/20 bg-danger/10 px-3.5 py-2.5 text-sm text-danger"
              data-testid="match-drawer-errors"
            >
              <ul className="list-inside list-disc space-y-0.5">
                {validation.errors.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div
          className="sticky bottom-0 z-10 grid flex-none grid-cols-2 gap-2.5 border-t border-border bg-white px-6 py-4 sm:px-7 md:flex md:justify-end"
          data-testid="match-drawer-footer"
        >
          <button
            type="button"
            onClick={onClose}
            className="btn-press w-full rounded-[10px] border border-border bg-white px-5 py-2.5 text-sm font-medium text-text-sub hover:bg-page-bg md:w-auto"
            data-testid="match-drawer-cancel"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={!validation.valid}
            onClick={() => onConfirm(selectedGLRows, note)}
            className={`btn-press w-full rounded-[10px] px-5 py-2.5 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50 md:w-auto ${
              withinTolerance ? 'bg-primary hover:bg-primary-hover' : 'bg-amber-600 hover:bg-amber-700'
            }`}
            data-testid="match-drawer-confirm"
          >
            {withinTolerance ? 'ยืนยันการจับคู่' : 'ยืนยันแบบมีผลต่าง'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-text-sub">{label}</dt>
      <dd className="font-numeric mt-0.5 text-sm font-bold text-text">{value}</dd>
    </div>
  );
}
