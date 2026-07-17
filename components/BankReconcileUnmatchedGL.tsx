'use client';

import { useState } from 'react';
import { CheckSquare, ChevronDown, Search, Square, StickyNote } from 'lucide-react';
import { GL_ONLY_BADGE_CLASS, GL_ONLY_STATUS_LABEL, TRANSACTION_DIRECTION_BADGE_CLASS, TRANSACTION_DIRECTION_LABELS } from '@/types/bankReconcile';
import type { GLOnlyRow, GLReviewFlags } from '@/types/bankReconcile';

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

interface BankReconcileUnmatchedGLProps {
  rows: GLOnlyRow[];
  reviewFlags: Record<string, GLReviewFlags>;
  onToggleNeedsGlReview: (glRowId: string) => void;
  onToggleReviewed: (glRowId: string) => void;
  onEditNote: (glRowId: string) => void;
}

/**
 * ส่วนแยกต่างหาก "รายการใน GL ที่ไม่พบใน Bank Statement" (สเปกส่วน "16. GL-ONLY TABLE") — แสดงเฉพาะแถว GL ที่
 * เหลือค้างหลังจับคู่ทั้งหมดแล้ว (glOnlyResults จาก runSimpleReconciliation) คอลัมน์ตรงตามสเปกเป๊ะ: ลำดับ/
 * วันที่ GL/เลขที่เอกสาร/รายละเอียด/ประเภท/ยอด GL/สถานะ/หมายเหตุ/การจัดการ ป้ายสถานะสีส้ม/ม่วงตามสเปก (เลือก
 * ม่วง — ดูเหตุผลที่ GL_ONLY_BADGE_CLASS ใน types/bankReconcile.ts) ปุ่มการจัดการ (เพิ่มหมายเหตุ/ทำเครื่องหมาย
 * ต้องตรวจสอบ GL/ทำเครื่องหมายตรวจสอบแล้ว) ตามสเปกส่วน "17. REVIEW WORKFLOW" ("For 'มีใน GL แต่ไม่มีใน
 * Bank'...") พับ/ขยายได้โดย reuse คลาส .month-detail-panel เดิมของระบบ (เทคนิค CSS Grid 0fr -> 1fr) ไม่เพิ่ม
 * CSS ใหม่เลย ค่าเริ่มต้นขยายอยู่เสมอ (isExpanded=true) เพราะเป็นผลลัพธ์การกระทบยอดโดยตรง
 */
export default function BankReconcileUnmatchedGL({ rows, reviewFlags, onToggleNeedsGlReview, onToggleReviewed, onEditNote }: BankReconcileUnmatchedGLProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const total = rows.reduce((s, r) => s + r.gl.amount, 0);

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
          <span data-testid="reconcile-unmatched-gl-count">{rows.length.toLocaleString('th-TH')} รายการ</span>
          <span className="font-semibold text-text" data-testid="reconcile-unmatched-gl-total">
            รวม {money(total)} บาท
          </span>
        </span>
      </button>

      <div className={`month-detail-panel ${isExpanded ? 'is-expanded' : ''}`}>
        <div className="pt-4">
          {rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card-bg p-8 text-center text-sm text-text-sub" data-testid="reconcile-unmatched-gl-empty">
              <Search className="mx-auto mb-2 text-text-sub" size={20} aria-hidden="true" />
              ไม่พบรายการ GL ที่ตกค้าง
            </div>
          ) : (
            <div className="overflow-auto rounded-xl border border-border">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-table-header">
                  <tr>
                    {['ลำดับ', 'วันที่ GL', 'เลขที่เอกสาร', 'รายละเอียด', 'ประเภท', 'ยอด GL', 'สถานะ', 'หมายเหตุ'].map((h) => (
                      <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold whitespace-nowrap text-text-sub">
                        {h}
                      </th>
                    ))}
                    <th className="px-3 py-2.5 text-right text-xs font-semibold whitespace-nowrap text-text-sub">การจัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {rows.map((r, index) => {
                    const flags = reviewFlags[r.gl.id];
                    return (
                      <tr key={r.gl.id} className="transition-colors duration-150 hover:bg-table-row-hover" data-testid={`reconcile-unmatched-gl-row-${r.gl.id}`}>
                        <td className="font-numeric px-3 py-2.5 text-text-sub">{index + 1}</td>
                        <td className="font-numeric px-3 py-2.5 whitespace-nowrap text-text-sub">{formatDate(r.gl.date)}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-text-sub">{r.gl.docNo || '-'}</td>
                        <td className="min-w-[160px] px-3 py-2.5 text-text">{r.gl.description || '-'}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${TRANSACTION_DIRECTION_BADGE_CLASS[r.gl.direction!]}`}>
                            {TRANSACTION_DIRECTION_LABELS[r.gl.direction!]}
                          </span>
                        </td>
                        <td className="font-numeric px-3 py-2.5 text-right font-semibold whitespace-nowrap text-text">{money(r.gl.amount)}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className={`inline-block w-fit rounded-full px-3.5 py-2 text-xs font-medium ${GL_ONLY_BADGE_CLASS}`}>{GL_ONLY_STATUS_LABEL}</span>
                        </td>
                        <td className="min-w-[140px] px-3 py-2.5 text-text-sub">
                          {flags?.reviewNote || '-'}
                          {flags?.needsGlReview && <span className="mt-1 block text-xs font-medium text-warning">ต้องตรวจสอบ GL</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-nowrap justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => onEditNote(r.gl.id)}
                              title="เพิ่ม/แก้ไขหมายเหตุ"
                              className="btn-press rounded-[8px] border border-border p-1.5 text-text-sub hover:bg-page-bg"
                              data-testid={`reconcile-gl-note-${r.gl.id}`}
                            >
                              <StickyNote size={14} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onToggleNeedsGlReview(r.gl.id)}
                              title="ทำเครื่องหมายว่าต้องตรวจสอบ GL"
                              className={`btn-press rounded-[8px] border p-1.5 ${flags?.needsGlReview ? 'border-warning/40 bg-warning/10 text-warning' : 'border-border text-text-sub hover:bg-page-bg'}`}
                              data-testid={`reconcile-gl-needs-review-${r.gl.id}`}
                            >
                              <Search size={14} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onToggleReviewed(r.gl.id)}
                              title="ทำเครื่องหมายว่าตรวจสอบแล้ว"
                              className={`btn-press rounded-[8px] border p-1.5 ${flags?.reviewed ? 'border-success/40 bg-success/10 text-success' : 'border-border text-text-sub hover:bg-page-bg'}`}
                              data-testid={`reconcile-gl-reviewed-${r.gl.id}`}
                            >
                              {flags?.reviewed ? <CheckSquare size={14} aria-hidden="true" /> : <Square size={14} aria-hidden="true" />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
