'use client';

import { GitMerge, NotebookPen, Unlink, X } from 'lucide-react';
import type { MatchBankRow, MatchGLRow, MatchGroup } from '@/types/bankReconcile';
import { MATCH_STATUS_BADGE_CLASS, MATCH_STATUS_LABELS } from '@/lib/bankReconcileMatchLogic';
import { MATCH_TYPE_LABELS } from '@/lib/bankReconcileManualMatchLogic';

const THB2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** matched_at เป็น ISO datetime จริง (มีเวลาที่มีความหมาย ต่างจาก bank_date/gl_date ที่เป็นวันที่ปฏิทินล้วนๆ
 * ไม่มีเวลา) จึงแปลงผ่าน Date ตรงๆ ได้ถูกต้อง (แสดงเป็นเวลาท้องถิ่นของผู้ดู ซึ่งเป็นพฤติกรรมที่ถูกต้องสำหรับ
 * timestamp จริง — ต่างจาก formatDate ด้านบนที่จงใจ "ไม่" ผ่าน Date object เพื่อเลี่ยง timezone shift ของ
 * วันที่ปฏิทินล้วนๆ) เขียนปี/เดือน/วันเองแทนการใช้ toLocaleDateString('th-TH') เพื่อการันตีปี ค.ศ. เสมอ (เลี่ยง
 * ความเสี่ยงที่บาง environment จะแปลงเป็นปี พ.ศ. ตาม Thai Buddhist calendar ของ locale th-TH) */
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

interface BankReconcileGroupDetailDrawerProps {
  group: MatchGroup;
  /** แถว Bank/GL ที่ resolve จาก group.bank_transaction_ids/gl_transaction_ids มาแล้ว (ผู้เรียกรับผิดชอบ map
   * id -> แถวจริงเอง เพราะ component นี้ไม่ควรต้องรู้จักแหล่งข้อมูลทั้งหมดของทั้งหน้า) */
  bankRows: MatchBankRow[];
  glRows: MatchGLRow[];
  /** ทั้งสามปุ่มแค่ "ขอ" ให้ orchestrator ทำงานต่อ (เปิด dialog อื่นแทนที่ ไม่ได้ทำเองในนี้) ตามธรรมเนียม
   * onRequestEdit ของ ContactForm.tsx — "แก้ไขการจับคู่" ไม่มี UI แก้ไขสมาชิกกลุ่มแบบ in-place ในเฟสนี้ (ไม่ได้
   * ระบุไว้ชัดเจนในสเปก มีแค่ปุ่มเดียว) orchestrator ตีความเป็น "ยกเลิกกลุ่มเดิมแล้วเปิด Match Drawer ใหม่ให้
   * เลือก GL ใหม่ทันที" (undo + reopen) ซึ่งให้ผลลัพธ์เดียวกับ "แก้ไข" ทุกประการโดยไม่ต้องเพิ่ม edit-mode ใหม่
   * ใน BankReconcileMatchDrawer เลย — เป็นดุลยพินิจที่ตัดสินใจเอง ระบุไว้ในสรุปผล */
  onRequestEditMatch: () => void;
  onRequestUndoMatch: () => void;
  onRequestEditNote: () => void;
  onClose: () => void;
}

/**
 * Drawer แสดงรายละเอียดกลุ่มการจับคู่ด้วยตนเอง (เฟส 3 ส่วน "10. GROUP DETAIL DRAWER") — เปิดจากไอคอนกลุ่มใน
 * ตารางหลัก (สเปกส่วน "9. MATCH GROUPS": "allow opening a Group Detail Drawer") แสดงตาราง Bank/GL ที่อยู่ใน
 * กลุ่มครบทุกแถว + สรุปผล + คงคะแนน/เหตุผลจากระบบอัตโนมัติเดิมไว้ให้ดูด้วยเสมอ (สเปก "Preserve the original
 * automatic score and reason") มิเรอร์สไตล์ + DetailField pattern จาก BankReconcileDetailDrawer.tsx ของเฟส 2
 * เป๊ะ (อ่านอย่างเดียว ไม่มี state ภายในเลย ต่างจาก Match Drawer ที่มี state การเลือก/ค้นหา)
 */
