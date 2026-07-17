'use client';

import { CheckSquare, FilePlus2, Square, StickyNote } from 'lucide-react';
import {
  BANK_MATCH_STATUS_BADGE_CLASS,
  BANK_MATCH_STATUS_LABELS,
  TRANSACTION_DIRECTION_BADGE_CLASS,
  TRANSACTION_DIRECTION_LABELS,
} from '@/types/bankReconcile';
import type { BankReconcileResultRow, BankReviewFlags } from '@/types/bankReconcile';

const THB2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

function money(n: number): string {
  return n.toLocaleString('th-TH', THB2);
}

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return '-';
  return `${d}/${m}/${y}`;
}

interface BankReconcileResultTableProps {
  rows: BankReconcileResultRow[];
  reviewFlags: Record<string, BankReviewFlags>;
  onToggleNeedsGlEntry: (bankRowId: string) => void;
  onToggleReviewed: (bankRowId: string) => void;
  onEditNote: (bankRowId: string) => void;
}

/**
 * ตารางผลลัพธ์หลัก (Bank-based) — สเปกส่วน "15. PRIMARY RESULT TABLE" คอลัมน์ตรงตามสเปกเป๊ะ 13 คอลัมน์:
 * ลำดับ/วันที่ Bank/รายละเอียด Bank/ประเภท/ยอด Bank/วันที่ GL/เลขที่เอกสาร GL/รายละเอียด GL/ยอด GL/ผลต่าง/
 * สถานะ/หมายเหตุ/การจัดการ — แถวพบใน GL (found_in_gl) เป็นสีเขียว แถวไม่พบ (not_found_in_gl) เป็นสีแดงตามสเปก
 * ("Matched → green background/badge, Not found → red") ปุ่มการจัดการ (เพิ่มหมายเหตุ/ทำเครื่องหมายต้องบันทึก
 * GL เพิ่ม/ทำเครื่องหมายตรวจสอบแล้ว) แสดงเฉพาะแถวไม่พบใน GL เท่านั้นตามสเปกส่วน "17. REVIEW WORKFLOW" ("For
 * 'ไม่พบใน GL'...") แถวพบใน GL แล้วไม่มีอะไรให้ตรวจสอบเพิ่ม (การจัดการว่างเสมอ) ทุกแถว Bank ที่ผ่านเข้าสู่การ
 * กระทบยอด (isRowUsable) ปรากฏในตารางนี้เสมอ ไม่มีการซ่อนแถว Bank ใดๆ ทั้งสิ้นตามสเปก ("Never hide Bank
 * transactions") — เรียงลำดับเดิมตามไฟล์ต้นฉบับเสมอ (ผู้เรียกส่ง rows ที่กรอง/เรียงแล้วมาให้ตรงๆ)
 */
