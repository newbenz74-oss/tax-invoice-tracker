'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { AlertTriangle, CheckCircle2, DatabaseBackup, Download, Loader2, RotateCcw, Upload, X } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';
import { exportCompanyBackup, restoreCompanyBackup } from '@/lib/backupApi';
import {
  BackupFileError,
  buildBackupFileName,
  countBackupRows,
  formatExportedAt,
  parseBackupFile,
} from '@/lib/backupLogic';
import { BACKUP_TABLES, BACKUP_TABLE_LABELS, type BackupFile, type RestoreMode, type RestoreResult } from '@/types/backup';

/**
 * การ์ด "สำรอง/กู้คืนข้อมูล" ในหน้าตั้งค่าบริษัท (เพิ่มเข้ามา 2026-09-08 ตามคำขอผู้ใช้ — "อยากสำรองข้อมูลออกมา
 * เป็นไฟล์ กรณีข้อมูลในเว็บหายทั้งหมด แล้วนำไฟล์กลับเข้ามาให้ครบถ้วนเหมือนเดิมได้")
 *
 * แยกเป็นไฟล์ component ของตัวเองแทนการยัดเพิ่มเข้าไปใน CompanySettingsPage.tsx (675 บรรทัดอยู่แล้ว) เพราะมี
 * วงจร async + สถานะของตัวเองครบชุด (กำลังสำรอง / อ่านไฟล์แล้วรอยืนยัน / กำลังกู้คืน / ผลลัพธ์) ไม่เกี่ยวกับ
 * ฟอร์มตั้งค่าด้านบนเลยแม้แต่ field เดียว — หลักการเดียวกับที่ DeleteCompanyModal ถูกแยกออกมาเป็น component
 * ของตัวเองในไฟล์นั้น
 *
 * กติกาความปลอดภัยของ UI นี้ (จงใจให้กดพลาดยาก เพราะการกู้คืนเขียนทับข้อมูลจริง):
 *   1. เลือกไฟล์แล้ว "ยังไม่ทำอะไรทั้งนั้น" — อ่านไฟล์มาสรุปให้ดูก่อนว่ามีอะไรอยู่กี่แถว สำรองไว้เมื่อไหร่
 *   2. ต้องเลือกโหมดกู้คืนเอง (ไม่มีค่าเริ่มต้นที่ทำลายข้อมูล — โหมดปลอดภัยถูกเลือกไว้ให้ก่อนเสมอ)
 *   3. โหมด "ล้างของเดิมก่อน" ต้องพิมพ์คำยืนยันเพิ่มอีกชั้น เหมือนกติกาการลบบริษัทที่ผู้ใช้คุ้นอยู่แล้ว
 */

const REPLACE_CONFIRM_WORD = 'confirm';

