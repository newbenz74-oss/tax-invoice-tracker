'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { GLOnlyResult } from '@/types/bankReconcile';
import { computeGLOnlyTotal, MATCH_STATUS_BADGE_CLASS, MATCH_STATUS_LABELS } from '@/lib/bankReconcileMatchLogic';

const THB2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

interface BankReconcileUnmatchedGLProps {
  glOnlyResults: GLOnlyResult[];
}

/**
 * ส่วนแยกต่างหากใต้ตารางผลลัพธ์หลัก "รายการใน GL ที่ไม่พบใน Bank Statement" — แสดงเฉพาะแถว GL ที่เหลือค้าง
 * หลังจับคู่ทั้งหมดแล้ว (ไม่เคยถูกเลือกเป็น matchedGL ของ Bank แถวใดเลย รวมถึง GL ที่เป็นผู้สมัครของแถว
 * ambiguous ด้วย เพราะ ambiguous ไม่ยึด GL แถวใดไว้จริง) พับ/ขยายได้โดย reuse คลาส .month-detail-panel ที่มี
 * อยู่แล้วใน globals.css (เทคนิค CSS Grid 0fr -> 1fr เดียวกับหน้า "ภาษีซื้อที่ยังไม่ได้รับ") ไม่ต้องเพิ่ม CSS
 * ใหม่เลยแม้แต่บรรทัดเดียว — ค่าเริ่มต้นขยายอยู่ (isExpanded=true) เพราะเป็นผลลัพธ์การกระทบยอดโดยตรง ไม่ใช่
 * รายละเอียดเสริมที่ควรซ่อนไว้ก่อน ผู้ใช้พับเก็บเองได้ถ้าต้องการพื้นที่จอเพิ่ม
 */
export default function BankReconcileUnmatchedGL({ glOnlyResults }: BankReconcileUnmatchedGLProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const total = computeGLOnlyTotal(glOnlyResults);

  return (
    <div className="card-surface rounded-2xl p-6" data-testid="reconcile-unmatched-gl-section">
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="btn-press flex w-full flex-wrap items-center justify-between gap-2 text-left"
        aria-expanded={isExpanded}
        data-testid="reconcile-unmatched-gl-toggle"
      >
        <span className="flex items-center gap-2 text-sm font-bold text-text">
          <ChevronDown
            size={16}
            className={`shrink-0 text-text-sub transition-transform duration-[250ms] ${isExpanded ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
          รายการใน GL ที่ไม่พบใน Bank Statement
        </span>
        <span className="font-numeric flex items-center gap-3 text-xs text-text-sub">
          <span data-testid="reconcile-unmatched-gl-count">{glOnlyResults.length.toLocaleString('th-TH')} รายการ</span>
          <span className="font-semibold text-text" data-testid="reconcile-unmatched-gl-total">
            รวม {total.toLocaleString('th-TH', THB2)} บาท
          </span>
        </span>
      </button>

      <div className={`month-detail-panel ${isExpanded ? 'is-expanded' : ''}`}>
        <div className="pt-4">
          {glOnlyResults.length === 0 ? (
            <div
              className="rounded-2xl border border-dashed border-border bg-card-bg p-8 text-center text-sm text-text-sub"
              data-testid="reconcile-unmatched-gl-empty"
            >
              ไม่พบรายการ GL ที่ตกค้าง
            </div>
          ) : (
            <div className="overflow-auto rounded-xl border border-border">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-table-header">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-sub">วันที่ GL</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-sub">เลขที่เอกสาร</th>
                    <th className="min-w-[160px] px-3 py-2.5 text-left text-xs font-semibold text-text-sub">รายละเอียด</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold text-text-sub">เดบิต</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold text-text-sub">เครดิต</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold text-text-sub">ยอดสุทธิ</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-sub">สถานะ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {glOnlyResults.map((r) => (
                    <tr
                      key={r.gl.gl_row_id}
                      className="transition-colors duration-150 hover:bg-table-row-hover"
                      data-testid={`reconcile-unmatched-gl-row-${r.gl.gl_row_id}`}
                    >
                      <td className="font-numeric px-3 py-2.5 text-text-sub">{formatDate(r.gl.gl_date)}</td>
                      <td className="px-3 py-2.5 text-text-sub">{r.gl.gl_document_no || '-'}</td>
                      <td className="px-3 py-2.5 text-text">{r.gl.gl_description || '-'}</td>
                      <td className="font-numeric px-3 py-2.5 text-right text-text-sub">
                        {r.gl.gl_debit.toLocaleString('th-TH', THB2)}
                      </td>
                      <td className="font-numeric px-3 py-2.5 text-right text-text-sub">
                        {r.gl.gl_credit.toLocaleString('th-TH', THB2)}
                      </td>
                      <td className="font-numeric px-3 py-2.5 text-right font-semibold text-text">
                        {r.gl.gl_amount.toLocaleString('th-TH', THB2)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-block w-fit rounded-full px-3.5 py-2 text-xs font-medium ${MATCH_STATUS_BADGE_CLASS[r.status]}`}
                        >
                          {MATCH_STATUS_LABELS[r.status]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
