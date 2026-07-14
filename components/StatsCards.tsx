import type { InvoiceStats } from '@/lib/invoiceLogic';

const THB = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function StatsCards({ stats }: { stats: InvoiceStats }) {
  const cards = [
    { id: 'pending', label: 'รอรับใบกำกับภาษี', value: stats.totalPending, accent: 'text-gray-900' },
    { id: 'pending-amount', label: 'ยอดรวมที่รอรับ (บาท)', value: THB.format(stats.totalPendingAmount), accent: 'text-blue-600' },
    { id: 'pending-vat', label: 'VAT ที่รอรับ (บาท)', value: THB.format(stats.totalPendingVat), accent: 'text-purple-600' },
    { id: 'overdue', label: 'เกินกำหนด', value: stats.totalOverdue, accent: 'text-red-600' },
    { id: 'received', label: 'ได้รับแล้ว', value: stats.totalReceived, accent: 'text-green-600' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((c) => (
        <div key={c.id} className="rounded-xl border border-gray-200 bg-white p-4" data-testid={`stat-${c.id}`}>
          <p className="text-xs text-gray-500">{c.label}</p>
          <p className={`mt-1 text-2xl font-bold ${c.accent}`}>{c.value}</p>
        </div>
      ))}
    </div>
  );
}
