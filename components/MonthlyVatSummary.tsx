import type { MonthlyVatSummaryRow } from '@/lib/invoiceLogic';
import { formatMonthLabel } from '@/lib/thaiDate';

const THB = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface MonthlyVatSummaryProps {
  rows: MonthlyVatSummaryRow[];
}

export default function MonthlyVatSummary({ rows }: MonthlyVatSummaryProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-400">
        ยังไม่มีข้อมูล
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">เดือน</th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">VAT ค้างรับ (บาท)</th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">VAT ได้รับแล้ว (บาท)</th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">รวม VAT (บาท)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row) => (
            <tr key={row.month} data-testid={`vat-month-row-${row.month}`}>
              <td className="px-4 py-3 font-medium text-gray-900">{formatMonthLabel(row.month)}</td>
              <td className="px-4 py-3 text-right text-orange-600" data-testid={`vat-pending-${row.month}`}>
                {THB.format(row.vatPending)}
              </td>
              <td className="px-4 py-3 text-right text-green-600" data-testid={`vat-received-${row.month}`}>
                {THB.format(row.vatReceived)}
              </td>
              <td className="px-4 py-3 text-right font-medium text-gray-900">
                {THB.format(row.vatPending + row.vatReceived)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
