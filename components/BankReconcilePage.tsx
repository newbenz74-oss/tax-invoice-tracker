'use client';

import { useState } from 'react';
import { ListChecks } from 'lucide-react';
import BankReconcileUploadPanel, { type BankReconcileFileSummary } from './BankReconcileUploadPanel';
import BankReconcileSummaryCards from './BankReconcileSummaryCards';
import BankReconcileMatchedTable from './BankReconcileMatchedTable';
import BankReconcileUnmatchedTable from './BankReconcileUnmatchedTable';
import { parseBankFile, parseGLFile } from '@/lib/bankReconcileParse';
import { reconcileTransactions } from '@/lib/bankReconcileLogic';
import type { BankTransaction, DateTolerance, GLTransaction, ReconcileResult } from '@/types/bankReconcile';

interface LoadedFile<T> {
  fileName: string;
  rows: T[];
  warnings: string[];
}

/**
 * หน้า "กระทบยอด Bank Reconcile" เวอร์ชันออกแบบใหม่ทั้งหมด (2026-07-17) — เป็น "รายงานเปรียบเทียบ" ระหว่าง
 * Bank Statement กับ GL เท่านั้น ไม่มีการแก้ไข/บันทึก/ยืนยัน/สร้างรายการบัญชีใดๆ ทั้งสิ้น ทำงานฝั่ง client
 * ล้วนๆ (parse ไฟล์ในเบราว์เซอร์ + คำนวณกระทบยอดในเบราว์เซอร์) ไม่มีการเรียก API หรือบันทึกลงฐานข้อมูล
 * ผลลัพธ์อยู่ใน memory ของหน้านี้เท่านั้น รีเฟรชหน้าแล้วต้องอัปโหลดไฟล์ใหม่เสมอ (ตั้งใจให้เป็นแบบนี้ตาม
 * สเปก — ไม่มีขั้นตอน save/history ใดๆ ถูกระบุไว้เลย)
 *
 * ขั้นตอน: อัปโหลด 2 ไฟล์ (Bank Statement, GL) → เลือกช่วงวันที่ที่ยอมรับได้ (±1 หรือ ±3 วัน) → กด
 * "ตรวจสอบข้อมูล" → แสดงผล 3 ส่วนแยกกันชัดเจน (กระทบยอดสำเร็จ / Bank ไม่สำเร็จ / GL ไม่สำเร็จ) พร้อม
 * การ์ดสรุปด้านบน
 */
