'use client';

import { useMemo } from 'react';
import useSWR from 'swr';
import { ArrowRight, FileInput, FileOutput, FileSpreadsheet, PlusCircle } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { fetchInvoices, INVOICES_SWR_KEY } from '@/lib/invoiceApi';
import { AGING_BADGE_CLASS, AGING_LABELS, computeMonthlyVatSummary, computeStats, getAgingBucket } from '@/lib/invoiceLogic';
import type { NavIntent } from '@/lib/navigation';
import StatsCards from '@/components/StatsCards';
import MonthlyVatSummary from '@/components/MonthlyVatSummary';
import type { PendingTaxInvoice } from '@/types/invoice';

const THB = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// จำนวนรายการที่แสดงในลิสต์ย่อยแต่ละอัน (รายการล่าสุด / เกินกำหนด) — สเปกระบุ 5 รายการชัดเจนสำหรับ
// "รายการรอรับใบกำกับภาษีล่าสุด" ส่วน "รายการเกินกำหนด" ไม่ได้ระบุจำนวนไว้ ใช้จำนวนเดียวกันเพื่อให้
// หน้า Dashboard กระชับตามเจตนา "หน้าภาพรวม" (ดูรายการที่เหลือทั้งหมดได้ผ่านลิงก์ "ดูทั้งหมด")
const RECENT_LIST_LIMIT = 5;

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

interface DashboardOverviewProps {
  // เหมือน pattern onNavigate เดิมของ ExpenseRecordContent/MonthlyVatSummary — เผื่อให้ปุ่ม/การ์ด
  // ในหน้านี้พาไปเมนูอื่นได้เอง ไม่บังคับส่งมา (ไม่ส่งมาก็ยังใช้งานได้ปกติ แค่ปุ่ม/การ์ดไม่ตอบสนอง)
  onNavigate?: (id: string, intent?: NavIntent) => void;
}

/**
 * หน้า Dashboard ภาพรวม — เพิ่มเข้ามาในรอบปรับโครงสร้าง Navigation/Layout (2026-07-15) เป็นหน้า
 * "อ่านอย่างเดียว" ล้วนๆ ตามสเปก ("Dashboard เป็นหน้าภาพรวม ไม่ใช่หน้าสำหรับแก้ไขข้อมูล") — ไม่มีฟอร์ม/
 * ปุ่มแก้ไข/ลบรายการใดๆ อยู่ในหน้านี้เอง ทุกอย่างที่ต้องแก้ไขข้อมูลจริงพากลับไปที่หน้า "บันทึกค่าใช้จ่าย"
 * ผ่าน onNavigate เสมอ (ดู ExpenseRecordContent ใน app/dashboard/page.tsx)
 *
 * ใช้ SWR key เดียวกับ ExpenseRecordContent/PurchaseTaxReport (INVOICES_SWR_KEY) จึงอ่านจาก cache
 * ชุดเดียวกัน ไม่ยิง fetch ซ้ำ — ตาม pattern ที่ใช้มาตั้งแต่ฟีเจอร์ VAT Reconcile เดิม
 *
 * StatsCards และ MonthlyVatSummary ย้ายมาจากหน้า "บันทึกค่าใช้จ่าย" ทั้งคู่ (component เดิมไม่ถูกแก้ไข
 * logic การคำนวณใดๆ เลย แค่ย้ายตำแหน่งที่ render มาไว้ที่นี่แทน)
 */
