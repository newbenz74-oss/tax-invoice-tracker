'use client';

import { useMemo, useRef, useState } from 'react';
import {
  buildTemplateBlob,
  findDuplicateRowNumbers,
  parseExcelRows,
  readWorkbookRows,
  type ExcelImportRow,
} from '@/lib/excelImport';
import type { PendingTaxInvoice, TaxType } from '@/types/invoice';

const THB2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// แถวในหน้าตรวจสอบ = ExcelImportRow เดิม + สถานะที่จัดการเฉพาะในหน้านี้ (ไม่ได้มาจากการ parse โดยตรง)
// included: ผู้ใช้ต้องการนำเข้าแถวนี้หรือไม่ (แถวที่ error จะถูกบังคับ false เสมอ แก้ไม่ได้จนกว่าจะแก้
// ปัญหา — ส่วนแถวที่ซ้ำแค่เตือนเฉยๆ ผู้ใช้เลือกรวมเข้าไปเองได้ถ้ามั่นใจว่าไม่ซ้ำจริง)
type ReviewRow = ExcelImportRow & { included: boolean; isDuplicate: boolean };
type ReviewFilter = 'all' | 'vat' | 'no_vat' | 'error';

interface ExcelImportPanelProps {
  onImport: (rows: ExcelImportRow[]) => Promise<void>;
  onClose: () => void;
  // รายการที่มีอยู่แล้วในระบบ — ใช้ตรวจหารายการซ้ำก่อนนำเข้า (ผู้ขาย+วันที่+เลขที่อ้างอิง+ยอดรวมตรงกัน)
  existingInvoices: PendingTaxInvoice[];
}

