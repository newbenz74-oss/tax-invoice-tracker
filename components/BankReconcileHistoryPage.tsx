'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { useAuth } from '@/lib/AuthContext';
import {
  fetchReconcileReports,
  RECONCILE_REPORTS_SWR_KEY,
  type ReconcileReportSummary,
} from '@/lib/bankReconcileReportApi';
import { thaiMonthName } from '@/lib/thaiDate';
import BankReconcilePagination from './BankReconcilePagination';
import type { NavIntent } from '@/lib/navigation';

const PAGE_SIZE = 10;

interface BankReconcileHistoryPageProps {
  // pattern เดียวกับ DashboardOverview/OverduePurchaseTaxReport — ไม่ส่งมาก็ยังใช้งานหน้านี้ได้ปกติ
  // แค่ปุ่ม "เปิดดู/แก้ไข" จะไม่พาไปหน้า "Bank Reconcile" เท่านั้น
  onNavigate?: (id: string, intent?: NavIntent) => void;
}

/**
 * หน้า "ประวัติการกระทบยอด" (เพิ่มเข้ามา 2026-07-19) — เมนูใหม่ระดับบนสุดแบบ standalone (ดู lib/navigation.ts
 * NAV_STRUCTURE, id: 'reconcile-history') แสดงรายการกระทบยอดทั้งหมดที่เคยกด "บันทึกเป็นประวัติ" ไว้จากหน้า
 * Bank Reconcile (BankReconcileWorkspace.tsx) เรียงตามช่วงเวลาล่าสุดก่อนเสมอ (ดู fetchReconcileReports() —
 * order by period_year desc, period_month desc, updated_at desc) ใช้ ReconcileReportSummary เท่านั้น (ไม่ใช่
 * ReconcileReportDetail) เพราะหน้านี้แค่แสดงสรุป ไม่ต้องโหลดแถว Bank/GL/MatchGroup เต็มของทุกรายการมาเปล่าๆ
 *
 * ปุ่ม "เปิดดู/แก้ไข" แต่ละแถวไม่เปิดหน้ารายละเอียดแยกต่างหาก — ส่ง NavIntent ชนิด 'open-reconcile-report'
 * กลับไปที่หน้า "Bank Reconcile" ให้ BankReconcilePage.tsx (dispatcher) สลับไปแสดง BankReconcileLoadedSession
 * แทนทันที (รูปแบบ onNavigate เดียวกับปุ่ม "แก้ไข" ใน OverduePurchaseTaxReport.tsx ที่ส่ง 'edit-invoice'
 * กลับไปหน้า "บันทึกค่าใช้จ่าย") ไม่ duplicate UI/logic การแสดงผลรายการที่โหลดมาเลยแม้แต่นิดเดียว
 */
