'use client';

import { useRef, useState } from 'react';
import { buildTemplateBlob, parseExcelRows, readWorkbookRows, type ExcelImportRow } from '@/lib/excelImport';

interface ExcelImportPanelProps {
  onImport: (rows: ExcelImportRow[]) => Promise<void>;
  onClose: () => void;
}

export default function ExcelImportPanel({ onImport, onClose }: ExcelImportPanelProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ExcelImportRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validRows = rows.filter((r) => r.errors.length === 0);
  const invalidRows = rows.filter((r) => r.errors.length > 0);

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
    setRows([]);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const rawRows = readWorkbookRows(arrayBuffer);
      const parsed = parseExcelRows(rawRows);
      if (parsed.length === 0) {
        setParseError('ไม่พบข้อมูลในไฟล์ กรุณาตรวจสอบว่ากรอกข้อมูลตามแถวใต้หัวคอลัมน์ และใช้หัวคอลัมน์ตรงกับเทมเพลต');
      }
      setRows(parsed);
    } catch {
      setParseError('อ่านไฟล์ไม่สำเร็จ กรุณาตรวจสอบว่าเป็นไฟล์ .xlsx หรือ .xls ที่ไม่เสียหาย');
    }
  }

  async function handleConfirmImport() {
    if (validRows.length === 0) return;
    setImporting(true);
    setImportError(null);
    try {
      await onImport(validRows);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'นำเข้าข้อมูลไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setImporting(false);
    }
  }

  function handlePickAnotherFile() {
    setFileName(null);
    setRows([]);
    setParseError(null);
    setImportError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div className="space-y-4" data-testid="excel-import-panel">
      <p className="text-sm text-gray-600">
        นำเข้ารายการยอดซื้อหลายรายการพร้อมกันจากไฟล์ Excel — ดาวน์โหลดเทมเพลต กรอกข้อมูล แล้วอัปโหลดกลับมา
        (ไม่กรอกช่อง VAT จะคำนวณให้อัตโนมัติ 7% จากยอดก่อน VAT)
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

      {rows.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="rounded-full bg-green-100 px-3 py-1 font-medium text-green-800" data-testid="valid-count">
              พร้อมนำเข้า {validRows.length} รายการ
            </span>
            {invalidRows.length > 0 && (
              <span className="rounded-full bg-red-100 px-3 py-1 font-medium text-red-800" data-testid="invalid-count">
                มีปัญหา {invalidRows.length} รายการ (จะข้ามไป ไม่นำเข้า)
              </span>
            )}
          </div>

          <div className="max-h-72 overflow-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">แถว</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">ผู้ขาย</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">วันที่</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">ยอดก่อน VAT</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">VAT</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.rowNumber} className={r.errors.length > 0 ? 'bg-red-50' : undefined}>
                    <td className="px-3 py-2 text-gray-400">{r.rowNumber}</td>
                    <td className="px-3 py-2 text-gray-900">{r.vendor_name || '-'}</td>
                    <td className="px-3 py-2 text-gray-700">{r.transaction_date || '-'}</td>
                    <td className="px-3 py-2 text-right text-gray-700">{r.amount_excl_vat || '-'}</td>
                    <td className="px-3 py-2 text-right text-gray-700">{r.vat_amount || '-'}</td>
                    <td className="px-3 py-2">
                      {r.errors.length === 0 ? (
                        <span className="text-green-700">✓ พร้อมนำเข้า</span>
                      ) : (
                        <span className="text-red-600">{r.errors.join(', ')}</span>
                      )}
                    </td>
                  </tr>
                ))}
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
        {rows.length > 0 && (
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
          disabled={validRows.length === 0 || importing}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          data-testid="confirm-import"
        >
          {importing ? 'กำลังนำเข้า...' : `นำเข้า ${validRows.length} รายการ`}
        </button>
      </div>
    </div>
  );
}
