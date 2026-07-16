'use client';

import { X } from 'lucide-react';
import type { PendingTaxInvoice } from '@/types/invoice';
import { getTaxInvoiceStatusBadgeClass, getTaxInvoiceStatusLabel } from '@/lib/invoiceLogic';
import { OVERDUE_AGING_BADGE_CLASS, OVERDUE_AGING_LABELS, getOverdueAging } from '@/lib/overduePurchaseTaxLogic';

const THB = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

interface OverdueInvoiceDetailModalProps {
  invoice: PendingTaxInvoice;
  today: string;
  onClose: () => void;
}

/** Modal อ่านอย่างเดียวสำหรับปุ่ม "ดูรายละเอียด" ในหน้า "ภาษีซื้อที่ยังไม่ได้รับ" — เป็น component ใหม่
 * แยกต่างหาก ไม่แตะ/ไม่ใช้ InvoiceForm เดิม (ซึ่งเป็นฟอร์มแก้ไขจริง มี state/validation/submit ผูกอยู่
 * ไม่เหมาะกับการแสดงผลอ่านอย่างเดียวล้วนๆ) ไม่มีการเรียก API หรือแก้ไขข้อมูลใดๆ ในนี้เลย มีแค่ปุ่มปิด */
export default function OverdueInvoiceDetailModal({ invoice, today, onClose }: OverdueInvoiceDetailModalProps) {
  const aging = getOverdueAging(invoice.expected_date, today);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`รายละเอียดรายการ ${invoice.vendor_name}`}
      data-testid="overdue-report-detail-modal"
    >
      <div
        className="card-surface max-h-[calc(100vh-48px)] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-text">รายละเอียดรายการ</h3>
            <p className="mt-0.5 text-sm text-text-sub">{invoice.vendor_name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-text-sub hover:bg-page-bg"
            aria-label="ปิด"
            data-testid="overdue-report-detail-close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <span
            className={`inline-block w-fit rounded-full px-3.5 py-2 text-xs font-medium ${getTaxInvoiceStatusBadgeClass(invoice)}`}
          >
            {getTaxInvoiceStatusLabel(invoice)}
          </span>
          <span className={`inline-block w-fit rounded-full px-3.5 py-2 text-xs font-medium ${OVERDUE_AGING_BADGE_CLASS[aging.status]}`}>
            {OVERDUE_AGING_LABELS[aging.status]} · {aging.daysText}
          </span>
        </div>

        <dl className="mt-5 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          <DetailField label="ผู้ขาย" value={invoice.vendor_name} />
          <DetailField label="เลขประจำตัวผู้เสียภาษี" value={invoice.vendor_tax_id ?? '-'} numeric />
          <DetailField label="วันที่ทำรายการ" value={formatDate(invoice.transaction_date)} numeric />
          <DetailField label="วันที่คาดว่าจะได้รับ" value={formatDate(invoice.expected_date)} numeric />
          <DetailField label="เลขที่อ้างอิง" value={invoice.reference_no || '-'} />
          <DetailField label="รายละเอียด" value={invoice.description || '-'} span />
          <DetailField label="ยอดก่อน VAT" value={`${THB.format(invoice.amount_excl_vat)} บาท`} numeric />
          <DetailField label="VAT" value={`${THB.format(invoice.vat_amount)} บาท`} numeric />
          <DetailField label="ยอดรวม" value={`${THB.format(invoice.total_amount)} บาท`} numeric span />
          {invoice.notes && <DetailField label="หมายเหตุ" value={invoice.notes} span />}
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
