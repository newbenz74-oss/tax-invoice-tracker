'use client';

import { useMemo } from 'react';
import useSWR from 'swr';
import { ArrowLeft, CheckCircle2, FileSpreadsheet, FileText, Pencil, Printer } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getReportDetail, RECONCILE_REPORTS_SWR_KEY } from '@/lib/bankReconcileReportApi';
import { thaiMonthName } from '@/lib/thaiDate';
import {
  buildBankReconcileHistoryExcelBlob,
  buildBankReconcileHistoryPdfBlob,
  summarizeBankReconcileHistoryRows,
  type BankReconcileHistoryExportRow,
} from '@/lib/bankReconcileHistoryExport';
import { downloadBlob } from '@/lib/reportExport';
import BankReconcileSummaryCards from './BankReconcileSummaryCards';
import type { ReconcileSummary } from '@/types/bankReconcile';
import type { NavIntent } from '@/lib/navigation';

const THB2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

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
 * Reconcile" ทั้งหน้า ผู้ใช้ระบุชัดเจนว่าไม่ต้องการให้ออกจากหน้าประวัติอีกต่อไป แค่อยากดูยอดที่กระทบสำเร็จ
 * ตรงนี้ได้เลย — component นี้จึงเป็นมุมมอง "อ่านอย่างเดียว" ล้วนๆ (ไม่มีอัปโหลด/จับคู่เอง/บันทึกซ้ำใดๆ)
 *
 * ยึด Bank Statement เป็นหลักตามที่ผู้ใช้ระบุ ("ต้องใช้ข้อมูล statement เป็นหลัก") คือ 1 แถวในตาราง = 1
 * แถว Bank Statement เสมอ (ครบทุกแถวจากไฟล์ต้นฉบับ ทั้งที่จับคู่สำเร็จและยังไม่จับคู่) พร้อมคอลัมน์บอกว่า
 * แถวนั้นจับคู่กับเอกสาร GL เลขที่ใด (กลุ่มที่จับคู่เองแบบ N:M อาจมีมากกว่า 1 เลขที่ — แสดงคั่นด้วยจุลภาค)
 * หรือ "ยังไม่จับคู่" ถ้ายังไม่มีคู่เลย
 *
 * รอบปรับปรุง 2026-08-05 (รอบ 2 ตามคำขอผู้ใช้เพิ่มเติมหลังใช้งานจริง):
 * 1) เอากล่อง max-h/overflow-auto + pagination ของตารางออก (แสดงทุกแถวรวดเดียว ไม่ต้องเลื่อนดูในกล่องเล็ก
 *    ซ้อนอีกชั้นหนึ่ง — เลื่อนหน้าเว็บตามปกติพอ) หัวตารางยังคง sticky top-0 ไว้เหมือนเดิม แต่เกาะกับการเลื่อน
 *    ของทั้งหน้าแทนที่จะเกาะกับกล่องเล็กที่ถูกลบไปแล้ว
 * 2) เพิ่มแถวสรุปยอดรวมรับ/จ่ายท้ายตาราง (tfoot) และแผงตรวจสอบยอด 3 ระดับ (ทั้งหมด/กระทบยอดสำเร็จ/
 *    ยังไม่จับคู่ — สองอันหลังรวมกันต้องเท่ากับอันแรกเสมอ ดู lib/bankReconcileHistoryExport.ts
 *    summarizeBankReconcileHistoryRows) เพื่อยืนยันว่ายอดรวมตรงกับ Bank Statement จริง ไม่มีแถวไหนตกหล่น
 * 3) เพิ่มปุ่ม Export Excel / Export PDF (lib/bankReconcileHistoryExport.ts — เขียนตาม pattern เดียวกับ
 *    lib/reportExport.ts ของรายงานภาษีซื้อทุกประการ รวมถึงฝังฟอนต์ Sarabun ใน PDF) และปุ่ม "พิมพ์"
 *    (window.print() ธรรมดา — ครอบเนื้อหาที่ต้องการพิมพ์ด้วย class "printable-area" ตาม print utility
 *    ใหม่ใน app/globals.css ซึ่งซ่อนทุกอย่างนอกเนื้อหานี้ตอนพิมพ์ รวมถึงปุ่มต่างๆ เองด้วย class "no-print")
 *
 * ใช้ getReportDetail() ตัวเดียวกับ BankReconcileLoadedSession.tsx ทุกประการ (ดึงข้อมูลเต็มจาก 4 ตาราง
 * ของฟีเจอร์นี้ผ่าน SWR) แต่ไม่ส่งต่อให้ BankReconcileWorkspace เลย — ประกอบตารางอ่านอย่างเดียวของตัวเองแทน
 */
