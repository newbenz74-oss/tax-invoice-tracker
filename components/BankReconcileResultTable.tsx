'use client';

import { CheckCheck, Flag, GitMerge, Link2, StickyNote, Unlink, type LucideIcon } from 'lucide-react';
import type { MatchGLRow, MatchGroup, ReconcileRow } from '@/types/bankReconcile';
import { MATCH_STATUS_BADGE_CLASS, MATCH_STATUS_LABELS } from '@/lib/bankReconcileMatchLogic';
import { getRowNote } from '@/lib/bankReconcileManualMatch';
import { formatGroupSummary, MATCH_TYPE_LABELS } from '@/lib/bankReconcileManualMatchLogic';

const THB2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** matched_at เป็น ISO datetime จริง — ดูหมายเหตุเดียวกันใน BankReconcileGroupDetailDrawer.tsx (คัดลอกตาม
 * ธรรมเนียม private ต่อไฟล์) */
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

function formatMoney(n: number): string {
  return n.toLocaleString('th-TH', THB2);
}

/** สรุปฝั่ง GL ของแถวหนึ่งแถวสำหรับแสดงในคอลัมน์ GL เดิม 4 คอลัมน์ (วันที่/เลขที่เอกสาร/รายละเอียด/ยอด) —
 * กรณีปกติ (0 หรือ 1 แถว GL) แสดงเหมือนเฟส 2 ทุกประการ กรณีเป็นกลุ่ม 1 Bank : หลาย GL (matchedGLRows.length > 1)
 * ไม่มี "วันที่ GL" เดียวที่มีความหมาย (หลายวันที่ต่างกัน) จึงแสดง "-" และสรุปเลขที่เอกสาร/รายละเอียดแบบย่อ +
 * ยอดรวมแทน รายละเอียดเต็มดูได้ที่ "ดูรายละเอียด"/"ดูรายละเอียดกลุ่ม" เสมอ */
function summarizeGL(rows: MatchGLRow[]): { date: string; docNo: string; description: string; amount: string } {
  if (rows.length === 0) return { date: '-', docNo: '-', description: '-', amount: '-' };
  if (rows.length === 1) {
    const g = rows[0];
    return {
      date: formatDate(g.gl_date),
      docNo: g.gl_document_no || '-',
      description: g.gl_description || '-',
      amount: formatMoney(g.gl_amount),
    };
  }
  const total = rows.reduce((sum, g) => sum + g.gl_amount, 0);
  return {
    date: '-',
    docNo: `หลายรายการ (${rows.length})`,
    description: rows.map((g) => g.gl_document_no || g.gl_description || '-').join(', '),
    amount: formatMoney(total),
  };
}

interface BankReconcileResultTableProps {
  /** ผลลัพธ์ที่ผ่านตัวกรอง (Segmented Control + search + filters) มาแล้ว — ตารางนี้แสดงตรงๆ ไม่กรองซ้ำเอง
   * เปลี่ยนจาก BankMatchResult[] ของเฟส 2 เป็น ReconcileRow[] ของเฟส 3 (superset โครงสร้างเดียวกันทุก field
   * เดิม — ดูหมายเหตุที่ ReconcileRow ใน types/bankReconcile.ts) */
  results: ReconcileRow[];
  /** แถว Bank ที่ติ๊กเลือกไว้เพื่อ "รวมรายการ Bank เพื่อจับคู่" (สเปกส่วน 4) — ปุ่มรวมรายการเองอยู่นอกตาราง
   * (ใน BankReconcileResults.tsx) ตารางนี้แค่แสดง/สลับสถานะติ๊กเท่านั้น */
  selectedBankIds: Set<string>;
  onToggleSelect: (bankRowId: string) => void;
  onViewDetail: (row: ReconcileRow) => void;
  onViewCandidates: (row: ReconcileRow) => void;
  onToggleReviewFlag: (row: ReconcileRow) => void;
  onEditNote: (row: ReconcileRow) => void;
  /** เปิด Confirm Suggested Match Dialog (สเปกส่วน 1) — ปุ่มแสดงเฉพาะ status matched_tolerance/pending_review */
  onConfirmSuggested: (row: ReconcileRow) => void;
  /** เปิด Match Drawer แบบ 1 แถว Bank (สเปกส่วน 2) — ปุ่มแสดงเฉพาะ status ambiguous/pending_review/not_found_in_gl */
  onSelectGL: (row: ReconcileRow) => void;
  /** เปิด Undo Confirm Dialog (สเปกส่วน 6) — ปุ่มแสดงเฉพาะแถวที่มี matchGroup แล้ว */
  onUndoMatch: (row: ReconcileRow) => void;
  onViewGroup: (group: MatchGroup) => void;
}

