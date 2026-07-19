'use client';

import { useMemo } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { validateManualMatch, type ManualMatchReason } from '@/lib/bankReconcileManualMatch';
import type { BankTransaction, GLTransaction } from '@/types/bankReconcile';

const THB2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

function formatTHB(n: number): string {
  return n.toLocaleString('th-TH', THB2);
}

const HINT_TEXT: Record<ManualMatchReason, string> = {
  ok: 'ยอดรวมทั้งสองฝั่งเท่ากันแล้ว พร้อมยืนยันจับคู่',
  'empty-bank': 'เลือกอย่างน้อย 1 รายการฝั่ง Bank Statement',
  'empty-gl': 'เลือกอย่างน้อย 1 รายการฝั่ง GL',
  'type-mismatch': 'เลือกได้เฉพาะรายการรับกับรับ หรือจ่ายกับจ่ายเท่านั้น ห้ามผสมกัน',
  'amount-mismatch': 'ยอดรวมสองฝั่งยังไม่เท่ากัน',
};

interface BankReconcileManualMatchToolbarProps {
  bankSelection: BankTransaction[];
  glSelection: GLTransaction[];
  onConfirm: () => void;
}

/** แถบเครื่องมือ "จับคู่เอง" — อยู่ระหว่างตาราง Bank ไม่สำเร็จ กับตาราง GL ไม่สำเร็จ แสดงยอดรวมของแถวที่ติ๊ก
 * เลือกไว้ทั้งสองฝั่งแบบสดๆ พร้อมปุ่มยืนยันจับคู่ที่กดได้ก็ต่อเมื่อยอดรวมเท่ากันเท่านั้น (validateManualMatch
 * ใน lib/bankReconcileManualMatch.ts เป็นผู้ตัดสินเงื่อนไขทั้งหมด — component นี้แค่แสดงผลตามนั้น) ไม่แสดง
 * error ผ่าน alert()/confirm() เด็ดขาด (ห้ามใช้ native dialog ทั้งระบบ) ใช้ข้อความ hint ในตัวเองแทนเสมอ */
export default function BankReconcileManualMatchToolbar({
  bankSelection,
  glSelection,
  onConfirm,
}: BankReconcileManualMatchToolbarProps) {
  const validation = useMemo(
    () => validateManualMatch({ bankRows: bankSelection, glRows: glSelection }),
    [bankSelection, glSelection]
  );

  return (
    <div
      className="card-surface mb-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-dashed border-primary/40 p-4"
      data-testid="manual-match-toolbar"
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <div>
          <span className="text-text-sub">เลือกจาก Bank Statement </span>
          <span className="font-numeric font-semibold text-text" data-testid="manual-match-bank-total">
            {bankSelection.length} รายการ ({formatTHB(validation.bankTotal)} บาท)
          </span>
        </div>
        <div>
          <span className="text-text-sub">เลือกจาก GL </span>
          <span className="font-numeric font-semibold text-text" data-testid="manual-match-gl-total">
            {glSelection.length} รายการ ({formatTHB(validation.glTotal)} บาท)
          </span>
        </div>
        <div>
          <span className="text-text-sub">ผลต่าง </span>
          <span
            className={`font-numeric font-semibold ${validation.canConfirm ? 'text-success' : 'text-danger'}`}
            data-testid="manual-match-difference"
          >
            {formatTHB(Math.abs(validation.difference))} บาท
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <p
          className={`text-sm ${validation.canConfirm ? 'text-success' : 'text-text-sub'}`}
          data-testid="manual-match-hint"
        >
          {HINT_TEXT[validation.reason]}
        </p>
        <button
          type="button"
          onClick={onConfirm}
          disabled={!validation.canConfirm}
          className="btn-press flex shrink-0 items-center gap-1.5 rounded-[10px] bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="manual-match-confirm-button"
        >
          <CheckCircle2 size={16} aria-hidden="true" />
          ยืนยันจับคู่
        </button>
      </div>
    </div>
  );
}
