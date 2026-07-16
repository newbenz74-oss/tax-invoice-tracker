'use client';

import { useState } from 'react';
import { FileSpreadsheet, Landmark } from 'lucide-react';
import BankReconcileUploadCard from './BankReconcileUploadCard';
import BankReconcileColumnMapping from './BankReconcileColumnMapping';
import BankReconcileResults from './BankReconcileResults';
import type { BankColumnKey, BankColumnMapping, GLColumnKey, GLColumnMapping, UploadedFileState } from '@/types/bankReconcile';

type Step = 'upload' | 'mapping' | 'done';

const EMPTY_BANK_MAPPING: BankColumnMapping = {
  transactionDate: null,
  description: null,
  moneyIn: null,
  moneyOut: null,
  balance: null,
};

const EMPTY_GL_MAPPING: GLColumnMapping = {
  date: null,
  docNo: null,
  description: null,
  debit: null,
  credit: null,
};

/**
 * Bank Reconcile — เฟส 1 (อัปโหลด + เตรียมข้อมูล) เท่านั้น ตามสเปกที่ระบุไว้ตรงๆ:
 * "Build Phase 1 of the Bank Reconcile module only. Do not build matching logic, result tables, export,
 * or database session saving yet." ทุก state ในไฟล์นี้เป็น client-side ล้วนๆ อยู่ในหน่วยความจำเบราว์เซอร์
 * เท่านั้น ไม่มีการเรียก Supabase ที่ไหนเลยทั้งไฟล์ (ไม่มี useSWR/fetch/insert ใดๆ ทั้งสิ้น)
 *
 * ขั้นตอน (step) ในหน้านี้:
 * 1. upload  — อัปโหลด Bank Statement + GL สองการ์ด ตรวจสอบไฟล์ทันทีที่เลือก (ดู BankReconcileUploadCard)
 * 2. mapping — จับคู่คอลัมน์ + พรีวิวข้อมูลหลัง normalize (ดู BankReconcileColumnMapping) แสดงเมื่อไฟล์
 *              ทั้งสองผ่านการตรวจสอบแล้วเท่านั้น
 * 3. done    — เดิมเป็นแค่หน้าจอสำเร็จเฉยๆ ในเฟส 1 ("ระบบกำลังพัฒนาขั้นตอนการจับคู่รายการอัตโนมัติ เร็วๆ นี้")
 *              ตั้งแต่เฟส 2 (2026-07-16) เปลี่ยนเป็นแสดงผลการกระทบยอดจริงผ่าน BankReconcileResults (เครื่องมือ
 *              จับคู่รายการ + ตารางผลลัพธ์ + KPI) แทนที่ข้อความ placeholder เดิมทั้งหมด — คง id ของ step ไว้
 *              เป็น 'done' เหมือนเดิมโดยตั้งใจ (ไม่ rename เป็น 'reconcile' หรืออื่นๆ) เพื่อลด diff ที่ไม่
 *              จำเป็นกับ state/logic ของเฟส 1 ที่ยังทำงานถูกต้องอยู่แล้ว ยังคงไม่มีการนำทางไป route ใหม่ใดๆ
 *              และไม่มีการบันทึกฐานข้อมูลใดๆ ทั้งสิ้นเช่นเดิม (เฟส 2 ก็ยังเป็น client-side ล้วนๆ)
 */