export default function DashboardOverview({ onNavigate }: DashboardOverviewProps) {
  const { session } = useAuth();

  const {
    data: invoices = [],
    error: loadErrorObj,
    isLoading: loading,
  } = useSWR<PendingTaxInvoice[]>(session ? INVOICES_SWR_KEY : null, fetchInvoices);
  const loadError =
    loadErrorObj instanceof Error ? loadErrorObj.message : loadErrorObj ? 'โหลดข้อมูลไม่สำเร็จ' : null;

  const today = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, []);

  const stats = useMemo(() => computeStats(invoices, today), [invoices, today]);
  const monthlyVat = useMemo(() => computeMonthlyVatSummary(invoices), [invoices]);

  // รายการรอรับใบกำกับภาษีล่าสุด — ตีความ "ล่าสุด" เป็นรายการที่เพิ่งถูกบันทึกเข้าระบบล่าสุด
  // (created_at desc) ไม่ใช่วันที่ทำรายการ/วันที่คาดว่าจะได้รับ เพราะเจตนาของ widget นี้คือให้เห็นว่า
  // เพิ่งมีอะไรเข้ามาใหม่ที่ยังรอเอกสารอยู่
  const recentPending = useMemo(() => {
    return invoices
      .filter((i) => i.status === 'pending')
      .slice()
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, RECENT_LIST_LIMIT);
  }, [invoices]);

  // รายการเกินกำหนด — ใช้ getAgingBucket ตัวเดิมจาก lib/invoiceLogic.ts (ไม่มี logic ใหม่) เรียง
  // เกินกำหนดนานสุดก่อน (วันที่คาดว่าจะได้รับเก่าสุดก่อน)
  const overdueList = useMemo(() => {
    return invoices
      .filter((i) => {
        const bucket = getAgingBucket(i.expected_date, i.status, today);
        return bucket !== 'not_due' && bucket !== 'n_a';
      })
      .slice()
      .sort((a, b) => (a.expected_date ?? '').localeCompare(b.expected_date ?? ''))
      .slice(0, RECENT_LIST_LIMIT);
  }, [invoices, today]);

  function goToRecordExpense(intent?: NavIntent) {
    onNavigate?.('record-expense', intent);
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-8">
      {loadError && (
        <p
          role="alert"
          className="mb-4 rounded-[10px] border border-danger/20 bg-danger/10 px-3.5 py-2.5 text-sm text-danger"
        >
          {loadError}
        </p>
      )}

      {loading ? (
        <p className="py-12 text-center text-sm text-text-sub">กำลังโหลดข้อมูล...</p>
      ) : (
        <div className="flex flex-col gap-6">
          {/* KPI Cards — คลิกได้ พาไปหน้า/filter ที่เกี่ยวข้อง ("ทุก Card สามารถกดเพื่อเข้าเมนูที่
              เกี่ยวข้องได้" ตามสเปก) — "รอรับ"/"ยอดรวมที่รอรับ"/"เกินกำหนด" พาไปหน้าบันทึกค่าใช้จ่าย
              filter=รอรับ (รายการเกินกำหนดยังคงเป็นสับเซตของรอรับ เห็น badge เกินกำหนดในตารางอยู่แล้ว
              จึงไม่เพิ่ม filter สถานะใหม่ที่ต้องแก้ lib/invoiceLogic.ts), "VAT ที่รอรับ" พาไปรายงาน
              ภาษีซื้อตรงตามตัวอย่างในสเปก, "ได้รับแล้ว" พาไปบันทึกค่าใช้จ่าย filter=ได้รับแล้ว */}
          {/* entrance-animate ทั้งหน้า (2026-07-18) — ผู้ใช้ขอให้กดเข้าหน้านี้แล้ว smooth เหมือนหน้า
              "สมุดรายชื่อ" (ContactsPage.tsx) ใช้คลาส entrance-animate/entrance-delay-1/2/3 ชุดเดิมจาก
              globals.css ซ้ำตรงๆ (ไม่เพิ่มคลาส/tier ใหม่) ไล่ลำดับความสำคัญจากบนลงล่าง: KPI Cards (delay-1)
              → ทางลัด (delay-2) → รายการล่าสุด/เกินกำหนด+สรุป VAT รายเดือน (delay-3 — ใส่ตรงๆ ที่ grid กับ
              ห่อ MonthlyVatSummary แยกกันคนละจุดด้านล่าง เพราะมีแค่ 3 tier delay ให้ใช้ ไม่จำเป็นต้องมี
              wrapper div ร่วมกัน ก็เล่นพร้อมกันได้อยู่แล้วเพราะ animation-delay เท่ากัน) — ครอบด้วย div เปล่า
              เฉพาะจุดที่ component ลูก (StatsCards/MonthlyVatSummary) ไม่มี className prop ให้ส่งเข้าไปตรงๆ
              เท่านั้น (ไม่แก้ไฟล์ component ลูกเลย เพื่อจำกัดขอบเขตการแก้ไขรอบนี้) */}
          <div className="entrance-animate entrance-delay-1">
            <StatsCards
              stats={stats}
              onCardClick={(id) => {
                if (id === 'pending-vat') onNavigate?.('purchase-tax-report');
                else if (id === 'received') goToRecordExpense({ type: 'filter', status: 'received' });
                else goToRecordExpense({ type: 'filter', status: 'pending' });
              }}
            />
          </div>

          {/* Quick Actions */}
          <div className="card-surface entrance-animate entrance-delay-2 rounded-2xl p-6" data-testid="quick-actions">
            <h2 className="mb-4 text-sm font-bold text-text">ทางลัด</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <button
                type="button"
                onClick={() => goToRecordExpense({ type: 'open-form' })}
                className="btn-press flex flex-col items-center gap-2 rounded-[10px] border border-border bg-white px-3 py-4 text-center text-xs font-medium text-text hover:border-primary/50 hover:bg-primary-light"
                data-testid="quick-action-add-expense"
              >
                <PlusCircle size={20} className="text-primary" aria-hidden="true" />
                เพิ่มค่าใช้จ่าย
              </button>
              <button
                type="button"
                onClick={() => goToRecordExpense({ type: 'open-import' })}
                className="btn-press flex flex-col items-center gap-2 rounded-[10px] border border-border bg-white px-3 py-4 text-center text-xs font-medium text-text hover:border-primary/50 hover:bg-primary-light"
                data-testid="quick-action-import-excel"
              >
                <FileSpreadsheet size={20} className="text-primary" aria-hidden="true" />
                Import Excel
              </button>
              <button
                type="button"
                onClick={() => onNavigate?.('purchase-tax-report')}
                className="btn-press flex flex-col items-center gap-2 rounded-[10px] border border-border bg-white px-3 py-4 text-center text-xs font-medium text-text hover:border-primary/50 hover:bg-primary-light"
                data-testid="quick-action-purchase-tax-report"
              >
                <FileInput size={20} className="text-primary" aria-hidden="true" />
                รายงานภาษีซื้อ
              </button>
              <button
                type="button"
                onClick={() => onNavigate?.('sales-tax-report')}
                className="btn-press flex flex-col items-center gap-2 rounded-[10px] border border-border bg-white px-3 py-4 text-center text-xs font-medium text-text hover:border-primary/50 hover:bg-primary-light"
                data-testid="quick-action-sales-tax-report"
              >
                <FileOutput size={20} className="text-primary" aria-hidden="true" />
                รายงานภาษีขาย
              </button>
            </div>
          </div>

          <div className="entrance-animate entrance-delay-3 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* ตารางรายการรอรับใบกำกับภาษีล่าสุด */}
            <div className="card-surface overflow-hidden rounded-2xl">
              <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
                <h2 className="text-sm font-bold text-text">รายการรอรับใบกำกับภาษีล่าสุด</h2>
                <button
                  type="button"
                  onClick={() => goToRecordExpense({ type: 'filter', status: 'pending' })}
                  className="btn-press flex items-center gap-1 text-xs font-medium text-primary hover:text-primary-hover"
                  data-testid="view-all-pending"
                >
                  ดูทั้งหมด
                  <ArrowRight size={13} aria-hidden="true" />
                </button>
              </div>
              {recentPending.length === 0 ? (
                <p className="p-6 text-center text-sm text-text-sub">ไม่มีรายการรอรับใบกำกับภาษี</p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {recentPending.map((invoice) => (
                    <li
                      key={invoice.id}
                      className="flex items-center justify-between gap-3 px-6 py-3.5"
                      data-testid={`recent-pending-${invoice.id}`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-text">{invoice.vendor_name}</p>
                        <p className="text-xs text-text-sub">{formatDate(invoice.transaction_date)}</p>
                      </div>
                      <p className="font-numeric shrink-0 text-sm font-medium text-text">
                        {THB.format(invoice.total_amount)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* รายการเกินกำหนด */}
            <div className="card-surface overflow-hidden rounded-2xl">
              <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
                <h2 className="text-sm font-bold text-text">รายการเกินกำหนด</h2>
                <button
                  type="button"
                  onClick={() => goToRecordExpense({ type: 'filter', status: 'pending' })}
                  className="btn-press flex items-center gap-1 text-xs font-medium text-primary hover:text-primary-hover"
                  data-testid="view-all-overdue"
                >
                  ดูทั้งหมด
                  <ArrowRight size={13} aria-hidden="true" />
                </button>
              </div>
              {overdueList.length === 0 ? (
                <p className="p-6 text-center text-sm text-text-sub">ไม่มีรายการเกินกำหนด</p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {overdueList.map((invoice) => {
                    const bucket = getAgingBucket(invoice.expected_date, invoice.status, today);
                    return (
                      <li
                        key={invoice.id}
                        className="flex items-center justify-between gap-3 px-6 py-3.5"
                        data-testid={`overdue-item-${invoice.id}`}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-text">{invoice.vendor_name}</p>
                          <span
                            className={`mt-1 inline-block w-fit rounded-full px-2.5 py-1 text-[11px] font-medium ${AGING_BADGE_CLASS[bucket]}`}
                          >
                            {AGING_LABELS[bucket]}
                          </span>
                        </div>
                        <p className="font-numeric shrink-0 text-sm font-medium text-text">
                          {THB.format(invoice.total_amount)}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="entrance-animate entrance-delay-3">
            <MonthlyVatSummary
              rows={monthlyVat}
              onViewAllReport={onNavigate ? () => onNavigate('purchase-tax-report') : undefined}
            />
          </div>
        </div>
      )}
    </main>
  );
}
