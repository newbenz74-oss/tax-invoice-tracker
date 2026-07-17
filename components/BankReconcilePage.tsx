'use client';

import { useEffect, useState } from 'react';
import { FileSpreadsheet, Landmark } from 'lucide-react';
import BankReconcileUploadCard from './BankReconcileUploadCard';
import BankReconcileColumnMapping from './BankReconcileColumnMapping';
import BankReconcileResults from './BankReconcileResults';
import BankReconcileSessionList from './BankReconcileSessionList';
import { fetchSessionDetail } from '@/lib/bankReconcileSessionApi';
import { resetBankReconcileDirty } from '@/lib/bankReconcileNavGuard';
import type { BankColumnKey, BankColumnMapping, GLColumnKey, GLColumnMapping, UploadedFileState } from '@/types/bankReconcile';
import type { LoadedSessionData } from '@/types/bankReconcileSession';

type Step = 'list' | 'upload' | 'mapping' | 'done';

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
 * Bank Reconcile — หน้ารวมทุกขั้นตอนของโมดูล ตั้งแต่เฟส 4 (2026-07-16) เป็นต้นไป จุดเริ่มต้น (step แรก) ของ
 * หน้านี้เปลี่ยนจาก 'upload' เป็น 'list' (หน้ารายการ "ประวัติการกระทบยอดธนาคาร" — สเปกส่วน "6. SESSION LIST
 * PAGE") — ทุก state ของเฟส 1-3 ที่มีอยู่แล้วด้านล่างนี้ไม่ถูกแก้ไขพฤติกรรมเลย มีแค่เพิ่ม step ใหม่คั่นก่อนหน้า
 * เดิม + เพิ่มสองเส้นทางนำทางใหม่ (สร้างรอบใหม่ / เปิดรอบเดิม) เข้ามาเท่านั้น
 *
 * ขั้นตอน (step) ในหน้านี้:
 * 0. list    — หน้ารายการรอบกระทบยอดทั้งหมด (ดู BankReconcileSessionList) เป็น step เริ่มต้นของเมนูนี้เสมอ
 *              มีปุ่ม "+ สร้างรอบกระทบยอดใหม่" (ไป step 'upload' แบบเดิมทุกประการ) และปุ่ม "เปิด" ต่อแถว (โหลด
 *              รอบที่บันทึกไว้แล้วทั้งชุดผ่าน fetchSessionDetail แล้วข้ามไป step 'done' ตรงๆ โดยไม่ผ่าน
 *              'upload'/'mapping' เลย — ตามสเปกส่วน "8. OPEN EXISTING SESSION" ที่ห้ามรันจับคู่อัตโนมัติซ้ำ)
 * 1. upload  — อัปโหลด Bank Statement + GL สองการ์ด ตรวจสอบไฟล์ทันทีที่เลือก (ดู BankReconcileUploadCard) —
 *              พฤติกรรมเดิมทุกประการจากเฟส 1 มีเพิ่มแค่ลิงก์ "← กลับไปหน้ารายการ" เส้นเดียวที่ด้านบน
 * 2. mapping — จับคู่คอลัมน์ + พรีวิวข้อมูลหลัง normalize (ดู BankReconcileColumnMapping) แสดงเมื่อไฟล์
 *              ทั้งสองผ่านการตรวจสอบแล้วเท่านั้น — ไม่แตะเลยตั้งแต่เฟส 1
 * 3. done    — แสดงผลการกระทบยอดจริงผ่าน BankReconcileResults (เครื่องมือจับคู่รายการ + ตารางผลลัพธ์ + KPI +
 *              ตั้งแต่เฟส 4: การบันทึก/auto-save/completion/reopen/export/audit log ทั้งหมด) เข้าถึงได้สองทาง:
 *              (ก) จากการอัปโหลดไฟล์ใหม่ผ่าน upload→mapping ตามเดิม (loadedSession เป็น null, bankFile/glFile
 *              เป็นของจริงจากการอัปโหลด) หรือ (ข) จากการเปิดรอบเดิมที่หน้า list (loadedSession เป็นข้อมูลที่โหลด
 *              มา, bankFile/glFile เป็น null เสมอ) — ดูรายละเอียดที่คอมเมนต์บน prop loadedSession ของ
 *              BankReconcileResults.tsx โดยตรง คง id ของ step ไว้เป็น 'done' เหมือนเดิมโดยตั้งใจเพื่อลด diff
 *
 * key={loadedSession?.session.id ?? 'new'} บน BankReconcileResults ด้านล่าง เป็นการป้องกันสองชั้น (defense in
 * depth) ให้ React บังคับ unmount/remount ทุกครั้งที่เปลี่ยนไปเปิดคนละรอบ แม้ในทางปฏิบัติการ conditional render
 * ของ step ('done' หายไปตอนกลับหน้า list แล้วโผล่ใหม่ตอนเปิดรอบถัดไป) จะทำให้ unmount/remount เกิดขึ้นเองอยู่
 * แล้วก็ตาม — ตามแนวทางเดียวกับ key={editingInvoice?.id ?? 'new'} ที่ใช้อยู่แล้วใน app/dashboard/page.tsx
 */
export default function BankReconcilePage() {
  const [step, setStep] = useState<Step>('list');
  // เปลี่ยนค่านี้ทุกครั้งที่กด "ล้างไฟล์" หรือ "สร้างรอบกระทบยอดใหม่" แล้วใช้เป็น key ของการ์ดทั้งสองใบ เพื่อ
  // บังคับ remount กลับสู่สถานะเริ่มต้นทั้งหมด (input ที่เลือกไว้/สถานะ isProcessing ภายในการ์ด) โดยไม่ต้องเพิ่ม
  // reset() แยก — เป็นเทคนิคเดียวกับที่ใช้อยู่แล้วใน app/dashboard/page.tsx (key={editingInvoice?.id ?? 'new'})
  const [resetCounter, setResetCounter] = useState(0);

  const [bankFile, setBankFile] = useState<UploadedFileState | null>(null);
  const [glFile, setGlFile] = useState<UploadedFileState | null>(null);
  const [bankMapping, setBankMapping] = useState<BankColumnMapping>(EMPTY_BANK_MAPPING);
  const [glMapping, setGlMapping] = useState<GLColumnMapping>(EMPTY_GL_MAPPING);

  // เฟส 4: ข้อมูลรอบกระทบยอดที่โหลดมาจากหน้ารายการ (ปุ่ม "เปิด") — ไม่ใช่ null เฉพาะตอนเปิดรอบเดิมเท่านั้น
  const [loadedSession, setLoadedSession] = useState<LoadedSessionData | null>(null);
  const [openingSessionId, setOpeningSessionId] = useState<string | null>(null);
  const [openSessionError, setOpenSessionError] = useState<string | null>(null);

  // เฟส 4: รีเซ็ต flag "มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก" ทุกครั้งที่เข้าเมนูนี้ใหม่ กันค่าเก่าจากรอบก่อนหน้า
  // ค้างข้ามการนำทางเข้า-ออกเมนูนี้หลายรอบ (ดู lib/bankReconcileNavGuard.ts — เป็น module-level flag ธรรมดา
  // ไม่ผูกกับ lifecycle ของ component นี้โดยอัตโนมัติ จึงต้องรีเซ็ตเองตรงนี้)
  useEffect(() => {
    resetBankReconcileDirty();
  }, []);

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

  /** ปุ่ม "+ สร้างรอบกระทบยอดใหม่" บนหน้ารายการ — ล้าง state ของรอบที่เคยเปิดไว้ (ถ้ามี) ทั้งหมดก่อนเข้าสู่
   * flow อัปโหลดไฟล์เดิมของเฟส 1 ทุกประการ */
  function handleCreateNew() {
    setOpenSessionError(null);
    setLoadedSession(null);
    setBankFile(null);
    setGlFile(null);
    setBankMapping(EMPTY_BANK_MAPPING);
    setGlMapping(EMPTY_GL_MAPPING);
    setResetCounter((n) => n + 1);
    setStep('upload');
  }

  /** ปุ่ม "เปิด" ต่อแถวบนหน้ารายการ — โหลดข้อมูลรอบกระทบยอดที่บันทึกไว้ทั้งชุดจาก Supabase ครั้งเดียว แล้วส่ง
   * เข้า BankReconcileResults ผ่าน prop loadedSession โดยตรง ข้ามขั้นตอน upload/mapping ไปเลย (ไม่รันจับคู่
   * อัตโนมัติซ้ำ ตามสเปกส่วน "8. OPEN EXISTING SESSION") — bankFile/glFile ตั้งเป็น null เสมอในเส้นทางนี้ (ดู
   * คอมเมนต์ที่ prop เดียวกันใน BankReconcileResults.tsx) */
  async function handleOpenSession(sessionId: string) {
    setOpenSessionError(null);
    setOpeningSessionId(sessionId);
    try {
      const detail = await fetchSessionDetail(sessionId);
      setLoadedSession(detail);
      setBankFile(null);
      setGlFile(null);
      setBankMapping(EMPTY_BANK_MAPPING);
      setGlMapping(EMPTY_GL_MAPPING);
      setStep('done');
    } catch (err) {
      console.error('[BankReconcilePage] เปิดรอบกระทบยอดไม่สำเร็จ', err);
      setOpenSessionError('เปิดรอบกระทบยอดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง — การเชื่อมต่อฐานข้อมูลอาจขัดข้องชั่วคราว');
    } finally {
      setOpeningSessionId(null);
    }
  }

  /** ลิงก์ "← กลับไปหน้ารายการ" จากขั้นตอน upload (ยังไม่มีอะไรให้เสียดาย — ไฟล์ที่เลือกไว้ยังไม่ผ่านการ
   * ประมวลผลกระทบยอดใดๆ เลย เหมือนปุ่ม "ล้างไฟล์" เดิมที่ไม่มีการยืนยันอยู่แล้วในเฟส 1) */
  function handleBackToListFromUpload() {
    setBankFile(null);
    setGlFile(null);
    setBankMapping(EMPTY_BANK_MAPPING);
    setGlMapping(EMPTY_GL_MAPPING);
    setStep('list');
  }

  /** ส่งเป็น prop onBackToList ให้ BankReconcileResults เรียกกลับมา — ตัวคอมโพเนนต์นั้นเป็นผู้ตัดสินใจเองแล้วว่า
   * ต้องแสดงกล่องยืนยัน "มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก" ก่อนหรือไม่ (ดู attemptLeave() ใน
   * BankReconcileResults.tsx) — ฟังก์ชันนี้จึงแค่เคลียร์ loadedSession แล้วกลับหน้า list ตรงๆ โดยไม่ต้องยืนยัน
   * ซ้ำอีกชั้น */
  function handleBackToList() {
    setLoadedSession(null);
    setStep('list');
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-8" data-testid="bank-reconcile-page">
      <p className="mb-6 text-sm font-medium text-text-sub" data-testid="bank-reconcile-step-indicator">
        {step === 'list' && 'ประวัติการกระทบยอดธนาคาร'}
        {step === 'upload' && 'ขั้นตอนที่ 1 จาก 2: อัปโหลดไฟล์'}
        {step === 'mapping' && 'ขั้นตอนที่ 2 จาก 2: จับคู่คอลัมน์และตรวจสอบข้อมูล'}
        {step === 'done' && 'ผลการกระทบยอดรายการ'}
      </p>

      {step === 'list' && (
        <div className="space-y-3">
          {openSessionError && (
            <p
              role="alert"
              className="rounded-[10px] border border-danger/20 bg-danger/10 px-3.5 py-2.5 text-sm text-danger"
              data-testid="session-list-open-error"
            >
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
          onSave={() => setStep('done')}
        />
      )}

      {step === 'done' && (loadedSession || (bankFile && glFile)) && (
        <BankReconcileResults
          key={loadedSession?.session.id ?? 'new'}
          bankFile={bankFile}
          glFile={glFile}
          bankMapping={bankMapping}
          glMapping={glMapping}
          onBack={() => setStep('mapping')}
          onBackToList={handleBackToList}
          loadedSession={loadedSession}
        />
      )}
    </main>
  );
}
