'use client';

import { X } from 'lucide-react';
import type { PendingTaxInvoice } from '@/types/invoice';
import {
  calcNetPayment,
  getTaxInvoiceStatusBadgeClass,
  getTaxInvoiceStatusLabel,
  TAX_TYPE_LABELS,
} from '@/lib/invoiceLogic';
import { formatThaiDate, thaiMonthName } from '@/lib/thaiDate';

const THB = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// เดิมแสดงปี ค.ศ. ทั้งที่กรอกเป็น พ.ศ. — ดูคอมเมนต์ formatThaiDate ใน lib/thaiDate.ts (แก้ 2026-09-14)
const formatDate = formatThaiDate;

interface InvoiceDetailModalProps {
  invoice: PendingTaxInvoice;
  // ข้อมูลใบหัก ณ ที่จ่ายที่ออกให้รายการนี้แล้ว (ถ้ามี) — parent (InvoiceTable.tsx) ดึงใบหัก ณ ที่จ่าย
  // ทั้งหมดของบริษัทมาแล้วส่งต่อมาเป็น Map เดียวกับที่ใช้แสดงตัวเล็กใต้ชื่อผู้ขายในตาราง ไม่ query ซ้ำที่นี่
  whtCertificatesById?: Map<string, { cert_number: string; payee_name: string }>;
  onClose: () => void;
}

/**
 * Modal อ่านอย่างเดียวสำหรับปุ่ม "ดูรายละเอียด" ในหน้า "บันทึกการจ่ายเงิน" (เพิ่มเข้ามา 2026-08-26 ตามคำขอผู้ใช้
 * "เมื่อฉันบันทึกได้รับใบกำกับภาษีซื้อมาแล้ว ฉันอยากให้มีปุ่มดูรายละเอียด เพื่อเรียกดูรายละเอียดใบกำกับภาษีที่
 * ฉันบันทึกแล้ว") — เดิมหลังกด "ได้รับแล้ว" บันทึกเลขที่ใบกำกับภาษี/วันที่ได้รับ/วันที่ในใบกำกับ/เดือนปีที่ใช้
 * เครดิต VAT ผ่าน ReceiveInvoiceModal ไปแล้ว แต่ไม่มีทางเรียกดูข้อมูลที่กรอกไปนั้นซ้ำอีกเลยนอกจากกด "แก้ไข"
 * (ซึ่งเป็นฟอร์มแก้ไขจริง ไม่เหมาะกับการแค่ดูเฉยๆ) — เขียนเป็น component แยกใหม่ ไม่แตะ/ไม่ใช้ InvoiceForm เดิม
 * ตาม pattern เดียวกับ OverdueInvoiceDetailModal.tsx (หน้า "ภาษีซื้อที่ยังไม่ได้รับ") ทุกประการ ไม่มีการเรียก
 * API หรือแก้ไขข้อมูลใดๆ ในนี้เลย มีแค่ปุ่มปิด — ต่างจาก OverdueInvoiceDetailModal.tsx ตรงที่หน้านี้ครอบคลุม
 * ทุกสถานะ (ไม่ใช่แค่ pending ที่เกินกำหนด) จึงเพิ่มส่วน "ข้อมูลการรับเอกสาร" (เลขที่/วันที่ใบกำกับภาษีจริง,
 * วันที่ได้รับ, เดือน/ปีที่ใช้เครดิต VAT) ที่แสดงเฉพาะรายการที่บันทึก "ได้รับแล้ว" ไปแล้วเท่านั้น และส่วนข้อมูล
 * ใบหัก ณ ที่จ่ายถ้าออกใบไปแล้ว
 */