export default function BankReconcileHistoryDetail({ reportId, onBack, onNavigate }: BankReconcileHistoryDetailProps) {
  const { session } = useAuth();
  const {
    data: detail,
    error: errorObj,
    isLoading: loading,
  } = useSWR(session ? `${RECONCILE_REPORTS_SWR_KEY}/${reportId}` : null, () => getReportDetail(reportId));
  const errorMessage = errorObj instanceof Error ? errorObj.message : errorObj ? 'โหลดข้อมูลไม่สำเร็จ' : null;

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

  // แผนที่ id แถว Bank -> รายละเอียด (description) ของแถว GL ทั้งหมดที่จับคู่อยู่ใน group เดียวกัน (เพิ่มเข้ามา
  // 2026-08-18 ตามคำขอผู้ใช้ — เดิมมีตาราง GL แยกต่างหาก แต่ผู้ใช้อยากให้ตาราง Bank Statement ตารางเดียว
  // แสดงครบทั้ง "จับคู่กับ GL เลขที่" และ "รายละเอียดของ GL" เลย ไม่ต้องมีตาราง GL แยก) ใช้ pattern เดียวกับ
  // glDocsByBankRowId ทุกประการ
  const glDescriptionsByBankRowId = useMemo(() => {
    const map = new Map<string, string[]>();
    (detail?.matchGroups ?? []).forEach((group) => {
      const descs = group.glRows.map((row) => row.description || '-');
      group.bankRows.forEach((row) => map.set(row.id, descs));
    });
    return map;
  }, [detail]);

  const bankRows = useMemo(() => detail?.bankRows ?? [], [detail]);

  // ชุดข้อมูลกลางที่ใช้ทั้งแสดงผลในตารางและ export (Excel/PDF) — สร้างครั้งเดียวใช้ร่วมกันเพื่อให้ตัวเลขที่
  // เห็นบนหน้าจอกับในไฟล์ที่ export ตรงกันเป๊ะเสมอ ไม่มีทางคำนวณเพี้ยนไปคนละทางกัน
  const exportRows: BankReconcileHistoryExportRow[] = useMemo(
    () =>
      bankRows.map((row) => ({
        date: row.date,
        type: row.type,
        amount: row.amount,
        glDocumentNos: glDocsByBankRowId.get(row.id) ?? [],
      })),
    [bankRows, glDocsByBankRowId]
  );
  const totals = useMemo(() => summarizeBankReconcileHistoryRows(exportRows), [exportRows]);

  const summary: ReconcileSummary | null = detail
    ? {
        bankCount: detail.report.bank_row_count,
        glCount: detail.report.gl_row_count,
        matchedCount: detail.report.matched_group_count,
        bankUnmatchedCount: detail.report.bank_unmatched_count,
        glUnmatchedCount: detail.report.gl_unmatched_count,
      }
    : null;

  const reportLabel = detail
    ? `${detail.report.report_name} (${thaiMonthName(detail.report.period_month)} ${detail.report.period_year})`
    : '';

  function handleExportExcel() {
    if (!detail) return;
    const blob = buildBankReconcileHistoryExcelBlob(exportRows, totals, reportLabel);
    downloadBlob(blob, `${detail.report.report_name}.xlsx`);
  }

  function handleExportPdf() {
    if (!detail) return;
    const blob = buildBankReconcileHistoryPdfBlob(exportRows, totals, reportLabel);
    downloadBlob(blob, `${detail.report.report_name}.pdf`);
  }

  function handlePrint() {
    window.print();
  }

  return (
    <main className="mx-auto w-full max-w-[112rem] flex-1 px-4 py-6 sm:px-10" data-testid="reconcile-history-detail">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="btn-press flex items-center gap-1.5 rounded-[10px] border border-border bg-white/8 px-3.5 py-2 text-sm font-medium text-text hover:bg-white/15"
          data-testid="reconcile-history-detail-back"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          กลับไปหน้ารายการ
        </button>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={!detail || bankRows.length === 0}
            className="btn-press flex items-center gap-1.5 rounded-[10px] border border-border bg-white/8 px-3.5 py-2 text-sm font-medium text-text hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="reconcile-history-detail-export-excel"
          >
            <FileSpreadsheet size={16} aria-hidden="true" />
            Export Excel
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={!detail || bankRows.length === 0}
            className="btn-press flex items-center gap-1.5 rounded-[10px] border border-border bg-white/8 px-3.5 py-2 text-sm font-medium text-text hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="reconcile-history-detail-export-pdf"
          >
            <FileText size={16} aria-hidden="true" />
            Export PDF
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={!detail || bankRows.length === 0}
            className="btn-press flex items-center gap-1.5 rounded-[10px] border border-border bg-white/8 px-3.5 py-2 text-sm font-medium text-text hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="reconcile-history-detail-print"
          >
            <Printer size={16} aria-hidden="true" />
            พิมพ์
          </button>
          {/* ปุ่มเสริม — เผื่อผู้ใช้ต้องการแก้ไขจริงๆ (อัปโหลดไฟล์ใหม่/จับคู่เองเพิ่ม/เปลี่ยนสถานะ) ไม่ใช่แค่ดู
              เท่านั้น ใช้เส้นทางเดิมของโปรเจกต์ (NavIntent 'open-reconcile-report') พาไปหน้า "Bank Reconcile"
              เต็มรูปแบบ ไม่แสดงเลยถ้าไม่ได้ส่ง onNavigate มา */}
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
        // printable-area — ดู @media print ใน app/globals.css: กด "พิมพ์" แล้วซ่อนทุกอย่างนอก div นี้
        // (Sidebar/Header/ปุ่มลอยผู้ช่วย AI/ปุ่มต่างๆ ด้านบนที่มี class "no-print") เหลือแค่หัวรายงาน +
        // การ์ดสรุป + ตาราง + แผงตรวจสอบยอด
        <div className="printable-area">
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
              <div className="card-surface mb-6 overflow-x-auto rounded-2xl">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead className="sticky top-0 z-10 bg-card-bg/90 backdrop-blur-sm">
                    <tr>
                      <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">วันที่</th>
                      <th className="px-3.5 py-2.5 text-right font-medium text-text-sub">รับ</th>
                      <th className="px-3.5 py-2.5 text-right font-medium text-text-sub">จ่าย</th>
                      {/* รายละเอียด (เพิ่มเข้ามา 2026-08-17 ตามคำขอผู้ใช้) — ดึงจาก BankTransaction.description
                          (อาจว่างได้ถ้าไฟล์ต้นฉบับไม่มีคอลัมน์นี้ — แสดง "-" แทน) */}
                      <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">รายละเอียด</th>
                      <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">จับคู่กับ GL เลขที่</th>
                      <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">รายละเอียด GL</th>
                      <th className="px-3.5 py-2.5 text-left font-medium whitespace-nowrap text-text-sub">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {bankRows.map((row) => {
                      const docs = glDocsByBankRowId.get(row.id);
                      const glDescriptions = glDescriptionsByBankRowId.get(row.id);
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
                          <td className="px-3.5 py-2.5 text-text-sub" data-testid={`reconcile-history-detail-bank-description-${row.id}`}>
                            {row.description || '-'}
                          </td>
                          <td className="px-3.5 py-2.5 text-text-sub" data-testid={`reconcile-history-detail-gldoc-${row.id}`}>
                            {docs ? docs.join(', ') : '-'}
                          </td>
                          <td className="px-3.5 py-2.5 text-text-sub" data-testid={`reconcile-history-detail-gl-description-${row.id}`}>
                            {glDescriptions ? glDescriptions.join(', ') : '-'}
                          </td>
                          <td className="px-3.5 py-2.5 whitespace-nowrap">
                            {docs ? (
                              <span className="whitespace-nowrap rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success">
                                จับคู่สำเร็จ
                              </span>
                            ) : (
                              <span className="whitespace-nowrap rounded-full bg-danger/15 px-2.5 py-1 text-xs font-medium text-danger">
                                ยังไม่จับคู่
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-primary-light">
                    <tr>
                      <td className="px-3.5 py-2.5 text-sm font-bold text-text">
                        รวมทั้งสิ้น ({bankRows.length.toLocaleString('th-TH')} รายการ)
                      </td>
                      <td
                        className="font-numeric px-3.5 py-2.5 text-right text-sm font-bold text-primary"
                        data-testid="reconcile-history-detail-total-receive"
                      >
                        {totals.totalReceive.toLocaleString('th-TH', THB2)}
                      </td>
                      <td
                        className="font-numeric px-3.5 py-2.5 text-right text-sm font-bold text-primary"
                        data-testid="reconcile-history-detail-total-payment"
                      >
                        {totals.totalPayment.toLocaleString('th-TH', THB2)}
                      </td>
                      <td colSpan={4} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          {bankRows.length > 0 && (
            <section
              className="card-surface rounded-2xl p-4"
              data-testid="reconcile-history-detail-reconcile-check"
            >
              <h3 className="mb-3 text-sm font-bold text-text">ตรวจสอบยอด — เทียบกับ Bank Statement</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-semibold text-text-sub">
                      <th className="py-1.5 pr-4"></th>
                      <th className="py-1.5 pr-4 text-right">รับ</th>
                      <th className="py-1.5 text-right">จ่าย</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    <tr>
                      <td className="py-1.5 pr-4 font-medium text-text">Bank Statement (ทั้งหมด)</td>
                      <td className="font-numeric py-1.5 pr-4 text-right font-semibold text-text">
                        {totals.totalReceive.toLocaleString('th-TH', THB2)}
                      </td>
                      <td className="font-numeric py-1.5 text-right font-semibold text-text">
                        {totals.totalPayment.toLocaleString('th-TH', THB2)}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5 pr-4 text-text-sub">กระทบยอดสำเร็จ</td>
                      <td className="font-numeric py-1.5 pr-4 text-right text-success">
                        {totals.matchedReceive.toLocaleString('th-TH', THB2)}
                      </td>
                      <td className="font-numeric py-1.5 text-right text-success">
                        {totals.matchedPayment.toLocaleString('th-TH', THB2)}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5 pr-4 text-text-sub">ยังไม่จับคู่</td>
                      <td className="font-numeric py-1.5 pr-4 text-right text-danger">
                        {totals.unmatchedReceive.toLocaleString('th-TH', THB2)}
                      </td>
                      <td className="font-numeric py-1.5 text-right text-danger">
                        {totals.unmatchedPayment.toLocaleString('th-TH', THB2)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-xs text-success" data-testid="reconcile-history-detail-check-note">
                <CheckCircle2 size={14} aria-hidden="true" />
                กระทบยอดสำเร็จ + ยังไม่จับคู่ ตรงกับยอดรวม Bank Statement ทั้งหมดครบทุกแถว
              </p>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