export default function CompanyBackupCard() {
  const { selectedCompany, reload } = useCompany();
  const { session } = useAuth();

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportedFileName, setExportedFileName] = useState<string | null>(null);

  const [pendingFile, setPendingFile] = useState<{ file: BackupFile; fileName: string } | null>(null);
  const [restoreMode, setRestoreMode] = useState<RestoreMode>('merge');
  const [replaceConfirmText, setReplaceConfirmText] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const busy = exporting || restoring;

  async function handleExport() {
    if (!selectedCompany) return;
    setExporting(true);
    setExportError(null);
    setExportedFileName(null);
    setProgress(null);
    try {
      const backup = await exportCompanyBackup(selectedCompany.id, session?.user.email ?? null, setProgress);
      // เขียน JSON แบบเว้นวรรค 2 ช่อง — ไฟล์ใหญ่ขึ้นเล็กน้อยแลกกับการที่ผู้ใช้เปิดดู/ตรวจสอบเองได้ว่าข้อมูล
      // อยู่ครบจริง ซึ่งเป็นคุณค่าหลักของไฟล์สำรองข้อมูลที่เก็บไว้เผื่อวันที่ข้อมูลหาย
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
      const fileName = buildBackupFileName(selectedCompany.name, new Date());
      downloadBlob(blob, fileName);
      setExportedFileName(fileName);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'สำรองข้อมูลไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setExporting(false);
      setProgress(null);
    }
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // ล้างค่า input ทันทีเสมอ เพื่อให้เลือกไฟล์เดิมซ้ำได้อีกครั้งถ้าครั้งแรกอ่านไม่ผ่าน (input[type=file] ไม่
    // ยิง onChange ถ้าเลือกไฟล์เดิมโดยไม่ล้างค่าก่อน) — แพทเทิร์นเดียวกับช่องเลือกโลโก้ในหน้านี้
    e.target.value = '';
    if (!file) return;

    setRestoreError(null);
    setRestoreResult(null);
    setReplaceConfirmText('');
    setRestoreMode('merge');
    try {
      const parsed = parseBackupFile(await file.text());
      setPendingFile({ file: parsed, fileName: file.name });
    } catch (err) {
      setPendingFile(null);
      setRestoreError(
        err instanceof BackupFileError || err instanceof Error ? err.message : 'อ่านไฟล์สำรองข้อมูลไม่สำเร็จ'
      );
    }
  }

  function handleCancelRestore() {
    if (restoring) return;
    setPendingFile(null);
    setReplaceConfirmText('');
    setRestoreError(null);
  }

  async function handleConfirmRestore() {
    if (!selectedCompany || !pendingFile) return;
    if (restoreMode === 'replace' && replaceConfirmText.trim().toLowerCase() !== REPLACE_CONFIRM_WORD) return;

    setRestoring(true);
    setRestoreError(null);
    setRestoreResult(null);
    try {
      const result = await restoreCompanyBackup(selectedCompany.id, pendingFile.file, restoreMode, setProgress);
      setRestoreResult(result);
      setPendingFile(null);
      setReplaceConfirmText('');
      // ข้อมูลบริษัท (ตั้งค่า + โลโก้) เปลี่ยนไปแล้ว — สั่งโหลดใหม่ให้ฟอร์มด้านบนและหัวเว็บแสดงค่าล่าสุดทันที
      reload();
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : 'กู้คืนข้อมูลไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setRestoring(false);
      setProgress(null);
    }
  }

  if (!selectedCompany) return null;

  const canConfirmRestore =
    !restoring && (restoreMode === 'merge' || replaceConfirmText.trim().toLowerCase() === REPLACE_CONFIRM_WORD);

  return (
    <div className="card-surface mt-6 rounded-2xl bg-card-bg p-6 sm:p-8" data-testid="company-backup-card">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-light">
          <DatabaseBackup className="h-5 w-5 text-primary" strokeWidth={2} aria-hidden="true" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-text">สำรอง / กู้คืนข้อมูล</h3>
          <p className="mt-1 text-sm text-text-sub">
            ดาวน์โหลดข้อมูลทั้งหมดของ {selectedCompany.name} เป็นไฟล์เดียว เก็บไว้เผื่อข้อมูลในระบบหาย แล้วนำไฟล์กลับเข้ามากู้คืนได้ครบเหมือนเดิม
          </p>
        </div>
      </div>

      {/* ---------- ส่วนที่ 1: สำรองข้อมูลออกมาเป็นไฟล์ ---------- */}
      <div className="mt-6 space-y-3 border-t border-border/70 pt-6">
        <h4 className="text-xs font-bold text-text-sub">สำรองข้อมูล</h4>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleExport}
            disabled={busy}
            className="btn-press inline-flex items-center gap-1.5 rounded-[10px] bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary shadow-sm hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="export-backup"
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="h-4 w-4" aria-hidden="true" />
            )}
            {exporting ? 'กำลังสำรองข้อมูล...' : 'ดาวน์โหลดไฟล์สำรองข้อมูล'}
          </button>
          {exporting && progress && (
            <span className="text-xs text-text-sub" data-testid="export-progress">
              {progress}
            </span>
          )}
        </div>

        <p className="text-xs text-text-sub">
          ไฟล์ JSON ไฟล์เดียว ครอบคลุม: รายการซื้อ/ใบกำกับภาษี, สมุดรายชื่อ, ใบหัก ณ ที่จ่าย, รายงานกระทบยอด, ข้อมูลตั้งค่าบริษัทและโลโก้ —
          ไม่รวมรายชื่อสมาชิกและสิทธิ์ผู้ใช้ (ต้องเชิญใหม่หลังกู้คืน)
        </p>

        {exportedFileName && (
          <p
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-primary/20 bg-primary-light px-3.5 py-2.5 text-sm text-text"
            data-testid="export-success"
          >
            <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
            ดาวน์โหลดแล้ว: <span className="font-semibold">{exportedFileName}</span>
          </p>
        )}
        {exportError && (
          <p
            role="alert"
            className="rounded-[10px] border border-danger/20 bg-danger/10 px-3.5 py-2.5 text-sm text-danger"
            data-testid="export-error"
          >
            {exportError}
          </p>
        )}
      </div>

      {/* ---------- ส่วนที่ 2: กู้คืนจากไฟล์ ---------- */}
      <div className="mt-6 space-y-3 border-t border-border/70 pt-6">
        <h4 className="text-xs font-bold text-text-sub">กู้คืนข้อมูลจากไฟล์</h4>

        {!pendingFile && (
          <>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="btn-press inline-flex items-center gap-1.5 rounded-[10px] border border-border px-4 py-2.5 text-sm font-semibold text-text-sub hover:bg-page-bg hover:text-text disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="choose-backup-file"
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              เลือกไฟล์สำรองข้อมูล...
            </button>
            <p className="text-xs text-text-sub">เลือกไฟล์แล้วระบบจะสรุปให้ดูก่อนว่ามีข้อมูลอะไรอยู่บ้าง ยังไม่เขียนทับอะไรจนกว่าจะกดยืนยัน</p>
          </>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={handleFileChange}
          className="hidden"
          data-testid="backup-file-input"
        />

        {pendingFile && (
          <div className="rounded-xl border border-border bg-page-bg/40 p-4" data-testid="restore-preview">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-text">{pendingFile.fileName}</p>
                <p className="mt-0.5 text-xs text-text-sub">
                  บริษัทในไฟล์: {pendingFile.file.company.name}
                  {formatExportedAt(pendingFile.file.exported_at) && ` — สำรองไว้เมื่อ ${formatExportedAt(pendingFile.file.exported_at)}`}
                  {pendingFile.file.exported_by_email && ` โดย ${pendingFile.file.exported_by_email}`}
                </p>
              </div>
              <button
                type="button"
                onClick={handleCancelRestore}
                disabled={restoring}
                className="shrink-0 rounded-md p-1 text-text-sub hover:bg-page-bg disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="ยกเลิกไฟล์ที่เลือก"
                data-testid="cancel-restore"
              >
                <X size={16} />
              </button>
            </div>

            {pendingFile.file.source_company_id !== selectedCompany.id && (
              <p
                className="mt-3 flex items-start gap-1.5 rounded-[10px] border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-text"
                data-testid="cross-company-warning"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
                ไฟล์นี้สำรองมาจากคนละบริษัทกับที่เลือกอยู่ตอนนี้ — ข้อมูลจะถูกกู้คืนเข้า &quot;{selectedCompany.name}&quot; ตรวจสอบให้แน่ใจก่อนกดยืนยัน
              </p>
            )}

            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[320px] text-xs">
                <tbody>
                  {BACKUP_TABLES.map((table) => (
                    <tr key={table} className="border-b border-border/50 last:border-0">
                      <td className="py-1.5 pr-3 text-text-sub">{BACKUP_TABLE_LABELS[table]}</td>
                      <td className="py-1.5 text-right font-semibold text-text" data-testid={`preview-count-${table}`}>
                        {(pendingFile.file.tables[table]?.length ?? 0).toLocaleString('th-TH')}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="pt-2 pr-3 font-semibold text-text">รวมทุกตาราง</td>
                    <td className="pt-2 text-right font-bold text-text" data-testid="preview-count-total">
                      {countBackupRows(pendingFile.file.tables).toLocaleString('th-TH')} แถว
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <fieldset className="mt-4 space-y-2" disabled={restoring}>
              <legend className="mb-1.5 text-xs font-bold text-text-sub">เลือกวิธีกู้คืน</legend>

              <label className="flex cursor-pointer items-start gap-2.5 rounded-[10px] border border-border bg-card-bg p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-light">
                <input
                  type="radio"
                  name="restore-mode"
                  value="merge"
                  checked={restoreMode === 'merge'}
                  onChange={() => setRestoreMode('merge')}
                  className="mt-0.5"
                  data-testid="restore-mode-merge"
                />
                <span className="text-xs">
                  <span className="block font-semibold text-text">รวมข้อมูล (ปลอดภัยกว่า)</span>
                  <span className="mt-0.5 block text-text-sub">
                    เขียนทับเฉพาะรายการที่ตรงกันกับในไฟล์ รายการอื่นที่มีอยู่ในระบบตอนนี้ยังอยู่ครบ — เหมาะกับกรณีข้อมูลหายบางส่วน
                  </span>
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-2.5 rounded-[10px] border border-border bg-card-bg p-3 has-[:checked]:border-danger has-[:checked]:bg-danger/5">
                <input
                  type="radio"
                  name="restore-mode"
                  value="replace"
                  checked={restoreMode === 'replace'}
                  onChange={() => setRestoreMode('replace')}
                  className="mt-0.5"
                  data-testid="restore-mode-replace"
                />
                <span className="text-xs">
                  <span className="block font-semibold text-text">ล้างของเดิมก่อนแล้วกู้คืนทั้งหมด</span>
                  <span className="mt-0.5 block text-text-sub">
                    ลบข้อมูลทั้งหมดของบริษัทนี้ทิ้งก่อน แล้วเขียนใหม่จากไฟล์ — ได้สภาพเหมือนวันที่สำรองไว้เป๊ะ รายการที่เพิ่มหลังจากนั้นจะหายไปทั้งหมด
                  </span>
                </span>
              </label>
            </fieldset>

            {restoreMode === 'replace' && (
              <label className="mt-3 block">
                <span className="mb-1.5 block text-xs font-medium text-text">
                  พิมพ์คำว่า <span className="font-mono font-bold text-danger">confirm</span> เพื่อยืนยันว่าเข้าใจว่าข้อมูลปัจจุบันจะถูกลบทิ้ง
                </span>
                <input
                  value={replaceConfirmText}
                  onChange={(e) => setReplaceConfirmText(e.target.value)}
                  disabled={restoring}
                  placeholder="confirm"
                  className="h-11 w-full rounded-[10px] border border-border bg-input px-3.5 text-sm text-text placeholder:text-text-sub focus-ring-primary focus:outline-none"
                  data-testid="restore-confirm-input"
                />
              </label>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              {restoring && progress && (
                <span className="mr-auto text-xs text-text-sub" data-testid="restore-progress">
                  {progress}
                </span>
              )}
              <button
                type="button"
                onClick={handleCancelRestore}
                disabled={restoring}
                className="btn-press rounded-[10px] border border-border px-4 py-2 text-sm font-semibold text-text-sub hover:bg-page-bg disabled:cursor-not-allowed disabled:opacity-60"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleConfirmRestore}
                disabled={!canConfirmRestore}
                className={`btn-press inline-flex items-center gap-1.5 rounded-[10px] px-4 py-2 text-sm font-semibold text-on-primary disabled:cursor-not-allowed disabled:opacity-50 ${
                  restoreMode === 'replace' ? 'bg-danger hover:bg-danger/90' : 'bg-primary hover:bg-primary-hover'
                }`}
                data-testid="confirm-restore"
              >
                {restoring ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {restoring ? 'กำลังกู้คืน...' : 'กู้คืนข้อมูล'}
              </button>
            </div>
          </div>
        )}

        {restoreError && (
          <p
            role="alert"
            className="rounded-[10px] border border-danger/20 bg-danger/10 px-3.5 py-2.5 text-sm text-danger"
            data-testid="restore-error"
          >
            {restoreError}
          </p>
        )}

        {restoreResult && (
          <div
            className="rounded-[10px] border border-primary/20 bg-primary-light px-3.5 py-3 text-sm text-text"
            data-testid="restore-success"
          >
            <p className="flex items-center gap-1.5 font-semibold">
              <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
              กู้คืนข้อมูลสำเร็จ {restoreResult.totalRows.toLocaleString('th-TH')} แถว
              {restoreResult.mode === 'replace' ? ' (ล้างของเดิมก่อนกู้คืน)' : ' (รวมข้อมูล)'}
            </p>
            {!restoreResult.logoRestored && (
              <p className="mt-1 text-xs text-text-sub">
                หมายเหตุ: กู้คืนโลโก้บริษัทไม่สำเร็จ (หรือไฟล์สำรองไม่มีโลโก้) — อัปโหลดใหม่ได้ที่ส่วน &quot;โลโก้บริษัท&quot; ด้านบน
              </p>
            )}
            <p className="mt-1 text-xs text-text-sub">รายชื่อสมาชิกและสิทธิ์ผู้ใช้ไม่ได้ถูกกู้คืน — เชิญสมาชิกใหม่ได้ที่เมนู &quot;อนุมัติสมาชิกใหม่&quot;</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** สั่งดาวน์โหลด Blob เป็นไฟล์ — สำเนาเล็กๆ ของ downloadBlob ใน lib/reportExport.ts / downloadContactBlob ใน
 * lib/contactExport.ts ตามธรรมเนียมเดิมของโปรเจกต์ที่ให้แต่ละฟีเจอร์มีของตัวเอง ไม่ผูก import ข้ามฟีเจอร์ */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
