import { ArrowDownCircle, ArrowUpCircle, CheckCircle2, FileStack, Landmark, Scale, Search, XCircle } from 'lucide-react';
import type { ReconcileSessionKpi } from '@/types/bankReconcileSession';

const THB2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

function money(n: number): string {
  return n.toLocaleString('th-TH', THB2);
}

interface KpiCardDef {
  key: keyof ReconcileSessionKpi;
  label: string;
  icon: typeof Landmark;
  tone: 'default' | 'success' | 'danger' | 'warning';
  isMoney?: boolean;
}

/** 9 การ์ด KPI ตามลำดับที่สเปกส่วน "13. RECONCILIATION SUMMARY" ระบุไว้เป๊ะ */
const KPI_CARDS: KpiCardDef[] = [
  { key: 'bank_row_count', label: 'รายการ Bank ทั้งหมด', icon: Landmark, tone: 'default' },
  { key: 'found_count', label: 'พบใน GL', icon: CheckCircle2, tone: 'success' },
  { key: 'bank_not_found_count', label: 'ไม่พบใน GL', icon: XCircle, tone: 'danger' },
  { key: 'gl_row_count', label: 'รายการ GL ทั้งหมด', icon: FileStack, tone: 'default' },
  { key: 'gl_not_found_count', label: 'GL ที่ไม่พบใน Bank', icon: Search, tone: 'warning' },
  { key: 'bank_income_total', label: 'ยอดรับเงิน Bank', icon: ArrowDownCircle, tone: 'success', isMoney: true },
  { key: 'bank_payment_total', label: 'ยอดจ่ายเงิน Bank', icon: ArrowUpCircle, tone: 'default', isMoney: true },
  { key: 'income_difference', label: 'ผลต่างรายการรับ', icon: Scale, tone: 'default', isMoney: true },
  { key: 'payment_difference', label: 'ผลต่างรายการจ่าย', icon: Scale, tone: 'default', isMoney: true },
];

const TONE_ICON_CLASS: Record<KpiCardDef['tone'], string> = {
  default: 'bg-primary-light text-primary',
  success: 'bg-success/15 text-success',
  danger: 'bg-danger/15 text-danger',
  warning: 'bg-warning/15 text-warning',
};

/**
 * 9 การ์ด KPI สรุปผลการกระทบยอด (สเปกส่วน "13. RECONCILIATION SUMMARY") — คัดลอกรูปแบบการ์ด KPI เดิมของ
 * ระบบเป๊ะ (grid grid-cols-2 gap-4 sm:grid-cols-3, card-surface card-hover-lift rounded-2xl p-5) ตามที่ระบุ
 * ไว้ในสเปกส่วน "22. UI DESIGN" ("keep current BENZ theme") — ค่าที่แสดงมาจาก kpi ที่ orchestrator คำนวณผ่าน
 * computeReconcileSessionKpi() เสมอ (ไม่คำนวณเองในนี้)
 */
export default function BankReconcileKpiCards({ kpi }: { kpi: ReconcileSessionKpi }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3" data-testid="reconcile-kpi-cards">
      {KPI_CARDS.map(({ key, label, icon: Icon, tone, isMoney }) => {
        const value = kpi[key];
        return (
          <div key={key} className="card-surface card-hover-lift rounded-2xl p-5" data-testid={`reconcile-kpi-${key}`}>
            <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl ${TONE_ICON_CLASS[tone]}`}>
              <Icon size={20} aria-hidden="true" />
            </div>
            <p className="text-xs text-text-sub">{label}</p>
            <p className="font-numeric mt-1 text-xl font-bold text-text">
              {isMoney ? money(value) : value.toLocaleString('th-TH')}
              {isMoney && <span className="ml-1 text-xs font-normal text-text-sub">บาท</span>}
            </p>
          </div>
        );
      })}
    </div>
  );
}
