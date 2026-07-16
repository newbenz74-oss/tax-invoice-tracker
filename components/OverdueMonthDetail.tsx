'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { MarkReceivedInput, PendingTaxInvoice } from '@/types/invoice';
import { getTaxInvoiceStatusBadgeClass, getTaxInvoiceStatusLabel } from '@/lib/invoiceLogic';
import { buddhistYearOptions, currentBuddhistYear, currentMonth, thaiMonthName } from '@/lib/thaiDate';
import {
  OVERDUE_AGING_BADGE_CLASS,
  getOverdueAging,
  groupByVendor,
  type OverdueMonthGroup,
} from '@/lib/overduePurchaseTaxLogic';

const THB = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

interface OverdueMonthDetailProps {
  group: OverdueMonthGroup;
  today: string;
  onView: (invoice: PendingTaxInvoice) => void;
  onEdit: (invoice: PendingTaxInvoice) => void;
  onMarkReceived: (invoice: PendingTaxInvoice, input: MarkReceivedInput) => Promise<void>;
}

// อินพุตในฟอร์ม "ได้รับใบกำกับภาษีแล้ว" กระชับ ตามแบบเดียวกับ InvoiceTable.tsx เดิม (สูงไม่เต็ม 48px
// เพราะอยู่ในเซลล์ตารางแคบๆ) — คงฟิลด์ครบ 4 ช่องเดียวกันทุกประการ (เลขที่/วันที่ใบกำกับภาษี, เดือน/ปีที่
// ใช้เครดิต VAT) ตามที่สเปกระบุ "ใช้ขั้นตอนเดิมของระบบ"
const inlineInputClass =
  'w-40 rounded-[10px] border border-border bg-white px-2.5 py-1.5 text-xs text-text focus-ring-primary';

/** เนื้อหาที่ขยายออกมาเมื่อกด "ดูรายละเอียด" ของแถวเดือนในหน้า "ภาษีซื้อที่ยังไม่ได้รับ" — จัดกลุ่มย่อย
 * ตามผู้ขาย (มุมมองรายบริษัท) กดชื่อผู้ขายเพื่อขยายดูรายการใบกำกับภาษีของผู้ขายนั้น พร้อมปุ่มดำเนินการ
 * ต่อรายการ (ดูรายละเอียด/แก้ไข/ได้รับใบกำกับภาษีแล้ว) */
