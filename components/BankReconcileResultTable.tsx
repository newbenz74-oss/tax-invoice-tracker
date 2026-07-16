'use client';

import type { BankMatchResult } from '@/types/bankReconcile';
import { MATCH_STATUS_BADGE_CLASS, MATCH_STATUS_LABELS } from '@/lib/bankReconcileMatchLogic';

const THB2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function formatMoney(n: number): string {
  return n.toLocaleString('th-TH', THB2);
}

interface BankReconcileResultTableProps {
  /** ผลลัพธ์ที่ผ่านตัวกรอง (Segmented Control + search + filters) มาแล้ว — ตารางนี้แสดงตรงๆ ไม่กรองซ้ำเอง */
  results: BankMatchResult[];
  flaggedIds: Set<string>;
  onViewDetail: (result: BankMatchResult) => void;
  onViewCandidates: (result: BankMatchResult) => void;
  onTogglePendingFlag: (result: BankMatchResult) => void;
}

/**
 * ตารางผลลัพธ์การกระทบยอดหลัก — เป็น Bank-based เสมอ (ยาวเท่าจำนวนแถว Bank ที่ผ่านตัวกรองปัจจุบัน) แถว Bank
 * ทุกแถวปรากฏในนี้เสมอแม้ไม่มี GL จับคู่เลยก็ตาม ("Bank Statement must always be the primary source of
 * truth") คอลัมน์ฝั่ง Bank อยู่ก่อนฝั่ง GL เสมอตามสเปก ใช้ sticky header + max-height + overflow-auto
 * (เทคนิคเดียวกับ ExcelImportPanel.tsx) รองรับทั้งแถวจำนวนมากและ horizontal scroll บนจอเล็ก
 *
 * "ลำดับ" (คอลัมน์แรก) ใช้เลขลำดับการแสดงผลจริง (1, 2, 3, ...) ไม่ใช่เลขแถวในไฟล์ต้นฉบับ — ตัดสินใจเองเพราะ
 * ตารางนี้ผ่านการกรอง/ค้นหามาแล้วเสมอ เลขแถวไฟล์เดิมจะมีช่องว่างไม่ต่อเนื่องทำให้ "ลำดับ" ดูสับสนกว่า
 */
