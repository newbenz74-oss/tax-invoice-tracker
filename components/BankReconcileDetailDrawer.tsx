'use client';

import { X } from 'lucide-react';
import type { MatchGroup, ReconcileRow } from '@/types/bankReconcile';
import { MATCH_STATUS_BADGE_CLASS, MATCH_STATUS_LABELS } from '@/lib/bankReconcileMatchLogic';
import { getRowNote } from '@/lib/bankReconcileManualMatch';
import { formatGroupSummary, MATCH_TYPE_LABELS } from '@/lib/bankReconcileManualMatchLogic';

const THB2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** matched_at/reviewed_at เป็น ISO datetime จริง (มีเวลาที่มีความหมาย) ต่างจาก formatDate ด้านบนซึ่งจงใจไม่ผ่าน
 * Date object เพื่อเลี่ยง timezone shift ของวันที่ปฏิทินล้วนๆ — ดูหมายเหตุเดียวกันใน
 * BankReconcileGroupDetailDrawer.tsx (คัดลอกมาตามธรรมเนียม private ต่อไฟล์ของโปรเจกต์) */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

function money(n: number): string {
  return n.toLocaleString('th-TH', THB2);
}

interface BankReconcileDetailDrawerProps {
  /** เดิมรับ BankMatchResult ของเฟส 2 — เปลี่ยนเป็น ReconcileRow ของเฟส 3 (superset โครงสร้างเดียวกันทุก field
   * เดิม + field ใหม่ matchedGLRows/matchGroup/reviewFlag/note) เพื่อให้แสดงข้อมูลการยืนยันด้วยตนเองได้ด้วย —
   * ทุก field เดิมที่ใช้อยู่แล้ว (bank/status/matchedGL/amountDifference/...) ยังอยู่ครบ ไม่มีการลบ/เปลี่ยนชื่อ
   * field ใดๆ เลย จึงเป็นการเพิ่มเติมล้วนๆ ไม่ใช่การเขียนใหม่ */
  result: ReconcileRow;
  /** เปิด Group Detail Drawer ต่อ (เฉพาะตอนแถวนี้เป็นส่วนหนึ่งของกลุ่มจับคู่ด้วยตนเองแล้วเท่านั้น) — optional
   * เพราะ component นี้ต้องยังใช้งานได้เองแม้ผู้เรียกยังไม่พร้อมรองรับ Group Detail Drawer ก็ตาม */
  onViewGroup?: (group: MatchGroup) => void;
  onClose: () => void;
}

/**
 * Modal อ่านอย่างเดียวสำหรับปุ่ม "ดูรายละเอียด" — เทียบข้อมูล Bank กับ GL ที่จับคู่แล้ว (ถ้ามี) พร้อมสรุป
 * ผลเปรียบเทียบ (ยอด/ผลต่าง/วันที่ต่างกัน/คะแนน/เหตุผล/สถานะ) มิเรอร์สไตล์ + DetailField pattern จาก
 * OverdueInvoiceDetailModal.tsx เป๊ะ (modal เดิมของระบบ ไม่สร้างรูปแบบ interaction ใหม่)
 *
 * ส่วนที่เพิ่มเข้ามาในเฟส 3 (ทั้งหมดเป็นการเพิ่มเติมแบบมีเงื่อนไขเท่านั้น ไม่แก้พฤติกรรมเดิมของเฟส 2 แม้แต่จุด
 * เดียวเมื่อแถวนั้นไม่มีข้อมูลเฟส 3 เลย): แสดง GL หลายแถวเมื่อเป็นกลุ่ม 1:หลาย (matchedGLRows.length > 1 — เดิม
 * เฟส 2 มีแค่ matchedGL เดี่ยว แสดงไม่ครบถ้าเป็นกลุ่ม), ข้อมูลการยืนยันด้วยตนเอง (ประเภท/ผู้ยืนยัน/วันที่/ลิงก์
 * ไปยัง Group Detail Drawer), หมายเหตุ (ผ่าน getRowNote ซึ่งรวมทั้ง RowNote เดี่ยวและ MatchGroup.note ให้แล้ว),
 * และเครื่องหมาย "ต้องตรวจสอบ" ถ้ามี
 */
