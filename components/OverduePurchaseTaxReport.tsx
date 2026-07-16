'use client';

import { Fragment, useMemo, useState, type FormEvent } from 'react';
import useSWR from 'swr';
import {
  AlertTriangle,
  Building2,
  ChevronDown,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  ListChecks,
  Receipt,
  Search,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { fetchInvoices, INVOICES_SWR_KEY, markReceived } from '@/lib/invoiceApi';
import { thaiMonthName } from '@/lib/thaiDate';
import {
  applyOverdueFilters,
  computeOverdueKpis,
  filterUnreceivedPurchaseTax,
  formatOverduePeriodLabel,
  getExpectedDateYearOptions,
  getVendorOptions,
  groupOverdueByMonth,
  OVERDUE_AGING_LABELS,
  OVERDUE_FILTER_DEFAULTS,
  type OverdueAgingStatus,
  type OverdueFilterOptions,
} from '@/lib/overduePurchaseTaxLogic';
import { buildOverdueExcelBlob, buildOverduePdfBlob } from '@/lib/overduePurchaseTaxExport';
import { downloadBlob } from '@/lib/reportExport';
import OverdueMonthDetail from '@/components/OverdueMonthDetail';
import OverdueInvoiceDetailModal from '@/components/OverdueInvoiceDetailModal';
import type { NavIntent } from '@/lib/navigation';
import type { MarkReceivedInput, PendingTaxInvoice } from '@/types/invoice';

const THB = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const AGING_FILTER_OPTIONS: OverdueAgingStatus[] = ['not_due', 'overdue', 'no_date'];

interface OverduePurchaseTaxReportProps {
  // pattern เดียวกับ DashboardOverview/ExpenseRecordContent — ไม่ส่งมาก็ยังใช้งานหน้านี้ได้ปกติ
  // แค่ปุ่ม "แก้ไข" จะไม่พาไปหน้า "บันทึกค่าใช้จ่าย" เท่านั้น
  onNavigate?: (id: string, intent?: NavIntent) => void;
}

/**
 * หน้า "ภาษีซื้อที่ยังไม่ได้รับ" (เมนู กระทบยอด > เดิมชื่อ "ภาษีซื้อไม่ถึงกำหนด") — รายงานติดตามเอกสารที่
 * บันทึกเป็นค่าใช้จ่ายแล้วแต่ยังไม่ได้รับใบกำกับภาษี ไม่ใช่รายงานภาษีซื้อสำหรับยื่น ภ.พ.30 (ดูหน้านั้นที่
 * PurchaseTaxReport.tsx แทน — คนละหน้า คนละเงื่อนไข Query กัน)
 *
 * ใช้ SWR key เดียวกับทุกหน้าที่เกี่ยวกับ pending_tax_invoices (INVOICES_SWR_KEY) จึงอ่าน/เขียนจาก cache
 * ชุดเดียวกัน — ปุ่ม "ได้รับใบกำกับภาษีแล้ว" ในหน้านี้เรียก markReceived() ตัวเดิมทุกประการ (ขั้นตอนเดิม
 * ของระบบ เหมือนที่ InvoiceTable.tsx เรียก) ทำให้หลัง mutate() รายการนั้นไม่ผ่าน
 * filterUnreceivedPurchaseTax อีกต่อไป จึงหายจากหน้านี้ทันที และไปปรากฏในรายงานภาษีซื้อของเดือน/ปีที่
 * เลือกไว้ตอนกรอกฟอร์มโดยอัตโนมัติ (คนละหน้าอ่าน cache SWR ชุดเดียวกัน)
 *
 * ปุ่ม "แก้ไข" ไม่เปิดฟอร์มซ้ำในหน้านี้ — ส่ง NavIntent ชนิด 'edit-invoice' ไปให้หน้า "บันทึกค่าใช้จ่าย"
 * เปิดฟอร์มแก้ไขเดิม (InvoiceForm) ให้แทน เพื่อไม่ duplicate ฟอร์ม/validation/submit logic ใดๆ เลย
 */
export default function OverduePurchaseTaxReport({ onNavigate }: OverduePurchaseTaxReportProps) {
  const { session } = useAuth();
  const today = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, []);

  const {
    data: invoices = [],
    error: loadErrorObj,
    isLoading: loading,
    mutate,
  } = useSWR<PendingTaxInvoice[]>(session ? INVOICES_SWR_KEY : null, fetchInvoices);
  const loadError =
    loadErrorObj instanceof Error ? loadErrorObj.message : loadErrorObj ? 'โหลดข้อมูลไม่สำเร็จ' : null;

  const [filters, setFilters] = useState<OverdueFilterOptions>(OVERDUE_FILTER_DEFAULTS);
  const [searchDraft, setSearchDraft] = useState('');
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({});
  const [viewingInvoice, setViewingInvoice] = useState<PendingTaxInvoice | null>(null);

  // base query: เฉพาะรายการที่ "มี VAT และยังไม่ได้รับเอกสาร" เท่านั้น (ไม่สนตัวกรอง UI ใดๆ) — ใช้เป็น
  // ที่มาของตัวเลือก dropdown ผู้ขาย/ปี ด้วย เพื่อไม่ให้ตัวเลือกหดหายไปเรื่อยๆ ตามตัวกรองอื่นที่เลือกไว้อยู่
  const baseInvoices = useMemo(() => filterUnreceivedPurchaseTax(invoices), [invoices]);
  const vendorOptions = useMemo(() => getVendorOptions(baseInvoices), [baseInvoices]);
  const yearOptions = useMemo(() => getExpectedDateYearOptions(baseInvoices), [baseInvoices]);

  const filteredInvoices = useMemo(
    () => applyOverdueFilters(baseInvoices, filters, today),
    [baseInvoices, filters, today]
  );
  const kpis = useMemo(() => computeOverdueKpis(filteredInvoices, today), [filteredInvoices, today]);
  const monthGroups = useMemo(() => groupOverdueByMonth(filteredInvoices, today), [filteredInvoices, today]);
  const periodLabel = useMemo(
    () => formatOverduePeriodLabel(filters.month, filters.year),
    [filters.month, filters.year]
  );

  function updateFilter<K extends keyof OverdueFilterOptions>(key: K, value: OverdueFilterOptions[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function toggleMonth(monthKey: string) {
    setExpandedMonths((prev) => ({ ...prev, [monthKey]: !prev[monthKey] }));
  }

  function handleSearchSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    updateFilter('search', searchDraft.trim());
  }

  function handleClearFilters() {
    setFilters(OVERDUE_FILTER_DEFAULTS);
    setSearchDraft('');
  }

  async function handleMarkReceived(invoice: PendingTaxInvoice, input: MarkReceivedInput) {
    await markReceived(invoice.id, input);
    await mutate();
  }

  function handleEdit(invoice: PendingTaxInvoice) {
    onNavigate?.('record-expense', { type: 'edit-invoice', invoiceId: invoice.id });
  }

  function handleExportExcel() {
    const blob = buildOverdueExcelBlob(filteredInvoices, today, periodLabel);
    downloadBlob(blob, `ภาษีซื้อที่ยังไม่ได้รับ-${periodLabel}.xlsx`);
  }

  function handleExportPdf() {
    const blob = buildOverduePdfBlob(filteredInvoices, today, periodLabel, formatDate(today), {
      vendorCount: kpis.vendorCount,
      itemCount: kpis.itemCount,
      totalAmountExclVat: kpis.totalAmountExclVat,
      totalVatAmount: kpis.totalVatAmount,
      totalAmount: round2(kpis.totalAmountExclVat + kpis.totalVatAmount),
    });
    downloadBlob(blob, `ภาษีซื้อที่ยังไม่ได้รับ-${periodLabel}.pdf`);
  }

  const kpiCards: Array<{
    id: string;
    label: string;
    value: string | number;
    icon: LucideIcon;
    iconBg: string;
    iconColor: string;
  }> = [
    {
      id: 'item-count',
      label: 'จำนวนรายการที่ยังไม่ได้รับ',
      value: kpis.itemCount,
      icon: ListChecks,
      iconBg: 'bg-brand/15',
      iconColor: 'text-brand',
    },
    {
      id: 'vendor-count',
      label: 'จำนวนบริษัทหรือผู้ขาย',
      value: kpis.vendorCount,
      icon: Building2,
      iconBg: 'bg-violet-100',
      iconColor: 'text-violet-600',
    },
    {
      id: 'amount-excl-vat',
      label: 'ยอดก่อน VAT ที่ยังรอรับ',
      value: THB.format(kpis.totalAmountExclVat),
      icon: Wallet,
      iconBg: 'bg-warning/15',
      iconColor: 'text-warning',
    },
    {
      id: 'vat-amount',
      label: 'VAT ที่ยังรอรับ',
      value: THB.format(kpis.totalVatAmount),
      icon: Receipt,
      iconBg: 'bg-violet-100',
      iconColor: 'text-violet-600',
    },
    {
      id: 'overdue-count',
      label: 'จำนวนรายการเกินกำหนด',
      value: kpis.overdueCount,
      icon: AlertTriangle,
      iconBg: 'bg-danger/15',
      iconColor: 'text-danger',
    },
  ];

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
      {loadError && (
        <p
          role="alert"
          className="mb-4 rounded-[10px] border border-danger/20 bg-danger/10 px-3.5 py-2.5 text-sm text-danger"
        >
          {loadError}
        </p>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {kpiCards.map((c) => {
          const Icon = c.icon;
          return (
            <div
              key={c.id}
              className="card-surface card-hover-lift rounded-2xl p-6"
              data-testid={`overdue-report-kpi-${c.id}`}
            >
              <div className={`flex h-11 w-11 items-center justify-center rounded-full ${c.iconBg} ${c.iconColor}`}>
                <Icon size={20} aria-hidden="true" />
              </div>
              <p className="font-numeric mt-4 text-2xl font-bold text-text">{c.value}</p>
              <p className="mt-1 text-xs text-text-sub">{c.label}</p>
            </div>
          );
        })}
      </div>

      <form onSubmit={handleSearchSubmit} className="card-surface mb-6 flex flex-wrap items-center gap-2 rounded-2xl p-4">
        <select
          value={filters.month}
          onChange={(e) => updateFilter('month', e.target.value === 'all' ? 'all' : Number(e.target.value))}
          className="focus-ring-primary rounded-[10px] border border-border bg-white px-3.5 py-2.5 text-sm text-text"
          data-testid="overdue-report-month-filter"
        >
          <option value="all">ทุกเดือน</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {thaiMonthName(m)}
            </option>
          ))}
        </select>

        <select
          value={filters.year}
          onChange={(e) => updateFilter('year', e.target.value === 'all' ? 'all' : Number(e.target.value))}
          className="focus-ring-primary rounded-[10px] border border-border bg-white px-3.5 py-2.5 text-sm text-text"
          data-testid="overdue-report-year-filter"
        >
          <option value="all">ทุกปี</option>
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>

        <select
          value={filters.agingStatus}
          onChange={(e) => updateFilter('agingStatus', e.target.value as OverdueFilterOptions['agingStatus'])}
          className="focus-ring-primary rounded-[10px] border border-border bg-white px-3.5 py-2.5 text-sm text-text"
          data-testid="overdue-report-status-filter"
        >
          <option value="all">ทั้งหมด</option>
          {AGING_FILTER_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {OVERDUE_AGING_LABELS[status]}
            </option>
          ))}
        </select>

        <select
          value={filters.vendor}
          onChange={(e) => updateFilter('vendor', e.target.value)}
          className="focus-ring-primary rounded-[10px] border border-border bg-white px-3.5 py-2.5 text-sm text-text"
          data-testid="overdue-report-vendor-filter"
        >
          <option value="all">ทุกผู้ขาย</option>
          {vendorOptions.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>

        <div className="relative">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-sub"
            aria-hidden="true"
          />
          <input
            type="text"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="ค้นหาผู้ขาย / รายละเอียด / เลขที่อ้างอิง"
            className="focus-ring-primary w-64 rounded-[10px] border border-border bg-white py-2.5 pl-9 pr-3.5 text-sm text-text"
            data-testid="overdue-report-search-input"
          />
        </div>

        <button
          type="submit"
          className="btn-press flex items-center gap-1.5 rounded-[10px] bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-hover"
          data-testid="overdue-report-search-submit"
        >
          <Search size={16} aria-hidden="true" />
          ค้นหา
        </button>
        <button
          type="button"
          onClick={handleClearFilters}
          className="btn-press flex items-center gap-1.5 rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-text-sub hover:bg-page-bg"
          data-testid="overdue-report-clear-filters"
        >
          <X size={16} aria-hidden="true" />
          ล้างตัวกรอง
        </button>

        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={filteredInvoices.length === 0}
            className="btn-press flex items-center gap-1.5 rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-text hover:bg-page-bg disabled:opacity-50"
            data-testid="overdue-report-export-excel"
          >
            <FileSpreadsheet size={16} aria-hidden="true" />
            Export Excel
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={filteredInvoices.length === 0}
            className="btn-press flex items-center gap-1.5 rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-text hover:bg-page-bg disabled:opacity-50"
            data-testid="overdue-report-export-pdf"
          >
            <FileText size={16} aria-hidden="true" />
            Export PDF
          </button>
        </div>
      </form>

      {loading ? (
        <p className="py-12 text-center text-sm text-text-sub">กำลังโหลดข้อมูล...</p>
      ) : monthGroups.length === 0 ? (
        <div className="card-surface rounded-2xl p-12 text-center" data-testid="overdue-report-empty">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/15">
            <FileCheck2 size={28} className="text-success" aria-hidden="true" />
          </div>
          <h3 className="mt-4 text-base font-bold text-text">ไม่มีรายการใบกำกับภาษีที่รอรับ</h3>
          <p className="mt-1.5 text-sm text-text-sub">รายการที่ได้รับเอกสารครบแล้วจะไม่แสดงในหน้านี้</p>
        </div>
      ) : (
        <div className="card-surface overflow-x-auto rounded-2xl">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-table-header">
              <tr>
                <th className="px-[18px] py-[18px] text-left text-xs font-semibold text-text-sub">เดือน</th>
                <th className="px-[18px] py-[18px] text-left text-xs font-semibold text-text-sub">จำนวนบริษัท</th>
                <th className="px-[18px] py-[18px] text-left text-xs font-semibold text-text-sub">จำนวนรายการ</th>
                <th className="px-[18px] py-[18px] text-right text-xs font-semibold text-text-sub">ยอดก่อน VAT</th>
                <th className="px-[18px] py-[18px] text-right text-xs font-semibold text-text-sub">VAT ที่ยังรอรับ</th>
                <th className="px-[18px] py-[18px] text-right text-xs font-semibold text-text-sub">ยอดรวม</th>
                <th className="px-[18px] py-[18px] text-right text-xs font-semibold text-text-sub">เกินกำหนด</th>
                <th className="px-[18px] py-[18px] text-right text-xs font-semibold text-text-sub">การจัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {monthGroups.map((group) => {
                const isExpanded = Boolean(expandedMonths[group.monthKey]);
                return (
                  <Fragment key={group.monthKey}>
                    <tr
                      data-testid={`overdue-report-month-row-${group.monthKey}`}
                      className="transition-colors duration-150 hover:bg-table-row-hover"
                    >
                      <td className="px-[18px] py-[18px] font-medium text-text">{group.monthLabel}</td>
                      <td className="font-numeric px-[18px] py-[18px] text-text-sub">{group.vendorCount}</td>
                      <td className="font-numeric px-[18px] py-[18px] text-text-sub">{group.itemCount}</td>
                      <td className="font-numeric px-[18px] py-[18px] text-right text-text-sub">
                        {THB.format(group.totalAmountExclVat)}
                      </td>
                      <td className="font-numeric px-[18px] py-[18px] text-right text-text-sub">
                        {THB.format(group.totalVatAmount)}
                      </td>
                      <td className="font-numeric px-[18px] py-[18px] text-right font-medium text-text">
                        {THB.format(group.totalAmount)}
                      </td>
                      <td className="px-[18px] py-[18px] text-right">
                        {group.overdueCount > 0 ? (
                          <span className="font-numeric inline-block rounded-full bg-danger/15 px-2.5 py-1 text-xs font-medium text-danger">
                            {group.overdueCount} รายการ
                          </span>
                        ) : (
                          <span className="text-xs text-text-sub">-</span>
                        )}
                      </td>
                      <td className="px-[18px] py-[18px] text-right">
                        <button
                          type="button"
                          onClick={() => toggleMonth(group.monthKey)}
                          aria-expanded={isExpanded}
                          className="btn-press ml-auto flex items-center gap-1 rounded-[10px] border border-border bg-white px-3 py-1.5 text-xs font-medium text-text-sub hover:bg-page-bg"
                          data-testid={`overdue-report-month-toggle-${group.monthKey}`}
                        >
                          ดูรายละเอียด
                          <ChevronDown
                            size={14}
                            className={`transition-transform duration-[250ms] ${isExpanded ? 'rotate-180' : ''}`}
                            aria-hidden="true"
                          />
                        </button>
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={8} className="p-0">
                        <div className={`month-detail-panel ${isExpanded ? 'is-expanded' : ''}`}>
                          <div>
                            <OverdueMonthDetail
                              group={group}
                              today={today}
                              onView={setViewingInvoice}
                              onEdit={handleEdit}
                              onMarkReceived={handleMarkReceived}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {viewingInvoice && (
        <OverdueInvoiceDetailModal invoice={viewingInvoice} today={today} onClose={() => setViewingInvoice(null)} />
      )}
    </main>
  );
}