export default function BankReconcileHistoryPage({ onNavigate }: BankReconcileHistoryPageProps) {
  const { session } = useAuth();
  const {
    data: reports = [],
    error: loadErrorObj,
    isLoading: loading,
  } = useSWR<ReconcileReportSummary[]>(session ? RECONCILE_REPORTS_SWR_KEY : null, fetchReconcileReports);
  const loadError = loadErrorObj instanceof Error ? loadErrorObj.message : loadErrorObj ? 'โหลดข้อมูลไม่สำเร็จ' : null;

  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(reports.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visibleReports = useMemo(
    () => reports.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [reports, safePage]
  );

  function handleOpen(report: ReconcileReportSummary) {
    onNavigate?.('bank-reconcile', { type: 'open-reconcile-report', reportId: report.id });
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6" data-testid="reconcile-history-page">
      <p className="mb-6 text-sm text-text-sub">
        รายการกระทบยอดที่เคยบันทึกไว้ทั้งหมด เรียงตามเดือน/ปีล่าสุดก่อน — กด &quot;เปิดดู/แก้ไข&quot; เพื่อกลับไปดู
        หรือแก้ไขรายการโดยไม่ต้องอัปโหลดไฟล์ Bank Statement/GL ใหม่เลย
      </p>

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
      ) : reports.length === 0 ? (
        <div
          className="entrance-animate entrance-delay-1 card-surface rounded-2xl border border-dashed border-border p-12 text-center text-sm text-text-sub"
          data-testid="reconcile-history-empty"
        >
          ยังไม่มีรายการกระทบยอดที่บันทึกไว้ — เปิดหน้า &quot;Bank Reconcile&quot; กด &quot;ตรวจสอบข้อมูล&quot; แล้ว
          กด &quot;บันทึกเป็นประวัติ&quot; เพื่อเริ่มเก็บประวัติรายการแรก
        </div>
      ) : (
        <div className="entrance-animate entrance-delay-1">
          <div className="card-surface overflow-x-auto rounded-2xl">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-table-header">
                <tr>
                  <th className="px-[18px] py-[18px] text-left text-xs font-semibold text-text-sub">รายการ</th>
                  <th className="px-[18px] py-[18px] text-left text-xs font-semibold text-text-sub">สถานะ</th>
                  <th className="px-[18px] py-[18px] text-right text-xs font-semibold text-text-sub">แถว Bank</th>
                  <th className="px-[18px] py-[18px] text-right text-xs font-semibold text-text-sub">แถว GL</th>
                  <th className="px-[18px] py-[18px] text-right text-xs font-semibold text-text-sub">จับคู่สำเร็จ</th>
                  <th className="px-[18px] py-[18px] text-right text-xs font-semibold text-text-sub">Bank ไม่สำเร็จ</th>
                  <th className="px-[18px] py-[18px] text-right text-xs font-semibold text-text-sub">GL ไม่สำเร็จ</th>
                  <th className="px-[18px] py-[18px] text-right text-xs font-semibold text-text-sub">การจัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {visibleReports.map((report, index) => (
                  <tr
                    key={report.id}
                    data-testid={`reconcile-history-row-${report.id}`}
                    className={`transition-colors duration-150 hover:bg-table-row-hover ${
                      index % 2 === 1 ? 'bg-table-row-zebra' : ''
                    }`}
                  >
                    <td className="px-[18px] py-[18px]">
                      <p className="font-medium text-text">{report.report_name}</p>
                      <p className="text-xs text-text-sub">
                        {thaiMonthName(report.period_month)} {report.period_year}
                      </p>
                    </td>
                    <td className="px-[18px] py-[18px]">
                      <span
                        className={`inline-block w-fit rounded-full px-3.5 py-2 text-xs font-medium ${
                          report.status === 'complete' ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
                        }`}
                        data-testid={`reconcile-history-status-${report.id}`}
                      >
                        {report.status === 'complete' ? 'เสร็จสมบูรณ์' : 'ทำค้างไว้'}
                      </span>
                    </td>
                    <td className="font-numeric px-[18px] py-[18px] text-right text-text-sub">
                      {report.bank_row_count.toLocaleString('th-TH')}
                    </td>
                    <td className="font-numeric px-[18px] py-[18px] text-right text-text-sub">
                      {report.gl_row_count.toLocaleString('th-TH')}
                    </td>
                    <td className="font-numeric px-[18px] py-[18px] text-right text-text-sub">
                      {report.matched_group_count.toLocaleString('th-TH')}
                    </td>
                    <td className="font-numeric px-[18px] py-[18px] text-right text-text-sub">
                      {report.bank_unmatched_count.toLocaleString('th-TH')}
                    </td>
                    <td className="font-numeric px-[18px] py-[18px] text-right text-text-sub">
                      {report.gl_unmatched_count.toLocaleString('th-TH')}
                    </td>
                    <td className="px-[18px] py-[18px] text-right">
                      <button
                        type="button"
                        onClick={() => handleOpen(report)}
                        className="btn-press rounded-[10px] border border-primary/50 bg-primary-light px-3.5 py-2 text-xs font-semibold text-primary hover:bg-primary/20"
                        data-testid={`reconcile-history-open-${report.id}`}
                      >
                        เปิดดู/แก้ไข
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <BankReconcilePagination
            testIdPrefix="reconcile-history"
            page={safePage}
            totalPages={totalPages}
            totalItems={reports.length}
            pageSize={PAGE_SIZE}
            onPrev={() => setPage(safePage - 1)}
            onNext={() => setPage(safePage + 1)}
          />
        </div>
      )}
    </main>
  );
}
