'use client';

import { useState } from 'react';
import { Pencil, RotateCcw, X, XCircle } from 'lucide-react';
import { allRowsReadyForReconciliation } from '@/lib/bankReconcileValidation';
import { parseDateCell } from '@/lib/bankReconcileNormalize';
import {
  ROW_DATA_STATUS_BADGE_CLASS,
  ROW_DATA_STATUS_LABELS,
  TRANSACTION_DIRECTION_LABELS,
} from '@/types/bankReconcile';
import type { BankRow, GLRow, RowDataStatus, TransactionDirection } from '@/types/bankReconcile';

const THB2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

/** สถานะข้อมูลของแถวหนึ่งแถว — คำนวณจาก excluded/errors ตรงๆ (ไม่เก็บเป็น field แยกใน BankRow/GLRow เพื่อไม่ให้
 * มีสองแหล่งความจริงที่อาจไม่ตรงกัน — คำนวณสดทุกครั้งจาก state ปัจจุบันของแถวเสมอ) */
function rowDataStatus(row: Pick<BankRow | GLRow, 'excluded' | 'errors'>): RowDataStatus {
  if (row.excluded) return 'excluded';
  return row.errors.length > 0 ? 'invalid' : 'valid';
}

type EditTarget = { kind: 'bank'; row: BankRow } | { kind: 'gl'; row: GLRow };

interface BankReconcilePreviewProps {
  bankRows: BankRow[];
  glRows: GLRow[];
  onBankRowsChange: (rows: BankRow[]) => void;
  onGlRowsChange: (rows: GLRow[]) => void;
  onBack: () => void;
  onStartReconciliation: () => void;
}

/**
 * ขั้นตอน "ตรวจสอบข้อมูลก่อนกระทบยอด" — ไฟล์ใหม่ เพิ่มเข้ามา 2026-07-17 ตามสเปกส่วน "12. PREVIEW BEFORE
 * RECONCILIATION" ใช้ตัวเดียวกันไม่ว่าไฟล์ต้นฉบับจะเป็น Excel/CSV/PDF (ต่างจากที่คิดไว้แต่แรกว่า PDF ต้องมี
 * ขั้นตอนพรีวิวของตัวเองแยกจาก Excel — สเปกฉบับ rebuild นี้ระบุคอลัมน์พรีวิวชุดเดียวใช้ร่วมกันทั้งสามประเภทไฟล์
 * ตรงๆ จึงไม่ต้องแยกโค้ด) แสดงตาราง Bank และ GL แยกกัน แก้ไขค่า/ยกเว้น/กู้คืนแถวได้ ปุ่ม "เริ่มกระทบยอด" เปิดใช้
 * งานได้ก็ต่อเมื่อทุกแถวที่ไม่ถูกยกเว้นผ่านการตรวจสอบแล้วเท่านั้น (allRowsReadyForReconciliation)
 */