export default function OverdueMonthDetail({ group, today, onView, onEdit, onMarkReceived }: OverdueMonthDetailProps) {
  const [expandedVendors, setExpandedVendors] = useState<Record<string, boolean>>({});
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [taxInvoiceNumber, setTaxInvoiceNumber] = useState('');
  const [receivedDate, setReceivedDate] = useState(today);
  const [taxInvoiceDate, setTaxInvoiceDate] = useState('');
  const [vatClaimMonth, setVatClaimMonth] = useState<number | ''>('');
  const [vatClaimYear, setVatClaimYear] = useState<number | ''>('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const vendorGroups = groupByVendor(group.invoices);

  function toggleVendor(vendorName: string) {
    setExpandedVendors((prev) => ({ ...prev, [vendorName]: !prev[vendorName] }));
  }

  function startReceiving(invoice: PendingTaxInvoice) {
    setReceivingId(invoice.id);
    setTaxInvoiceNumber('');
    setReceivedDate(today);
    setTaxInvoiceDate('');
    // ตั้งค่าเริ่มต้นเป็นเดือน/ปีปัจจุบัน (กรณีส่วนใหญ่นำไปเครดิตเดือนเดียวกับที่กำลังบันทึก) แก้ไขได้เสมอ
    setVatClaimMonth(currentMonth());
    setVatClaimYear(currentBuddhistYear());
  }

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

  return (
    <div
      className="divide-y divide-border/60 bg-page-bg/60 px-4 py-3 sm:px-6"
      data-testid={`overdue-report-month-detail-${group.monthKey}`}
    >
      {vendorGroups.map((vendorGroup, index) => {
        const isExpanded = Boolean(expandedVendors[vendorGroup.vendorName]);
        return (
          <div key={vendorGroup.vendorName} className="py-2.5">
            <button
              type="button"
              onClick={() => toggleVendor(vendorGroup.vendorName)}
              className="btn-press flex w-full flex-wrap items-center justify-between gap-2 rounded-[10px] px-2 py-2 text-left hover:bg-white"
              aria-expanded={isExpanded}
              data-testid={`overdue-report-vendor-toggle-${group.monthKey}-${index}`}
            >
              <span className="flex items-center gap-2 font-medium text-text">
                <ChevronDown
                  size={16}
                  className={`shrink-0 text-text-sub transition-transform duration-[250ms] ${isExpanded ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
                {vendorGroup.vendorName}
              </span>
              <span className="font-numeric flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-sub">
                <span>{vendorGroup.itemCount} รายการ</span>
                <span>ยอดก่อน VAT {THB.format(vendorGroup.totalAmountExclVat)}</span>
                <span>VAT {THB.format(vendorGroup.totalVatAmount)}</span>
                <span className="font-semibold text-text">ยอดรวม {THB.format(vendorGroup.totalAmount)}</span>
              </span>
            </button>

            {isExpanded && (
              <div
                className="mt-2 overflow-x-auto rounded-xl border border-border bg-white"
                data-testid={`overdue-report-vendor-group-${group.monthKey}-${index}`}
              >
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead className="bg-table-header">
                    <tr>
                      <th className="min-w-[140px] px-3 py-2.5 text-left text-xs font-semibold text-text-sub">ผู้ขาย</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-sub">วันที่ทำรายการ</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-sub">เลขที่อ้างอิง</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-sub">รายละเอียด</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-sub">วันที่คาดว่าจะได้รับ</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-sub">จำนวนวันที่ค้าง</th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold text-text-sub">ยอดก่อน VAT</th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold text-text-sub">VAT</th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold text-text-sub">ยอดรวม</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-sub">สถานะ</th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold text-text-sub">การจัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {vendorGroup.invoices.map((invoice) => {
                      const aging = getOverdueAging(invoice.expected_date, today);
                      const isReceiving = receivingId === invoice.id;
                      const isBusy = busyId === invoice.id;
                      return (
                        <tr
                          key={invoice.id}
                          data-testid={`overdue-report-invoice-row-${invoice.id}`}
                          className="transition-colors duration-150 hover:bg-table-row-hover"
                        >
                          <td className="min-w-[140px] px-3 py-2.5 font-medium text-text">{invoice.vendor_name}</td>
                          <td className="font-numeric px-3 py-2.5 text-text-sub">{formatDate(invoice.transaction_date)}</td>
                          <td className="px-3 py-2.5 text-text-sub">{invoice.reference_no || '-'}</td>
                          <td className="px-3 py-2.5 text-text-sub">{invoice.description || '-'}</td>
                          <td className="font-numeric px-3 py-2.5 text-text-sub">{formatDate(invoice.expected_date)}</td>
                          <td className="px-3 py-2.5">
                            <span
                              className={`inline-block w-fit rounded-full px-2.5 py-1 text-[11px] font-medium ${OVERDUE_AGING_BADGE_CLASS[aging.status]}`}
                              data-testid={`overdue-report-aging-${invoice.id}`}
                            >
                              {aging.daysText}
                            </span>
                          </td>
                          <td className="font-numeric px-3 py-2.5 text-right text-text-sub">{THB.format(invoice.amount_excl_vat)}</td>
                          <td className="font-numeric px-3 py-2.5 text-right text-text-sub">{THB.format(invoice.vat_amount)}</td>
                          <td className="font-numeric px-3 py-2.5 text-right font-medium text-text">{THB.format(invoice.total_amount)}</td>
                          <td className="px-3 py-2.5">
                            <span
                              className={`inline-block w-fit rounded-full px-2.5 py-1 text-[11px] font-medium ${getTaxInvoiceStatusBadgeClass(invoice)}`}
                            >
                              {getTaxInvoiceStatusLabel(invoice)}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            {isReceiving ? (
                              <div className="flex flex-col items-end gap-1.5">
                                <input
                                  placeholder="เลขที่ใบกำกับภาษี"
                                  value={taxInvoiceNumber}
                                  onChange={(e) => setTaxInvoiceNumber(e.target.value)}
                                  className={inlineInputClass}
                                  data-testid={`overdue-report-tax-invoice-number-input-${invoice.id}`}
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
                                    data-testid={`overdue-report-tax-invoice-date-input-${invoice.id}`}
                                  />
                                </label>
                                <label className="flex w-40 flex-col gap-0.5 text-[10px] text-text-sub">
                                  เดือนที่ใช้เครดิต VAT *
                                  <select
                                    value={vatClaimMonth}
                                    onChange={(e) => setVatClaimMonth(e.target.value ? Number(e.target.value) : '')}
                                    className={inlineInputClass}
                                    data-testid={`overdue-report-vat-claim-month-select-${invoice.id}`}
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
                                    data-testid={`overdue-report-vat-claim-year-select-${invoice.id}`}
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
                                    data-testid={`overdue-report-confirm-received-${invoice.id}`}
                                  >
                                    ยืนยัน
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex flex-wrap justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => onView(invoice)}
                                  className="btn-press rounded-[10px] border border-border px-2 py-1 text-xs font-medium text-text-sub hover:bg-page-bg"
                                  data-testid={`overdue-report-view-${invoice.id}`}
                                >
                                  ดูรายละเอียด
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onEdit(invoice)}
                                  className="btn-press rounded-[10px] border border-border px-2 py-1 text-xs font-medium text-text-sub hover:bg-page-bg"
                                  data-testid={`overdue-report-edit-${invoice.id}`}
                                >
                                  แก้ไข
                                </button>
                                <button
                                  type="button"
                                  onClick={() => startReceiving(invoice)}
                                  className="btn-press rounded-[10px] border border-success/40 px-2 py-1 text-xs font-medium text-success hover:bg-success/10"
                                  data-testid={`overdue-report-mark-received-${invoice.id}`}
                                >
                                  ได้รับใบกำกับภาษีแล้ว
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
            )}
          </div>
        );
      })}
    </div>
  );
}
