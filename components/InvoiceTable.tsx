'use client';

import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { MarkReceivedInput, PendingTaxInvoice, SortDirection, SortField } from '@/types/invoice';
import {
  AGING_BADGE_CLASS,
  AGING_LABELS,
  calcNetPayment,
  getAgingBucket,
  getTaxInvoiceStatusBadgeClass,
  getTaxInvoiceStatusLabel,
  isWhtCertEligible,
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
  // เพิ่มพร้อมฟีเจอร์ "ออกใบหัก ณ ที่จ่าย" (2026-08-11) — selection state ยกไปเก็บที่ parent
  // (ExpenseRecordContent) แทนเก็บใน component นี้เอง เพราะแถบปุ่ม "ออกใบหัก ณ ที่จ่าย (N รายการ)" ลอยอยู่
  // นอกตาราง (เหนือ pagination) ต้องอ่านค่าเดียวกันได้ ไม่บังคับส่งมา (optional) เพื่อไม่กระทบจุดอื่นที่อาจ
  // เรียกใช้ InvoiceTable โดยไม่ต้องรองรับฟีเจอร์นี้ (ปัจจุบันมีจุดเรียกจุดเดียวคือ ExpenseRecordContent แต่กัน
  // ไว้เผื่ออนาคต) — checkbox แสดงเฉพาะแถวที่ isWhtCertEligible() เป็น true เท่านั้น
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  // เพิ่มเข้ามาตามคำขอผู้ใช้ (2026-08-12) — แสดงเลขที่ใบหัก ณ ที่จ่าย + ชื่อที่ออกใบให้ เป็นตัวเล็กๆ ใต้ชื่อ
  // ผู้ขายของแถวที่ออกใบไปแล้ว (invoice.wht_certificate_id ไม่เป็น null) เก็บเป็น Map คีย์ด้วย cert id เพราะ
  // parent (ExpenseRecordContent) ดึงใบหัก ณ ที่จ่ายทั้งหมดของบริษัทมาแล้ว แค่ต้อง lookup ตรงๆ ไม่ query ซ้ำ
  // ที่นี่ — ไม่บังคับส่งมา (ถ้าไม่ส่งจะไม่แสดงตัวเล็กนี้เลย ไม่ error)
  whtCertificatesById?: Map<string, { cert_number: string; payee_name: string }>;
}

// เอาคอลัมน์ "คาดว่าจะได้รับ" ออกจากตารางแล้ว (2026-08-10 ตามคำขอผู้ใช้) — ยังคง 'expected_date' ไว้เป็น
// ค่าเริ่มต้นของ sortField ใน app/dashboard/page.tsx เหมือนเดิม (ไม่กระทบ การเรียงลำดับข้อมูลยังทำงานปกติ
// แค่ไม่มีคอลัมน์ให้กดเปลี่ยนการเรียงลำดับด้วยฟิลด์นี้ในตารางอีกต่อไปเท่านั้น) และ getAgingBucket ด้านล่างยัง
// ใช้ invoice.expected_date คำนวณป้าย Aging (รอรับกี่วัน) อยู่เหมือนเดิมทุกประการ ไม่ได้ลบข้อมูลนี้ทิ้ง แค่ไม่
// โชว์เป็นคอลัมน์แยกอีกต่อไป
//
// เอาคอลัมน์ "ยอดรวม" ออกจากตารางแล้วเช่นกัน (2026-08-10 ตามคำขอผู้ใช้ หลังเพิ่มฟีเจอร์หัก ณ ที่จ่าย) — ผู้ใช้
// เห็นว่า "ยอดรวม" กับ "ยอดจ่ายสุทธิ" ที่เพิ่มเข้ามาใหม่ดูซ้ำซ้อนกัน (ส่วนใหญ่ไม่มี WHT ตัวเลขจึงเท่ากันพอดี)
// จึงเหลือแสดงแค่ "ยอดจ่ายสุทธิ" คอลัมน์เดียว (= ยอดรวม - หัก ณ ที่จ่าย, เท่ากับยอดรวมเป๊ะๆ เมื่อไม่มี WHT)
// total_amount ยังคงอยู่ในข้อมูล/ฐานข้อมูลเหมือนเดิมทุกประการ (ยังใช้คำนวณยอดจ่ายสุทธิ, ใช้ในรายงานภาษีซื้อ,
// สรุปยอด ฯลฯ) แค่ไม่มีคอลัมน์ "ยอดรวม" แยกให้กดเรียงลำดับในตารางนี้อีกต่อไป (sortField เริ่มต้นเป็น
// 'expected_date' อยู่แล้ว ไม่ใช่ 'total_amount' จึงไม่กระทบการเรียงลำดับเริ่มต้น)
const COLUMNS: { field: SortField; label: string }[] = [
  { field: 'vendor_name', label: 'ผู้ขาย' },
  { field: 'transaction_date', label: 'วันที่ทำรายการ' },
];