export default function BankReconcileDetailDrawer({ result, onViewGroup, onClose }: BankReconcileDetailDrawerProps) {
  const { bank, matchedGL, matchedGLRows } = result;
  const noteText = getRowNote(result);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`รายละเอียดรายการ ${bank.bank_description || ''}`}
      data-testid="reconcile-detail-modal"
    >
      <div
        className="card-surface max-h-[calc(100vh-48px)] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-text">รายละเอียดรายการกระทบยอด</h3>
            <p className="mt-0.5 text-sm text-text-sub">{bank.bank_description || '-'}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-text-sub hover:bg-page-bg"
            aria-label="ปิด"
            data-testid="reconcile-detail-close"
          >
            <X size={18} />
          </button>
        </div>

        <span
          className={`inline-block w-fit rounded-full px-3.5 py-2 text-xs font-medium ${MATCH_STATUS_BADGE_CLASS[result.status]}`}
        >
          {MATCH_STATUS_LABELS[result.status]}
        </span>

        <h4 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-text-sub">Bank Statement</h4>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          <DetailField label="วันที่" value={formatDate(bank.bank_date)} numeric />
          <DetailField label="รายละเอียด" value={bank.bank_description || '-'} span />
          <DetailField label="เงินเข้า" value={`${money(bank.bank_money_in)} บาท`} numeric />
          <DetailField label="เงินออก" value={`${money(bank.bank_money_out)} บาท`} numeric />
          <DetailField label="ยอดสุทธิ" value={`${money(bank.bank_amount)} บาท`} numeric />
          <DetailField label="ยอดคงเหลือ" value={`${money(bank.bank_balance)} บาท`} numeric />
        </dl>

        <h4 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-text-sub">GL จากระบบ Express</h4>
        {matchedGLRows.length === 0 ? (
          <p className="text-sm text-text-sub" data-testid="reconcile-detail-no-gl">
            ยังไม่มี GL ที่จับคู่ยืนยันแล้วสำหรับรายการนี้
          </p>
        ) : matchedGLRows.length === 1 ? (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            <DetailField label="วันที่" value={formatDate((matchedGL ?? matchedGLRows[0]).gl_date)} numeric />
            <DetailField label="เลขที่เอกสาร" value={(matchedGL ?? matchedGLRows[0]).gl_document_no || '-'} />
            <DetailField label="รายละเอียด" value={(matchedGL ?? matchedGLRows[0]).gl_description || '-'} span />
            <DetailField label="เดบิต" value={`${money((matchedGL ?? matchedGLRows[0]).gl_debit)} บาท`} numeric />
            <DetailField label="เครดิต" value={`${money((matchedGL ?? matchedGLRows[0]).gl_credit)} บาท`} numeric />
            <DetailField label="ยอดสุทธิ" value={`${money((matchedGL ?? matchedGLRows[0]).gl_amount)} บาท`} numeric />
          </dl>
        ) : (
          // แถวนี้เป็นส่วนหนึ่งของกลุ่ม 1 Bank : หลาย GL — matchedGL เดี่ยวไม่พอสื่อความหมาย แสดงเป็นตารางแทน
          <div className="card-surface overflow-auto rounded-xl" data-testid="reconcile-detail-gl-group-table">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-table-header">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-text-sub">วันที่</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-text-sub">เลขที่เอกสาร</th>
                  <th className="min-w-[140px] px-3 py-2 text-left text-xs font-semibold text-text-sub">รายละเอียด</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-text-sub">ยอดสุทธิ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {matchedGLRows.map((g) => (
                  <tr key={g.gl_row_id}>
                    <td className="font-numeric px-3 py-2 text-text-sub">{formatDate(g.gl_date)}</td>
                    <td className="px-3 py-2 text-text-sub">{g.gl_document_no || '-'}</td>
                    <td className="px-3 py-2 text-text">{g.gl_description || '-'}</td>
                    <td className="font-numeric px-3 py-2 text-right font-semibold text-text">{money(g.gl_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h4 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-text-sub">เปรียบเทียบ</h4>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          <DetailField label="ยอด Bank" value={`${money(bank.bank_amount)} บาท`} numeric />
          <DetailField
            label="ยอด GL"
            value={matchedGLRows.length === 0 ? '-' : `${money(matchedGLRows.reduce((s, g) => s + g.gl_amount, 0))} บาท`}
            numeric
          />
          <DetailField
            label="ผลต่าง"
            value={result.amountDifference === null ? '-' : `${money(result.amountDifference)} บาท`}
            numeric
          />
          <DetailField
            label="วันที่ต่างกัน"
            value={result.dateDifferenceDays === null ? '-' : `${result.dateDifferenceDays} วัน`}
            numeric
          />
          <DetailField label="คะแนนจับคู่" value={result.matchScore === null ? '-' : String(result.matchScore)} numeric />
          <DetailField label="สถานะ" value={MATCH_STATUS_LABELS[result.status]} />
          <DetailField label="เหตุผลในการจับคู่" value={result.matchReason} span />
        </dl>

        {result.matchGroup && (
          <>
            <h4 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-text-sub">ข้อมูลการยืนยันด้วยตนเอง</h4>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <DetailField label="ประเภทการจับคู่" value={MATCH_TYPE_LABELS[result.matchGroup.match_type]} />
              <DetailField label="กลุ่มการจับคู่" value={formatGroupSummary(result.matchGroup)} />
              <DetailField label="ผู้ยืนยัน" value={result.matchGroup.matched_by || '-'} />
              <DetailField label="วันที่ยืนยัน" value={formatDateTime(result.matchGroup.matched_at)} numeric />
            </dl>
            {onViewGroup && (
              <button
                type="button"
                onClick={() => onViewGroup(result.matchGroup!)}
                className="btn-press mt-3 rounded-[10px] border border-border bg-white px-3.5 py-2 text-xs font-medium text-text-sub hover:bg-page-bg"
                data-testid="reconcile-detail-view-group"
              >
                ดูรายละเอียดกลุ่ม
              </button>
            )}
          </>
        )}

        {noteText && (
          <>
            <h4 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-text-sub">หมายเหตุ</h4>
            <p className="rounded-xl border border-border bg-page-bg p-3 text-sm text-text" data-testid="reconcile-detail-note">
              {noteText}
            </p>
          </>
        )}

        {result.reviewFlag && (
          <p className="mt-4 text-xs font-medium text-warning" data-testid="reconcile-detail-review-flag">
            ทำเครื่องหมาย &quot;ต้องตรวจสอบ&quot; โดย {result.reviewFlag.reviewed_by} เมื่อ{' '}
            {formatDateTime(result.reviewFlag.reviewed_at)}
          </p>
        )}

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="btn-press rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-text-sub hover:bg-page-bg"
          >
            ปิด
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
