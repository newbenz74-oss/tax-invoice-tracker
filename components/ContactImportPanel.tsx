'use client';

import { useMemo, useRef, useState } from 'react';
import {
  annotateDuplicateCodeErrors,
  buildContactTemplateBlob,
  parseContactRows,
  readContactWorkbookRows,
  type ContactImportRow,
} from '@/lib/contactExcelImport';
import { PARTNER_TYPE_LABELS, getContactDisplayName } from '@/lib/contactLogic';
import type { BusinessPartner, PartnerType } from '@/types/contact';

// แถวในหน้าตรวจสอบ = ContactImportRow เดิม + สถานะที่จัดการเฉพาะในหน้านี้ (เหมือน ReviewRow ของ
// ExcelImportPanel.tsx เดิม แต่เป็นไฟล์แยกต่างหากทั้งหมด ไม่แชร์โค้ดกันเลย)
type ReviewRow = ContactImportRow & { included: boolean };
type ReviewFilter = 'all' | 'customer' | 'vendor' | 'error';

interface ContactImportPanelProps {
  onImport: (rows: ContactImportRow[]) => Promise<void>;
  onClose: () => void;
  existingContacts: BusinessPartner[];
}

export default function ContactImportPanel({ onImport, onClose, existingContacts }: ContactImportPanelProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [reviewRows, setReviewRows] = useState<ReviewRow[]>([]);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all');
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const importableRows = useMemo(
    () => reviewRows.filter((r) => r.included && r.errors.length === 0),
    [reviewRows]
  );

  const summary = useMemo(() => {
    const customerCount = reviewRows.filter((r) => r.partner_type === 'customer').length;
    const vendorCount = reviewRows.filter((r) => r.partner_type === 'vendor').length;
    const errorCount = reviewRows.filter((r) => r.errors.length > 0).length;
    return {
      total: reviewRows.length,
      customerCount,
      vendorCount,
      errorCount,
      includedCount: importableRows.length,
    };
  }, [reviewRows, importableRows]);

  const displayedRows = reviewRows.filter((r) => {
    if (reviewFilter === 'error') return r.errors.length > 0;
    if (reviewFilter === 'customer') return r.partner_type === 'customer';
    if (reviewFilter === 'vendor') return r.partner_type === 'vendor';
    return true;
  });

  function handleDownloadTemplate() {
    const blob = buildContactTemplateBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'เทมเพลตนำเข้าสมุดรายชื่อ.xlsx';
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
      const rawRows = readContactWorkbookRows(arrayBuffer);
      const parsed = parseContactRows(rawRows);
      if (parsed.length === 0) {
        setParseError('ไม่พบข้อมูลในไฟล์ กรุณาตรวจสอบว่ากรอกข้อมูลตามแถวใต้หัวคอลัมน์ และใช้หัวคอลัมน์ตรงกับเทมเพลต');
      }
      const annotated = annotateDuplicateCodeErrors(parsed, existingContacts);
      setReviewRows(annotated.map((row) => ({ ...row, included: row.errors.length === 0 })));
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
    <div className="space-y-4" data-testid="contact-import-panel">
      <p className="text-sm text-text-sub">
        นำเข้ารายชื่อลูกค้า/ผู้จัดจำหน่ายหลายรายการพร้อมกันจากไฟล์ Excel — ดาวน์โหลดเทมเพลต กรอกข้อมูล
        แล้วอัปโหลดกลับมา ตรวจสอบผลลัพธ์ในหน้าตรวจสอบก่อนนำเข้าจริงเสมอ (แถวที่มีรหัสซ้ำหรือข้อมูลไม่ครบจะ
        ถูกบล็อกไว้จนกว่าจะแก้ไขไฟล์แล้วอัปโหลดใหม่)
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleDownloadTemplate}
          className="btn-press rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-text hover:bg-page-bg"
          data-testid="download-contact-template"
        >
          ดาวน์โหลดเทมเพลต Excel
        </button>

        <label className="btn-press cursor-pointer rounded-[10px] bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover">
          เลือกไฟล์ Excel...
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileChange}
            className="hidden"
            data-testid="contact-excel-file-input"
          />
        </label>

        {fileName && <span className="text-sm text-text-sub">ไฟล์: {fileName}</span>}
      </div>

      {parseError && (
        <p role="alert" className="rounded-[10px] border border-danger/20 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
          {parseError}
        </p>
      )}

      {reviewRows.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2" data-testid="contact-import-filter-tabs">
            {(
              [
                { key: 'all', label: `ทั้งหมด (${summary.total})` },
                { key: 'customer', label: `ลูกค้า (${summary.customerCount})` },
                { key: 'vendor', label: `ผู้จัดจำหน่าย (${summary.vendorCount})` },
                { key: 'error', label: `ข้อมูลผิดพลาด (${summary.errorCount})` },
              ] as { key: ReviewFilter; label: string }[]
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setReviewFilter(tab.key)}
                className={`btn-press rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors duration-[250ms] ${
                  reviewFilter === tab.key
                    ? 'bg-primary text-white'
                    : 'border border-border bg-white text-text-sub hover:bg-page-bg'
                }`}
                data-testid={`contact-import-filter-${tab.key}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-[10px] border border-border bg-page-bg p-3 text-xs sm:grid-cols-4">
            <div>
              <span className="text-text-sub">จะนำเข้า</span>{' '}
              <span className="font-numeric font-semibold text-text" data-testid="contact-import-summary-count">
                {summary.includedCount} รายการ
              </span>
            </div>
            <div>
              <span className="text-text-sub">ลูกค้า</span>{' '}
              <span className="font-numeric font-semibold text-text">{summary.customerCount} รายการ</span>
            </div>
            <div>
              <span className="text-text-sub">ผู้จัดจำหน่าย</span>{' '}
              <span className="font-numeric font-semibold text-text">{summary.vendorCount} รายการ</span>
            </div>
            <div>
              <span className="text-text-sub">มีปัญหา</span>{' '}
              <span className="font-numeric font-semibold text-danger" data-testid="contact-import-summary-error-count">
                {summary.errorCount} รายการ
              </span>
            </div>
          </div>

          <div className="card-surface max-h-[28rem] overflow-auto rounded-2xl">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="sticky top-0 bg-table-header">
                <tr>
                  <th className="px-3.5 py-2.5 text-center font-medium text-text-sub">นำเข้า</th>
                  <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">ลำดับ</th>
                  <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">รหัส</th>
                  <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">ประเภท</th>
                  <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">ชื่อ/ชื่อบริษัท</th>
                  <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">จังหวัด</th>
                  <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">สถานะตรวจสอบ</th>
                  <th className="px-3.5 py-2.5 text-left font-medium text-text-sub">ข้อผิดพลาด</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {displayedRows.map((r) => {
                  const hasError = r.errors.length > 0;
                  const messages = [...r.errors, ...r.warnings];
                  const displayName = getContactDisplayName({
                    entity_type: r.entity_type || 'individual',
                    company_name: r.company_name,
                    first_name: r.first_name,
                    last_name: r.last_name,
                  });
                  return (
                    <tr
                      key={r.rowNumber}
                      className={hasError ? 'bg-danger/10' : undefined}
                      data-testid={`contact-import-row-${r.rowNumber}`}
                    >
                      <td className="px-3.5 py-2.5 text-center">
                        <input
                          type="checkbox"
                          checked={r.included}
                          disabled={hasError}
                          onChange={() => handleToggleIncluded(r.rowNumber)}
                          className="accent-primary"
                          data-testid={`contact-import-row-include-${r.rowNumber}`}
                        />
                      </td>
                      <td className="px-3.5 py-2.5 text-text-sub">{r.rowNumber}</td>
                      <td className="px-3.5 py-2.5 text-text">{r.contact_code || '-'}</td>
                      <td className="px-3.5 py-2.5 text-text-sub">
                        {r.partner_type ? PARTNER_TYPE_LABELS[r.partner_type as PartnerType] : '-'}
                      </td>
                      <td className="px-3.5 py-2.5 text-text-sub">{displayName}</td>
                      <td className="px-3.5 py-2.5 text-text-sub">{r.province || '-'}</td>
                      <td className="px-3.5 py-2.5">
                        {hasError ? (
                          <span className="text-danger">ผิดพลาด</span>
                        ) : (
                          <span className="text-success">✓ พร้อมนำเข้า</span>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 text-xs text-text-sub">{messages.join(' / ') || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {importError && (
        <p role="alert" className="rounded-[10px] border border-danger/20 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
          {importError}
        </p>
      )}

      <div className="flex justify-end gap-2.5 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="btn-press rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-text-sub hover:bg-page-bg"
        >
          ปิด
        </button>
        {reviewRows.length > 0 && (
          <button
            type="button"
            onClick={handlePickAnotherFile}
            className="btn-press rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-text-sub hover:bg-page-bg"
          >
            เลือกไฟล์ใหม่
          </button>
        )}
        <button
          type="button"
          onClick={handleConfirmImport}
          disabled={importableRows.length === 0 || importing}
          className="btn-press rounded-[10px] bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover disabled:opacity-60"
          data-testid="confirm-contact-import"
        >
          {importing ? 'กำลังนำเข้า...' : `นำเข้า ${importableRows.length} รายการ`}
        </button>
      </div>
    </div>
  );
}
