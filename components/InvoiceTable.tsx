'use client';

import { useState } from 'react';
import type { MarkReceivedInput, PendingTaxInvoice, SortDirection, SortField } from '@/types/invoice';
import {
  AGING_BADGE_CLASS,
  AGING_LABELS,
  getAgingBucket,
  getTaxInvoiceStatusBadgeClass,
  getTaxInvoiceStatusLabel,
} from '@/lib/invoiceLogic';
import { buddhistYearOptions, currentBuddhistYear, currentMonth, thaiMonthName } from '@/lib/thaiDate';

const THB = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

interface InvoiceTableProps {
  invoices: PendingTaxInvoice[];
  today: string;
  sortField: SortField;
  sortDirection: SortDirection;
  onSortChange: (field: SortField) => void;
  onEdit: (invoice: PendingTaxInvoice) => void;
  onMarkReceived: (invoice: PendingTaxInvoice, input: MarkReceivedInput) => Promise<void>;
  onCancelInvoice: (invoice: PendingTaxInvoice) => Promise<void>;
  onDelete: (invoice: PendingTaxInvoice) => Promise<void>;
}

const COLUMNS: { field: SortField; label: string }[] = [
  { field: 'vendor_name', label: 'ผู้ขาย' },
  { field: 'transaction_date', label: 'วันที่ทำรายการ' },
  { field: 'total_amount', label: 'ยอดรวม' },
  { field: 'expected_date', label: 'คาดว่าจะได้รับ' },
];

// อินพุตในตาราง (แถบ "มาร์กว่าได้รับแล้ว") ตั้งใจให้กระชับกว่า input ทั่วไปของระบบ (สูง 48px)
// เพราะอยู่ในเซลล์ตารางแคบๆ ที่มี 5 ฟิลด์เรียงต่อกัน ใช้ความสูงเต็ม 48px ตรงนี้จะทำให้แถวสูง
// เกินไปจนตารางดูอึดอัด — คงขนาดกระชับเดิมไว้ แต่ปรับสี/ขอบ/โฟกัสให้เป็นชุดสีใหม่ทั้งหมด
const inlineInputClass =
  'w-40 rounded-[10px] border border-border bg-white px-2.5 py-1.5 text-xs text-text focus-ring-primary';