/**
 * ตารางผลลัพธ์การกระทบยอดหลัก — เป็น Bank-based เสมอ (ยาวเท่าจำนวนแถว Bank ที่ผ่านตัวกรองปัจจุบัน) แถว Bank
 * ทุกแถวปรากฏในนี้เสมอแม้ไม่มี GL จับคู่เลยก็ตาม ("Bank Statement must always be the primary source of
 * truth") คอลัมน์ฝั่ง Bank อยู่ก่อนฝั่ง GL เสมอตามสเปก ใช้ sticky header + max-height + overflow-auto
 * (เทคนิคเดียวกับ ExcelImportPanel.tsx) รองรับทั้งแถวจำนวนมากและ horizontal scroll บนจอเล็ก
 *
 * "ลำดับ" (คอลัมน์แรก) ใช้เลขลำดับการแสดงผลจริง (1, 2, 3, ...) ไม่ใช่เลขแถวในไฟล์ต้นฉบับ — ตัดสินใจเองเพราะ
 * ตารางนี้ผ่านการกรอง/ค้นหามาแล้วเสมอ เลขแถวไฟล์เดิมจะมีช่องว่างไม่ต่อเนื่องทำให้ "ลำดับ" ดูสับสนกว่า
 *
 * คอลัมน์/ปุ่มที่เพิ่มเข้ามาในเฟส 3 (สเปกส่วน "11. TABLE UPDATES") ทั้งหมดเป็นการเพิ่มเติมเท่านั้น — testid ของ
 * คอลัมน์/ปุ่มเดิมของเฟส 2 (reconcile-row-*, reconcile-status-*, reconcile-view-detail-*,
 * reconcile-view-candidates-*, reconcile-mark-pending-*, reconcile-flagged-*) คงไว้ทุกตัวอักษรเพื่อไม่ให้
 * e2e test เดิมพัง — ปุ่มใหม่ทั้งหมดใช้ไอคอน+tooltip (title/aria-label) แทนปุ่มข้อความยาว ตามคำแนะนำของสเปก
 * ตรงๆ ("prefer icons/tooltips over long text columns") ยกเว้น "ทำเครื่องหมายรอตรวจสอบ" ที่คงเป็นปุ่มข้อความเดิม
 * ทุกประการ (แค่เปลี่ยนแหล่งข้อมูลจาก flaggedIds Set เดิมมาเป็น row.reviewFlag ของเฟส 3 แทน) เพื่อไม่ให้กระทบ
 * DOM/testid ที่ e2e เดิมอ้างอิงอยู่เลย
 */
