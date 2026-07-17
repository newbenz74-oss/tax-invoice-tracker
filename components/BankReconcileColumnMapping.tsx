'use client';

import { useMemo } from 'react';
import { buildBankRows, buildGLRows } from '@/lib/bankReconcileNormalize';
import { isBankMappingComplete, isGLMappingComplete } from '@/lib/bankReconcileValidation';
import { TRANSACTION_DIRECTION_LABELS } from '@/types/bankReconcile';
import type {
  BankColumnKey,
  BankColumnMapping,
  GLColumnKey,
  GLColumnMapping,
  UploadedFileState,
} from '@/types/bankReconcile';

const THB2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

const BANK_FIELD_ORDER: BankColumnKey[] = ['transactionDate', 'description', 'moneyIn', 'moneyOut', 'balance', 'accountNo'];
const BANK_FIELD_LABELS: Record<BankColumnKey, string> = {
  transactionDate: 'วันที่รายการ',
  description: 'รายละเอียด',
  moneyIn: 'เงินเข้า',
  moneyOut: 'เงินออก',
  balance: 'ยอดคงเหลือ',
  accountNo: 'เลขที่บัญชี',
};
const BANK_OPTIONAL_FIELDS: BankColumnKey[] = ['balance', 'accountNo'];

const GL_FIELD_ORDER: GLColumnKey[] = ['date', 'description', 'moneyIn', 'moneyOut', 'docNo', 'accountCode'];
const GL_FIELD_LABELS: Record<GLColumnKey, string> = {
  date: 'วันที่',
  description: 'รายละเอียด',
  moneyIn: 'ฝั่งรับเงิน',
  moneyOut: 'ฝั่งจ่ายเงิน',
  docNo: 'เลขที่เอกสาร',
  accountCode: 'รหัสบัญชี',
};
const GL_OPTIONAL_FIELDS: GLColumnKey[] = ['docNo', 'accountCode'];

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
  required,
  headers,
  value,
  onChange,
  testId,
}: {
  label: string;
  required: boolean;
  headers: string[];
  value: number | null;
  onChange: (next: number | null) => void;
  testId: string;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-text">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </span>
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

/**
 * ขั้นตอน "จับคู่คอลัมน์" — เขียนใหม่ 2026-07-17 คู่กับโมเดลกระทบยอดใหม่ ต่างจากเดิม 2 จุดหลัก: (1) ฝั่ง GL
 * เปลี่ยนจาก "เดบิต/เครดิต" เป็น "ฝั่งรับเงิน/ฝั่งจ่ายเงิน" ให้ผู้ใช้ระบุทิศทางเองตรงๆ ตามสเปก "Do not infer GL
 * debit/credit behavior without showing the mapping" (2) ฟิลด์บังคับของ Bank เปลี่ยนจาก "อย่างน้อยหนึ่งใน
 * เงินเข้า/เงินออก" เป็น "ทั้งเงินเข้าและเงินออกต้องจับคู่ครบทั้งคู่" (ไฟล์ธนาคารจริงมักมีทั้งสองคอลัมน์เสมอ
 * แค่บางแถวว่างคอลัมน์ใดคอลัมน์หนึ่ง) ตัวอย่างพรีวิวเปลี่ยนจากตาราง "เงินเข้า/เงินออก/ยอดสุทธิ" เป็น
 * "ประเภทรายการ/จำนวนเงิน/สถานะ" (แสดงผลลัพธ์ resolveDirectionAndAmount ตรงๆ ให้ตรวจสอบก่อนไปขั้นตอนพรีวิว/
 * แก้ไขแถวแบบเต็ม — ดู components/BankReconcilePreview.tsx สำหรับขั้นตอนถัดไปที่แก้ไข/ยกเว้นแถวได้จริง)
 */
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
    () => buildBankRows(bankFile.table, bankMapping).slice(0, PREVIEW_ROW_LIMIT),
    [bankFile, bankMapping]
  );
  const glPreviewRows = useMemo(() => buildGLRows(glFile.table, glMapping).slice(0, PREVIEW_ROW_LIMIT), [glFile, glMapping]);

  const canSave = isBankMappingComplete(bankMapping) && isGLMappingComplete(glMapping);

  return (
    <div className="space-y-6" data-testid="bank-reconcile-mapping-step">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card-surface rounded-2xl p-6">
          <h3 className="mb-1 text-sm font-bold text-text">จับคู่คอลัมน์ — Bank Statement</h3>
          <p className="mb-4 text-xs text-text-sub">
            ต้องระบุ &quot;วันที่รายการ&quot; &quot;รายละเอียด&quot; &quot;เงินเข้า&quot; และ &quot;เงินออก&quot;
            ครบทั้งหมด — ยอดคงเหลือและเลขที่บัญชีไม่บังคับ
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {BANK_FIELD_ORDER.map((key) => (
              <ColumnSelect
                key={key}
                label={BANK_FIELD_LABELS[key]}
                required={!BANK_OPTIONAL_FIELDS.includes(key)}
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
            ต้องระบุ &quot;วันที่&quot; &quot;รายละเอียด&quot; &quot;ฝั่งรับเงิน&quot; และ &quot;ฝั่งจ่ายเงิน&quot;
            ครบทั้งหมด — ระบบไม่เดาทิศทางเงินเข้า/เงินออกให้ กรุณาระบุเอง เลขที่เอกสารและรหัสบัญชีไม่บังคับ
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {GL_FIELD_ORDER.map((key) => (
              <ColumnSelect
                key={key}
                label={GL_FIELD_LABELS[key]}
                required={!GL_OPTIONAL_FIELDS.includes(key)}
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
        <h3 className="text-sm font-bold text-text">ตัวอย่างข้อมูล Bank Statement หลังปรับรูปแบบ (10 แถวแรก)</h3>
        <div className="card-surface overflow-auto rounded-2xl">
          <table className="min-w-full divide-y divide-border text-sm" data-testid="bank-preview-table">
            <thead className="bg-table-header">
              <tr>
                <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">วันที่</th>
                <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">รายละเอียด</th>
                <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">ประเภทรายการ</th>
                <th className="px-3.5 py-2.5 text-right font-medium text-text-sub">จำนวนเงิน</th>
                <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {bankPreviewRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3.5 py-6 text-center text-text-sub">
                    ยังไม่มีข้อมูลให้แสดงตัวอย่าง — กรุณาจับคู่คอลัมน์ด้านบนก่อน
                  </td>
                </tr>
              ) : (
                bankPreviewRows.map((r) => (
                  <tr key={r.rowNumber} data-testid={`bank-preview-row-${r.rowNumber}`}>
                    <td className="px-3.5 py-2.5 text-text-sub">{r.date ?? '-'}</td>
                    <td className="px-3.5 py-2.5 text-text">{r.description || '-'}</td>
                    <td className="px-3.5 py-2.5 text-text-sub">{r.direction ? TRANSACTION_DIRECTION_LABELS[r.direction] : '-'}</td>
                    <td className="font-numeric px-3.5 py-2.5 text-right text-text-sub">{r.amount.toLocaleString('th-TH', THB2)}</td>
                    <td className="px-3.5 py-2.5">
                      {r.errors.length === 0 ? (
                        <span className="text-success">ถูกต้อง</span>
                      ) : (
                        <span className="text-danger">{r.errors.join(' / ')}</span>
                      )}
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
                <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">ประเภทรายการ</th>
                <th className="px-3.5 py-2.5 text-right font-medium text-text-sub">จำนวนเงิน</th>
                <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">สถานะ</th>
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
                    <td className="px-3.5 py-2.5 text-text-sub">{r.direction ? TRANSACTION_DIRECTION_LABELS[r.direction] : '-'}</td>
                    <td className="font-numeric px-3.5 py-2.5 text-right text-text-sub">{r.amount.toLocaleString('th-TH', THB2)}</td>
                    <td className="px-3.5 py-2.5">
                      {r.errors.length === 0 ? (
                        <span className="text-success">ถูกต้อง</span>
                      ) : (
                        <span className="text-danger">{r.errors.join(' / ')}</span>
                      )}
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
          ถัดไป: ตรวจสอบข้อมูล
        </button>
      </div>
    </div>
  );
}