export default function InvoiceDetailModal({ invoice, whtCertificatesById, onClose }: InvoiceDetailModalProps) {
  const cert = invoice.wht_certificate_id ? whtCertificatesById?.get(invoice.wht_certificate_id) : undefined;
  const hasReceivedInfo = Boolean(invoice.tax_invoice_number || invoice.received_date || invoice.tax_invoice_date);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`รายละเอียดรายการ ${invoice.vendor_name}`}
      data-testid="invoice-detail-modal"
    >
      {/* การ์ด/โมดัลทั้งระบบเป็นกระจกเข้มเสมอ (card-surface ชนะ bg-card-bg เสมอตาม CSS Cascade Layers — ดู
          คอมเมนต์เต็มใน app/globals.css) องค์ประกอบที่วางตรงบนพื้นการ์ดตรงนี้ (ไม่มีกล่อง bg-card-bg ของ
          ตัวเอง) จึงต้องใช้สีอ่อน text-text/text-text-sub ให้อ่านออกบนพื้นเข้ม (2026-08-12) */}
      {/* max-h ต้องตรงกับ padding ของ overlay ด้านนอกเป๊ะๆ (p-4 = 16px บน+ล่างรวม 32px) — เดิมใช้
          calc(100vh-48px) (ตามโมดัลอื่นในระบบ) ซึ่งมากกว่าพื้นที่จริงที่ overlay เหลือให้ (100vh-32px) ทำให้
          การ์ดสูงเกินกรอบได้ 16px ในบางความสูงจอ เกิด scroll เลื่อนขึ้นลงได้นิดเดียวโดยไม่จำเป็น (ผู้ใช้แจ้ง
          2026-08-26) แก้โดยให้ตัวเลขตรงกันเป๊ะ ไม่มีส่วนเกินให้ scroll */}
      <div
        className="card-surface card-surface-modal max-h-[calc(100vh-32px)] w-full max-w-lg overflow-y-auto rounded-2xl bg-card-bg p-6"
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
            data-testid="invoice-detail-close"
          >
            <X size={18} />
          </button>
        </div>

        <span
          className={`inline-block w-fit rounded-full px-3.5 py-2 text-xs font-medium ${getTaxInvoiceStatusBadgeClass(invoice)}`}
        >
          {getTaxInvoiceStatusLabel(invoice)}
        </span>

        <dl className="mt-5 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          <DetailField label="ผู้ขาย" value={invoice.vendor_name} />
          <DetailField label="เลขประจำตัวผู้เสียภาษี" value={invoice.vendor_tax_id ?? '-'} numeric />
          <DetailField label="ผู้ติดต่อ" value={invoice.contact_person || '-'} />
          <DetailField label="เลขที่อ้างอิง" value={invoice.reference_no || '-'} />
          <DetailField label="วันที่ทำรายการ" value={formatDate(invoice.transaction_date)} numeric />
          <DetailField label="ประเภทภาษี" value={invoice.tax_type ? TAX_TYPE_LABELS[invoice.tax_type] : 'รอตรวจสอบประเภทภาษี'} />
          <DetailField label="รายละเอียด" value={invoice.description || '-'} span />
          <DetailField label="ยอดก่อน VAT" value={`${THB.format(invoice.amount_excl_vat)} บาท`} numeric />
          <DetailField label="VAT" value={`${THB.format(invoice.vat_amount)} บาท`} numeric />
          <DetailField label="หัก ณ ที่จ่าย" value={invoice.wht_amount ? `${THB.format(invoice.wht_amount)} บาท` : '-'} numeric />
          <DetailField
            label="ยอดจ่ายสุทธิ"
            value={`${THB.format(calcNetPayment(invoice.total_amount, invoice.wht_amount))} บาท`}
            numeric
          />
          {invoice.notes && <DetailField label="หมายเหตุ" value={invoice.notes} span />}
        </dl>

        {hasReceivedInfo && (
          <div className="mt-5 border-t border-border/70 pt-4">
            <h4 className="text-xs font-bold text-text-sub">ข้อมูลการรับเอกสาร</h4>
            <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <DetailField label="เลขที่ใบกำกับภาษี" value={invoice.tax_invoice_number || '-'} />
              <DetailField label="วันที่ได้รับเอกสาร" value={formatDate(invoice.received_date)} numeric />
              <DetailField label="วันที่ในใบกำกับภาษี" value={formatDate(invoice.tax_invoice_date)} numeric />
              <DetailField
                label="เดือน/ปีที่ใช้เครดิต VAT"
                value={
                  invoice.vat_claim_month && invoice.vat_claim_year
                    ? `${thaiMonthName(invoice.vat_claim_month)} ${invoice.vat_claim_year}`
                    : '-'
                }
              />
            </dl>
          </div>
        )}

        {cert && (
          <div className="mt-5 border-t border-border/70 pt-4">
            <h4 className="text-xs font-bold text-text-sub">ใบหัก ณ ที่จ่าย</h4>
            <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <DetailField label="เลขที่ใบหัก ณ ที่จ่าย" value={cert.cert_number} />
              <DetailField label="ชื่อผู้รับเงิน" value={cert.payee_name} />
            </dl>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="btn-press rounded-[10px] border border-border bg-card-bg px-4 py-2.5 text-sm font-medium text-text-sub hover:bg-page-bg"
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
