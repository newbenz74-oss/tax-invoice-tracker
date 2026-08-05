'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { ArrowLeft, Pencil } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getReportDetail, RECONCILE_REPORTS_SWR_KEY } from '@/lib/bankReconcileReportApi';
import { thaiMonthName } from '@/lib/thaiDate';
import BankReconcileSummaryCards from './BankReconcileSummaryCards';
import BankReconcilePagination from './BankReconcilePagination';
import type { ReconcileSummary } from '@/types/bankReconcile';
import type { NavIntent } from '@/lib/navigation';

const THB2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
const PAGE_SIZE = 20;

function formatDateDisplay(iso: string): string {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

interface BankReconcileHistoryDetailProps {
  reportId: string;
  onBack: () => void;
  // ทางเลือกเสริม (ไม่ส่งมาก็ยังใช้งานมุมมองนี้ได้ปกติ แค่ปุ่ม "แก้ไขในหน้า Bank Reconcile" จะไม่ปรากฏ) —
  // ใช้เส้นทางเดิมของโปรเจกต์ทุกประการ (onNavigate('bank-reconcile', {type:'open-reconcile-report',
  // reportId}) — ดูคอมเมนต์เต็มใน BankReconcileHistoryPage.tsx ว่าทำไมยังเก็บเส้นทางนี้ไว้)
  onNavigate?: (id: string, intent?: NavIntent) => void;
}

/**
 * มุมมอง "ดูรายละเอียด" ของรายการประวัติ 1 รายการ (เพิ่มเข้ามาแทนพฤติกรรมเดิม 2026-08-05 ตามคำขอผู้ใช้) —
 * เดิมปุ่ม "เปิดดู/แก้ไข" ในหน้าประวัติ (BankReconcileHistoryPage.tsx) จะ onNavigate ออกไปหน้า "Bank
 * Reconcile" ทั้งหน้า (ผ่าน BankReconcilePage → BankReconcileLoadedSession → BankReconcileWorkspace
 * เต็มรูปแบบ พร้อมแผงอัปโหลดไฟล์/จับคู่เอง) ผู้ใช้ระบุชัดเจนว่าไม่ต้องการให้ออกจากหน้าประวัติอีกต่อไป
 * แค่อยากดูยอดที่กระทบสำเร็จตรงนี้ได้เลย — component นี้จึงเป็นมุมมอง "อ่านอย่างเดียว" ล้วนๆ (ไม่มีอัปโหลด/
 * จับคู่เอง/บันทึกซ้ำใดๆ ทั้งสิ้น) แสดงอยู่ในหน้าประวัติเดิม ไม่นำทางออกไปหน้าอื่นเลย
 *
 * ยึด Bank Statement เป็นหลักตามที่ผู้ใช้ระบุ ("ต้องใช้ข้อมูล statement เป็นหลัก") คือ 1 แถวในตาราง = 1
 * แถว Bank Statement เสมอ (ครบทุกแถวจากไฟล์ต้นฉบับ ทั้งที่จับคู่สำเร็จและยังไม่จับคู่ — ต่างจาก
 * BankReconcileMatchedTable.tsx เดิมที่ยึด "กลุ่มที่จับคู่แล้ว" เป็นหลักและไม่แสดงแถว Bank ที่ยังไม่จับคู่
 * เลย) พร้อมคอลัมน์บอกว่าแถวนั้นจับคู่กับเอกสาร GL เลขที่ใด (กลุ่มที่จับคู่เองแบบ N:M อาจมีมากกว่า 1 เลขที่ —
 * แสดงคั่นด้วยจุลภาคทั้งหมด) หรือ "ยังไม่จับคู่" ถ้ายังไม่มีคู่เลย
 *
 * ใช้ getReportDetail() ตัวเดียวกับ BankReconcileLoadedSession.tsx ทุกประการ (ดึงข้อมูลเต็มจาก 4 ตาราง
 * ของฟีเจอร์นี้ผ่าน SWR, key เดียวกันจึงใช้ cache ร่วมกันได้ถ้าเคยเปิดผ่านทางเดิมมาก่อน) แต่ไม่ส่งต่อให้
 * BankReconcileWorkspace เลย — ประกอบตารางอ่านอย่างเดียวของตัวเองแทน
 */
export default function BankReconcileHistoryDetail({ reportId, onBack, onNavigate }: BankReconcileHistoryDetailProps) {
  const { session } = useAuth();
  const {
    data: detail,
    error: errorObj,
    isLoading: loading,
  } = useSWR(session ? `${RECONCILE_REPORTS_SWR_KEY}/${reportId}` : null, () => getReportDetail(reportId));
  const errorMessage = errorObj instanceof Error ? errorObj.message : errorObj ? 'โหลดข้อมูลไม่สำเร็จ' : null;

  const [page, setPage] = useState(1);

  // แผนที่ id แถว Bank -> เลขที่เอกสาร GL ทั้งหมดที่อยู่ใน group เดียวกัน (ปกติมี 1 รายการเสมอสำหรับกลุ่ม
  // ที่มาจากอัลกอริทึมอัตโนมัติ — ดู types/bankReconcileMatch.ts — อาจมีมากกว่า 1 สำหรับกลุ่มที่จับคู่เองแบบ
  // N:M) ไม่มี key ในแผนที่นี้เลย = แถวนั้นยังไม่จับคู่
  const glDocsByBankRowId = useMemo(() => {
    const map = new Map<string, string[]>();
    (detail?.matchGroups ?? []).forEach((group) => {
      const docs = group.glRows.map((row) => row.documentNo || '-');
      group.bankRows.forEach((row) => map.set(row.id, docs));
    });
    return map;
  }, [detail]);

  // ห่อด้วย useMemo แยกต่างหาก (แทนอ่าน detail?.bankRows ?? [] ตรงๆ) เพื่อให้ identity ของ array ว่างเปล่า
  // คงที่ระหว่าง render (ไม่สร้าง [] ใหม่ทุกครั้ง) — ทำให้ useMemo ของ paged ด้านล่างที่ dependency บนตัวแปร
  // นี้ทำงานถูกต้องตามที่ eslint react-hooks/exhaustive-deps คาดหวัง
  const bankRows = useMemo(() => detail?.bankRows ?? [], [detail]);
  const totalPages = Math.max(1, Math.ceil(bankRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = useMemo(() => bankRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE), [bankRows, safePage]);

  const summary: ReconcileSummary | null = detail
    ? {
        bankCount: detail.report.bank_row_count,
        glCount: detail.report.gl_row_count,
        matchedCount: detail.report.matched_group_count,
        bankUnmatchedCount: detail.report.bank_unmatched_count,
        glUnmatchedCount: detail.report.gl_unmatched_count,
      }
    : null;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6" data-testid="reconcile-history-detail">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="btn-press flex items-center gap-1.5 rounded-[10px] border border-border bg-white/8 px-3.5 py-2 text-sm font-medium text-text hover:bg-white/15"
          data-testid="reconcile-history-detail-back"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          กลับไปหน้ารายการ
        </button>
        {/* ปุ่มเสริม — เผื่อผู้ใช้ต้องการแก้ไขจริงๆ (อัปโหลดไฟล์ใหม่/จับคู่เองเพิ่ม/เปลี่ยนสถานะ) ไม่ใช่แค่ดู
            เท่านั้น ใช้เส้นทางเดิมของโปรเจกต์ (NavIntent 'open-reconcile-report') พาไปหน้า "Bank Reconcile"
            เต็มรูปแบบ (BankReconcileLoadedSession → BankReconcileWorkspace) ไม่แสดงเลยถ้าไม่ได้ส่ง onNavigate
            มา (เช่นถูกเรียกจากที่อื่นในอนาคตที่ไม่มีแนวคิดหน้า "Bank Reconcile") */}
        {onNavigate && (
          <button
            type="button"
            onClick={() => onNavigate('bank-reconcile', { type: 'open-reconcile-report', reportId })}
            className="btn-press flex items-center gap-1.5 rounded-[10px] border border-primary/50 bg-primary-light px-3.5 py-2 text-sm font-semibold text-primary hover:bg-primary/20"
            data-testid="reconcile-history-detail-edit"
          >
            <Pencil size={16} aria-hidden="true" />
            แก้ไขในหน้า Bank Reconcile
          </button>
        )}
      </div>

      {loading && <p className="py-12 text-center text-sm text-text-sub">กำลังโหลดข้อมูล...</p>}

      {errorMessage && (
        <p
          role="alert"
          className="mb-4 rounded-[10px] border border-danger/20 bg-danger/10 px-3.5 py-2.5 text-sm text-danger"
        >
          {errorMessage}
        </p>
      )}

      {!loading && !errorMessage && detail && (
        <>
          <div
            className="card-surface mb-6 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-primary/30 bg-primary-light/40 px-4 py-3"
            data-testid="reconcile-history-detail-header"
          >
            <p className="text-sm text-text">
              <span className="font-semibold">{detail.report.report_name}</span> ·{' '}
              {thaiMonthName(detail.report.period_month)} {detail.report.period_year}
            </p>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                detail.report.status === 'complete' ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
              }`}
              data-testid="reconcile-history-detail-status"
            >
              {detail.report.status === 'complete' ? 'เสร็จสมบูรณ์' : 'ทำค้างไว้'}
            </span>
          </div>

          {summary && <BankReconcileSummaryCards summary={summary} />}

          <section>
            <h2 className="mb-3 text-base font-bold text-text">
              Bank Statement ({bankRows.length.toLocaleString('th-TH')} รายการ)
            </h2>
            {bankRows.length === 0 ? (
              <div
                className="card-surface rounded-2xl border border-dashed border-border p-10 text-center text-sm text-text-sub"
                data-testid="reconcile-history-detail-empty"
              >
                ไม่มีแถว Bank Statement ในรายการนี้
              </div>
            ) : (
              <>
                <div className="card-surface max-h-[36rem] overflow-auto rounded-2xl">
                  <table className="min-w-full divide-y divide-border text-sm">
                    <thead className="sticky top-0 z-10 bg-card-bg/90 backdrop-blur-sm">
                      <tr>
                        <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">วันที่</th>
                        <th className="px-3.5 py-2.5 text-right font-medium text-text-sub">รับ</th>
                        <th className="px-3.5 py-2.5 text-right font-medium text-text-sub">จ่าย</th>
                        <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">จับคู่กับ GL เลขที่</th>
                        <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">สถานะ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {paged.map((row) => {
                        const docs = glDocsByBankRowId.get(row.id);
                        return (
                          <tr
                            key={row.id}
                            className="hover:bg-table-row-hover"
                            data-testid={`reconcile-history-detail-row-${row.id}`}
                          >
                            <td className="px-3.5 py-2.5 text-text-sub">{formatDateDisplay(row.date)}</td>
                            <td className="font-numeric px-3.5 py-2.5 text-right text-text">
                              {row.type === 'receive' ? row.amount.toLocaleString('th-TH', THB2) : '-'}
                            </td>
                            <td className="font-numeric px-3.5 py-2.5 text-right text-text">
                              {row.type === 'payment' ? row.amount.toLocaleString('th-TH', THB2) : '-'}
                            </td>
                            <td className="px-3.5 py-2.5 text-text-sub" data-testid={`reconcile-history-detail-gldoc-${row.id}`}>
                              {docs ? docs.join(', ') : '-'}
                            </td>
                            <td className="px-3.5 py-2.5">
                              {docs ? (
                                <span className="rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success">
                                  จับคู่สำเร็จ
                                </span>
                              ) : (
                                <span className="rounded-full bg-danger/15 px-2.5 py-1 text-xs font-medium text-danger">
                                  ยังไม่จับคู่
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <BankReconcilePagination
                  testIdPrefix="reconcile-history-detail"
                  page={safePage}
                  totalPages={totalPages}
                  totalItems={bankRows.length}
                  pageSize={PAGE_SIZE}
                  onPrev={() => setPage(safePage - 1)}
                  onNext={() => setPage(safePage + 1)}
                />
              </>
            )}
          </section>
        </>
      )}
    </main>
  );
}
