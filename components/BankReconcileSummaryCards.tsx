import { Banknote, BookText, CheckCircle2, FileWarning, XCircle, type LucideIcon } from 'lucide-react';
import type { ReconcileSummary } from '@/types/bankReconcile';

interface BankReconcileSummaryCardsProps {
  summary: ReconcileSummary;
}

/** การ์ดสรุปผลกระทบยอด 5 ใบ แสดงเหนือทั้ง 3 sections เสมอ — ใช้ grid pattern เดียวกับการ์ด KPI ใน
 * OverduePurchaseTaxReport.tsx (grid-cols-2 → sm:3 → lg:5) เพราะมี 5 การ์ดพอดีเช่นเดียวกัน */
export default function BankReconcileSummaryCards({ summary }: BankReconcileSummaryCardsProps) {
  const cards: Array<{ id: string; label: string; value: number; icon: LucideIcon; iconBg: string; iconColor: string }> = [
    {
      id: 'bank-count',
      label: 'Bank Statement',
      value: summary.bankCount,
      icon: Banknote,
      iconBg: 'bg-primary-light',
      iconColor: 'text-primary',
    },
    {
      id: 'gl-count',
      label: 'GL',
      value: summary.glCount,
      icon: BookText,
      iconBg: 'bg-violet-100',
      iconColor: 'text-violet-600',
    },
    {
      id: 'matched-count',
      label: 'กระทบยอดสำเร็จ',
      value: summary.matchedCount,
      icon: CheckCircle2,
      iconBg: 'bg-success/15',
      iconColor: 'text-success',
    },
    {
      id: 'bank-unmatched-count',
      label: 'Bank Statement ไม่สำเร็จ',
      value: summary.bankUnmatchedCount,
      icon: FileWarning,
      iconBg: 'bg-warning/15',
      iconColor: 'text-warning',
    },
    {
      id: 'gl-unmatched-count',
      label: 'GL ไม่สำเร็จ',
      value: summary.glUnmatchedCount,
      icon: XCircle,
      iconBg: 'bg-danger/15',
      iconColor: 'text-danger',
    },
  ];

  return (
    <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5" data-testid="bank-reconcile-summary-cards">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <div key={c.id} className="card-surface card-hover-lift rounded-2xl p-6" data-testid={`bank-reconcile-summary-${c.id}`}>
            <div className={`flex h-11 w-11 items-center justify-center rounded-full ${c.iconBg} ${c.iconColor}`}>
              <Icon size={20} aria-hidden="true" />
            </div>
            <p className="font-numeric mt-4 text-2xl font-bold text-text">{c.value.toLocaleString('th-TH')}</p>
            <p className="mt-1 text-xs text-text-sub">{c.label}</p>
          </div>
        );
      })}
    </div>
  );
}
