'use client';

import { useState } from 'react';
import { CheckCircle2, XCircle, type LucideIcon } from 'lucide-react';
import { detectSourceFileType, parseFileToRawTable } from '@/lib/bankReconcileParse';
import { extractPdfToRawTable, SCANNED_PDF_MESSAGE } from '@/lib/bankReconcilePdfParse';
import { countDataRows, validateFileType, validateParsedTable } from '@/lib/bankReconcileValidation';
import { SOURCE_FILE_TYPE_LABELS } from '@/types/bankReconcile';
import type { UploadedFileState } from '@/types/bankReconcile';

interface BankReconcileUploadCardProps {
  icon: LucideIcon;
  title: string;
  buttonLabel: string;
  fileState: UploadedFileState | null;
  onFileParsed: (state: UploadedFileState) => void;
  testIdPrefix: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** การ์ดอัปโหลดไฟล์ 1 ใบ — ใช้ซ้ำทั้ง Bank Statement และ GL จากระบบ Express เขียนใหม่ 2026-07-17 เพื่อรองรับ
 * ไฟล์ PDF เพิ่มเติมจากเดิม (เดิมรองรับแค่ Excel/CSV) ตามสเปกส่วน "UPLOAD BUTTONS"/"FILE TYPE DETECTION":
 * accept รองรับ .pdf เพิ่ม, มีข้อความช่วยเหลือ "รองรับ Excel, CSV และ PDF" ใต้ปุ่มเสมอ, แสดงประเภทไฟล์ที่ตรวจ
 * พบ + ขนาดไฟล์ + จำนวนหน้า (เฉพาะ PDF) ข้างชื่อไฟล์
 *
 * แยกเส้นทางการอ่านไฟล์ตามประเภท: Excel/CSV ผ่าน parseFileToRawTable (lib/bankReconcileParse.ts, เดิมไม่แก้)
 * PDF ผ่าน extractPdfToRawTable (lib/bankReconcilePdfParse.ts, ใหม่) — ทั้งสองเส้นทางให้ผลลัพธ์เป็น RawFileTable
 * รูปแบบเดียวกัน จึงส่งต่อเข้า validateParsedTable/countDataRows ตัวเดียวกันได้ทั้งคู่ ไม่ต้องแยกโค้ดตรวจสอบ
 *
 * ถ้า PDF ตรวจพบว่าเป็นเอกสารสแกน (isScannedPdf) ถือเป็นไฟล์ไม่ผ่านการตรวจสอบทันที (validation.valid=false)
 * แสดงข้อความเตือนตามสเปกเป๊ะ — ผู้ใช้ต้องเปลี่ยนไฟล์เท่านั้น ไม่มีทางกดข้ามต่อได้ตามสเปก "Do not build
 * unreliable OCR" (ไม่มีระบบ OCR ในโปรเจกต์นี้จริง ยืนยันแล้วจาก package.json)
 */
export default function BankReconcileUploadCard({
  icon: Icon,
  title,
  buttonLabel,
  fileState,
  onFileParsed,
  testIdPrefix,
}: BankReconcileUploadCardProps) {
  const [processingStage, setProcessingStage] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (processingStage) return; // กันคลิกซ้ำระหว่างประมวลผล (ตามสเปก "Disable duplicate upload ... clicks while processing")

    const typeError = validateFileType(file.name);
    const sourceFileType = detectSourceFileType(file.name);
    if (typeError || !sourceFileType) {
      onFileParsed({
        fileName: file.name,
        fileSizeBytes: file.size,
        sourceFileType: sourceFileType ?? 'excel',
        table: { headers: [], rows: [] },
        validation: { valid: false, errors: [typeError ?? 'ไม่รองรับไฟล์นี้'] },
        rowCount: 0,
        pageCount: null,
        isScannedPdf: false,
      });
      e.target.value = '';
      return;
    }

    setProcessingStage(sourceFileType === 'pdf' ? 'กำลังอ่านไฟล์ PDF...' : 'กำลังตรวจสอบไฟล์...');
    try {
      if (sourceFileType === 'pdf') {
        let extraction;
        try {
          extraction = await extractPdfToRawTable(file);
        } catch (err) {
          onFileParsed({
            fileName: file.name,
            fileSizeBytes: file.size,
            sourceFileType: 'pdf',
            table: { headers: [], rows: [] },
            validation: { valid: false, errors: [err instanceof Error ? err.message : 'ไม่สามารถอ่านไฟล์ PDF นี้ได้'] },
            rowCount: 0,
            pageCount: null,
            isScannedPdf: false,
          });
          return;
        }

        if (extraction.isScanned) {
          onFileParsed({
            fileName: file.name,
            fileSizeBytes: file.size,
            sourceFileType: 'pdf',
            table: { headers: [], rows: [] },
            validation: { valid: false, errors: [SCANNED_PDF_MESSAGE] },
            rowCount: 0,
            pageCount: extraction.pageCount,
            isScannedPdf: true,
          });
          return;
        }

        onFileParsed({
          fileName: file.name,
          fileSizeBytes: file.size,
          sourceFileType: 'pdf',
          table: extraction.table,
          validation: validateParsedTable(extraction.table),
          rowCount: countDataRows(extraction.table),
          pageCount: extraction.pageCount,
          isScannedPdf: false,
        });
        return;
      }

      const table = await parseFileToRawTable(file);
      onFileParsed({
        fileName: file.name,
        fileSizeBytes: file.size,
        sourceFileType,
        table,
        validation: validateParsedTable(table),
        rowCount: countDataRows(table),
        pageCount: null,
        isScannedPdf: false,
      });
    } catch {
      onFileParsed({
        fileName: file.name,
        fileSizeBytes: file.size,
        sourceFileType,
        table: { headers: [], rows: [] },
        validation: { valid: false, errors: ['อ่านไฟล์ไม่สำเร็จ กรุณาตรวจสอบว่าไฟล์ไม่เสียหายและเป็นรูปแบบที่รองรับ'] },
        rowCount: 0,
        pageCount: null,
        isScannedPdf: false,
      });
    } finally {
      setProcessingStage(null);
      // เคลียร์ค่า input เพื่อให้เลือกไฟล์ชื่อเดิมซ้ำอีกครั้งได้
      e.target.value = '';
    }
  }

