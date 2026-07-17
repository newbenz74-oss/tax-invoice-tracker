'use client';

import { useEffect, useState } from 'react';
import { FileSpreadsheet, Landmark } from 'lucide-react';
import BankReconcileUploadCard from './BankReconcileUploadCard';
import BankReconcileColumnMapping from './BankReconcileColumnMapping';
import BankReconcilePreview from './BankReconcilePreview';
import BankReconcileResults from './BankReconcileResults';
import BankReconcileSessionList from './BankReconcileSessionList';
import { buildBankRows, buildGLRows } from '@/lib/bankReconcileNormalize';
import { fetchSessionDetail } from '@/lib/bankReconcileSessionApi';
import { resetBankReconcileDirty } from '@/lib/bankReconcileNavGuard';
import type { BankColumnKey, BankColumnMapping, BankRow, GLColumnKey, GLColumnMapping, GLRow, UploadedFileState } from '@/types/bankReconcile';
import type { LoadedSessionData } from '@/types/bankReconcileSession';

type Step = 'list' | 'upload' | 'mapping' | 'preview' | 'done';

const EMPTY_BANK_MAPPING: BankColumnMapping = {
  transactionDate: null,
  description: null,
  moneyIn: null,
  moneyOut: null,
  balance: null,
  accountNo: null,
};

const EMPTY_GL_MAPPING: GLColumnMapping = {
  date: null,
  description: null,
  moneyIn: null,
  moneyOut: null,
  docNo: null,
  accountCode: null,
};

/**
 * Bank Reconcile — หน้ารวมทุกขั้นตอนของโมดูล เขียนใหม่ทั้งไฟล์ 2026-07-17 พร้อมกับการ rebuild โมดูลทั้งโมดูล
 * ตามสเปก "REBUILD Bank Reconcile module from scratch" คงสัญญา default export ไม่มี prop บังคับไว้เหมือนเดิม
 * ทุกประการ (app/dashboard/page.tsx เรียก <BankReconcilePage /> ตรงๆ — ดูข้อจำกัด "Do not modify ... Sidebar,
 * or unrelated routes" — ไฟล์นี้และ app/dashboard/page.tsx/lib/navigation.ts ไม่ถูกแตะเลยแม้แต่บรรทัดเดียว)
 *
 * ขั้นตอน (step) ในหน้านี้ — เพิ่ม step ใหม่ 'preview' คั่นระหว่าง 'mapping' กับ 'done' จากเดิม (สเปกส่วน "12.
 * PREVIEW BEFORE RECONCILIATION" — "Do not start reconciliation until all included rows are valid"):
 * 0. list    — หน้ารายการรอบกระทบยอดทั้งหมด (BankReconcileSessionList) จุดเริ่มต้นเสมอ
 * 1. upload  — อัปโหลด Bank Statement + GL สองการ์ด (BankReconcileUploadCard, รองรับ Excel/CSV/PDF)
 * 2. mapping — จับคู่คอลัมน์ (BankReconcileColumnMapping) กดบันทึกแล้วสร้าง BankRow[]/GLRow[] ผ่าน
 *              buildBankRows/buildGLRows (lib/bankReconcileNormalize.ts) ทันที ก่อนไป step ถัดไป
 * 3. preview — ตรวจสอบ/แก้ไขข้อมูลก่อนกระทบยอด (BankReconcilePreview) กด "เริ่มกระทบยอด" แล้วไป 'done'
 * 4. done    — แสดงผลการกระทบยอดจริง (BankReconcileResults) เข้าถึงได้สองทาง: (ก) อัปโหลดไฟล์ใหม่ผ่าน
 *              upload→mapping→preview ตามลำดับ (loadedSession เป็น null, onBack กลับไป 'preview' ได้) หรือ
 *              (ข) เปิดรอบเดิมจากหน้ารายการ (loadedSession มีข้อมูล, onBack เป็น null เสมอ — ไม่มีทางย้อนกลับ
 *              ไปแก้ไขข้อมูลดิบของรอบที่บันทึกไว้แล้วผ่านหน้าจอนี้ เป็นดุลยพินิจที่ตัดสินใจเอง เพื่อไม่ให้ธง
 *              ตรวจสอบที่ผูกกับ id ของแถวที่โหลดมาสับสนถ้าข้อมูลดิบถูกแก้ไขทีหลัง — ระบุไว้ในสรุปผลตอนส่งมอบ)
 *
 * key={loadedSession?.session.id ?? 'new'} บน BankReconcileResults ป้องกันสองชั้นให้ React unmount/remount
 * ทุกครั้งที่เปลี่ยนไปเปิดคนละรอบ — มิเรอร์เทคนิคเดียวกับ key={editingInvoice?.id ?? 'new'} ที่ใช้อยู่แล้วใน
 * app/dashboard/page.tsx
 */