export default function BankReconcileResultTable({
  results,
  flaggedIds,
  onViewDetail,
  onViewCandidates,
  onTogglePendingFlag,
}: BankReconcileResultTableProps) {
  if (results.length === 0) {
    return (
      <div
        className="rounded-2xl border border-dashed border-border bg-card-bg p-12 text-center text-sm text-text-sub"
        data-testid="reconcile-table-empty"
      >
        ไม่พบรายการในสถานะนี้
      </div>
    );
  }

  return (
    <div className="card-surface max-h-[36rem] overflow-auto rounded-2xl" data-testid="reconcile-result-table">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="sticky top-0 bg-table-header">
          <tr>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-sub">ลำดับ</th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-sub">วันที่ Bank</th>
            <th className="min-w-[160px] px-3 py-2.5 text-left text-xs font-semibold text-text-sub">รายละเอียด Bank</th>
            <th className="px-3 py-2.5 text-right text-xs font-semibold text-text-sub">เงินเข้า</th>
            <th className="px-3 py-2.5 text-right text-xs font-semibold text-text-sub">เงินออก</th>
            <th className="px-3 py-2.5 text-right text-xs font-semibold text-text-sub">ยอด Bank</th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-sub">วันที่ GL</th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-sub">เลขที่เอกสาร GL</th>
            <th className="min-w-[160px] px-3 py-2.5 text-left text-xs font-semibold text-text-sub">รายละเอียด GL</th>
            <th className="px-3 py-2.5 text-right text-xs font-semibold text-text-sub">ยอด GL</th>
            <th className="px-3 py-2.5 text-right text-xs font-semibold text-text-sub">ผลต่าง</th>
            <th className="px-3 py-2.5 text-center text-xs font-semibold text-text-sub">วันที่ต่างกัน</th>
            <th className="px-3 py-2.5 text-center text-xs font-semibold text-text-sub">คะแนนจับคู่</th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-sub">สถานะ</th>
            <th className="px-3 py-2.5 text-right text-xs font-semibold text-text-sub">การจัดการ</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {results.map((r, index) => {
            const isFlagged = flaggedIds.has(r.bank.bank_row_id);
            return (
              <tr
                key={r.bank.bank_row_id}
                data-testid={`reconcile-row-${r.bank.bank_row_id}`}
                className="transition-colors duration-150 hover:bg-table-row-hover"
              >
                <td className="px-3 py-2.5 text-text-sub">{index + 1}</td>
                <td className="font-numeric px-3 py-2.5 text-text-sub">{formatDate(r.bank.bank_date)}</td>
                <td className="px-3 py-2.5 text-text">{r.bank.bank_description || '-'}</td>
                <td className="font-numeric px-3 py-2.5 text-right text-text-sub">{formatMoney(r.bank.bank_money_in)}</td>
                <td className="font-numeric px-3 py-2.5 text-right text-text-sub">{formatMoney(r.bank.bank_money_out)}</td>
                <td
                  className={`font-numeric px-3 py-2.5 text-right font-semibold ${
                    r.bank.bank_amount < 0 ? 'text-danger' : 'text-success'
                  }`}
                  data-testid={`reconcile-bank-amount-${r.bank.bank_row_id}`}
                >
                  {formatMoney(r.bank.bank_amount)}
                </td>
                <td className="font-numeric px-3 py-2.5 text-text-sub">{formatDate(r.matchedGL?.gl_date ?? null)}</td>
                <td className="px-3 py-2.5 text-text-sub">{r.matchedGL?.gl_document_no || '-'}</td>
                <td className="px-3 py-2.5 text-text-sub">{r.matchedGL?.gl_description || '-'}</td>
                <td className="font-numeric px-3 py-2.5 text-right text-text-sub">
                  {r.matchedGL ? formatMoney(r.matchedGL.gl_amount) : '-'}
                </td>
                <td className="font-numeric px-3 py-2.5 text-right text-text-sub">
                  {r.amountDifference === null ? '-' : formatMoney(r.amountDifference)}
                </td>
                <td className="font-numeric px-3 py-2.5 text-center text-text-sub">
                  {r.dateDifferenceDays === null ? '-' : `${r.dateDifferenceDays} วัน`}
                </td>
                <td className="font-numeric px-3 py-2.5 text-center text-text-sub">
                  {r.matchScore === null ? '-' : r.matchScore}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-col items-start gap-1">
                    <span
                      className={`inline-block w-fit rounded-full px-3.5 py-2 text-xs font-medium ${MATCH_STATUS_BADGE_CLASS[r.status]}`}
                      data-testid={`reconcile-status-${r.bank.bank_row_id}`}
                    >
                      {MATCH_STATUS_LABELS[r.status]}
                    </span>
                    {isFlagged && (
                      <span
                        className="text-[10px] font-medium text-warning"
                        data-testid={`reconcile-flagged-${r.bank.bank_row_id}`}
                      >
                        ● ทำเครื่องหมายรอตรวจสอบไว้
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => onViewDetail(r)}
                      className="btn-press rounded-[10px] border border-border px-2 py-1 text-xs font-medium text-text-sub hover:bg-page-bg"
                      data-testid={`reconcile-view-detail-${r.bank.bank_row_id}`}
                    >
                      ดูรายละเอียด
                    </button>
                    <button
                      type="button"
                      onClick={() => onViewCandidates(r)}
                      disabled={r.candidates.length === 0}
                      className="btn-press rounded-[10px] border border-border px-2 py-1 text-xs font-medium text-text-sub hover:bg-page-bg disabled:cursor-not-allowed disabled:opacity-40"
                      data-testid={`reconcile-view-candidates-${r.bank.bank_row_id}`}
                    >
                      ดูรายการที่อาจตรงกัน
                    </button>
                    <button
                      type="button"
                      onClick={() => onTogglePendingFlag(r)}
                      className={`btn-press rounded-[10px] border px-2 py-1 text-xs font-medium ${
                        isFlagged
                          ? 'border-warning/40 bg-warning/10 text-warning'
                          : 'border-border text-text-sub hover:bg-page-bg'
                      }`}
                      data-testid={`reconcile-mark-pending-${r.bank.bank_row_id}`}
                    >
                      {isFlagged ? 'ยกเลิกเครื่องหมาย' : 'ทำเครื่องหมายรอตรวจสอบ'}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