export default function BankReconcilePage() {
  const [step, setStep] = useState<Step>('upload');
  // เปลี่ยนค่านี้ทุกครั้งที่กด "ล้างไฟล์" แล้วใช้เป็น key ของการ์ดทั้งสองใบ เพื่อบังคับ remount กลับสู่
  // สถานะเริ่มต้นทั้งหมด (input ที่เลือกไว้/สถานะ isProcessing ภายในการ์ด) โดยไม่ต้องเพิ่ม reset() แยก —
  // เป็นเทคนิคเดียวกับที่ใช้อยู่แล้วใน app/dashboard/page.tsx (key={editingInvoice?.id ?? 'new'})
  const [resetCounter, setResetCounter] = useState(0);

  const [bankFile, setBankFile] = useState<UploadedFileState | null>(null);
  const [glFile, setGlFile] = useState<UploadedFileState | null>(null);
  const [bankMapping, setBankMapping] = useState<BankColumnMapping>(EMPTY_BANK_MAPPING);
  const [glMapping, setGlMapping] = useState<GLColumnMapping>(EMPTY_GL_MAPPING);

  const bothFilesValid = Boolean(bankFile?.validation.valid && glFile?.validation.valid);

  function handleBankFileParsed(state: UploadedFileState) {
    setBankFile(state);
    // ไฟล์ใหม่อาจมีจำนวน/ลำดับคอลัมน์ต่างจากไฟล์เดิม — ล้างการจับคู่คอลัมน์เดิมทิ้งเสมอเพื่อไม่ให้ index
    // ที่จับคู่ไว้ก่อนหน้าชี้ไปคอลัมน์ผิดของไฟล์ใหม่แบบเงียบๆ
    setBankMapping(EMPTY_BANK_MAPPING);
  }

  function handleGlFileParsed(state: UploadedFileState) {
    setGlFile(state);
    setGlMapping(EMPTY_GL_MAPPING);
  }

  function handleClearFiles() {
    setBankFile(null);
    setGlFile(null);
    setBankMapping(EMPTY_BANK_MAPPING);
    setGlMapping(EMPTY_GL_MAPPING);
    setResetCounter((n) => n + 1);
  }

  function handleBankMappingChange(key: BankColumnKey, value: number | null) {
    setBankMapping((prev) => ({ ...prev, [key]: value }));
  }

  function handleGlMappingChange(key: GLColumnKey, value: number | null) {
    setGlMapping((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-8" data-testid="bank-reconcile-page">
      <p className="mb-6 text-sm font-medium text-text-sub" data-testid="bank-reconcile-step-indicator">
        {step === 'upload' && 'ขั้นตอนที่ 1 จาก 2: อัปโหลดไฟล์'}
        {step === 'mapping' && 'ขั้นตอนที่ 2 จาก 2: จับคู่คอลัมน์และตรวจสอบข้อมูล'}
        {step === 'done' && 'ผลการกระทบยอดรายการ'}
      </p>

      {step === 'upload' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <BankReconcileUploadCard
              key={`bank-${resetCounter}`}
              icon={Landmark}
              title="Bank Statement"
              buttonLabel="เลือกไฟล์ Bank Statement"
              fileState={bankFile}
              onFileParsed={handleBankFileParsed}
              testIdPrefix="bank"
            />
            <BankReconcileUploadCard
              key={`gl-${resetCounter}`}
              icon={FileSpreadsheet}
              title="GL จากระบบ Express"
              buttonLabel="เลือกไฟล์ GL"
              fileState={glFile}
              onFileParsed={handleGlFileParsed}
              testIdPrefix="gl"
            />
          </div>

          <div className="flex flex-wrap justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={handleClearFiles}
              className="btn-press rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-text-sub hover:bg-page-bg"
              data-testid="clear-files"
            >
              ล้างไฟล์
            </button>
            <button
              type="button"
              onClick={() => setStep('mapping')}
              disabled={!bothFilesValid}
              className="btn-press rounded-[10px] bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="next-to-mapping"
            >
              ถัดไป: จับคู่คอลัมน์
            </button>
          </div>
        </div>
      )}

      {step === 'mapping' && bankFile && glFile && (
        <BankReconcileColumnMapping
          bankFile={bankFile}
          glFile={glFile}
          bankMapping={bankMapping}
          glMapping={glMapping}
          onBankMappingChange={handleBankMappingChange}
          onGlMappingChange={handleGlMappingChange}
          onBack={() => setStep('upload')}
          onClearMapping={() => {
            setBankMapping(EMPTY_BANK_MAPPING);
            setGlMapping(EMPTY_GL_MAPPING);
          }}
          onSave={() => setStep('done')}
        />
      )}

      {step === 'done' && bankFile && glFile && (
        <BankReconcileResults
          bankFile={bankFile}
          glFile={glFile}
          bankMapping={bankMapping}
          glMapping={glMapping}
          onBack={() => setStep('mapping')}
        />
      )}
    </main>
  );
}
