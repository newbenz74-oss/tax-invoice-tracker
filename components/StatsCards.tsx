import type { InvoiceStats } from '@/lib/invoiceLogic';
import { Banknote, CalendarX, CheckCircle2, Clock, Receipt, type LucideIcon } from 'lucide-react';

const THB = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function StatsCards({ stats }: { stats: InvoiceStats }) {
  const cards: Array<{
    id: string;
    label: string;
    value: string | number;
    icon: LucideIcon;
    iconBg: string;
    iconColor: string;
  }> = [
    {
      id: 'pending',
      label: 'รอรับใบกำกับภาษี',
      value: stats.totalPending,
      icon: Clock,
      iconBg: 'bg-warning/15',
      iconColor: 'text-warning',
    },
    {
      id: 'pending-amount',
      label: 'ยอดรวมที่รอรับ (บาท)',
      value: THB.format(stats.totalPendingAmount),
      icon: Banknote,
      iconBg: 'bg-brand/15',
      iconColor: 'text-brand',
    },
    {
      id: 'pending-vat',
      label: 'VAT ที่รอรับ (บาท)',
      value: THB.format(stats.totalPendingVat),
      icon: Receipt,
      iconBg: 'bg-violet-100',
      iconColor: 'text-violet-600',
    },
    {
      id: 'overdue',
      label: 'เกินกำหนด',
      value: stats.totalOverdue,
      icon: CalendarX,
      iconBg: 'bg-danger/15',
      iconColor: 'text-danger',
    },
    {
      id: 'received',
      label: 'ได้รับแล้ว',
      value: stats.totalReceived,
      icon: CheckCircle2,
      iconBg: 'bg-success/15',
      iconColor: 'text-success',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <div
            key={c.id}
            className="card-surface card-hover-lift rounded-2xl p-6"
            data-testid={`stat-${c.id}`}
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
  );
}
