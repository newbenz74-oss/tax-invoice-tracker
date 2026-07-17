'use client';

import { useState, type ChangeEvent, type DragEvent } from 'react';
import { CheckCircle2, UploadCloud } from 'lucide-react';

export interface BankReconcileFileSummary {
  fileName: string;
  rowCount: number;
  warnings: string[];
}

interface BankReconcileUploadPanelProps {
  title: string;
  description: string;
  testId: string;
  fileSummary: BankReconcileFileSummary | null;
  loading: boolean;
  error: string | null;
  onFileSelected: (file: File) => void;
}

const ACCEPT = '.xlsx,.xls,.csv,.pdf';

/** แผงอัปโหลดไฟล์ 1 ช่อง — ใช้ซ้ำ 2 จุดในหน้ากระทบยอด (Bank Statement และ GL) ต่างกันแค่ title/testId/
 * callback ที่ส่งเข้ามา ดีไซน์เป็น dropzone (คลิกหรือลากไฟล์มาวางก็ได้) ตามสไตล์ "modern accounting
 * software" ที่ระบุในสเปก — รองรับ Excel / CSV / PDF ตามที่สเปกกำหนดไว้ */
export default function BankReconcileUploadPanel({
  title,
  description,
  testId,
  fileSummary,
  loading,
  error,
  onFileSelected,
}: BankReconcileUploadPanelProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onFileSelected(file);
    e.target.value = ''; // เคลียร์ค่า input เพื่อให้เลือกไฟล์ชื่อเดิมซ้ำได้อีกครั้งถ้าต้องการ
  }

  function handleDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFileSelected(file);
  }

  const visibleWarnings = fileSummary?.warnings.slice(0, 3) ?? [];
  const extraWarningCount = fileSummary ? fileSummary.warnings.length - visibleWarnings.length : 0;

  return (
    <div className="card-surface rounded-2xl p-5" data-testid={`${testId}-panel`}>
      <h3 className="text-sm font-bold text-text">{title}</h3>
      <p className="mt-1 text-xs text-text-sub">{description}</p>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        className={`btn-press mt-4 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[10px] border-2 border-dashed px-4 py-6 text-center text-sm font-medium transition-colors duration-150 ${
          isDragOver ? 'border-primary bg-primary-light text-primary' : 'border-border bg-page-bg text-text-sub hover:border-primary/40 hover:bg-primary-light/40'
        } ${loading ? 'pointer-events-none opacity-60' : ''}`}
      >
        <UploadCloud size={20} aria-hidden="true" />
        <span>{loading ? 'กำลังอ่านไฟล์...' : 'คลิกเพื่อเลือกไฟล์ หรือลากไฟล์มาวางที่นี่'}</span>
        <span className="text-xs font-normal text-text-sub">รองรับ Excel, CSV, PDF</span>
        <input
          type="file"
          accept={ACCEPT}
          onChange={handleChange}
          disabled={loading}
          className="hidden"
          data-testid={`${testId}-input`}
        />
      </label>

      {fileSummary && !error && (
        <div
          className="mt-3 flex items-center gap-2 rounded-[10px] bg-success/10 px-3 py-2 text-xs text-success"
          data-testid={`${testId}-success`}
        >
          <CheckCircle2 size={14} aria-hidden="true" />
          <span>
            {fileSummary.fileName} — พบ {fileSummary.rowCount.toLocaleString('th-TH')} รายการ
          </span>
        </div>
      )}

      {fileSummary && visibleWarnings.length > 0 && (
        <div className="mt-2 rounded-[10px] bg-warning/10 px-3 py-2 text-xs text-warning" data-testid={`${testId}-warnings`}>
          {visibleWarnings.join(' / ')}
          {extraWarningCount > 0 ? ` และอีก ${extraWarningCount} รายการ` : ''}
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-[10px] border border-danger/20 bg-danger/10 px-3 py-2 text-xs text-danger"
          data-testid={`${testId}-error`}
        >
          {error}
        </p>
      )}
    </div>
  );
}