export default function BankReconcilePage() {
  const [bankFile, setBankFile] = useState<LoadedFile<BankTransaction> | null>(null);
  const [glFile, setGlFile] = useState<LoadedFile<GLTransaction> | null>(null);
  const [bankLoading, setBankLoading] = useState(false);
  const [glLoading, setGlLoading] = useState(false);
  const [bankError, setBankError] = useState<string | null>(null);
  const [glError, setGlError] = useState<string | null>(null);
  const [tolerance, setTolerance] = useState<DateTolerance>(1);
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [checking, setChecking] = useState(false);

  const canCheck = Boolean(bankFile && bankFile.rows.length > 0 && glFile && glFile.rows.length > 0) && !checking;

  async function handleBankFile(file: File) {
    setBankLoading(true);
    setBankError(null);
    setBankFile(null);
    setResult(null);
    try {
      const parsed = await parseBankFile(file);
      if (parsed.errors.length > 0) {
        setBankError(parsed.errors[0]);
      } else if (parsed.rows.length === 0) {
        setBankError('ไม่พบรายการที่อ่านได้ในไฟล์นี้ กรุณาตรวจสอบข้อมูลในไฟล์');
      } else {
        setBankFile({ fileName: file.name, rows: parsed.rows, warnings: parsed.warnings });
      }
    } catch (err) {
      setBankError(err instanceof Error ? err.message : 'อ่านไฟล์ Bank Statement ไม่สำเร็จ');
    } finally {
      setBankLoading(false);
    }
  }

  async function handleGlFile(file: File) {
    setGlLoading(true);
    setGlError(null);
    setGlFile(null);
    setResult(null);
    try {
      const parsed = await parseGLFile(file);
      if (parsed.errors.length > 0) {
        setGlError(parsed.errors[0]);
      } else if (parsed.rows.length === 0) {
        setGlError('ไม่พบรายการที่อ่านได้ในไฟล์นี้ กรุณาตรวจสอบข้อมูลในไฟล์');
      } else {
        setGlFile({ fileName: file.name, rows: parsed.rows, warnings: parsed.warnings });
      }
    } catch (err) {
      setGlError(err instanceof Error ? err.message : 'อ่านไฟล์ GL ไม่สำเร็จ');
    } finally {
      setGlLoading(false);
    }
  }

  function handleCheck() {
    if (!bankFile || !glFile) return;
    setChecking(true);
    // ครอบด้วย setTimeout(…, 0) เพื่อให้ React มีโอกาส paint สถานะ "กำลังตรวจสอบ..." ก่อนเริ่มคำนวณจริง
    // (การคำนวณเป็น synchronous ล้วนๆ — ถ้าไฟล์ใหญ่มากอาจใช้เวลาหน่วงพอให้ UI ค้างได้เล็กน้อยถ้าไม่ทำแบบนี้)
    setTimeout(() => {
      const computed = reconcileTransactions(bankFile.rows, glFile.rows, tolerance);
      setResult(computed);
      setChecking(false);
    }, 0);
  }

  const bankSummary: BankReconcileFileSummary | null = bankFile
    ? { fileName: bankFile.fileName, rowCount: bankFile.rows.length, warnings: bankFile.warnings }
    : null;
  const glSummary: BankReconcileFileSummary | null = glFile
    ? { fileName: glFile.fileName, rowCount: glFile.rows.length, warnings: glFile.warnings }
    : null;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
      <p className="mb-6 text-sm text-text-sub">
        เปรียบเทียบ Bank Statement กับ GL เพื่อดูรายการที่กระทบยอดสำเร็จ และรายการที่ไม่พบข้อมูลตรงกันในอีก
        ฝั่งหนึ่ง หน้านี้เป็นรายงานสำหรับตรวจสอบเท่านั้น ไม่มีการแก้ไข ยืนยัน หรือบันทึกข้อมูลบัญชีใดๆ
      </p>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BankReconcileUploadPanel
          title="Bank Statement"
          description="รายการเดินบัญชีธนาคาร (ข้อมูลหลักที่ใช้อ้างอิงเสมอ)"
          testId="bank-upload"
          fileSummary={bankSummary}
          loading={bankLoading}
          error={bankError}
          onFileSelected={handleBankFile}
        />
        <BankReconcileUploadPanel
          title="GL"
          description="รายการบัญชีแยกประเภทที่ต้องการกระทบยอดกับ Bank Statement"
          testId="gl-upload"
          fileSummary={glSummary}
          loading={glLoading}
          error={glError}
          onFileSelected={handleGlFile}
        />
      </div>

      <div className="card-surface mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-text">ช่วงวันที่ที่ยอมรับได้</span>
          <div className="flex rounded-[10px] border border-border bg-white p-1" role="group" aria-label="เลือกช่วงวันที่ที่ยอมรับได้">
            <button
              type="button"
              onClick={() => setTolerance(1)}
              aria-pressed={tolerance === 1}
              className={`btn-press rounded-[8px] px-3.5 py-1.5 text-sm font-medium transition-colors duration-150 ${
                tolerance === 1 ? 'bg-primary text-white' : 'text-text-sub hover:bg-page-bg'
              }`}
              data-testid="tolerance-option-1"
            >
              ±1 วัน
            </button>
            <button
              type="button"
              onClick={() => setTolerance(3)}
              aria-pressed={tolerance === 3}
              className={`btn-press rounded-[8px] px-3.5 py-1.5 text-sm font-medium transition-colors duration-150 ${
                tolerance === 3 ? 'bg-primary text-white' : 'text-text-sub hover:bg-page-bg'
              }`}
              data-testid="tolerance-option-3"
            >
              ±3 วัน
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={handleCheck}
          disabled={!canCheck}
          className="btn-press flex items-center gap-1.5 rounded-[10px] bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="check-data-button"
        >
          <ListChecks size={16} aria-hidden="true" />
          {checking ? 'กำลังตรวจสอบ...' : 'ตรวจสอบข้อมูล'}
        </button>
      </div>

      {!result && (
        <div
          className="card-surface rounded-2xl border border-dashed border-border p-12 text-center text-sm text-text-sub"
          data-testid="bank-reconcile-empty"
        >
          อัปโหลดไฟล์ Bank Statement และ GL ให้ครบทั้งสองไฟล์ แล้วกด &quot;ตรวจสอบข้อมูล&quot; เพื่อเริ่มกระทบยอด
        </div>
      )}

      {result && (
        <>
          <BankReconcileSummaryCards summary={result.summary} />
          <BankReconcileMatchedTable pairs={result.matched} />
          <BankReconcileUnmatchedTable
            title="Bank Statement ไม่สำเร็จ"
            testId="bank-unmatched"
            statusText="ไม่พบข้อมูลใน GL"
            emptyText="ไม่มีรายการ Bank Statement ที่ไม่พบข้อมูลใน GL"
            rows={result.bankUnmatched}
          />
          <BankReconcileUnmatchedTable
            title="GL ไม่สำเร็จ"
            testId="gl-unmatched"
            statusText="ไม่พบข้อมูลใน Bank Statement"
            emptyText="ไม่มีรายการ GL ที่ไม่พบข้อมูลใน Bank Statement"
            rows={result.glUnmatched}
            showDocumentNo
          />
        </>
      )}
    </main>
  );
}