export default function BankReconcileResultTable({
  results,
  selectedBankIds,
  onToggleSelect,
  onViewDetail,
  onViewCandidates,
  onToggleReviewFlag,
  onEditNote,
  onConfirmSuggested,
  onSelectGL,
  onUndoMatch,
  onViewGroup,
}: BankReconcileResultTableProps) {
  if (results.length === 0) {
    return (
      <div
        className="rounded-2xl border border-dashed border-border bg-card-bg p-12 text-center text-sm text-text-sub"
        data-testid="reconcile-table-empty"
      >
        ไม่พบรายการในสถานะนี้
      </div>
    );
  }

  return (
    <div className="card-surface max-h-[36rem] overflow-auto rounded-2xl" data-testid="reconcile-result-table">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="sticky top-0 bg-table-header">
          <tr>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-sub">เลือก</th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-sub">ลำดับ</th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-sub">วันที่ Bank</th>
            <th className="min-w-[160px] px-3 py-2.5 text-left text-xs font-semibold text-text-sub">รายละเอียด Bank</th>
            <th className="px-3 py-2.5 text-right text-xs font-semibold text-text-sub">เงินเข้า</th>
            <th className="px-3 py-2.5 text-right text-xs font-semibold text-text-sub">เงินออก</th>
            <th className="px-3 py-2.5 text-right text-xs font-semibold text-text-sub">ยอด Bank</th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-sub">วันที่ GL</th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-sub">เลขที่เอกสาร GL</th>
            <th className="min-w-[160px] px-3 py-2.5 text-left text-xs font-semibold text-text-sub">รายละเอียด GL</th>
            <th className="px-3 py-2.5 text-right text-xs font-semibold text-text-sub">ยอด GL</th>
            <th className="px-3 py-2.5 text-right text-xs font-semibold text-text-sub">ผลต่าง</th>
            <th className="px-3 py-2.5 text-center text-xs font-semibold text-text-sub">วันที่ต่างกัน</th>
            <th className="px-3 py-2.5 text-center text-xs font-semibold text-text-sub">คะแนนจับคู่</th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-sub">สถานะ</th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-sub">กลุ่มจับคู่</th>
            <th className="px-3 py-2.5 text-center text-xs font-semibold text-text-sub">หมายเหตุ</th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-sub">ผู้ยืนยัน</th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-sub">วันที่ยืนยัน</th>
            <th className="px-3 py-2.5 text-right text-xs font-semibold text-text-sub">การจัดการ</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {results.map((r, index) => {
            const id = r.bank.bank_row_id;
            const isFlagged = r.reviewFlag !== null;
            const gl = summarizeGL(r.matchedGLRows);
            const rowNote = getRowNote(r);
            const canConfirmSuggested = r.status === 'matched_tolerance' || r.status === 'pending_review';
            const canSelectGL = r.status === 'ambiguous' || r.status === 'pending_review' || r.status === 'not_found_in_gl';
            return (
              <tr
                key={id}
                data-testid={`reconcile-row-${id}`}
                className="transition-colors duration-150 hover:bg-table-row-hover"
              >
                <td className="px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={selectedBankIds.has(id)}
                    disabled={Boolean(r.matchGroup)}
                    onChange={() => onToggleSelect(id)}
                    title={r.matchGroup ? 'ยกเลิกการจับคู่เดิมก่อนจึงจะรวมรายการนี้ได้' : 'เลือกเพื่อรวมรายการ Bank'}
                    className="h-4 w-4 rounded border-border accent-primary disabled:cursor-not-allowed"
                    aria-label={`เลือกแถว ${r.bank.bank_description || id}`}
                    data-testid={`reconcile-select-${id}`}
                  />
                </td>
                <td className="px-3 py-2.5 text-text-sub">{index + 1}</td>
                <td className="font-numeric px-3 py-2.5 text-text-sub">{formatDate(r.bank.bank_date)}</td>
                <td className="px-3 py-2.5 text-text">{r.bank.bank_description || '-'}</td>
                <td className="font-numeric px-3 py-2.5 text-right text-text-sub">{formatMoney(r.bank.bank_money_in)}</td>
                <td className="font-numeric px-3 py-2.5 text-right text-text-sub">{formatMoney(r.bank.bank_money_out)}</td>
                <td
                  className={`font-numeric px-3 py-2.5 text-right font-semibold ${
                    r.bank.bank_amount < 0 ? 'text-danger' : 'text-success'
                  }`}
                  data-testid={`reconcile-bank-amount-${id}`}
                >
                  {formatMoney(r.bank.bank_amount)}
                </td>
                <td className="font-numeric px-3 py-2.5 text-text-sub">{gl.date}</td>
                <td className="px-3 py-2.5 text-text-sub">{gl.docNo}</td>
                <td className="px-3 py-2.5 text-text-sub">{gl.description}</td>
                <td className="font-numeric px-3 py-2.5 text-right text-text-sub">{gl.amount}</td>
                <td className="font-numeric px-3 py-2.5 text-right text-text-sub">
                  {r.amountDifference === null ? '-' : formatMoney(r.amountDifference)}
                </td>
                <td className="font-numeric px-3 py-2.5 text-center text-text-sub">
                  {r.dateDifferenceDays === null ? '-' : `${r.dateDifferenceDays} วัน`}
                </td>
                <td className="font-numeric px-3 py-2.5 text-center text-text-sub">
                  {r.matchScore === null ? '-' : r.matchScore}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-col items-start gap-1">
                    <span
                      className={`inline-block w-fit rounded-full px-3.5 py-2 text-xs font-medium ${MATCH_STATUS_BADGE_CLASS[r.status]}`}
                      data-testid={`reconcile-status-${id}`}
                    >
                      {MATCH_STATUS_LABELS[r.status]}
                    </span>
                    {isFlagged && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2.5 py-1 text-[10px] font-semibold text-warning"
                        data-testid={`reconcile-flagged-${id}`}
                      >
                        <Flag size={10} aria-hidden="true" />
                        ต้องตรวจสอบ
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  {r.matchGroup ? (
                    <button
                      type="button"
                      onClick={() => onViewGroup(r.matchGroup!)}
                      title={MATCH_TYPE_LABELS[r.matchGroup.match_type]}
                      className="btn-press inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/20"
                      data-testid={`reconcile-view-group-${id}`}
                    >
                      <GitMerge size={12} aria-hidden="true" />
                      {formatGroupSummary(r.matchGroup)}
                    </button>
                  ) : (
                    <span className="text-text-sub">-</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-center">
                  <button
                    type="button"
                    onClick={() => onEditNote(r)}
                    title={rowNote || 'เพิ่มหมายเหตุ'}
                    aria-label={rowNote ? 'แก้ไขหมายเหตุ' : 'เพิ่มหมายเหตุ'}
                    className={`btn-press inline-flex h-7 w-7 items-center justify-center rounded-[8px] border ${
                      rowNote ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border text-text-sub hover:bg-page-bg'
                    }`}
                    data-testid={`reconcile-edit-note-${id}`}
                  >
                    <StickyNote size={14} aria-hidden="true" />
                  </button>
                </td>
                <td className="px-3 py-2.5 text-text-sub">{r.matchGroup?.matched_by || '-'}</td>
                <td className="font-numeric px-3 py-2.5 text-text-sub">
                  {r.matchGroup ? formatDateTime(r.matchGroup.matched_at) : '-'}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => onViewDetail(r)}
                      className="btn-press rounded-[10px] border border-border px-2 py-1 text-xs font-medium text-text-sub hover:bg-page-bg"
                      data-testid={`reconcile-view-detail-${id}`}
                    >
                      ดูรายละเอียด
                    </button>
                    <button
                      type="button"
                      onClick={() => onViewCandidates(r)}
                      disabled={r.candidates.length === 0}
                      className="btn-press rounded-[10px] border border-border px-2 py-1 text-xs font-medium text-text-sub hover:bg-page-bg disabled:cursor-not-allowed disabled:opacity-40"
                      data-testid={`reconcile-view-candidates-${id}`}
                    >
                      ดูรายการที่อาจตรงกัน
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleReviewFlag(r)}
                      className={`btn-press rounded-[10px] border px-2 py-1 text-xs font-medium ${
                        isFlagged
                          ? 'border-warning/40 bg-warning/10 text-warning'
                          : 'border-border text-text-sub hover:bg-page-bg'
                      }`}
                      data-testid={`reconcile-mark-pending-${id}`}
                    >
                      {isFlagged ? 'ยกเลิกเครื่องหมาย' : 'ทำเครื่องหมายรอตรวจสอบ'}
                    </button>
                    {canConfirmSuggested && (
                      <IconActionButton
                        icon={CheckCheck}
                        tooltip="ยืนยันว่าตรงกัน"
                        onClick={() => onConfirmSuggested(r)}
                        tone="teal"
                        testId={`reconcile-confirm-suggested-${id}`}
                      />
                    )}
                    {canSelectGL && (
                      <IconActionButton
                        icon={Link2}
                        tooltip="เลือกรายการ GL"
                        onClick={() => onSelectGL(r)}
                        tone="primary"
                        testId={`reconcile-select-gl-${id}`}
                      />
                    )}
                    {r.matchGroup && (
                      <IconActionButton
                        icon={Unlink}
                        tooltip="ยกเลิกการจับคู่"
                        onClick={() => onUndoMatch(r)}
                        tone="danger"
                        testId={`reconcile-undo-match-${id}`}
                      />
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const ICON_BUTTON_TONE_CLASS: Record<'primary' | 'teal' | 'danger', string> = {
  primary: 'border-primary/30 text-primary hover:bg-primary/10',
  teal: 'border-teal-300 text-teal-700 hover:bg-teal-50',
  danger: 'border-danger/30 text-danger hover:bg-danger/10',
};

/** ปุ่มไอคอนขนาดกะทัดรัด+tooltip สำหรับ action ใหม่ของเฟส 3 — ใช้แทนปุ่มข้อความยาวตามคำแนะนำของสเปกส่วน
 * "11. TABLE UPDATES" ("prefer icons/tooltips over long text columns") title = tooltip แบบ native ของ
 * เบราว์เซอร์ (ไม่เพิ่ม component/dependency ใหม่) aria-label ซ้ำข้อความเดียวกันเพื่อการเข้าถึง */
function IconActionButton({
  icon: Icon,
  tooltip,
  onClick,
  tone,
  testId,
}: {
  icon: LucideIcon;
  tooltip: string;
  onClick: () => void;
  tone: 'primary' | 'teal' | 'danger';
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={tooltip}
      aria-label={tooltip}
      className={`btn-press flex h-7 w-7 items-center justify-center rounded-[8px] border bg-white ${ICON_BUTTON_TONE_CLASS[tone]}`}
      data-testid={testId}
    >
      <Icon size={14} aria-hidden="true" />
    </button>
  );
}
