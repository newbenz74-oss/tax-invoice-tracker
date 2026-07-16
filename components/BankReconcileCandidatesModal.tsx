'use client';

import { X } from 'lucide-react';
import type { BankMatchResult } from '@/types/bankReconcile';
import { describeCandidateMatch } from '@/lib/bankReconcileMatching';

const THB2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

interface BankReconcileCandidatesModalProps {
  result: BankMatchResult;
  onClose: () => void;
}

/**
 * Modal อ่านอย่างเดียวสำหรับปุ่ม "ดูรายการที่อาจตรงกัน" — แสดงผู้สมัคร GL ทั้งหมดที่ยอดเงินตรงกับแถว Bank ที่
 * เลือก (candidates ของ BankMatchResult เก็บไว้ให้ทุกสถานะอยู่แล้ว ไม่ใช่แค่ ambiguous) ไม่มีปุ่มเลือก/ยืนยัน
 * ใดๆ ทั้งสิ้นตามสเปกเฟส 2 ตรงๆ ("No select or confirm button yet" — การเลือกด้วยตนเองจะเพิ่มในเฟส 3)
 * มิเรอร์สไตล์ modal จาก OverdueInvoiceDetailModal.tsx เป๊ะ (ไม่สร้างรูปแบบ interaction ใหม่ให้ระบบ)
 */
export default function BankReconcileCandidatesModal({ result, onClose }: BankReconcileCandidatesModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="รายการ GL ที่อาจตรงกัน"
      data-testid="reconcile-candidates-modal"
    >
      <div
        className="card-surface max-h-[calc(100vh-48px)] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-text">รายการ GL ที่อาจตรงกัน</h3>
            <p className="mt-0.5 text-sm text-text-sub">
              Bank: {formatDate(result.bank.bank_date)} · {result.bank.bank_description || '-'} ·{' '}
              {result.bank.bank_amount.toLocaleString('th-TH', THB2)} บาท
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-text-sub hover:bg-page-bg"
            aria-label="ปิด"
            data-testid="reconcile-candidates-close"
          >
            <X size={18} />
          </button>
        </div>

        {result.candidates.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card-bg p-8 text-center text-sm text-text-sub">
            ไม่พบผู้สมัคร GL ที่ยอดเงินตรงกัน
          </div>
        ) : (
          <div className="card-surface overflow-auto rounded-2xl">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-table-header">
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-sub">วันที่ GL</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-sub">เลขที่เอกสาร</th>
                  <th className="min-w-[140px] px-3 py-2.5 text-left text-xs font-semibold text-text-sub">รายละเอียด</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-text-sub">เดบิต</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-text-sub">เครดิต</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-text-sub">ยอดสุทธิ</th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold text-text-sub">วันที่ต่างกัน</th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold text-text-sub">คะแนนจับคู่</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {result.candidates.map((c) => {
                  const { dateDiffDays, matchScore } = describeCandidateMatch(result.bank, c);
                  const isChosen = result.matchedGL?.gl_row_id === c.gl_row_id;
                  return (
                    <tr
                      key={c.gl_row_id}
                      className={`transition-colors duration-150 hover:bg-table-row-hover ${isChosen ? 'bg-success/5' : ''}`}
                      data-testid={`reconcile-candidate-${c.gl_row_id}`}
                    >
                      <td className="font-numeric px-3 py-2.5 text-text-sub">{formatDate(c.gl_date)}</td>
                      <td className="px-3 py-2.5 text-text-sub">{c.gl_document_no || '-'}</td>
                      <td className="px-3 py-2.5 text-text">{c.gl_description || '-'}</td>
                      <td className="font-numeric px-3 py-2.5 text-right text-text-sub">
                        {c.gl_debit.toLocaleString('th-TH', THB2)}
                      </td>
                      <td className="font-numeric px-3 py-2.5 text-right text-text-sub">
                        {c.gl_credit.toLocaleString('th-TH', THB2)}
                      </td>
                      <td className="font-numeric px-3 py-2.5 text-right font-semibold text-text">
                        {c.gl_amount.toLocaleString('th-TH', THB2)}
                      </td>
                      <td className="font-numeric px-3 py-2.5 text-center text-text-sub">
                        {dateDiffDays === null ? '-' : `${dateDiffDays} วัน`}
                      </td>
                      <td className="font-numeric px-3 py-2.5 text-center text-text-sub">{matchScore}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="btn-press rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-text-sub hover:bg-page-bg"
          >
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
}
