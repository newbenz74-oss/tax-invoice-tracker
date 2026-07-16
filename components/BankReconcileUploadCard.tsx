'use client';

import { useState } from 'react';
import { CheckCircle2, XCircle, type LucideIcon } from 'lucide-react';
import { parseFileToRawTable } from '@/lib/bankReconcileParse';
import { countDataRows, validateFileType, validateParsedTable } from '@/lib/bankReconcileValidation';
import type { UploadedFileState } from '@/types/bankReconcile';

interface BankReconcileUploadCardProps {
  icon: LucideIcon;
  title: string;
  buttonLabel: string;
  fileState: UploadedFileState | null;
  onFileParsed: (state: UploadedFileState) => void;
  testIdPrefix: string;
}

/** การ์ดอัปโหลดไฟล์ 1 ใบ — ใช้ซ้ำทั้ง Bank Statement และ GL จากระบบ Express (ต่างกันแค่ title/buttonLabel/
 * icon/testIdPrefix) รับผิดชอบการอ่าน+ตรวจสอบไฟล์ทั้งหมดในตัวเอง (เหมือนธรรมเนียมเดิมของ
 * components/ExcelImportPanel.tsx ที่ handleFileChange อ่าน+parse+ตรวจสอบเสร็จในที่เดียว) แล้วรายงานผล
 * ขึ้นไปให้ BankReconcilePage (parent) เก็บ state ไว้ตัดสินใจเปิด/ปิดปุ่ม "ถัดไป" เท่านั้น
 *
 * ปุ่มเลือกไฟล์คลิกซ้ำได้เสมอแม้เลือกไฟล์ไปแล้ว (ไม่ disable) — ทำให้ผู้ใช้เปลี่ยนเฉพาะไฟล์ใบนี้ใบเดียวได้
 * โดยไม่ต้องกดล้างไฟล์ทั้งหมด ส่วนปุ่ม "ล้างไฟล์" ที่ล้างทั้งสองใบพร้อมกันควบคุมจาก BankReconcilePage ผ่าน
 * การเปลี่ยน key เพื่อ remount การ์ดนี้ใหม่ทั้งหมด (คืนสู่สถานะเริ่มต้น) */
export default function BankReconcileUploadCard({
  icon: Icon,
  title,
  buttonLabel,
  fileState,
  onFileParsed,
  testIdPrefix,
}: BankReconcileUploadCardProps) {
  const [isProcessing, setIsProcessing] = useState(false);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    try {
      const typeError = validateFileType(file.name);
      if (typeError) {
        onFileParsed({
          fileName: file.name,
          table: { headers: [], rows: [] },
          validation: { valid: false, errors: [typeError] },
          rowCount: 0,
        });
        return;
      }

      const table = await parseFileToRawTable(file);
      onFileParsed({
        fileName: file.name,
        table,
        validation: validateParsedTable(table),
        rowCount: countDataRows(table),
      });
    } catch {
      onFileParsed({
        fileName: file.name,
        table: { headers: [], rows: [] },
        validation: {
          valid: false,
          errors: ['อ่านไฟล์ไม่สำเร็จ กรุณาตรวจสอบว่าไฟล์ไม่เสียหายและเป็นรูปแบบที่รองรับ'],
        },
        rowCount: 0,
      });
    } finally {
      setIsProcessing(false);
      // เคลียร์ค่า input เพื่อให้เลือกไฟล์ชื่อเดิมซ้ำอีกครั้งได้ (เช่น แก้ไฟล์แล้วอัปโหลดทับด้วยชื่อเดิม)
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

      <label className="btn-press inline-flex cursor-pointer items-center rounded-[10px] bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover">
        {buttonLabel}
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleFileChange}
          className="hidden"
          data-testid={`${testIdPrefix}-file-input`}
        />
      </label>

      {isProcessing && <p className="mt-3 text-sm text-text-sub">กำลังตรวจสอบไฟล์...</p>}

      {!isProcessing && fileState && (
        <div className="mt-4 space-y-1.5 text-sm">
          <p className="text-text" data-testid={`${testIdPrefix}-file-name`}>
            ไฟล์: <span className="font-medium">{fileState.fileName}</span>
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