export default function InvoiceTable({
  invoices,
  today,
  sortField,
  sortDirection,
  onSortChange,
  onEdit,
  onMarkReceived,
  onCancelInvoice,
  onDelete,
}: InvoiceTableProps) {
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [taxInvoiceNumber, setTaxInvoiceNumber] = useState('');
  const [receivedDate, setReceivedDate] = useState(today);
  // เพิ่ม 3 ฟิลด์ใหม่สำหรับรายงานภาษีซื้อ (ดู lib/vatReportLogic.ts) — vatClaimMonth/Year ใช้ ''
  // แทนค่ายังไม่ได้เลือกใน <select> (ควบคุมด้วย React แบบ controlled component)
  const [taxInvoiceDate, setTaxInvoiceDate] = useState('');
  const [vatClaimMonth, setVatClaimMonth] = useState<number | ''>('');
  const [vatClaimYear, setVatClaimYear] = useState<number | ''>('');
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleConfirmReceived(invoice: PendingTaxInvoice) {
    if (!taxInvoiceNumber.trim() || !taxInvoiceDate || !vatClaimMonth || !vatClaimYear) return;
    setBusyId(invoice.id);
    try {
      await onMarkReceived(invoice, {
        taxInvoiceNumber: taxInvoiceNumber.trim(),
        receivedDate,
        taxInvoiceDate,
        vatClaimMonth,
        vatClaimYear,
      });
      setReceivingId(null);
      setTaxInvoiceNumber('');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteClick(invoice: PendingTaxInvoice) {
    if (confirmingDeleteId !== invoice.id) {
      setConfirmingDeleteId(invoice.id);
      return;
    }
    setBusyId(invoice.id);
    try {
      await onDelete(invoice);
    } finally {
      setBusyId(null);
      setConfirmingDeleteId(null);
    }
  }

  if (invoices.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card-bg p-12 text-center text-sm text-text-sub">
        ไม่พบรายการ
      </div>
    );
  }

  return (
    <div className="card-surface overflow-x-auto rounded-2xl">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-table-header">
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col.field}
                onClick={() => onSortChange(col.field)}
                className="cursor-pointer select-none px-[18px] py-[18px] text-left text-xs font-semibold text-text-sub hover:text-primary"
                data-testid={`sort-${col.field}`}
              >
                {col.label}
                {sortField === col.field && (sortDirection === 'asc' ? ' ▲' : ' ▼')}
              </th>
            ))}
            <th className="px-[18px] py-[18px] text-right text-xs font-semibold text-text-sub">ยอดก่อน VAT</th>
            <th className="px-[18px] py-[18px] text-right text-xs font-semibold text-text-sub">VAT</th>
            <th className="px-[18px] py-[18px] text-left text-xs font-semibold text-text-sub">เลขที่อ้างอิง</th>
            <th className="px-[18px] py-[18px] text-left text-xs font-semibold text-text-sub">สถานะ / Aging</th>
            <th className="px-[18px] py-[18px] text-right text-xs font-semibold text-text-sub">การจัดการ</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {invoices.map((invoice, index) => {
            const bucket = getAgingBucket(invoice.expected_date, invoice.status, today);
            const isReceiving = receivingId === invoice.id;
            const isBusy = busyId === invoice.id;
            return (
              <tr
                key={invoice.id}
                data-testid={`invoice-row-${invoice.id}`}
                className={`transition-colors duration-150 hover:bg-table-row-hover ${
                  index % 2 === 1 ? 'bg-table-row-zebra' : ''
                }`}
              >
                <td className="px-[18px] py-[18px] font-medium text-text">{invoice.vendor_name}</td>
                <td className="px-[18px] py-[18px] text-text-sub">{formatDate(invoice.transaction_date)}</td>
                <td className="font-numeric px-[18px] py-[18px] text-text">{THB.format(invoice.total_amount)}</td>
                <td className="px-[18px] py-[18px] text-text-sub">{formatDate(invoice.expected_date)}</td>
                <td
                  className="font-numeric px-[18px] py-[18px] text-right text-text-sub"
                  data-testid={`amount-excl-vat-${invoice.id}`}
                >
                  {THB.format(invoice.amount_excl_vat)}
                </td>
                <td
                  className="font-numeric px-[18px] py-[18px] text-right text-text-sub"
                  data-testid={`vat-amount-${invoice.id}`}
                >
                  {THB.format(invoice.vat_amount)}
                </td>
                <td className="px-[18px] py-[18px] text-text-sub">{invoice.reference_no || '-'}</td>
                <td className="px-[18px] py-[18px]">
                  <div className="flex flex-col gap-1">
                    <span
                      className={`inline-block w-fit rounded-full px-3.5 py-2 text-xs font-medium ${getTaxInvoiceStatusBadgeClass(invoice)}`}
                      data-testid={`tax-status-badge-${invoice.id}`}
                    >
                      {getTaxInvoiceStatusLabel(invoice)}
                    </span>
                    {invoice.status === 'pending' && (
                      <span
                        className={`inline-block w-fit rounded-full px-3.5 py-2 text-xs font-medium ${AGING_BADGE_CLASS[bucket]}`}
                        data-testid={`aging-badge-${invoice.id}`}
                      >
                        {AGING_LABELS[bucket]}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-[18px] py-[18px]">
                  {isReceiving ? (
                    <div className="flex flex-col items-end gap-1.5">
                      <input
                        placeholder="เลขที่ใบกำกับภาษี"
                        value={taxInvoiceNumber}
                        onChange={(e) => setTaxInvoiceNumber(e.target.value)}
                        className={inlineInputClass}
                        data-testid={`tax-invoice-number-input-${invoice.id}`}
                      />
                      <label className="flex w-40 flex-col gap-0.5 text-[10px] text-text-sub">
                        วันที่ได้รับเอกสาร
                        <input
                          type="date"
                          value={receivedDate}
                          onChange={(e) => setReceivedDate(e.target.value)}
                          className={inlineInputClass}
                        />
                      </label>
                      <label className="flex w-40 flex-col gap-0.5 text-[10px] text-text-sub">
                        วันที่ใบกำกับภาษี *
                        <input
                          type="date"
                          value={taxInvoiceDate}
                          onChange={(e) => setTaxInvoiceDate(e.target.value)}
                          className={inlineInputClass}
                          data-testid={`tax-invoice-date-input-${invoice.id}`}
                        />
                      </label>
                      <label className="flex w-40 flex-col gap-0.5 text-[10px] text-text-sub">
                        เดือนที่ใช้เครดิต VAT *
                        <select
                          value={vatClaimMonth}
                          onChange={(e) => setVatClaimMonth(e.target.value ? Number(e.target.value) : '')}
                          className={inlineInputClass}
                          data-testid={`vat-claim-month-select-${invoice.id}`}
                        >
                          <option value="">เลือกเดือน</option>
                          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                            <option key={m} value={m}>
                              {thaiMonthName(m)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex w-40 flex-col gap-0.5 text-[10px] text-text-sub">
                        ปีที่ใช้เครดิต VAT *
                        <select
                          value={vatClaimYear}
                          onChange={(e) => setVatClaimYear(e.target.value ? Number(e.target.value) : '')}
                          className={inlineInputClass}
                          data-testid={`vat-claim-year-select-${invoice.id}`}
                        >
                          <option value="">เลือกปี</option>
                          {buddhistYearOptions().map((y) => (
                            <option key={y} value={y}>
                              {y}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setReceivingId(null);
                            setTaxInvoiceNumber('');
                          }}
                          className="btn-press rounded-[10px] border border-border px-2 py-1 text-xs text-text-sub hover:bg-page-bg"
                        >
                          ยกเลิก
                        </button>
                        <button
                          type="button"
                          disabled={!taxInvoiceNumber.trim() || !taxInvoiceDate || !vatClaimMonth || !vatClaimYear || isBusy}
                          onClick={() => handleConfirmReceived(invoice)}
                          className="btn-press rounded-[10px] bg-success px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                          data-testid={`confirm-received-${invoice.id}`}
                        >
                          ยืนยัน
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {invoice.status === 'pending' &&
                        invoice.tax_type !== 'no_vat' &&
                        invoice.tax_type !== 'non_claimable_vat' && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setReceivingId(invoice.id);
                              setTaxInvoiceNumber('');
                              setReceivedDate(today);
                              setTaxInvoiceDate('');
                              // เดือน/ปีที่ใช้เครดิต VAT ตั้งค่าเริ่มต้นเป็นเดือน/ปีปัจจุบัน (กรณีส่วนใหญ่
                              // ที่นำไปเครดิตในเดือนเดียวกับที่กำลังบันทึก) ผู้ใช้แก้เป็นเดือน/ปีอื่นได้เสมอ
                              setVatClaimMonth(currentMonth());
                              setVatClaimYear(currentBuddhistYear());
                            }}
                            className="btn-press rounded-[10px] border border-success/40 px-2 py-1 text-xs font-medium text-success hover:bg-success/10"
                            data-testid={`mark-received-${invoice.id}`}
                          >
                            ได้รับแล้ว
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => onCancelInvoice(invoice)}
                            className="btn-press rounded-[10px] border border-border px-2 py-1 text-xs font-medium text-text-sub hover:bg-page-bg"
                          >
                            ยกเลิกรายการ
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => onEdit(invoice)}
                        className="btn-press rounded-[10px] border border-border px-2 py-1 text-xs font-medium text-text-sub hover:bg-page-bg"
                        data-testid={`edit-${invoice.id}`}
                      >
                        แก้ไข
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleDeleteClick(invoice)}
                        onBlur={() => setConfirmingDeleteId(null)}
                        className={`btn-press rounded-[10px] border px-2 py-1 text-xs font-medium ${
                          confirmingDeleteId === invoice.id
                            ? 'border-danger bg-danger text-white'
                            : 'border-danger/40 text-danger hover:bg-danger/10'
                        }`}
                        data-testid={`delete-${invoice.id}`}
                      >
                        {confirmingDeleteId === invoice.id ? 'ยืนยันลบ?' : 'ลบ'}
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
