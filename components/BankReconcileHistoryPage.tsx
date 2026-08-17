'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';
import {
  deleteReconcileReport,
  fetchReconcileReports,
  RECONCILE_REPORTS_SWR_KEY,
  type ReconcileReportSummary,
} from '@/lib/bankReconcileReportApi';
import { thaiMonthName } from '@/lib/thaiDate';
import BankReconcilePagination from './BankReconcilePagination';
import BankReconcileHistoryDetail from './BankReconcileHistoryDetail';
import type { NavIntent } from '@/lib/navigation';

const DEFAULT_PAGE_SIZE = 10;

interface BankReconcileHistoryPageProps {
  // ยังรับ onNavigate ไว้เหมือนเดิม (pattern เดียวกับ DashboardOverview/OverduePurchaseTaxReport) — ไม่ได้
  // ใช้เปิดรายละเอียดอีกต่อไปแล้ว (ดูคอมเมนต์ด้านล่าง) แต่ส่งต่อให้ BankReconcileHistoryDetail ใช้กับปุ่ม
  // "แก้ไขในหน้า Bank Reconcile" (ทางเลือกเสริม เผื่อผู้ใช้ต้องการแก้ไขจริงๆ ไม่ใช่แค่ดู) ไม่ส่งมาก็ยังใช้งาน
  // หน้านี้ได้ปกติ แค่ปุ่มแก้ไขนั้นจะไม่ปรากฏเท่านั้น
  onNavigate?: (id: string, intent?: NavIntent) => void;
}

/**
 * หน้า "ประวัติการกระทบยอด" (เพิ่มเข้ามา 2026-07-19) — เมนูใหม่ระดับบนสุดแบบ standalone (ดู lib/navigation.ts
 * NAV_STRUCTURE, id: 'reconcile-history') แสดงรายการกระทบยอดทั้งหมดที่เคยกด "บันทึกเป็นประวัติ" ไว้จากหน้า
 * Bank Reconcile (BankReconcileWorkspace.tsx) เรียงตามช่วงเวลาล่าสุดก่อนเสมอ (ดู fetchReconcileReports() —
 * order by period_year desc, period_month desc, updated_at desc) ใช้ ReconcileReportSummary เท่านั้น (ไม่ใช่
 * ReconcileReportDetail) เพราะหน้ารายการนี้แค่แสดงสรุป ไม่ต้องโหลดแถว Bank/GL/MatchGroup เต็มของทุกรายการมา
 * เปล่าๆ (โหลดเต็มเฉพาะรายการที่เปิดดูจริงผ่าน BankReconcileHistoryDetail.tsx ด้านล่าง)
 *
 * ปุ่ม "ดูรายละเอียด" แต่ละแถว (เดิมชื่อ "เปิดดู/แก้ไข" — เปลี่ยนชื่อ 2026-08-05 ตามคำขอผู้ใช้ ดูด้านล่าง) ไม่
 * ออกจากหน้าประวัติไปหน้า "Bank Reconcile" ทันทีเหมือนเดิมอีกต่อไปแล้ว — สลับไปแสดง BankReconcileHistoryDetail
 * (มุมมองอ่านอย่างเดียว ยึด Bank Statement เป็นหลัก พร้อมบอกว่าแต่ละแถวจับคู่กับ GL เลขที่ใด) แทนที่ list นี้
 * ทั้งหน้าโดยตรง (master-detail pattern เดียวกับ BankReconcilePage.tsx เดิม) ตามที่ผู้ใช้ระบุชัดเจนว่าไม่
 * ต้องการให้เด้งออกจากหน้านี้อีกต่อไป แค่อยากดูยอดที่กระทบสำเร็จตรงนี้ได้เลย — เส้นทางเดิม (onNavigate ไปหน้า
 * "Bank Reconcile" พร้อม NavIntent ชนิด 'open-reconcile-report') ยังคงอยู่ครบ ไม่ได้ลบทิ้ง แค่ย้ายไปอยู่หลัง
 * ปุ่มเสริม "แก้ไขในหน้า Bank Reconcile" ภายใน BankReconcileHistoryDetail แทน (เผื่อผู้ใช้ต้องการแก้ไขจริงๆ
 * เช่นอัปโหลดไฟล์ใหม่/จับคู่เองเพิ่ม ไม่ใช่แค่ดู — ความสามารถเดิมไม่หายไปไหน แค่ไม่ใช่ปุ่มเริ่มต้นอีกต่อไป)
 */
