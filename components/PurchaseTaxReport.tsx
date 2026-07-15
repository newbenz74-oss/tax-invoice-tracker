'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { FileSpreadsheet, FileText } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { fetchInvoices, INVOICES_SWR_KEY } from '@/lib/invoiceApi';
import {
  filterPurchaseTaxReport,
  sortPurchaseTaxReport,
  summarizePurchaseTaxReport,
  toPurchaseTaxReportRows,
} from '@/lib/vatReportLogic';
import { buildPurchaseTaxReportExcelBlob, buildPurchaseTaxReportPdfBlob, downloadBlob } from '@/lib/reportExport';
import { buddhistYearOptions, currentBuddhistYear, currentMonth, thaiMonthName } from '@/lib/thaiDate';
import type { PendingTaxInvoice } from '@/types/invoice';

const THB = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// หน้า "รายงานภาษีซื้อ" — ใช้ SWR key เดียวกับ DashboardContent (INVOICES_SWR_KEY) จึงอ่านจาก cache
// ชุดเดียวกัน ไม่ยิง fetch ซ้ำถ้าหน้า "บันทึกค่าใช้จ่าย" โหลดข้อมูลไว้แล้ว — กรองด้วย
// vat_claim_month/vat_claim_year (ไม่ใช่วันที่ใบกำกับภาษีหรือวันที่ได้รับ) ตามหลักการที่สเปกกำหนด
export default function PurchaseTaxReport() {
  const { session } = useAuth();
  const [month, setMonth] = useState<number | 'all'>(currentMonth());
  const [year, setYear] = useState<number>(currentBuddhistYear());

  const {
    data: invoices = [],
    error: loadErrorObj,
    isLoading: loading,
  } = useSWR<PendingTaxInvoice[]>(session ? INVOICES_SWR_KEY : null, fetchInvoices);
  const loadError =
    loadErrorObj instanceof Error ? loadErrorObj.message : loadErrorObj ? 'โหลดข้อมูลไม่สำเร็จ' : null;

  const rows = useMemo(() => {
    const filtered = filterPurchaseTaxReport(invoices, { month, year });
    return toPurchaseTaxReportRows(sortPurchaseTaxReport(filtered));
  }, [invoices, month, year]);

  const summary = useMemo(() => summarizePurchaseTaxReport(rows), [rows]);
  const periodLabel = month === 'all' ? `ทั้งปี ${year}` : `${thaiMonthName(month)} ${year}`;

  function handleExportExcel() {
    const blob = buildPurchaseTaxReportExcelBlob(rows, summary, periodLabel);
    downloadBlob(blob, `รายงานภาษีซื้อ-${periodLabel}.xlsx`);
  }

  function handleExportPdf() {
    const blob = buildPurchaseTaxReportPdfBlob(rows, summary, periodLabel);
    downloadBlob(blob, `รายงานภาษีซื้อ-${periodLabel}.pdf`);
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            data-testid="report-month-filter"
          >
            <option value="all">ทั้งปี</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {thaiMonthName(m)}
              </option>
            ))}
          </select>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            data-testid="report-year-filter"
          >
            {buddhistYearOptions().map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={rows.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            data-testid="export-excel"
          >
            <FileSpreadsheet size={16} aria-hidden="true" />
            Export Excel
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={rows.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            data-testid="export-pdf"
          >
            <FileText size={16} aria-hidden="true" />
            Export PDF
          </button>
        </div>
      </div>

      {loadError && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {loadError}
        </p>
      )}

      {loading ? (
        <p className="py-12 text-center text-sm text-gray-400">กำลังโหลดข้อมูล...</p>
      ) : rows.length === 0 ? (
        <div
          className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center text-sm text-gray-400"
          data-testid="report-empty"
        >
          ไม่พบรายการในช่วงเวลาที่เลือก
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">วันที่ใบกำกับภาษี</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">เลขที่ใบกำกับภาษี</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ผู้ขาย</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">เลขประจำตัวผู้เสียภาษี</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">รายการ</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">ฐานภาษี</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">VAT 7%</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">ยอดรวม</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.id} data-testid={`report-row-${r.id}`}>
                  <td className="px-4 py-3 text-gray-600">{formatDate(r.taxInvoiceDate)}</td>
                  <td className="px-4 py-3 text-gray-900">{r.taxInvoiceNumber}</td>
                  <td className="px-4 py-3 text-gray-900">{r.vendorName}</td>
                  <td className="px-4 py-3 text-gray-600">{r.vendorTaxId}</td>
                  <td className="px-4 py-3 text-gray-600">{r.description}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{THB.format(r.amountExclVat)}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{THB.format(r.vatAmount)}</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">{THB.format(r.totalAmount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50">
              <tr>
                <td colSpan={5} className="px-4 py-3 text-right text-sm font-bold text-gray-900">
                  รวมทั้งสิ้น ({summary.count} รายการ)
                </td>
                <td
                  className="px-4 py-3 text-right text-sm font-bold text-gray-900"
                  data-testid="report-total-excl-vat"
                >
                  {THB.format(summary.totalAmountExclVat)}
                </td>
                <td className="px-4 py-3 text-right text-sm font-bold text-gray-900" data-testid="report-total-vat">
                  {THB.format(summary.totalVatAmount)}
                </td>
                <td
                  className="px-4 py-3 text-right text-sm font-bold text-gray-900"
                  data-testid="report-total-amount"
                >
                  {THB.format(summary.totalAmount)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </main>
  );
}
