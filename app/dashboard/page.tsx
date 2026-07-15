'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import ProtectedRoute from '@/components/ProtectedRoute';
import Sidebar from '@/components/Sidebar';
import Header from '@/components/Header';
import ComingSoon from '@/components/ComingSoon';
import StatsCards from '@/components/StatsCards';
import InvoiceForm from '@/components/InvoiceForm';
import InvoiceTable from '@/components/InvoiceTable';
import ExcelImportPanel from '@/components/ExcelImportPanel';
import MonthlyVatSummary from '@/components/MonthlyVatSummary';
import PurchaseTaxReport from '@/components/PurchaseTaxReport';
import { useAuth } from '@/lib/AuthContext';
import {
  bulkCreateInvoices,
  cancelInvoice as apiCancelInvoice,
  createInvoice,
  deleteInvoice as apiDeleteInvoice,
  fetchInvoices,
  INVOICES_SWR_KEY,
  markReceived as apiMarkReceived,
  updateInvoice,
} from '@/lib/invoiceApi';
import { computeMonthlyVatSummary, computeStats, filterInvoices, sortInvoices } from '@/lib/invoiceLogic';
import { excelRowToWriteInput, type ExcelImportRow } from '@/lib/excelImport';
import { DEFAULT_ACTIVE_ID, findNavLeaf } from '@/lib/navigation';
import type {
  InvoiceFormInput,
  InvoiceStatus,
  MarkReceivedInput,
  PendingTaxInvoice,
  SortDirection,
  SortField,
} from '@/types/invoice';

const ACTIVE_NAV_STORAGE_KEY = 'benz_sidebar_active';

function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// โครง Sidebar + Header ใหม่ (DashboardShell) — DashboardContent ด้านล่างนี้ (state, handler,
// การเรียก SWR/API ทั้งหมด) ไม่ถูกแก้ไขแม้แต่บรรทัดเดียว แค่ย้ายไปแสดงในพื้นที่เนื้อหาด้านขวา
// แทนที่ Navbar เดิม โดยจะแสดงก็ต่อเมื่อเมนูที่ active คือ "บันทึกค่าใช้จ่าย" (เมนูในหมวด
// "บันทึกการจ่ายเงิน" ที่ผูกกับหน้า Dashboard เดิมนี้ไว้ และเป็นหน้าแรกของระบบตอนนี้ — เดิมเคย
// ผูกกับเมนู "ใบกำกับภาษี" ที่ถูกลบออกไปแล้ว ดู lib/navigation.ts)
export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <DashboardShell />
    </ProtectedRoute>
  );
}

// อ่านเมนูที่ active ล่าสุดจาก localStorage (client-only) — ถ้ายังไม่เคยมีค่า (เช่นล็อกอินครั้งแรก
// ในเบราว์เซอร์นี้ หรือค่าเดิมที่บันทึกไว้ชี้ไปเมนูที่ถูกลบไปแล้วอย่าง 'dashboard') จะ fallback ไปใช้
// DEFAULT_ACTIVE_ID คือ 'record-expense' (บันทึกค่าใช้จ่าย, หน้าเดิมของ Dashboard) เสมอ
function readInitialActiveId(): string {
  if (typeof window === 'undefined') return DEFAULT_ACTIVE_ID;
  try {
    const saved = localStorage.getItem(ACTIVE_NAV_STORAGE_KEY);
    if (saved && findNavLeaf(saved)) return saved;
  } catch {
    // localStorage ใช้ไม่ได้ (เช่น private mode) — ใช้ค่า default ต่อไป
  }
  return DEFAULT_ACTIVE_ID;
}

function DashboardShell() {
  const [activeId, setActiveId] = useState<string>(readInitialActiveId);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // บันทึกเมนูที่ active ไว้ทุกครั้งที่เปลี่ยน เพื่อให้จำได้ข้าม refresh
  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_NAV_STORAGE_KEY, activeId);
    } catch {
      // เขียน localStorage ไม่ได้ก็ไม่เป็นไร แค่จำเมนูข้าม refresh ไม่ได้
    }
  }, [activeId]);

  const activeEntry = findNavLeaf(activeId);
  const title = activeEntry?.label ?? '';

  function handleSelect(id: string) {
    setActiveId(id);
    setMobileNavOpen(false);
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar
        activeId={activeId}
        onSelect={handleSelect}
        isOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />
      <div className="flex min-h-screen flex-1 flex-col min-[992px]:ml-[250px]">
        <Header title={title} onMenuClick={() => setMobileNavOpen(true)} />
        {renderActiveContent(activeId, Boolean(activeEntry?.implemented), title)}
      </div>
    </div>
  );
}

// เดิมเป็น ternary เดียว (implemented ? DashboardContent : ComingSoon) เพราะมีแค่เมนูเดียวที่
// implemented: true — ตอนนี้มี 2 เมนูแล้ว (record-expense, purchase-tax-report) จึงขยายเป็นฟังก์ชัน
// เลือกตาม activeId แทน เมนูที่ implemented: false ทุกอันยังคงขึ้น ComingSoon เหมือนเดิมทุกประการ
function renderActiveContent(activeId: string, implemented: boolean, title: string) {
  if (!implemented) return <ComingSoon label={title} />;
  switch (activeId) {
    case 'record-expense':
      return <DashboardContent />;
    case 'purchase-tax-report':
      return <PurchaseTaxReport />;
    default:
      return <ComingSoon label={title} />;
  }
}