export default function BankReconcilePage() {
  const [step, setStep] = useState<Step>('list');
  const [resetCounter, setResetCounter] = useState(0);

  const [bankFile, setBankFile] = useState<UploadedFileState | null>(null);
  const [glFile, setGlFile] = useState<UploadedFileState | null>(null);
  const [bankMapping, setBankMapping] = useState<BankColumnMapping>(EMPTY_BANK_MAPPING);
  const [glMapping, setGlMapping] = useState<GLColumnMapping>(EMPTY_GL_MAPPING);
  const [bankRows, setBankRows] = useState<BankRow[]>([]);
  const [glRows, setGlRows] = useState<GLRow[]>([]);
  /** true = มาถึง step 'done' ผ่านเส้นทางอัปโหลดไฟล์ใหม่ (upload→mapping→preview) เท่านั้น — ควบคุมว่า
   * BankReconcileResults ควรแสดงปุ่ม "ย้อนกลับไปแก้ไขข้อมูล" หรือไม่ (ดูคอมเมนต์ที่ prop onBack ของ
   * BankReconcileResults.tsx) */
  const [cameFromPreview, setCameFromPreview] = useState(false);

  const [loadedSession, setLoadedSession] = useState<LoadedSessionData | null>(null);
  const [openingSessionId, setOpeningSessionId] = useState<string | null>(null);
  const [openSessionError, setOpenSessionError] = useState<string | null>(null);

  useEffect(() => {
    resetBankReconcileDirty();
  }, []);

  const bothFilesValid = Boolean(bankFile?.validation.valid && glFile?.validation.valid);

  function handleBankFileParsed(state: UploadedFileState) {
    setBankFile(state);
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

  /** ปุ่ม "ถัดไป: ตรวจสอบข้อมูล" ของขั้นตอนจับคู่คอลัมน์ — สร้าง BankRow[]/GLRow[] จากไฟล์ + การจับคู่ที่เลือก
   * ไว้ทันที (ครั้งเดียวตรงนี้เท่านั้น — ขั้นตอนพรีวิวถัดไปแก้ไขค่าที่ normalize แล้วโดยตรง ไม่ normalize ซ้ำ) */
  function handleMappingSave() {
    if (!bankFile || !glFile) return;
    setBankRows(buildBankRows(bankFile.table, bankMapping));
    setGlRows(buildGLRows(glFile.table, glMapping));
    setStep('preview');
  }

  function handleStartReconciliation() {
    setLoadedSession(null);
    setCameFromPreview(true);
    setStep('done');
  }

  function handleCreateNew() {
    setOpenSessionError(null);
    setLoadedSession(null);
    setCameFromPreview(false);
    setBankFile(null);
    setGlFile(null);
    setBankMapping(EMPTY_BANK_MAPPING);
    setGlMapping(EMPTY_GL_MAPPING);
    setBankRows([]);
    setGlRows([]);
    setResetCounter((n) => n + 1);
    setStep('upload');
  }

  async function handleOpenSession(sessionId: string) {
    setOpenSessionError(null);
    setOpeningSessionId(sessionId);
    try {
      const detail = await fetchSessionDetail(sessionId);
      setLoadedSession(detail);
      setCameFromPreview(false);
      setStep('done');
    } catch (err) {
      console.error('[BankReconcilePage] เปิดรอบกระทบยอดไม่สำเร็จ', err);
      setOpenSessionError('เปิดรอบกระทบยอดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง — การเชื่อมต่อฐานข้อมูลอาจขัดข้องชั่วคราว');
    } finally {
      setOpeningSessionId(null);
    }
  }

  function handleBackToListFromUpload() {
    setBankFile(null);
    setGlFile(null);
    setBankMapping(EMPTY_BANK_MAPPING);
    setGlMapping(EMPTY_GL_MAPPING);
    setStep('list');
  }

  function handleBackToList() {
    setLoadedSession(null);
    setStep('list');
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-8" data-testid="bank-reconcile-page">
      <p className="mb-6 text-sm font-medium text-text-sub" data-testid="bank-reconcile-step-indicator">
        {step === 'list' && 'ประวัติการกระทบยอดธนาคาร'}
        {step === 'upload' && 'ขั้นตอนที่ 1 จาก 3: อัปโหลดไฟล์'}
        {step === 'mapping' && 'ขั้นตอนที่ 2 จาก 3: จับคู่คอลัมน์'}
        {step === 'preview' && 'ขั้นตอนที่ 3 จาก 3: ตรวจสอบข้อมูลก่อนกระทบยอด'}
        {step === 'done' && 'ผลการกระทบยอดรายการ'}
      </p>

      {step === 'list' && (
        <div className="space-y-3">
          {openSessionError && (
            <p role="alert" className="rounded-[10px] border border-danger/20 bg-danger/10 px-3.5 py-2.5 text-sm text-danger" data-testid="session-list-open-error">
              {openSessionError}
            </p>
          )}
          {openingSessionId && (
            <p className="text-xs text-text-sub" data-testid="session-list-opening">
              กำลังเปิดรอบกระทบยอด...
            </p>
          )}
          <BankReconcileSessionList onCreateNew={handleCreateNew} onOpenSession={handleOpenSession} />
        </div>
      )}

      {step === 'upload' && (
        <div className="space-y-6">
          <button
            type="button"
            onClick={handleBackToListFromUpload}
            className="btn-press text-sm font-medium text-text-sub hover:text-primary"
            data-testid="upload-back-to-list"
          >
            ← กลับไปหน้ารายการ
          </button>

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
          onSave={handleMappingSave}
        />
      )}

      {step === 'preview' && (
        <BankReconcilePreview
          bankRows={bankRows}
          glRows={glRows}
          onBankRowsChange={setBankRows}
          onGlRowsChange={setGlRows}
          onBack={() => setStep('mapping')}
          onStartReconciliation={handleStartReconciliation}
        />
      )}

      {step === 'done' && (loadedSession || bankRows.length > 0) && (
        <BankReconcileResults
          key={loadedSession?.session.id ?? 'new'}
          bankRows={bankRows}
          glRows={glRows}
          bankFileName={loadedSession?.session.bank_file_name ?? bankFile?.fileName ?? ''}
          glFileName={loadedSession?.session.gl_file_name ?? glFile?.fileName ?? ''}
          bankSourceFileType={loadedSession?.session.bank_source_file_type ?? bankFile?.sourceFileType ?? 'excel'}
          glSourceFileType={loadedSession?.session.gl_source_file_type ?? glFile?.sourceFileType ?? 'excel'}
          onBack={cameFromPreview ? () => setStep('preview') : null}
          onBackToList={handleBackToList}
          loadedSession={loadedSession}
        />
      )}
    </main>
  );
}
