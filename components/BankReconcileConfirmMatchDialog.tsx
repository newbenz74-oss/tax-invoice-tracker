'use client';

import { useMemo, useState } from 'react';
import { CheckCheck, X } from 'lucide-react';
import type { MatchGLRow, ReconcileRow } from '@/types/bankReconcile';
import { resolveSuggestedCandidate } from '@/lib/bankReconcileManualMatch';
import { MATCH_STATUS_BADGE_CLASS, MATCH_STATUS_LABELS } from '@/lib/bankReconcileMatchLogic';

const THB2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function money(n: number): string {
  return n.toLocaleString('th-TH', THB2);
}

interface BankReconcileConfirmMatchDialogProps {
  /** ต้องเป็นแถวสถานะ matched_tolerance ("น่าจะตรงกัน") หรือ pending_review ("รอตรวจสอบ") เท่านั้น ตามสเปก
   * ส่วน "1. CONFIRM SUGGESTED MATCH" — ปุ่ม "ยืนยันว่าตรงกัน" ในตารางเปิด dialog นี้เฉพาะสองสถานะนี้เท่านั้น
   * component นี้ไม่ตรวจซ้ำ (ผู้เรียกรับผิดชอบเงื่อนไขการแสดงปุ่มเอง เหมือนที่ Candidates Modal/Detail Drawer
   * ของเฟส 2 ไม่ตรวจสถานะของ result ที่ได้รับมาเช่นกัน) */
  row: ReconcileRow;
  /** ส่ง suggestedGL ที่ dialog ใช้แสดงผลกลับไปด้วยเสมอ (ไม่ใช่แค่ note) เพื่อไม่ให้ผู้เรียกต้องคำนวณซ้ำด้วย
   * resolveSuggestedCandidate เอง (เสี่ยงได้ผลไม่ตรงกันถ้าคำนวณคนละจุด) — ผู้เรียก (BankReconcileResults.tsx)
   * เป็นคนสร้าง MatchGroup จริงผ่าน buildMatchGroup() ต่อจากนี้ (กำหนด matchGroupId/matchedBy/matchedAt เอง) */
  onConfirm: (note: string, suggestedGL: MatchGLRow) => void;
  onClose: () => void;
}

/**
 * Modal ยืนยันรายการที่ระบบแนะนำ (เฟส 3 ส่วน "1. CONFIRM SUGGESTED MATCH") — ใช้กับแถวสถานะ "น่าจะตรงกัน"
 * (matched_tolerance ซึ่งมี matchedGL อยู่แล้วจากเครื่องมือจับคู่อัตโนมัติของเฟส 2) และ "รอตรวจสอบ"
 * (pending_review ซึ่งยังไม่มี matchedGL แต่มี candidates ให้เลือกผู้สมัครที่ดีที่สุดด้วย
 * resolveSuggestedCandidate — ใช้เกณฑ์เดียวกับ pickClosestByDate ที่คำนวณ row.dateDifferenceDays/matchScore/
 * amountDifference ไว้แล้วตั้งแต่ต้น จึงรับประกันว่าเลือก GL ตัวเดียวกันเสมอ ไม่ต้องคำนวณค่าพวกนี้ใหม่ในนี้เลย
 * ใช้ค่าจาก row ตรงๆ ได้ทั้งหมด)
 *
 * แสดงข้อมูลเปรียบเทียบ Bank/GL ครบ + ผลต่างยอดเงิน/วันที่/คะแนน/เหตุผล + หมายเหตุ (ไม่บังคับ เพราะผลต่างยอดเงิน
 * ของทั้งสองสถานะนี้เป็น 0.00 เสมอโดยโครงสร้างข้อมูล — ดู candidates ของ BankMatchResult ที่กรองด้วยยอดเงินตรง
 * กันมาแล้วเท่านั้น ไม่มีทาง amount_difference > 0 ในบริบทนี้ จึงไม่เข้าเกณฑ์ "ต้องมีหมายเหตุ" ของสเปกส่วน
 * MANUAL MATCH VALIDATION ซึ่งบังคับเฉพาะกรณี override ที่มีผลต่างเท่านั้น) แล้วส่ง (note, suggestedGL) กลับผ่าน
 * onConfirm ให้ผู้เรียกเป็นคนสร้าง MatchGroup จริง — dialog นี้เป็น presentation ล้วนๆ ไม่รู้จัก id/เวลา/ผู้ใช้
 * ปัจจุบันเลย เหมือน BankReconcileNoteDialog/BankReconcileUndoConfirmDialog ทุกประการ (ไม่สร้าง pattern ใหม่)
 */