export default function BankReconcileGroupDetailDrawer({
  group,
  bankRows,
  glRows,
  onRequestEditMatch,
  onRequestUndoMatch,
  onRequestEditNote,
  onClose,
}: BankReconcileGroupDetailDrawerProps) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="รายละเอียดกลุ่มการจับคู่"
      data-testid="group-detail-drawer"
    >
      <div
        className="card-surface max-h-[calc(100vh-24px)] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 md:max-h-[calc(100vh-48px)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <GitMerge size={18} aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-base font-bold text-text">รายละเอียดกลุ่มการจับคู่</h3>
              <p className="mt-0.5 text-sm text-text-sub">{MATCH_TYPE_LABELS[group.match_type]}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-text-sub hover:bg-page-bg"
            aria-label="ปิด"
            data-testid="group-detail-close"
          >
            <X size={18} />
          </button>
        </div>

        <span
          className={`inline-block w-fit rounded-full px-3.5 py-2 text-xs font-medium ${MATCH_STATUS_BADGE_CLASS[group.status]}`}
        >
          {MATCH_STATUS_LABELS[group.status]}
        </span>

        <h4 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-text-sub">
          รายการ Bank ({bankRows.length})
        </h4>
        <div className="card-surface overflow-auto rounded-xl">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-table-header">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-text-sub">วันที่</th>
                <th className="min-w-[140px] px-3 py-2 text-left text-xs font-semibold text-text-sub">รายละเอียด</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-text-sub">เงินเข้า</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-text-sub">เงินออก</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-text-sub">ยอดสุทธิ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {bankRows.map((b) => (
                <tr key={b.bank_row_id}>
                  <td className="font-numeric px-3 py-2 text-text-sub">{formatDate(b.bank_date)}</td>
                  <td className="px-3 py-2 text-text">{b.bank_description || '-'}</td>
                  <td className="font-numeric px-3 py-2 text-right text-text-sub">{money(b.bank_money_in)}</td>
                  <td className="font-numeric px-3 py-2 text-right text-text-sub">{money(b.bank_money_out)}</td>
                  <td className="font-numeric px-3 py-2 text-right font-semibold text-text">{money(b.bank_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h4 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-text-sub">
          รายการ GL ({glRows.length})
        </h4>
        <div className="card-surface overflow-auto rounded-xl">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-table-header">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-text-sub">วันที่</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-text-sub">เลขที่เอกสาร</th>
                <th className="min-w-[140px] px-3 py-2 text-left text-xs font-semibold text-text-sub">รายละเอียด</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-text-sub">เดบิต</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-text-sub">เครดิต</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-text-sub">ยอดสุทธิ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {glRows.map((g) => (
                <tr key={g.gl_row_id}>
                  <td className="font-numeric px-3 py-2 text-text-sub">{formatDate(g.gl_date)}</td>
                  <td className="px-3 py-2 text-text-sub">{g.gl_document_no || '-'}</td>
                  <td className="px-3 py-2 text-text">{g.gl_description || '-'}</td>
                  <td className="font-numeric px-3 py-2 text-right text-text-sub">{money(g.gl_debit)}</td>
                  <td className="font-numeric px-3 py-2 text-right text-text-sub">{money(g.gl_credit)}</td>
                  <td className="font-numeric px-3 py-2 text-right font-semibold text-text">{money(g.gl_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h4 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-text-sub">สรุปผล</h4>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-3 rounded-xl border border-border bg-page-bg p-3 sm:grid-cols-2">
          <DetailField label="จำนวนรายการ Bank" value={`${group.bank_transaction_ids.length} รายการ`} numeric />
          <DetailField label="จำนวนรายการ GL" value={`${group.gl_transaction_ids.length} รายการ`} numeric />
          <DetailField label="ยอดรวม Bank" value={`${money(group.bank_total)} บาท`} numeric />
          <DetailField label="ยอดรวม GL" value={`${money(group.gl_total)} บาท`} numeric />
          <DetailField label="ผลต่าง" value={`${money(group.amount_difference)} บาท`} numeric />
          <DetailField label="ประเภทการจับคู่" value={MATCH_TYPE_LABELS[group.match_type]} />
          <DetailField label="ผู้ยืนยัน" value={group.matched_by || '-'} />
          <DetailField label="วันที่ยืนยัน" value={formatDateTime(group.matched_at)} numeric />
          <DetailField label="หมายเหตุ" value={group.note || '-'} span />
        </dl>

        {(group.auto_match_score !== null || group.auto_match_reason !== null) && (
          <>
            <h4 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-text-sub">
              ข้อมูลจากระบบอัตโนมัติเดิม (ก่อนยืนยัน)
            </h4>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-3 rounded-xl border border-border bg-page-bg p-3 sm:grid-cols-2">
              <DetailField
                label="คะแนนจับคู่เดิม"
                value={group.auto_match_score === null ? '-' : String(group.auto_match_score)}
                numeric
              />
              <DetailField label="เหตุผลเดิม" value={group.auto_match_reason || '-'} span />
            </dl>
          </>
        )}

        <div className="mt-6 grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="btn-press rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-text-sub hover:bg-page-bg"
            data-testid="group-detail-dismiss"
          >
            ปิด
          </button>
          <button
            type="button"
            onClick={onRequestEditNote}
            className="btn-press flex items-center justify-center gap-1.5 rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-text-sub hover:bg-page-bg"
            data-testid="group-detail-edit-note"
          >
            <NotebookPen size={15} aria-hidden="true" />
            แก้ไขหมายเหตุ
          </button>
          <button
            type="button"
            onClick={onRequestEditMatch}
            className="btn-press flex items-center justify-center gap-1.5 rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-text-sub hover:bg-page-bg"
            data-testid="group-detail-edit-match"
          >
            <GitMerge size={15} aria-hidden="true" />
            แก้ไขการจับคู่
          </button>
          <button
            type="button"
            onClick={onRequestUndoMatch}
            className="btn-press flex items-center justify-center gap-1.5 rounded-[10px] bg-danger px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-danger/90"
            data-testid="group-detail-undo-match"
          >
            <Unlink size={15} aria-hidden="true" />
            ยกเลิกการจับคู่
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
