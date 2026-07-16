'use client';

import { X } from 'lucide-react';
import type { BankMatchResult } from '@/types/bankReconcile';
import { MATCH_STATUS_BADGE_CLASS, MATCH_STATUS_LABELS } from '@/lib/bankReconcileMatchLogic';

const THB2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function money(n: number): string {
  return n.toLocaleString('th-TH', THB2);
}

interface BankReconcileDetailDrawerProps {
  result: BankMatchResult;
  onClose: () => void;
}

/**
 * Modal อ่านอย่างเดียวสำหรับปุ่ม "ดูรายละเอียด" — เทียบข้อมูล Bank กับ GL ที่จับคู่แล้ว (ถ้ามี) พร้อมสรุป
 * ผลเปรียบเทียบ (ยอด/ผลต่าง/วันที่ต่างกัน/คะแนน/เหตุผล/สถานะ) มิเรอร์สไตล์ + DetailField pattern จาก
 * OverdueInvoiceDetailModal.tsx เป๊ะ (modal เดิมของระบบ ไม่สร้างรูปแบบ interaction ใหม่)
 */
export default function BankReconcileDetailDrawer({ result, onClose }: BankReconcileDetailDrawerProps) {
  const { bank, matchedGL } = result;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`รายละเอียดรายการ ${bank.bank_description || ''}`}
      data-testid="reconcile-detail-modal"
    >
      <div
        className="card-surface max-h-[calc(100vh-48px)] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-text">รายละเอียดรายการกระทบยอด</h3>
            <p className="mt-0.5 text-sm text-text-sub">{bank.bank_description || '-'}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-text-sub hover:bg-page-bg"
            aria-label="ปิด"
            data-testid="reconcile-detail-close"
          >
            <X size={18} />
          </button>
        </div>

        <span
          className={`inline-block w-fit rounded-full px-3.5 py-2 text-xs font-medium ${MATCH_STATUS_BADGE_CLASS[result.status]}`}
        >
          {MATCH_STATUS_LABELS[result.status]}
        </span>

        <h4 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-text-sub">Bank Statement</h4>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          <DetailField label="วันที่" value={formatDate(bank.bank_date)} numeric />
          <DetailField label="รายละเอียด" value={bank.bank_description || '-'} span />
          <DetailField label="เงินเข้า" value={`${money(bank.bank_money_in)} บาท`} numeric />
          <DetailField label="เงินออก" value={`${money(bank.bank_money_out)} บาท`} numeric />
          <DetailField label="ยอดสุทธิ" value={`${money(bank.bank_amount)} บาท`} numeric />
          <DetailField label="ยอดคงเหลือ" value={`${money(bank.bank_balance)} บาท`} numeric />
        </dl>

        <h4 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-text-sub">GL จากระบบ Express</h4>
        {matchedGL ? (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            <DetailField label="วันที่" value={formatDate(matchedGL.gl_date)} numeric />
            <DetailField label="เลขที่เอกสาร" value={matchedGL.gl_document_no || '-'} />
            <DetailField label="รายละเอียด" value={matchedGL.gl_description || '-'} span />
            <DetailField label="เดบิต" value={`${money(matchedGL.gl_debit)} บาท`} numeric />
            <DetailField label="เครดิต" value={`${money(matchedGL.gl_credit)} บาท`} numeric />
            <DetailField label="ยอดสุทธิ" value={`${money(matchedGL.gl_amount)} บาท`} numeric />
          </dl>
        ) : (
          <p className="text-sm text-text-sub" data-testid="reconcile-detail-no-gl">
            ยังไม่มี GL ที่จับคู่ยืนยันแล้วสำหรับรายการนี้
          </p>
        )}

        <h4 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-text-sub">เปรียบเทียบ</h4>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          <DetailField label="ยอด Bank" value={`${money(bank.bank_amount)} บาท`} numeric />
          <DetailField label="ยอด GL" value={matchedGL ? `${money(matchedGL.gl_amount)} บาท` : '-'} numeric />
          <DetailField
            label="ผลต่าง"
            value={result.amountDifference === null ? '-' : `${money(result.amountDifference)} บาท`}
            numeric
          />
          <DetailField
            label="วันที่ต่างกัน"
            value={result.dateDifferenceDays === null ? '-' : `${result.dateDifferenceDays} วัน`}
            numeric
          />
          <DetailField label="คะแนนจับคู่" value={result.matchScore === null ? '-' : String(result.matchScore)} numeric />
          <DetailField label="สถานะ" value={MATCH_STATUS_LABELS[result.status]} />
          <DetailField label="เหตุผลในการจับคู่" value={result.matchReason} span />
        </dl>

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

function DetailField({
  label,
  value,
  span,
  numeric,
}: {
  label: string;
  value: string;
  span?: boolean;
  numeric?: boolean;
}) {
  return (
    <div className={span ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs text-text-sub">{label}</dt>
      <dd className={`mt-0.5 text-sm font-medium text-text ${numeric ? 'font-numeric' : ''}`}>{value}</dd>
    </div>
  );
}
