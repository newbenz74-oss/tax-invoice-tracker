import { ArrowRight } from 'lucide-react';
import type { MonthlyVatSummaryRow } from '@/lib/invoiceLogic';
import { formatMonthLabel } from '@/lib/thaiDate';

const THB = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface MonthlyVatSummaryProps {
  rows: MonthlyVatSummaryRow[];
  // เสริมใหม่ (optional): ให้การ์ดนี้พาไปหน้า "รายงานภาษีซื้อ" ได้เอง ผ่านปุ่ม "ดูรายงานทั้งหมด →"
  // ไม่ส่ง prop นี้มาก็ยังใช้งานได้ปกติ (ปุ่มจะไม่แสดง) ไม่กระทบ logic การคำนวณ VAT ใดๆ ทั้งสิ้น
  onViewAllReport?: () => void;
}

export default function MonthlyVatSummary({ rows, onViewAllReport }: MonthlyVatSummaryProps) {
  return (
    <div className="card-surface overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between gap-3 bg-linear-to-r from-sidebar-start to-sidebar-end px-6 py-4">
        <h2 className="text-sm font-bold text-white">สรุป VAT รายเดือน</h2>
        {onViewAllReport && (
          <button
            type="button"
            onClick={onViewAllReport}
            className="btn-press flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs font-medium text-white/90 transition-colors duration-[250ms] hover:bg-white/10 hover:text-white"
          >
            ดูรายงานทั้งหมด
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="p-8 text-center text-sm text-text-sub">ยังไม่มีข้อมูล</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-table-header">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-semibold text-text-sub">เดือน</th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-text-sub">VAT ค้างรับ (บาท)</th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-text-sub">VAT ได้รับแล้ว (บาท)</th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-text-sub">รวม VAT (บาท)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((row, index) => (
                <tr
                  key={row.month}
                  data-testid={`vat-month-row-${row.month}`}
                  className={`transition-colors duration-150 hover:bg-table-row-hover ${
                    index % 2 === 1 ? 'bg-table-row-zebra' : ''
                  }`}
                >
                  <td className="px-6 py-4 font-medium text-text">{formatMonthLabel(row.month)}</td>
                  <td
                    className="font-numeric px-6 py-4 text-right font-medium text-warning"
                    data-testid={`vat-pending-${row.month}`}
                  >
                    {THB.format(row.vatPending)}
                  </td>
                  <td
                    className="font-numeric px-6 py-4 text-right font-medium text-success"
                    data-testid={`vat-received-${row.month}`}
                  >
                    {THB.format(row.vatReceived)}
                  </td>
                  <td className="font-numeric px-6 py-4 text-right font-bold text-primary">
                    {THB.format(row.vatPending + row.vatReceived)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