export default function BankReconcileHistoryPage({ onNavigate }: BankReconcileHistoryPageProps) {
  const { session } = useAuth();
  const { selectedCompanyId } = useCompany();
  const {
    data: reports = [],
    error: loadErrorObj,
    isLoading: loading,
    mutate: mutateReports,
  } = useSWR<ReconcileReportSummary[]>(
    session && selectedCompanyId ? [RECONCILE_REPORTS_SWR_KEY, selectedCompanyId] : null,
    () => fetchReconcileReports(selectedCompanyId!)
  );
  const loadError = loadErrorObj instanceof Error ? loadErrorObj.message : loadErrorObj ? 'โหลดข้อมูลไม่สำเร็จ' : null;

  // ปุ่ม "ลบ" + dialog ยืนยัน (เพิ่มเข้ามา 2026-08-13 ตามคำขอผู้ใช้) — เป็น hard delete จริง (ไม่ใช่ soft
  // delete/void แบบ WHT certificate) ใช้ pattern เดียวกับ dialog ยืนยันใน WhtCertificateHistoryPage.tsx/
  // ContactTable.tsx (การ์ดกระจกเข้ม + ปุ่มแดง disabled ระหว่างกำลังลบ)
  const [deletingReport, setDeletingReport] = useState<ReconcileReportSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleConfirmDelete() {
    if (!deletingReport) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteReconcileReport(deletingReport.id);
      setDeletingReport(null);
      await mutateReports();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'ลบไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setDeleteBusy(false);
    }
  }

  const [page, setPage] = useState(1);
  // จำนวนรายการต่อหน้า (เพิ่มเข้ามา 2026-08-17 ตามคำขอผู้ใช้ — เลือกได้ 10/20/30/40/50 ต่อหน้า ไม่เลือกก็ใช้
  // ค่าเดิมปกติ 10 เหมือนก่อนหน้านี้)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(reports.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visibleReports = useMemo(
    () => reports.slice((safePage - 1) * pageSize, safePage * pageSize),
    [reports, safePage, pageSize]
  );

  function handlePageSizeChange(size: number) {
    setPageSize(size);
    setPage(1);
  }

  // id ของรายการที่กำลังเปิดดูรายละเอียดอยู่ (ไม่ null = แสดง BankReconcileHistoryDetail แทน list ทั้งหมด)
  const [viewingReportId, setViewingReportId] = useState<string | null>(null);

  if (viewingReportId) {
    return (
      <BankReconcileHistoryDetail
        reportId={viewingReportId}
        onBack={() => setViewingReportId(null)}
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6" data-testid="reconcile-history-page">
      <p className="mb-6 text-sm text-text-sub">
        รายการกระทบยอดที่เคยบันทึกไว้ทั้งหมด เรียงตามเดือน/ปีล่าสุดก่อน — กด &quot;ดูรายละเอียด&quot; เพื่อดูยอดที่
        กระทบสำเร็จของรายการนั้นได้ทันทีในหน้านี้ (ยึดข้อมูล Bank Statement เป็นหลัก พร้อมบอกว่าแต่ละแถวจับคู่กับ
        GL เลขที่ใด) ไม่ต้องออกไปหน้าอื่นเลย
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
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setViewingReportId(report.id)}
                          className="btn-press rounded-[10px] border border-primary/50 bg-primary-light px-3.5 py-2 text-xs font-semibold text-primary hover:bg-primary/20"
                          data-testid={`reconcile-history-open-${report.id}`}
                        >
                          ดูรายละเอียด
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError(null);
                            setDeletingReport(report);
                          }}
                          className="btn-press rounded-[10px] border border-danger/30 px-3.5 py-2 text-xs font-semibold text-danger hover:bg-danger/10"
                          data-testid={`reconcile-history-delete-${report.id}`}
                        >
                          ลบ
                        </button>
                      </div>
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
            pageSize={pageSize}
            onPrev={() => setPage(safePage - 1)}
            onNext={() => setPage(safePage + 1)}
            onPageSizeChange={handlePageSizeChange}
          />
        </div>
      )}

      {/* dialog ยืนยันลบ (เพิ่มเข้ามา 2026-08-13) — pattern เดียวกับ WhtCertificateHistoryPage.tsx/
          ContactTable.tsx (การ์ดกระจกเข้ม + ปุ่มแดง disabled ระหว่างกำลังลบ) เป็น hard delete จริง ไม่ใช่
          soft delete จึงเตือนว่า "ไม่สามารถย้อนกลับได้" ชัดเจน */}
      {deletingReport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => (deleteBusy ? null : setDeletingReport(null))}
          role="dialog"
          aria-modal="true"
          aria-label="ยืนยันลบรายการกระทบยอด"
          data-testid="reconcile-history-delete-confirm-dialog"
        >
          <div
            className="card-surface card-surface-modal w-full max-w-sm rounded-2xl bg-white p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-text">ยืนยันลบรายการกระทบยอด</h3>
            <p className="mt-2 text-sm text-text-sub">
              &quot;{deletingReport.report_name}&quot; จะถูกลบถาวร (การลบไม่สามารถย้อนกลับได้) ต้องการดำเนินการต่อหรือไม่?
            </p>
            {deleteError && (
              <p role="alert" className="mt-3 rounded-[10px] border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
                {deleteError}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                disabled={deleteBusy}
                onClick={() => setDeletingReport(null)}
                className="btn-press rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-gray-500 hover:bg-page-bg disabled:opacity-60"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={deleteBusy}
                onClick={handleConfirmDelete}
                className="btn-press rounded-[10px] bg-danger px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-danger/90 disabled:opacity-60"
                data-testid="confirm-reconcile-history-delete"
              >
                {deleteBusy ? 'กำลังลบ...' : 'ยืนยันลบ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