function DashboardContent() {
  const { session } = useAuth();
  const today = useMemo(() => todayISO(), []);

  // ใช้ SWR แทน useEffect+useState เพื่อดึงข้อมูล — เรียก fetch เฉพาะตอนมี session แล้ว
  // (key เป็น null ถ้ายังไม่ login ทำให้ SWR ไม่ยิง request) และ mutate() เพื่อรีเฟรชหลังแก้ไขข้อมูล
  const {
    data: invoices = [],
    error: loadErrorObj,
    isLoading: loading,
    mutate,
  } = useSWR<PendingTaxInvoice[]>(session ? INVOICES_SWR_KEY : null, fetchInvoices);
  const loadError = loadErrorObj instanceof Error ? loadErrorObj.message : loadErrorObj ? 'โหลดข้อมูลไม่สำเร็จ' : null;

  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'all'>('pending');
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('expected_date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const [showForm, setShowForm] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<PendingTaxInvoice | null>(null);
  const [showImportPanel, setShowImportPanel] = useState(false);

  const stats = useMemo(() => computeStats(invoices, today), [invoices, today]);
  const monthlyVat = useMemo(() => computeMonthlyVatSummary(invoices), [invoices]);

  const visibleInvoices = useMemo(() => {
    const filtered = filterInvoices(invoices, { status: statusFilter, search });
    return sortInvoices(filtered, sortField, sortDirection);
  }, [invoices, statusFilter, search, sortField, sortDirection]);

  function handleSortChange(field: SortField) {
    if (field === sortField) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  }

  async function handleFormSubmit(input: InvoiceFormInput) {
    const payload = {
      vendor_name: input.vendor_name.trim(),
      transaction_date: input.transaction_date,
      description: input.description.trim() || null,
      amount_excl_vat: parseFloat(input.amount_excl_vat) || 0,
      vat_amount: parseFloat(input.vat_amount) || 0,
      reference_no: input.reference_no.trim() || null,
      expected_date: input.expected_date || null,
      notes: input.notes.trim() || null,
      vendor_tax_id: input.vendor_tax_id.trim() || null,
    };

    if (editingInvoice) {
      await updateInvoice(editingInvoice.id, payload);
    } else {
      await createInvoice(payload, {
        id: session?.user?.id ?? null,
        email: session?.user?.email ?? null,
      });
    }
    setShowForm(false);
    setEditingInvoice(null);
    await mutate();
  }

  async function handleImportRows(rows: ExcelImportRow[]) {
    const inputs = rows.map(excelRowToWriteInput);
    await bulkCreateInvoices(inputs, {
      id: session?.user?.id ?? null,
      email: session?.user?.email ?? null,
    });
    setShowImportPanel(false);
    await mutate();
  }

  async function handleMarkReceived(invoice: PendingTaxInvoice, input: MarkReceivedInput) {
    await apiMarkReceived(invoice.id, input);
    await mutate();
  }

  async function handleCancelInvoice(invoice: PendingTaxInvoice) {
    await apiCancelInvoice(invoice.id);
    await mutate();
  }

  async function handleDelete(invoice: PendingTaxInvoice) {
    await apiDeleteInvoice(invoice.id);
    await mutate();
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
      <div className="mb-6 flex flex-col gap-4">
        <StatsCards stats={stats} />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {(['all', 'pending', 'received', 'cancelled'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                  statusFilter === s ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-300'
                }`}
                data-testid={`filter-${s}`}
              >
                {s === 'all' ? 'ทั้งหมด' : s === 'pending' ? 'รอรับ' : s === 'received' ? 'ได้รับแล้ว' : 'ยกเลิก'}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาผู้ขาย / เลขที่อ้างอิง / เลขใบกำกับภาษี"
              className="w-64 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              data-testid="search-input"
            />
            <button
              onClick={() => {
                setShowImportPanel(true);
                setShowForm(false);
              }}
              className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              data-testid="open-import-panel"
            >
              นำเข้าจาก Excel
            </button>
            <button
              onClick={() => {
                setEditingInvoice(null);
                setShowForm(true);
                setShowImportPanel(false);
              }}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
              data-testid="open-add-form"
            >
              + เพิ่มรายการ
            </button>
          </div>
        </div>
      </div>

      {showForm && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-bold text-gray-900">
            {editingInvoice ? 'แก้ไขรายการ' : 'เพิ่มรายการใหม่'}
          </h2>
          <InvoiceForm
            key={editingInvoice?.id ?? 'new'}
            editingInvoice={editingInvoice}
            onSubmit={handleFormSubmit}
            onCancel={() => {
              setShowForm(false);
              setEditingInvoice(null);
            }}
          />
        </div>
      )}

      {showImportPanel && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-bold text-gray-900">นำเข้ารายการจาก Excel</h2>
          <ExcelImportPanel onImport={handleImportRows} onClose={() => setShowImportPanel(false)} />
        </div>
      )}

      {loadError && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {loadError}
        </p>
      )}

      {loading ? (
        <p className="py-12 text-center text-sm text-gray-400">กำลังโหลดข้อมูล...</p>
      ) : (
        <>
          <InvoiceTable
            invoices={visibleInvoices}
            today={today}
            sortField={sortField}
            sortDirection={sortDirection}
            onSortChange={handleSortChange}
            onEdit={(invoice) => {
              setEditingInvoice(invoice);
              setShowForm(true);
              setShowImportPanel(false);
            }}
            onMarkReceived={handleMarkReceived}
            onCancelInvoice={handleCancelInvoice}
            onDelete={handleDelete}
          />

          <div className="mt-8">
            <h2 className="mb-3 text-sm font-bold text-gray-900">สรุป VAT รายเดือน</h2>
            <MonthlyVatSummary rows={monthlyVat} />
          </div>
        </>
      )}
    </main>
  );
}