// อินพุตในตาราง (แถบ "มาร์กว่าได้รับแล้ว") ตั้งใจให้กระชับกว่า input ทั่วไปของระบบ (สูง 48px)
// เพราะอยู่ในเซลล์ตารางแคบๆ ที่มี 5 ฟิลด์เรียงต่อกัน ใช้ความสูงเต็ม 48px ตรงนี้จะทำให้แถวสูง
// เกินไปจนตารางดูอึดอัด — คงขนาดกระชับเดิมไว้ แต่ปรับสี/ขอบ/โฟกัสให้เป็นชุดสีใหม่ทั้งหมด
// แก้บั๊กตัวหนังสือมองไม่เห็น (2026-08-11) — ช่องนี้เป็นกล่องขาวเฉพาะตัว (bg-white) วางอยู่ในแถวตารางที่เป็น
// การ์ดกระจกเข้ม (card-surface) เดิมใช้ text-text (สีเกือบขาว ออกแบบมาสำหรับพื้นกระจกเข้มเท่านั้น) ทำให้
// ตัวหนังสือที่พิมพ์ (เช่น เลขที่ใบกำกับภาษี) มองไม่เห็นบนพื้นขาวของกล่องนี้เอง — เปลี่ยนเป็น text-gray-800
const inlineInputClass =
  'w-40 rounded-[10px] border border-border bg-white px-2.5 py-1.5 text-xs text-gray-800 focus-ring-primary';

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
  selectedIds,
  onToggleSelect,
  whtCertificatesById,
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
  // รวมปุ่ม "ได้รับแล้ว/ยกเลิกรายการ/แก้ไข/ลบ" เป็นปุ่มเดียว "จัดการเอกสาร" ที่กดแล้วมีเมนูลอยสไลด์ลงมาแสดง
  // ตัวเลือกแทน (2026-08-12 ตามคำขอผู้ใช้ — เดิมโชว์ปุ่มทั้งหมดพร้อมกันทำให้คอลัมน์ดูรกเมื่อมีทั้ง 4 ปุ่ม
  // พร้อมกัน) เก็บเป็น id เดียว (ไม่ใช่ Set) เพราะเปิดได้ทีละแถวพอ — เป็นเมนูลอย (position: absolute) ไม่ใช่
  // accordion ดันความสูงแถวตาราง (ลองแบบ accordion ก่อนแล้วไม่ลื่นไหลเพราะอยู่ในบริบท tr/td) ดู JSX ด้านล่าง
  const [expandedActionsId, setExpandedActionsId] = useState<string | null>(null);

  // ปิดเมนู "จัดการเอกสาร" อัตโนมัติเมื่อคลิกนอกเมนู — เป็นพฤติกรรมมาตรฐานของ dropdown menu ที่ลอยทับแถวอื่น
  // (ต่างจาก .month-detail-panel/.nav-accordion-panel เดิมที่เป็น accordion ดันเนื้อหาลง ไม่ใช่เมนูลอย จึงไม่
  // เคยต้องมี handler แบบนี้มาก่อน) ใช้ data-row-actions-menu เป็นตัวเช็คขอบเขต แทนการผูก ref ทีละแถว เพราะ
  // ตารางนี้ render หลายแถวพร้อมกันด้วย state expandedActionsId ตัวเดียว (เก็บแค่ id แถวที่เปิดอยู่)
  useEffect(() => {
    if (!expandedActionsId) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-row-actions-menu]')) {
        setExpandedActionsId(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [expandedActionsId]);

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
            {/* คอลัมน์ checkbox เลือกออกใบหัก ณ ที่จ่าย (2026-08-11) — แสดงหัวคอลัมน์เฉพาะตอนที่ parent
                ส่ง selectedIds/onToggleSelect มาจริงๆ (ไม่บังคับ ดู props ด้านบน) */}
            {selectedIds && onToggleSelect && <th className="w-10 px-[18px] py-[18px]" />}
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
            {/* เพิ่มพร้อมฟีเจอร์ "หัก ณ ที่จ่าย" (2026-08-10) — wht_amount เป็น 0 = ไม่มีการหัก, ยอดจ่ายสุทธิ
                คำนวณสด (total_amount - wht_amount) ไม่ใช่คอลัมน์ในฐานข้อมูล ดู lib/invoiceLogic.ts calcNetPayment */}
            <th className="px-[18px] py-[18px] text-right text-xs font-semibold text-text-sub">หัก ณ ที่จ่าย</th>
            <th className="px-[18px] py-[18px] text-right text-xs font-semibold text-text-sub">ยอดจ่ายสุทธิ</th>
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
                {selectedIds && onToggleSelect && (
                  <td className="px-[18px] py-[18px]">
                    {isWhtCertEligible(invoice) && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(invoice.id)}
                        onChange={() => onToggleSelect(invoice.id)}
                        className="h-4 w-4 rounded border-border accent-primary"
                        aria-label={`เลือกออกใบหัก ณ ที่จ่าย ${invoice.vendor_name}`}
                        data-testid={`select-wht-${invoice.id}`}
                      />
                    )}
                  </td>
                )}
                <td className="px-[18px] py-[18px] font-medium text-text">
                  {invoice.vendor_name}
                  {/* เลขที่ใบหัก ณ ที่จ่าย + ชื่อที่ออกใบให้ (2026-08-12) — แสดงเฉพาะแถวที่ผูกกับใบที่ยัง
                      ไม่ถูกยกเลิก (wht_certificate_id ไม่เป็น null เสมอกลับไปเป็น null ทันทีที่ใบถูกยกเลิก
                      ผ่าน void_wht_certificate — ดู migration_016) ชื่อที่ออกอาจไม่ตรงกับ vendor_name
                      คอลัมน์นี้เพราะเลือกออกใบให้คนละคนได้ (ดู IssueWhtCertificateModal.tsx) */}
                  {invoice.wht_certificate_id &&
                    whtCertificatesById?.get(invoice.wht_certificate_id) &&
                    (() => {
                      const cert = whtCertificatesById.get(invoice.wht_certificate_id!)!;
                      return (
                        <div className="mt-0.5 text-xs font-normal text-text-sub" data-testid={`wht-cert-info-${invoice.id}`}>
                          <p>เลขที่ {cert.cert_number}</p>
                          <p>ชื่อ {cert.payee_name}</p>
                        </div>
                      );
                    })()}
                </td>
                <td className="px-[18px] py-[18px] text-text-sub">{formatDate(invoice.transaction_date)}</td>
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
                <td
                  className="font-numeric px-[18px] py-[18px] text-right text-text-sub"
                  data-testid={`wht-amount-${invoice.id}`}
                >
                  {invoice.wht_amount ? THB.format(invoice.wht_amount) : '-'}
                </td>
                <td
                  className="font-numeric px-[18px] py-[18px] text-right text-text"
                  data-testid={`net-payment-${invoice.id}`}
                >
                  {THB.format(calcNetPayment(invoice.total_amount, invoice.wht_amount))}
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
                    // เมนูลอย (dropdown) ที่สไลด์ลงมาจริงๆ (2026-08-12 — เดิมลองใช้เทคนิค accordion แบบ
                    // grid-template-rows เหมือน .month-detail-panel แต่เพราะอยู่ในแถวตาราง (tr/td) ความสูง
                    // แถวเปลี่ยนแบบไม่ลื่นไหล ดูเหมือน "โผล่มาทันที" ไม่ใช่ "สไลด์" ตามที่ผู้ใช้ต้องการ — เปลี่ยน
                    // มาใช้ position: absolute ลอยทับแถวถัดไปแทน (ไม่ดันความสูงแถวตารางเลย) แล้ว animate
                    // opacity + translateY ตรงๆ ด้วย Tailwind transition ได้ลื่นไหลแน่นอนไม่ว่าจะอยู่ในบริบท
                    // ตารางหรือไม่ก็ตาม — ปิดอัตโนมัติเมื่อคลิกนอกเมนู (ดู useEffect handleClickOutside ด้านบน)
                    <div className="relative inline-block text-left" data-row-actions-menu>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedActionsId((id) => (id === invoice.id ? null : invoice.id))
                        }
                        className="btn-press flex items-center gap-1 rounded-[10px] border border-border px-2.5 py-1.5 text-xs font-medium text-text-sub hover:bg-page-bg"
                        aria-expanded={expandedActionsId === invoice.id}
                        data-testid={`manage-actions-${invoice.id}`}
                      >
                        จัดการเอกสาร
                        <ChevronDown
                          size={14}
                          className={`transition-transform duration-200 ${
                            expandedActionsId === invoice.id ? 'rotate-180' : ''
                          }`}
                          aria-hidden="true"
                        />
                      </button>
                      <div
                        className={`absolute right-0 top-full z-20 mt-1.5 w-44 rounded-[10px] border border-border bg-card-bg p-1.5 shadow-lg transition-all duration-200 ease-out ${
                          expandedActionsId === invoice.id
                            ? 'pointer-events-auto translate-y-0 opacity-100'
                            : 'pointer-events-none -translate-y-2 opacity-0'
                        }`}
                      >
                        <div className="flex flex-col gap-1">
                          {invoice.status === 'pending' &&
                            invoice.tax_type !== 'no_vat' &&
                            invoice.tax_type !== 'non_claimable_vat' && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setExpandedActionsId(null);
                                  setReceivingId(invoice.id);
                                  setTaxInvoiceNumber('');
                                  setReceivedDate(today);
                                  setTaxInvoiceDate('');
                                  // เดือน/ปีที่ใช้เครดิต VAT ตั้งค่าเริ่มต้นเป็นเดือน/ปีปัจจุบัน (กรณีส่วนใหญ่
                                  // ที่นำไปเครดิตในเดือนเดียวกับที่กำลังบันทึก) ผู้ใช้แก้เป็นเดือน/ปีอื่นได้เสมอ
                                  setVatClaimMonth(currentMonth());
                                  setVatClaimYear(currentBuddhistYear());
                                }}
                                className="btn-press w-full rounded-[8px] px-2.5 py-1.5 text-left text-xs font-medium text-success hover:bg-success/10"
                                data-testid={`mark-received-${invoice.id}`}
                              >
                                ได้รับแล้ว
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => {
                                  setExpandedActionsId(null);
                                  onCancelInvoice(invoice);
                                }}
                                className="btn-press w-full rounded-[8px] px-2.5 py-1.5 text-left text-xs font-medium text-text-sub hover:bg-page-bg"
                              >
                                ยกเลิกรายการ
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setExpandedActionsId(null);
                              onEdit(invoice);
                            }}
                            className="btn-press w-full rounded-[8px] px-2.5 py-1.5 text-left text-xs font-medium text-text-sub hover:bg-page-bg"
                            data-testid={`edit-${invoice.id}`}
                          >
                            แก้ไข
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleDeleteClick(invoice)}
                            onBlur={() => setConfirmingDeleteId(null)}
                            className={`btn-press w-full rounded-[8px] px-2.5 py-1.5 text-left text-xs font-medium ${
                              confirmingDeleteId === invoice.id
                                ? 'bg-danger text-white'
                                : 'text-danger hover:bg-danger/10'
                            }`}
                            data-testid={`delete-${invoice.id}`}
                          >
                            {confirmingDeleteId === invoice.id ? 'ยืนยันลบ?' : 'ลบ'}
                          </button>
                        </div>
                      </div>
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
