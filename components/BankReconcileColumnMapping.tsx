'use client';

import { useMemo } from 'react';
import { normalizeBankRows, normalizeGLRows } from '@/lib/bankReconcileNormalize';
import { isBankMappingComplete, isGLMappingComplete } from '@/lib/bankReconcileValidation';
import type {
  BankColumnKey,
  BankColumnMapping,
  GLColumnKey,
  GLColumnMapping,
  UploadedFileState,
} from '@/types/bankReconcile';

const THB2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

const BANK_FIELD_ORDER: BankColumnKey[] = ['transactionDate', 'description', 'moneyIn', 'moneyOut', 'balance'];
const BANK_FIELD_LABELS: Record<BankColumnKey, string> = {
  transactionDate: 'วันที่รายการ',
  description: 'รายละเอียด',
  moneyIn: 'เงินเข้า',
  moneyOut: 'เงินออก',
  balance: 'ยอดคงเหลือ',
};

const GL_FIELD_ORDER: GLColumnKey[] = ['date', 'docNo', 'description', 'debit', 'credit'];
const GL_FIELD_LABELS: Record<GLColumnKey, string> = {
  date: 'วันที่',
  docNo: 'เลขที่เอกสาร',
  description: 'รายละเอียด',
  debit: 'เดบิต',
  credit: 'เครดิต',
};

const PREVIEW_ROW_LIMIT = 10;

interface BankReconcileColumnMappingProps {
  bankFile: UploadedFileState;
  glFile: UploadedFileState;
  bankMapping: BankColumnMapping;
  glMapping: GLColumnMapping;
  onBankMappingChange: (key: BankColumnKey, value: number | null) => void;
  onGlMappingChange: (key: GLColumnKey, value: number | null) => void;
  onBack: () => void;
  onClearMapping: () => void;
  onSave: () => void;
}