  return (
    <div className="card-surface rounded-2xl p-6" data-testid={`${testIdPrefix}-upload-card`}>
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-light text-primary">
          <Icon size={22} aria-hidden="true" />
        </div>
        <h3 className="text-sm font-bold text-text">{title}</h3>
      </div>

      <label
        className={`btn-press inline-flex items-center rounded-[10px] bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover ${
          processingStage ? 'pointer-events-none opacity-60' : 'cursor-pointer'
        }`}
      >
        {buttonLabel}
        <input
          type="file"
          accept=".xlsx,.xls,.csv,.pdf"
          onChange={handleFileChange}
          disabled={Boolean(processingStage)}
          className="hidden"
          data-testid={`${testIdPrefix}-file-input`}
        />
      </label>
      <p className="mt-2 text-xs text-text-sub" data-testid={`${testIdPrefix}-helper-text`}>
        รองรับ Excel, CSV และ PDF
      </p>

      {processingStage && (
        <p className="mt-3 text-sm text-text-sub" data-testid={`${testIdPrefix}-processing`}>
          {processingStage}
        </p>
      )}

      {!processingStage && fileState && (
        <div className="mt-4 space-y-1.5 text-sm">
          <p className="text-text" data-testid={`${testIdPrefix}-file-name`}>
            ไฟล์: <span className="font-medium">{fileState.fileName}</span>
          </p>
          <p className="text-text-sub" data-testid={`${testIdPrefix}-file-type`}>
            ประเภทไฟล์: {SOURCE_FILE_TYPE_LABELS[fileState.sourceFileType]}
            <span className="font-numeric"> · {formatFileSize(fileState.fileSizeBytes)}</span>
            {fileState.pageCount !== null && <span className="font-numeric"> · {fileState.pageCount} หน้า</span>}
          </p>
          <p className="font-numeric text-text-sub" data-testid={`${testIdPrefix}-row-count`}>
            จำนวนแถว: {fileState.rowCount.toLocaleString('th-TH')} แถว
          </p>
          {fileState.validation.valid ? (
            <p className="flex items-center gap-1.5 text-success" data-testid={`${testIdPrefix}-validation-status`}>
              <CheckCircle2 size={16} aria-hidden="true" /> ผ่านการตรวจสอบ
            </p>
          ) : (
            <div
              role="alert"
              className="flex items-start gap-1.5 rounded-[10px] border border-danger/20 bg-danger/10 px-3 py-2 text-danger"
              data-testid={`${testIdPrefix}-validation-status`}
            >
              <XCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{fileState.validation.errors.join(' / ')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