export default function BankReconcileConfirmMatchDialog({ row, onConfirm, onClose }: BankReconcileConfirmMatchDialogProps) {
  const [note, setNote] = useState('');
  const suggestedGL = useMemo(
    () => row.matchedGL ?? resolveSuggestedCandidate(row.bank, row.candidates),
    [row.matchedGL, row.bank, row.candidates]
  );
  const { bank } = row;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="ยืนยันว่าตรงกัน"
      data-testid="confirm-suggested-dialog"
    >
      <div
        className="card-surface max-h-[calc(100vh-48px)] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-700">
              <CheckCheck size={18} aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-base font-bold text-text">ยืนยันว่าตรงกัน</h3>
              <p className="mt-0.5 text-sm text-text-sub">
                ยืนยันว่ารายการ Bank นี้ตรงกับ GL ที่ระบบแนะนำ — หลังยืนยันสถานะจะเปลี่ยนเป็น &quot;ยืนยันด้วยตนเอง&quot;
                และ GL รายการนี้จะถูกล็อกไว้ไม่ให้ใช้ซ้ำ
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-text-sub hover:bg-page-bg"
            aria-label="ปิด"
            data-testid="confirm-suggested-close"
          >
            <X size={18} />
          </button>
        </div>

        <span
          className={`inline-block w-fit rounded-full px-3.5 py-2 text-xs font-medium ${MATCH_STATUS_BADGE_CLASS[row.status]}`}
        >
          {MATCH_STATUS_LABELS[row.status]}
        </span>

        {!suggestedGL ? (
          <div
            className="mt-4 rounded-2xl border border-dashed border-border bg-card-bg p-8 text-center text-sm text-text-sub"
            data-testid="confirm-suggested-no-candidate"
          >
            ไม่พบรายการ GL ที่แนะนำสำหรับแถวนี้
          </div>
        ) : (
          <>
            <h4 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-text-sub">Bank Statement</h4>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-3 rounded-xl border border-border bg-page-bg p-3 sm:grid-cols-2">
              <DetailField label="วันที่" value={formatDate(bank.bank_date)} numeric />
              <DetailField label="รายละเอียด" value={bank.bank_description || '-'} span />
              <DetailField label="เงินเข้า" value={`${money(bank.bank_money_in)} บาท`} numeric />
              <DetailField label="เงินออก" value={`${money(bank.bank_money_out)} บาท`} numeric />
              <DetailField label="ยอดสุทธิ" value={`${money(bank.bank_amount)} บาท`} numeric />
              <DetailField label="ยอดคงเหลือ" value={`${money(bank.bank_balance)} บาท`} numeric />
            </dl>

            <h4 className="mb-2 mt-4 text-xs font-bold uppercase tracking-wide text-text-sub">GL ที่ระบบแนะนำ</h4>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-3 rounded-xl border border-border bg-page-bg p-3 sm:grid-cols-2">
              <DetailField label="วันที่" value={formatDate(suggestedGL.gl_date)} numeric />
              <DetailField label="เลขที่เอกสาร" value={suggestedGL.gl_document_no || '-'} />
              <DetailField label="รายละเอียด" value={suggestedGL.gl_description || '-'} span />
              <DetailField label="เดบิต" value={`${money(suggestedGL.gl_debit)} บาท`} numeric />
              <DetailField label="เครดิต" value={`${money(suggestedGL.gl_credit)} บาท`} numeric />
              <DetailField label="ยอดสุทธิ" value={`${money(suggestedGL.gl_amount)} บาท`} numeric />
            </dl>

            <h4 className="mb-2 mt-4 text-xs font-bold uppercase tracking-wide text-text-sub">สรุปผลการจับคู่</h4>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border bg-page-bg p-3 sm:grid-cols-4">
              <DetailField
                label="ผลต่างยอดเงิน"
                value={row.amountDifference === null ? '-' : `${money(row.amountDifference)} บาท`}
                numeric
              />
              <DetailField
                label="วันที่ต่างกัน"
                value={row.dateDifferenceDays === null ? '-' : `${row.dateDifferenceDays} วัน`}
                numeric
              />
              <DetailField label="คะแนนจับคู่" value={row.matchScore === null ? '-' : String(row.matchScore)} numeric />
              <DetailField label="เหตุผล" value={row.matchReason} span />
            </dl>

            <label className="mt-4 flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-text">หมายเหตุ (ไม่บังคับ)</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="ระบุหมายเหตุ..."
                className="focus-ring-primary rounded-[10px] border border-border bg-white px-3 py-2.5 text-sm text-text"
                data-testid="confirm-suggested-note-input"
              />
            </label>
          </>
        )}

        <div className="mt-6 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="btn-press rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-text-sub hover:bg-page-bg"
            data-testid="confirm-suggested-cancel"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={!suggestedGL}
            onClick={() => suggestedGL && onConfirm(note, suggestedGL)}
            className="btn-press rounded-[10px] bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="confirm-suggested-confirm"
          >
            ยืนยันว่าตรงกัน
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailField({
  label,
  value,
  span,
  numeric,
}: {
  label: string;
  value: string;
  span?: boolean;
  numeric?: boolean;
}) {
  return (
    <div className={span ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs text-text-sub">{label}</dt>
      <dd className={`mt-0.5 text-sm font-medium text-text ${numeric ? 'font-numeric' : ''}`}>{value}</dd>
    </div>
  );
}