function ColumnSelect({
  label,
  headers,
  value,
  onChange,
  testId,
}: {
  label: string;
  headers: string[];
  value: number | null;
  onChange: (next: number | null) => void;
  testId: string;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-text">{label}</span>
      <select
        value={value === null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-3 text-sm text-text"
        data-testid={testId}
      >
        <option value="">- ไม่ระบุ -</option>
        {headers.map((h, idx) => (
          <option key={idx} value={idx}>
            {h || `(คอลัมน์ ${idx + 1})`}
          </option>
        ))}
      </select>
    </label>
  );
}

/** ขั้นตอน "จับคู่คอลัมน์" (แสดงหลังไฟล์ทั้งสองผ่านการตรวจสอบแล้วเท่านั้น) — ให้ผู้ใช้จับคู่คอลัมน์ดิบใน
 * ไฟล์ต้นฉบับ (หัวคอลัมน์ไม่ตายตัว) เข้ากับฟิลด์มาตรฐานของระบบ แล้วแสดงตัวอย่างข้อมูลหลัง normalize
 * (10 แถวแรก) ให้ตรวจสอบก่อนไปขั้นตอนถัดไป — เฟสนี้ยังไม่มีการจับคู่/เทียบรายการระหว่างสองไฟล์ใดๆ ทั้งสิ้น
 * (ตามสเปก "do not build matching logic... yet") ตารางพรีวิวสองตารางด้านล่างเป็นคนละไฟล์ แสดงแยกกันเฉยๆ */
export default function BankReconcileColumnMapping({
  bankFile,
  glFile,
  bankMapping,
  glMapping,
  onBankMappingChange,
  onGlMappingChange,
  onBack,
  onClearMapping,
  onSave,
}: BankReconcileColumnMappingProps) {
  const bankPreviewRows = useMemo(
    () => normalizeBankRows(bankFile.table, bankMapping).slice(0, PREVIEW_ROW_LIMIT),
    [bankFile, bankMapping]
  );
  const glPreviewRows = useMemo(
    () => normalizeGLRows(glFile.table, glMapping).slice(0, PREVIEW_ROW_LIMIT),
    [glFile, glMapping]
  );

  const canSave = isBankMappingComplete(bankMapping) && isGLMappingComplete(glMapping);

  return (
    <div className="space-y-6" data-testid="bank-reconcile-mapping-step">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card-surface rounded-2xl p-6">
          <h3 className="mb-1 text-sm font-bold text-text">จับคู่คอลัมน์ — Bank Statement</h3>
          <p className="mb-4 text-xs text-text-sub">
            ต้องระบุอย่างน้อย &quot;วันที่รายการ&quot; และ &quot;เงินเข้า&quot; หรือ &quot;เงินออก&quot;
            อย่างใดอย่างหนึ่ง — รายละเอียดและยอดคงเหลือไม่บังคับ
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {BANK_FIELD_ORDER.map((key) => (
              <ColumnSelect
                key={key}
                label={BANK_FIELD_LABELS[key]}
                headers={bankFile.table.headers}
                value={bankMapping[key]}
                onChange={(v) => onBankMappingChange(key, v)}
                testId={`bank-mapping-${key}`}
              />
            ))}
          </div>
        </div>

        <div className="card-surface rounded-2xl p-6">
          <h3 className="mb-1 text-sm font-bold text-text">จับคู่คอลัมน์ — GL จากระบบ Express</h3>
          <p className="mb-4 text-xs text-text-sub">
            ต้องระบุอย่างน้อย &quot;วันที่&quot; และ &quot;เดบิต&quot; หรือ &quot;เครดิต&quot;
            อย่างใดอย่างหนึ่ง — เลขที่เอกสารและรายละเอียดไม่บังคับ
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {GL_FIELD_ORDER.map((key) => (
              <ColumnSelect
                key={key}
                label={GL_FIELD_LABELS[key]}
                headers={glFile.table.headers}
                value={glMapping[key]}
                onChange={(v) => onGlMappingChange(key, v)}
                testId={`gl-mapping-${key}`}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-bold text-text">
          ตัวอย่างข้อมูล Bank Statement หลังปรับรูปแบบ (10 แถวแรก)
        </h3>
        <div className="card-surface overflow-auto rounded-2xl">
          <table className="min-w-full divide-y divide-border text-sm" data-testid="bank-preview-table">
            <thead className="bg-table-header">
              <tr>
                <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">วันที่รายการ</th>
                <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">รายละเอียด</th>
                <th className="px-3.5 py-2.5 text-right font-medium text-text-sub">เงินเข้า</th>
                <th className="px-3.5 py-2.5 text-right font-medium text-text-sub">เงินออก</th>
                <th className="px-3.5 py-2.5 text-right font-medium text-text-sub">ยอดคงเหลือ</th>
                <th className="px-3.5 py-2.5 text-right font-medium text-text-sub">ยอดสุทธิ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {bankPreviewRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3.5 py-6 text-center text-text-sub">
                    ยังไม่มีข้อมูลให้แสดงตัวอย่าง — กรุณาจับคู่คอลัมน์ด้านบนก่อน
                  </td>
                </tr>
              ) : (
                bankPreviewRows.map((r) => (
                  <tr key={r.rowNumber} data-testid={`bank-preview-row-${r.rowNumber}`}>
                    <td className="px-3.5 py-2.5 text-text-sub">{r.transactionDate ?? '-'}</td>
                    <td className="px-3.5 py-2.5 text-text">{r.description || '-'}</td>
                    <td className="font-numeric px-3.5 py-2.5 text-right text-text-sub">
                      {r.moneyIn.toLocaleString('th-TH', THB2)}
                    </td>
                    <td className="font-numeric px-3.5 py-2.5 text-right text-text-sub">
                      {r.moneyOut.toLocaleString('th-TH', THB2)}
                    </td>
                    <td className="font-numeric px-3.5 py-2.5 text-right text-text-sub">
                      {r.balance.toLocaleString('th-TH', THB2)}
                    </td>
                    <td
                      className={`font-numeric px-3.5 py-2.5 text-right font-semibold ${
                        r.signedAmount < 0 ? 'text-danger' : 'text-success'
                      }`}
                    >
                      {r.signedAmount.toLocaleString('th-TH', THB2)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-bold text-text">ตัวอย่างข้อมูล GL หลังปรับรูปแบบ (10 แถวแรก)</h3>
        <div className="card-surface overflow-auto rounded-2xl">
          <table className="min-w-full divide-y divide-border text-sm" data-testid="gl-preview-table">
            <thead className="bg-table-header">
              <tr>
                <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">วันที่</th>
                <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">เลขที่เอกสาร</th>
                <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">รายละเอียด</th>
                <th className="px-3.5 py-2.5 text-right font-medium text-text-sub">เดบิต</th>
                <th className="px-3.5 py-2.5 text-right font-medium text-text-sub">เครดิต</th>
                <th className="px-3.5 py-2.5 text-right font-medium text-text-sub">ยอดสุทธิ (แปลงแล้ว)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {glPreviewRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3.5 py-6 text-center text-text-sub">
                    ยังไม่มีข้อมูลให้แสดงตัวอย่าง — กรุณาจับคู่คอลัมน์ด้านบนก่อน
                  </td>
                </tr>
              ) : (
                glPreviewRows.map((r) => (
                  <tr key={r.rowNumber} data-testid={`gl-preview-row-${r.rowNumber}`}>
                    <td className="px-3.5 py-2.5 text-text-sub">{r.date ?? '-'}</td>
                    <td className="px-3.5 py-2.5 text-text-sub">{r.docNo || '-'}</td>
                    <td className="px-3.5 py-2.5 text-text">{r.description || '-'}</td>
                    <td className="font-numeric px-3.5 py-2.5 text-right text-text-sub">
                      {r.debit.toLocaleString('th-TH', THB2)}
                    </td>
                    <td className="font-numeric px-3.5 py-2.5 text-right text-text-sub">
                      {r.credit.toLocaleString('th-TH', THB2)}
                    </td>
                    <td
                      className={`font-numeric px-3.5 py-2.5 text-right font-semibold ${
                        r.signedAmount < 0 ? 'text-danger' : 'text-success'
                      }`}
                    >
                      {r.signedAmount.toLocaleString('th-TH', THB2)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2.5 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="btn-press rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-text-sub hover:bg-page-bg"
          data-testid="mapping-back"
        >
          ย้อนกลับ
        </button>
        <button
          type="button"
          onClick={onClearMapping}
          className="btn-press rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-text-sub hover:bg-page-bg"
          data-testid="mapping-clear"
        >
          ล้างการจับคู่คอลัมน์
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          className="btn-press rounded-[10px] bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="mapping-save"
        >
          บันทึกและไปขั้นตอนกระทบยอด
        </button>
      </div>
    </div>
  );
}