export default function ExcelImportPanel({ onImport, onClose, existingInvoices }: ExcelImportPanelProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [reviewRows, setReviewRows] = useState<ReviewRow[]>([]);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all');
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // แถวที่ "จะถูกนำเข้าจริง" ถ้ากดยืนยัน — ต้องติ๊กเลือกไว้ (included) ไม่มี error ค้าง และมีประเภทภาษี
  // ที่ระบุชัดเจนแล้ว (ไม่ใช่ '' ซึ่งเกิดได้เฉพาะตอนคอลัมน์ประเภทภาษีมีค่าที่ระบบไม่รู้จัก)
  const importableRows = useMemo(
    () =>
      reviewRows.filter(
        (r): r is ReviewRow & { tax_type: TaxType } => r.included && r.errors.length === 0 && r.tax_type !== ''
      ),
    [reviewRows]
  );

  const summary = useMemo(() => {
    // ตรวจจับจากยอด VAT เพียงอย่างเดียวเสมอ (ไม่มีคอลัมน์ "ประเภทภาษี" ให้เลือกเองอีกต่อไป) จึงมีแค่
    // 2 ประเภทที่เป็นไปได้จากการนำเข้า Excel: claimable_vat (มี VAT) กับ no_vat (ไม่มี VAT) เท่านั้น
    const vatCount = reviewRows.filter((r) => r.tax_type === 'claimable_vat').length;
    const noVatCount = reviewRows.filter((r) => r.tax_type === 'no_vat').length;
    const errorCount = reviewRows.filter((r) => r.errors.length > 0 || r.isDuplicate).length;
    const totalAmount = importableRows.reduce(
      (sum, r) => sum + (parseFloat(r.amount_excl_vat) || 0) + (parseFloat(r.vat_amount) || 0),
      0
    );
    const totalVat = importableRows.reduce((sum, r) => sum + (parseFloat(r.vat_amount) || 0), 0);
    return {
      total: reviewRows.length,
      vatCount,
      noVatCount,
      errorCount,
      includedCount: importableRows.length,
      totalAmount: round2(totalAmount),
      totalVat: round2(totalVat),
    };
  }, [reviewRows, importableRows]);

  const displayedRows = reviewRows.filter((r) => {
    if (reviewFilter === 'error') return r.errors.length > 0 || r.isDuplicate;
    if (reviewFilter === 'vat') return r.tax_type === 'claimable_vat';
    if (reviewFilter === 'no_vat') return r.tax_type === 'no_vat';
    return true;
  });

  function handleDownloadTemplate() {
    const blob = buildTemplateBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'เทมเพลตนำเข้ารายการยอดซื้อ.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setParseError(null);
    setImportError(null);
    setReviewFilter('all');
    setReviewRows([]);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const rawRows = readWorkbookRows(arrayBuffer);
      const parsed = parseExcelRows(rawRows);
      if (parsed.length === 0) {
        setParseError('ไม่พบข้อมูลในไฟล์ กรุณาตรวจสอบว่ากรอกข้อมูลตามแถวใต้หัวคอลัมน์ และใช้หัวคอลัมน์ตรงกับเทมเพลต');
      }
      const duplicateRowNumbers = findDuplicateRowNumbers(parsed, existingInvoices);
      setReviewRows(
        parsed.map((row) => {
          const isDuplicate = duplicateRowNumbers.has(row.rowNumber);
          return { ...row, isDuplicate, included: row.errors.length === 0 && !isDuplicate };
        })
      );
    } catch {
      setParseError('อ่านไฟล์ไม่สำเร็จ กรุณาตรวจสอบว่าเป็นไฟล์ .xlsx หรือ .xls ที่ไม่เสียหาย');
    }
  }

  function handleToggleIncluded(rowNumber: number) {
    setReviewRows((prev) => prev.map((r) => (r.rowNumber === rowNumber ? { ...r, included: !r.included } : r)));
  }

  async function handleConfirmImport() {
    if (importableRows.length === 0) return;
    setImporting(true);
    setImportError(null);
    try {
      await onImport(importableRows);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'นำเข้าข้อมูลไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setImporting(false);
    }
  }

  function handlePickAnotherFile() {
    setFileName(null);
    setReviewRows([]);
    setParseError(null);
    setImportError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div className="space-y-4" data-testid="excel-import-panel">
      <p className="text-sm text-gray-600">
        นำเข้ารายการยอดซื้อหลายรายการพร้อมกันจากไฟล์ Excel — ดาวน์โหลดเทมเพลต กรอกข้อมูล แล้วอัปโหลดกลับมา
        ระบบจะตรวจจากยอดในคอลัมน์ &quot;VAT&quot; ให้อัตโนมัติเสมอ: กรอกยอด VAT มา (มากกว่า 0) ถือเป็น
        &quot;มี VAT&quot; ส่วนเว้นว่างไว้ หรือใส่ 0 หรือเครื่องหมาย &quot;-&quot; ถือเป็น &quot;ไม่มี VAT&quot; —
        ตรวจสอบผลลัพธ์อีกครั้งได้ในหน้าตรวจสอบก่อนนำเข้าจริง
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleDownloadTemplate}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          data-testid="download-template"
        >
          ดาวน์โหลดเทมเพลต Excel
        </button>

        <label className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 cursor-pointer">
          เลือกไฟล์ Excel...
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileChange}
            className="hidden"
            data-testid="excel-file-input"
          />
        </label>

        {fileName && <span className="text-sm text-gray-500">ไฟล์: {fileName}</span>}
      </div>

      {parseError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {parseError}
        </p>
      )}

      {reviewRows.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2" data-testid="import-filter-tabs">
            {(
              [
                { key: 'all', label: `ทั้งหมด (${summary.total})` },
                { key: 'vat', label: `มี VAT (${summary.vatCount})` },
                { key: 'no_vat', label: `ไม่มี VAT (${summary.noVatCount})` },
                { key: 'error', label: `ข้อมูลผิดพลาด (${summary.errorCount})` },
              ] as { key: ReviewFilter; label: string }[]
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setReviewFilter(tab.key)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  reviewFilter === tab.key
                    ? 'bg-blue-600 text-white'
                    : 'border border-gray-300 bg-white text-gray-600'
                }`}
                data-testid={`import-filter-${tab.key}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs sm:grid-cols-4">
            <div>
              <span className="text-gray-500">จะนำเข้า</span>{' '}
              <span className="font-semibold text-gray-900" data-testid="import-summary-count">
                {summary.includedCount} รายการ
              </span>
            </div>
            <div>
              <span className="text-gray-500">ยอดรวม</span>{' '}
              <span className="font-semibold text-gray-900" data-testid="import-summary-amount">
                {summary.totalAmount.toLocaleString('th-TH', THB2)} บาท
              </span>
            </div>
            <div>
              <span className="text-gray-500">VAT รวม</span>{' '}
              <span className="font-semibold text-gray-900" data-testid="import-summary-vat">
                {summary.totalVat.toLocaleString('th-TH', THB2)} บาท
              </span>
            </div>
            <div>
              <span className="text-gray-500">มีปัญหา/ซ้ำ</span>{' '}
              <span className="font-semibold text-red-600" data-testid="import-summary-error-count">
                {summary.errorCount} รายการ
              </span>
            </div>
          </div>

          <div className="max-h-[28rem] overflow-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-center font-medium text-gray-500">นำเข้า</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">ลำดับ</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">ผู้ขาย</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">วันที่</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">ยอดก่อน VAT</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">VAT</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">ยอดรวม</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">ประเภทที่ระบบตรวจพบ</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">สถานะตรวจสอบ</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">ข้อผิดพลาด</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {displayedRows.map((r) => {
                  const amount = parseFloat(r.amount_excl_vat) || 0;
                  const vat = parseFloat(r.vat_amount) || 0;
                  const hasError = r.errors.length > 0;
                  const messages = [
                    ...r.errors,
                    ...(r.isDuplicate ? ['อาจซ้ำกับรายการที่มีอยู่แล้ว (ผู้ขาย/วันที่/เลขที่อ้างอิง/ยอดรวมตรงกัน)'] : []),
                    ...r.warnings,
                  ];
                  return (
                    <tr
                      key={r.rowNumber}
                      className={hasError ? 'bg-red-50' : r.isDuplicate ? 'bg-amber-50' : undefined}
                      data-testid={`import-row-${r.rowNumber}`}
                    >
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={r.included}
                          disabled={hasError}
                          onChange={() => handleToggleIncluded(r.rowNumber)}
                          data-testid={`import-row-include-${r.rowNumber}`}
                        />
                      </td>
                      <td className="px-3 py-2 text-gray-400">{r.rowNumber}</td>
                      <td className="px-3 py-2 text-gray-900">{r.vendor_name || '-'}</td>
                      <td className="px-3 py-2 text-gray-700">{r.transaction_date || '-'}</td>
                      <td className="px-3 py-2 text-right text-gray-700">
                        {r.amount_excl_vat ? amount.toLocaleString('th-TH', THB2) : '-'}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700">
                        {/* VAT อ่านเป็นตัวเลขไม่ได้ (มี error) — โชว์ข้อความดิบที่กรอกมาแทน ให้เห็นว่าผิดตรงไหน */}
                        {r.vat_amount !== '' && Number.isFinite(parseFloat(r.vat_amount))
                          ? vat.toLocaleString('th-TH', THB2)
                          : r.vat_amount || '-'}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700">
                        {r.amount_excl_vat || r.vat_amount ? (amount + vat).toLocaleString('th-TH', THB2) : '-'}
                      </td>
                      <td className="px-3 py-2">
                        {/* ตรวจจับอัตโนมัติจากยอด VAT เท่านั้น — อ่านอย่างเดียว ไม่ให้ผู้ใช้เลือก/แก้เอง
                            ตามที่ตกลงกันไว้ (ลดขั้นตอนกรอกข้อมูลซ้ำซ้อน) */}
                        {r.tax_type === 'claimable_vat' && (
                          <span
                            className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700"
                            data-testid={`import-row-tax-type-${r.rowNumber}`}
                          >
                            มี VAT
                          </span>
                        )}
                        {r.tax_type === 'no_vat' && (
                          <span
                            className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600"
                            data-testid={`import-row-tax-type-${r.rowNumber}`}
                          >
                            ไม่มี VAT
                          </span>
                        )}
                        {r.tax_type === '' && (
                          <span className="text-xs text-gray-400" data-testid={`import-row-tax-type-${r.rowNumber}`}>
                            -
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {hasError ? (
                          <span className="text-red-600">ผิดพลาด</span>
                        ) : r.isDuplicate ? (
                          <span className="text-amber-700">อาจซ้ำ</span>
                        ) : (
                          <span className="text-green-700">✓ พร้อมนำเข้า</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600">{messages.join(' / ') || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {importError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {importError}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          ปิด
        </button>
        {reviewRows.length > 0 && (
          <button
            type="button"
            onClick={handlePickAnotherFile}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            เลือกไฟล์ใหม่
          </button>
        )}
        <button
          type="button"
          onClick={handleConfirmImport}
          disabled={importableRows.length === 0 || importing}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          data-testid="confirm-import"
        >
          {importing ? 'กำลังนำเข้า...' : `นำเข้า ${importableRows.length} รายการ`}
        </button>
      </div>
    </div>
  );
}