export default function BankReconcilePreview({
  bankRows,
  glRows,
  onBankRowsChange,
  onGlRowsChange,
  onBack,
  onStartReconciliation,
}: BankReconcilePreviewProps) {
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

  const bankReady = allRowsReadyForReconciliation(bankRows);
  const glReady = allRowsReadyForReconciliation(glRows);
  const bankIncludedCount = bankRows.filter((r) => !r.excluded).length;
  const glIncludedCount = glRows.filter((r) => !r.excluded).length;
  const canStart = bankReady && glReady && bankIncludedCount > 0;

  function toggleBankExclude(id: string) {
    onBankRowsChange(bankRows.map((r) => (r.id === id ? { ...r, excluded: !r.excluded } : r)));
  }
  function toggleGlExclude(id: string) {
    onGlRowsChange(glRows.map((r) => (r.id === id ? { ...r, excluded: !r.excluded } : r)));
  }

  function saveBankRow(updated: BankRow) {
    onBankRowsChange(bankRows.map((r) => (r.id === updated.id ? updated : r)));
    setEditTarget(null);
  }
  function saveGlRow(updated: GLRow) {
    onGlRowsChange(glRows.map((r) => (r.id === updated.id ? updated : r)));
    setEditTarget(null);
  }

  return (
    <div className="space-y-6" data-testid="bank-reconcile-preview-step">
      <PreviewTable
        title="ตรวจสอบข้อมูล — Bank Statement"
        kind="bank"
        rows={bankRows}
        includedCount={bankIncludedCount}
        onToggleExclude={toggleBankExclude}
        onEdit={(row) => setEditTarget({ kind: 'bank', row })}
        testIdPrefix="bank-review"
      />
      <PreviewTable
        title="ตรวจสอบข้อมูล — GL จากระบบ Express"
        kind="gl"
        rows={glRows}
        includedCount={glIncludedCount}
        onToggleExclude={toggleGlExclude}
        onEdit={(row) => setEditTarget({ kind: 'gl', row })}
        testIdPrefix="gl-review"
      />

      {!canStart && (
        <p
          role="alert"
          className="rounded-[10px] border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-sm text-warning"
          data-testid="preview-not-ready-message"
        >
          กรุณาแก้ไขข้อมูลที่ไม่ถูกต้อง หรือยกเว้นแถวนั้นออก ก่อนเริ่มกระทบยอด
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2.5 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="btn-press rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-text-sub hover:bg-page-bg"
          data-testid="preview-back"
        >
          ย้อนกลับ
        </button>
        <button
          type="button"
          onClick={onStartReconciliation}
          disabled={!canStart}
          className="btn-press rounded-[10px] bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="preview-start-reconciliation"
        >
          เริ่มกระทบยอด
        </button>
      </div>

      {editTarget?.kind === 'bank' && (
        <EditBankRowDialog row={editTarget.row} onSave={saveBankRow} onClose={() => setEditTarget(null)} />
      )}
      {editTarget?.kind === 'gl' && (
        <EditGLRowDialog row={editTarget.row} onSave={saveGlRow} onClose={() => setEditTarget(null)} />
      )}
    </div>
  );
}

function StatusBadge({ row }: { row: Pick<BankRow | GLRow, 'excluded' | 'errors'> }) {
  const status = rowDataStatus(row);
  return (
    <span className={`inline-block w-fit rounded-full px-3 py-1 text-xs font-medium ${ROW_DATA_STATUS_BADGE_CLASS[status]}`}>
      {ROW_DATA_STATUS_LABELS[status]}
      {status === 'invalid' && row.errors.length > 0 && <span className="ml-1">({row.errors.join(', ')})</span>}
    </span>
  );
}

function PreviewTable({
  title,
  kind,
  rows,
  includedCount,
  onToggleExclude,
  onEdit,
  testIdPrefix,
}: {
  title: string;
  kind: 'bank' | 'gl';
  rows: (BankRow | GLRow)[];
  includedCount: number;
  onToggleExclude: (id: string) => void;
  onEdit: (row: never) => void;
  testIdPrefix: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-text">{title}</h3>
        <p className="font-numeric text-xs text-text-sub" data-testid={`${testIdPrefix}-included-count`}>
          รวมทั้งหมด {rows.length.toLocaleString('th-TH')} แถว — นำเข้ากระทบยอด {includedCount.toLocaleString('th-TH')} แถว
        </p>
      </div>
      <div className="card-surface max-h-[28rem] overflow-auto rounded-2xl">
        <table className="min-w-full divide-y divide-border text-sm" data-testid={`${testIdPrefix}-table`}>
          <thead className="sticky top-0 bg-table-header">
            <tr>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-sub">ลำดับ</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-sub">วันที่</th>
              {kind === 'gl' && <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-sub">เลขที่เอกสาร</th>}
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-sub">รายละเอียด</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold text-text-sub">รับเงิน</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold text-text-sub">จ่ายเงิน</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold text-text-sub">ยอดที่ใช้กระทบ</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-sub">ประเภทรายการ</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-sub">สถานะข้อมูล</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-text-sub">การจัดการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3.5 py-6 text-center text-text-sub" data-testid={`${testIdPrefix}-empty`}>
                  ไม่มีข้อมูล
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr
                  key={row.id}
                  className={`transition-colors duration-150 hover:bg-table-row-hover ${row.excluded ? 'opacity-50' : ''}`}
                  data-testid={`${testIdPrefix}-row-${row.id}`}
                >
                  <td className="font-numeric px-3 py-2.5 text-text-sub">{idx + 1}</td>
                  <td className="px-3 py-2.5 text-text-sub">{row.date ?? '-'}</td>
                  {kind === 'gl' && <td className="px-3 py-2.5 text-text-sub">{(row as GLRow).docNo || '-'}</td>}
                  <td className="max-w-[16rem] truncate px-3 py-2.5 text-text" title={row.description}>
                    {row.description || '-'}
                  </td>
                  <td className="font-numeric px-3 py-2.5 text-right text-text-sub">{row.moneyInRaw.toLocaleString('th-TH', THB2)}</td>
                  <td className="font-numeric px-3 py-2.5 text-right text-text-sub">{row.moneyOutRaw.toLocaleString('th-TH', THB2)}</td>
                  <td className="font-numeric px-3 py-2.5 text-right font-semibold text-text" data-testid={`${testIdPrefix}-amount-${row.id}`}>
                    {row.amount.toLocaleString('th-TH', THB2)}
                  </td>
                  <td className="px-3 py-2.5 text-text-sub">{row.direction ? TRANSACTION_DIRECTION_LABELS[row.direction] : '-'}</td>
                  <td className="px-3 py-2.5" data-testid={`${testIdPrefix}-status-${row.id}`}>
                    <StatusBadge row={row} />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onEdit(row as never)}
                        className="btn-press flex h-7 w-7 items-center justify-center rounded-[8px] border border-primary/30 bg-white text-primary hover:bg-primary/10"
                        aria-label="แก้ไข"
                        data-testid={`${testIdPrefix}-edit-${row.id}`}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onToggleExclude(row.id)}
                        className={`btn-press flex h-7 w-7 items-center justify-center rounded-[8px] border bg-white ${
                          row.excluded
                            ? 'border-success/30 text-success hover:bg-success/10'
                            : 'border-danger/30 text-danger hover:bg-danger/10'
                        }`}
                        aria-label={row.excluded ? 'กู้คืนแถว' : 'ยกเว้นแถว'}
                        data-testid={`${testIdPrefix}-toggle-exclude-${row.id}`}
                      >
                        {row.excluded ? <RotateCcw size={14} /> : <XCircle size={14} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** re-validate errors ของแถวหลังผู้ใช้แก้ไขค่าด้วยตนเอง — ใช้กติกาเดียวกับ resolveDirectionAndAmount แบบย่อ
 * (ไม่เรียกฟังก์ชันเดิมตรงๆ เพราะที่นี่ผู้ใช้แก้ direction/amount ที่ resolve แล้วโดยตรง ไม่ใช่ moneyIn/moneyOut
 * ดิบสองคอลัมน์เหมือนตอน normalize ครั้งแรก — กติกาความถูกต้องเหลือแค่ "ต้องเลือกทิศทาง และจำนวนเงินต้องมากกว่า 0") */
function revalidate(direction: TransactionDirection | null, amount: number): string[] {
  if (direction === null) return ['กรุณาระบุประเภทรายการ (รับเงิน/จ่ายเงิน)'];
  if (!Number.isFinite(amount) || amount <= 0) return ['ยอดเงินต้องมากกว่า 0'];
  return [];
}

function EditDialogShell({
  title,
  onClose,
  onSubmit,
  children,
  testIdPrefix,
}: {
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  children: React.ReactNode;
  testIdPrefix: string;
}) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid={`${testIdPrefix}-dialog`}
    >
      <div className="card-surface w-full max-w-lg rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="text-base font-bold text-text">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-text-sub hover:bg-page-bg"
            aria-label="ปิด"
            data-testid={`${testIdPrefix}-close`}
          >
            <X size={18} />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className="space-y-3.5"
        >
          {children}
          <div className="mt-6 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="btn-press rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-text-sub hover:bg-page-bg"
              data-testid={`${testIdPrefix}-cancel`}
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              className="btn-press rounded-[10px] bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover"
              data-testid={`${testIdPrefix}-save`}
            >
              บันทึก
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  testId,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testId: string;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-text">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-3 text-sm text-text"
        data-testid={testId}
      />
    </label>
  );
}

function DirectionField({ value, onChange, testId }: { value: TransactionDirection | null; onChange: (v: TransactionDirection) => void; testId: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-text">ประเภทรายการ</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value as TransactionDirection)}
        className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-3 text-sm text-text"
        data-testid={testId}
      >
        <option value="" disabled>
          - เลือกประเภทรายการ -
        </option>
        <option value="income">{TRANSACTION_DIRECTION_LABELS.income}</option>
        <option value="payment">{TRANSACTION_DIRECTION_LABELS.payment}</option>
      </select>
    </label>
  );
}

function EditBankRowDialog({ row, onSave, onClose }: { row: BankRow; onSave: (row: BankRow) => void; onClose: () => void }) {
  const [date, setDate] = useState(row.date ?? '');
  const [description, setDescription] = useState(row.description);
  const [direction, setDirection] = useState<TransactionDirection | null>(row.direction);
  const [amount, setAmount] = useState(String(row.amount));
  const [balance, setBalance] = useState(row.balance === null ? '' : String(row.balance));
  const [accountNo, setAccountNo] = useState(row.accountNo);

  function handleSubmit() {
    const parsedAmount = parseFloat(amount);
    const nextAmount = Number.isFinite(parsedAmount) ? Math.round((parsedAmount + Number.EPSILON) * 100) / 100 : 0;
    onSave({
      ...row,
      date: date.trim() === '' ? null : (parseDateCell(date) ?? date.trim()),
      description,
      direction,
      amount: nextAmount,
      moneyInRaw: direction === 'income' ? nextAmount : 0,
      moneyOutRaw: direction === 'payment' ? nextAmount : 0,
      balance: balance.trim() === '' ? null : parseFloat(balance) || 0,
      accountNo,
      errors: revalidate(direction, nextAmount),
    });
  }

  return (
    <EditDialogShell title="แก้ไขแถว Bank Statement" onClose={onClose} onSubmit={handleSubmit} testIdPrefix="edit-bank-row">
      <TextField label="วันที่ (เช่น 2026-07-17)" value={date} onChange={setDate} testId="edit-bank-row-date" />
      <TextField label="รายละเอียด" value={description} onChange={setDescription} testId="edit-bank-row-description" />
      <DirectionField value={direction} onChange={setDirection} testId="edit-bank-row-direction" />
      <TextField label="ยอดเงิน" value={amount} onChange={setAmount} testId="edit-bank-row-amount" type="number" />
      <TextField label="ยอดคงเหลือ (ถ้ามี)" value={balance} onChange={setBalance} testId="edit-bank-row-balance" type="number" />
      <TextField label="เลขที่บัญชี (ถ้ามี)" value={accountNo} onChange={setAccountNo} testId="edit-bank-row-account-no" />
    </EditDialogShell>
  );
}

function EditGLRowDialog({ row, onSave, onClose }: { row: GLRow; onSave: (row: GLRow) => void; onClose: () => void }) {
  const [date, setDate] = useState(row.date ?? '');
  const [description, setDescription] = useState(row.description);
  const [direction, setDirection] = useState<TransactionDirection | null>(row.direction);
  const [amount, setAmount] = useState(String(row.amount));
  const [docNo, setDocNo] = useState(row.docNo);
  const [accountCode, setAccountCode] = useState(row.accountCode);

  function handleSubmit() {
    const parsedAmount = parseFloat(amount);
    const nextAmount = Number.isFinite(parsedAmount) ? Math.round((parsedAmount + Number.EPSILON) * 100) / 100 : 0;
    onSave({
      ...row,
      date: date.trim() === '' ? null : (parseDateCell(date) ?? date.trim()),
      description,
      direction,
      amount: nextAmount,
      moneyInRaw: direction === 'income' ? nextAmount : 0,
      moneyOutRaw: direction === 'payment' ? nextAmount : 0,
      docNo,
      accountCode,
      errors: revalidate(direction, nextAmount),
    });
  }

  return (
    <EditDialogShell title="แก้ไขแถว GL" onClose={onClose} onSubmit={handleSubmit} testIdPrefix="edit-gl-row">
      <TextField label="วันที่ (เช่น 2026-07-17)" value={date} onChange={setDate} testId="edit-gl-row-date" />
      <TextField label="รายละเอียด" value={description} onChange={setDescription} testId="edit-gl-row-description" />
      <DirectionField value={direction} onChange={setDirection} testId="edit-gl-row-direction" />
      <TextField label="ยอดเงิน" value={amount} onChange={setAmount} testId="edit-gl-row-amount" type="number" />
      <TextField label="เลขที่เอกสาร (ถ้ามี)" value={docNo} onChange={setDocNo} testId="edit-gl-row-doc-no" />
      <TextField label="รหัสบัญชี (ถ้ามี)" value={accountCode} onChange={setAccountCode} testId="edit-gl-row-account-code" />
    </EditDialogShell>
  );
}