export default function BankReconcileResultTable({
  rows,
  reviewFlags,
  onToggleNeedsGlEntry,
  onToggleReviewed,
  onEditNote,
}: BankReconcileResultTableProps) {
  if (rows.length === 0) {
    return (
      <div className="card-surface rounded-2xl border border-dashed border-border p-10 text-center text-sm text-text-sub" data-testid="reconcile-result-table-empty">
        ไม่พบรายการที่ตรงกับตัวกรองนี้
      </div>
    );
  }

  return (
    <div className="card-surface max-h-[560px] overflow-auto rounded-2xl" data-testid="reconcile-result-table">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="sticky top-0 z-10 bg-table-header">
          <tr>
            {['ลำดับ', 'วันที่ Bank', 'รายละเอียด Bank', 'ประเภท', 'ยอด Bank', 'วันที่ GL', 'เลขที่เอกสาร GL', 'รายละเอียด GL', 'ยอด GL', 'ผลต่าง', 'สถานะ', 'หมายเหตุ'].map((h) => (
              <th key={h} className="px-3 py-3 text-left text-xs font-semibold whitespace-nowrap text-text-sub">
                {h}
              </th>
            ))}
            <th className="px-3 py-3 text-right text-xs font-semibold whitespace-nowrap text-text-sub">การจัดการ</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((r, index) => {
            const isFound = r.status === 'found_in_gl';
            const flags = reviewFlags[r.bank.id];
            return (
              <tr
                key={r.bank.id}
                data-testid={`reconcile-row-${r.bank.id}`}
                className={isFound ? 'bg-success/5' : 'bg-danger/5'}
              >
                <td className="font-numeric px-3 py-2.5 text-text-sub">{index + 1}</td>
                <td className="font-numeric px-3 py-2.5 whitespace-nowrap text-text-sub">{formatDate(r.bank.date)}</td>
                <td className="min-w-[160px] px-3 py-2.5 text-text">{r.bank.description || '-'}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${TRANSACTION_DIRECTION_BADGE_CLASS[r.bank.direction!]}`}>
                    {TRANSACTION_DIRECTION_LABELS[r.bank.direction!]}
                  </span>
                </td>
                <td className="font-numeric px-3 py-2.5 text-right font-semibold whitespace-nowrap text-text">{money(r.bank.amount)}</td>
                <td className="font-numeric px-3 py-2.5 whitespace-nowrap text-text-sub">{r.matchedGL ? formatDate(r.matchedGL.date) : '-'}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-text-sub">{r.matchedGL?.docNo || '-'}</td>
                <td className="min-w-[160px] px-3 py-2.5 text-text-sub">{r.matchedGL?.description || '-'}</td>
                <td className="font-numeric px-3 py-2.5 text-right whitespace-nowrap text-text-sub">{r.matchedGL ? money(r.matchedGL.amount) : '-'}</td>
                <td className="font-numeric px-3 py-2.5 text-right whitespace-nowrap text-text-sub">{money(r.difference)}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <span
                    className={`inline-block w-fit rounded-full px-3.5 py-2 text-xs font-medium ${BANK_MATCH_STATUS_BADGE_CLASS[r.status]}`}
                    data-testid={`reconcile-status-${r.bank.id}`}
                  >
                    {BANK_MATCH_STATUS_LABELS[r.status]}
                  </span>
                </td>
                <td className="min-w-[140px] px-3 py-2.5 text-text-sub">
                  {flags?.reviewNote ? flags.reviewNote : '-'}
                  {flags?.needsGlEntry && (
                    <span className="mt-1 block text-xs font-medium text-warning">ต้องบันทึก GL เพิ่ม</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {!isFound && (
                    <div className="flex flex-nowrap justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => onEditNote(r.bank.id)}
                        title="เพิ่ม/แก้ไขหมายเหตุ"
                        className="btn-press rounded-[8px] border border-border p-1.5 text-text-sub hover:bg-page-bg"
                        data-testid={`reconcile-note-${r.bank.id}`}
                      >
                        <StickyNote size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onToggleNeedsGlEntry(r.bank.id)}
                        title="ทำเครื่องหมายว่าต้องบันทึก GL เพิ่ม"
                        className={`btn-press rounded-[8px] border p-1.5 ${flags?.needsGlEntry ? 'border-warning/40 bg-warning/10 text-warning' : 'border-border text-text-sub hover:bg-page-bg'}`}
                        data-testid={`reconcile-needs-gl-entry-${r.bank.id}`}
                      >
                        <FilePlus2 size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onToggleReviewed(r.bank.id)}
                        title="ทำเครื่องหมายว่าตรวจสอบแล้ว"
                        className={`btn-press rounded-[8px] border p-1.5 ${flags?.reviewed ? 'border-success/40 bg-success/10 text-success' : 'border-border text-text-sub hover:bg-page-bg'}`}
                        data-testid={`reconcile-reviewed-${r.bank.id}`}
                      >
                        {flags?.reviewed ? <CheckSquare size={14} aria-hidden="true" /> : <Square size={14} aria-hidden="true" />}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
