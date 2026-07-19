'use client';

import { useMemo, useState } from 'react';
import { mutate } from 'swr';
import { ListChecks, Save } from 'lucide-react';
import BankReconcileUploadPanel, { type BankReconcileFileSummary } from './BankReconcileUploadPanel';
import BankReconcileSummaryCards from './BankReconcileSummaryCards';
import BankReconcileMatchedTable from './BankReconcileMatchedTable';
import BankReconcileUnmatchedTable from './BankReconcileUnmatchedTable';
import BankReconcileManualMatchToolbar from './BankReconcileManualMatchToolbar';
import BankReconcileSaveDialog, { type BankReconcileSaveInput } from './BankReconcileSaveDialog';
import { useAuth } from '@/lib/AuthContext';
import { parseBankFile, parseGLFile } from '@/lib/bankReconcileParse';
import { reconcileTransactions } from '@/lib/bankReconcileLogic';
import { createManualMatchGroup, wrapAutoMatchesAsGroups } from '@/lib/bankReconcileManualMatch';
import {
  fetchReconcileReports,
  RECONCILE_REPORTS_SWR_KEY,
  saveReconcileReport,
  type ReconcileReportDetail,
} from '@/lib/bankReconcileReportApi';
import { thaiMonthName } from '@/lib/thaiDate';
import type { BankTransaction, DateTolerance, GLTransaction, ReconcileSummary } from '@/types/bankReconcile';
import type { MatchGroup, ReconcileReportStatus } from '@/types/bankReconcileMatch';

interface LoadedFile<T> {
  fileName: string;
  rows: T[];
  warnings: string[];
}

interface LastSavedInfo {
  reportName: string;
  status: ReconcileReportStatus;
  periodMonth: number;
  periodYear: number;
}

interface BankReconcileWorkspaceProps {
  /** ไม่ระบุ/null = เปิดหน้าใหม่แบบเดิม (อัปโหลดไฟล์เอง) — ไม่ null = เปิดจากประวัติ (โหมด "เปิดจากประวัติ")
   * ผ่าน BankReconcileLoadedSession.tsx (เพิ่มเข้ามา 2026-07-19) ทุก state ด้านล่างที่ seed จาก prop นี้ใช้
   * useState lazy initializer เสมอ (ไม่ใช้ useEffect ตามกฎ react-hooks/set-state-in-effect เดิมของ
   * โปรเจกต์นี้) ใช้งานได้ถูกต้องเพราะ BankReconcilePage.tsx (dispatcher) ใส่ key={reportId} ไว้ที่
   * BankReconcileLoadedSession แล้ว ทำให้ component นี้ mount ใหม่เสมอทุกครั้งที่เปิดคนละรายการ */
  initialData?: ReconcileReportDetail | null;
}

/**
 * หน้า "กระทบยอด Bank Reconcile" — เดิมชื่อ BankReconcilePage.tsx (เขียนใหม่ 2026-07-17) ย้ายมาเป็น
 * BankReconcileWorkspace.tsx (2026-07-19) ตอนเพิ่มฟีเจอร์ "จับคู่เอง + บันทึกประวัติ" — BankReconcilePage.tsx
 * เดิมกลายเป็น thin dispatcher แทน (เลือกระหว่างเปิดหน้านี้แบบใหม่ กับโหลดรายการที่บันทึกไว้จากประวัติ — ดู
 * BankReconcilePage.tsx) โค้ด parse ไฟล์ + อัลกอริทึมอัตโนมัติ (reconcileTransactions) ไม่ถูกแก้ไขเลย
 *
 * ของใหม่ที่เพิ่มเข้ามาในไฟล์นี้ (2026-07-19): ตาราง Bank/GL ที่ไม่สำเร็จมีช่องติ๊กเลือกได้ ผู้ใช้ติ๊กแถวทั้ง
 * สองฝั่งแล้วกด "ยืนยันจับคู่" (BankReconcileManualMatchToolbar) เมื่อยอดรวมเท่ากัน กลุ่มที่จับคู่แล้ว (ทั้ง
 * อัตโนมัติและเอง) ถูกเก็บเป็น MatchGroup[] แบบเดียวกัน — ผลลัพธ์จาก reconcileTransactions() ถูกห่อเป็น
 * MatchGroup ผ่าน wrapAutoMatchesAsGroups() ทันทีหลังคำนวณเสร็จ ไม่มีการเก็บ ReconcileResult ดิบไว้ใช้ต่อ
 * (matchGroups/bankUnmatched/glUnmatched ด้านล่างคือ "ความจริงปัจจุบัน" เพียงชุดเดียว ไม่มี state อื่นที่
 * อาจไม่ตรงกันได้อีก) — ปุ่ม "บันทึก" (save) เปิด BankReconcileSaveDialog ให้เลือกเดือน/ปี+สถานะ แล้วเรียก
 * saveReconcileReport() จริง
 *
 * รองรับ initialData prop (เพิ่มเข้ามา 2026-07-19 เช่นกัน — ดู BankReconcileWorkspaceProps ด้านบน) สำหรับ
 * โหมด "เปิดจากประวัติ": bankFile/glFile/matchGroups/bankUnmatched/glUnmatched/tolerance/currentReportId/
 * lastSaved ทั้งหมด seed มาจาก prop นี้ตอน mount ผ่าน useState lazy initializer แทนการเริ่มว่างเปล่า ทำให้
 * เปิดรายการที่บันทึกไว้แล้วเห็นผลลัพธ์ทันทีโดยไม่ต้องอัปโหลดไฟล์หรือกด "ตรวจสอบข้อมูล" ซ้ำเลย (แต่ยังกดซ้ำได้
 * ถ้าต้องการคำนวณอัตโนมัติใหม่ — พฤติกรรมเดิมทุกประการ คือรีเซ็ต matchGroups/bankUnmatched/glUnmatched ทั้งหมด)
 */
export default function BankReconcileWorkspace({ initialData = null }: BankReconcileWorkspaceProps = {}) {
  const [bankFile, setBankFile] = useState<LoadedFile<BankTransaction> | null>(() =>
    initialData
      ? {
          fileName: initialData.report.bank_file_name ?? 'ไฟล์ Bank Statement (จากประวัติ)',
          rows: initialData.bankRows,
          warnings: [],
        }
      : null
  );
  const [glFile, setGlFile] = useState<LoadedFile<GLTransaction> | null>(() =>
    initialData
      ? {
          fileName: initialData.report.gl_file_name ?? 'ไฟล์ GL (จากประวัติ)',
          rows: initialData.glRows,
          warnings: [],
        }
      : null
  );
  const [bankLoading, setBankLoading] = useState(false);
  const [glLoading, setGlLoading] = useState(false);
  const [bankError, setBankError] = useState<string | null>(null);
  const [glError, setGlError] = useState<string | null>(null);
  const [tolerance, setTolerance] = useState<DateTolerance>(() => initialData?.report.tolerance_days ?? 1);
  const [checking, setChecking] = useState(false);
  // เปิดจากประวัติ = ถือว่า "ตรวจสอบแล้ว" ทันที (ข้อมูล matchGroups/bankUnmatched/glUnmatched ด้านล่างมาจาก
  // สแนปช็อตที่บันทึกไว้แล้ว ไม่ต้องรอผู้ใช้กด "ตรวจสอบข้อมูล" ซ้ำก่อนถึงจะเห็นผลลัพธ์)
  const [hasChecked, setHasChecked] = useState(() => initialData !== null);

  // "ความจริงปัจจุบัน" ของผลกระทบยอด — เริ่มต้นจากผลลัพธ์อัตโนมัติทุกครั้งที่กด "ตรวจสอบข้อมูล" แล้วค่อย
  // เปลี่ยนแปลงต่อเมื่อผู้ใช้ยืนยันจับคู่เองเพิ่ม (ย้ายแถวจาก bankUnmatched/glUnmatched ไปเป็น matchGroups
  // กลุ่มใหม่) กด "ตรวจสอบข้อมูล" ซ้ำจะรีเซ็ตทั้งสามค่านี้ใหม่ทั้งหมดเสมอ (พฤติกรรมเดิม: คำนวณใหม่ = ล้าง
  // ของเก่าทั้งหมด ไม่มีการเตือนเพราะห้ามใช้ native dialog อยู่แล้ว) — เปิดจากประวัติ: seed จากสแนปช็อตที่
  // บันทึกไว้ตรงๆ (bankUnmatched/glUnmatched ที่ได้จาก getReportDetail() คำนวณมาแล้วฝั่ง lib โดยดูว่าแถวไหน
  // ไม่มี match_group_id — ดู lib/bankReconcileReportApi.ts)
  const [matchGroups, setMatchGroups] = useState<MatchGroup[]>(() => initialData?.matchGroups ?? []);
  const [bankUnmatched, setBankUnmatched] = useState<BankTransaction[]>(() => initialData?.bankUnmatched ?? []);
  const [glUnmatched, setGlUnmatched] = useState<GLTransaction[]>(() => initialData?.glUnmatched ?? []);

  const [selectedBankIds, setSelectedBankIds] = useState<Set<string>>(new Set());
  const [selectedGlIds, setSelectedGlIds] = useState<Set<string>>(new Set());

  const { session } = useAuth();
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // มี id แล้ว = เคยบันทึกรอบนี้ไปแล้วอย่างน้อย 1 ครั้ง (ไม่ว่าจะเป็นการบันทึกใหม่ครั้งแรก หรือเปิดมาจาก
  // ประวัติ) กด "บันทึก" ซ้ำเมื่อมี id อยู่แล้วจะอัปเดตทับรายการเดิม ไม่สร้างรายการใหม่ซ้อนขึ้นมา — เปิดจาก
  // ประวัติ: seed เป็น id ของรายการที่เปิดอยู่ทันที เพื่อให้การบันทึกครั้งแรกหลัง reopen เป็นการอัปเดตทับ
  // ไม่ใช่สร้างรายการใหม่ซ้อน
  const [currentReportId, setCurrentReportId] = useState<string | null>(() => initialData?.report.id ?? null);
  // เก็บ periodMonth/periodYear ไว้ด้วย (ไม่ใช่แค่ reportName/status) เพื่อให้ dialog บันทึกครั้งถัดไป
  // (แก้ไขแล้วบันทึกซ้ำ) เสนอค่าเดิมที่รายการนี้เป็นของไว้ล่วงหน้าแทนที่จะ fallback ไปเดือน/ปีปัจจุบันเฉยๆ
  const [lastSaved, setLastSaved] = useState<LastSavedInfo | null>(() =>
    initialData
      ? {
          reportName: initialData.report.report_name,
          status: initialData.report.status,
          periodMonth: initialData.report.period_month,
          periodYear: initialData.report.period_year,
        }
      : null
  );

  const canCheck = Boolean(bankFile && bankFile.rows.length > 0 && glFile && glFile.rows.length > 0) && !checking;

  async function handleBankFile(file: File) {
    setBankLoading(true);
    setBankError(null);
    setBankFile(null);
    setHasChecked(false);
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
    setHasChecked(false);
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
      setMatchGroups(wrapAutoMatchesAsGroups(computed.matched));
      setBankUnmatched(computed.bankUnmatched);
      setGlUnmatched(computed.glUnmatched);
      setSelectedBankIds(new Set());
      setSelectedGlIds(new Set());
      setHasChecked(true);
      setChecking(false);
    }, 0);
  }

  function toggleBankRow(id: string) {
    setSelectedBankIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleGlRow(id: string) {
    setSelectedGlIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // toggle-all: เลือก id ที่ส่งมาครบทุกตัวอยู่แล้ว → ยกเลิกทั้งหมด, ยังไม่ครบ → เลือกเพิ่มให้ครบทั้งหมด
  // (ใช้ตรรกะเดียวกันทั้ง Bank/GL แยกฟังก์ชันเพราะ setter คนละตัว)
  function toggleAllBank(ids: string[]) {
    setSelectedBankIds((prev) => {
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...prev, ...ids]);
    });
  }

  function toggleAllGl(ids: string[]) {
    setSelectedGlIds((prev) => {
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...prev, ...ids]);
    });
  }

  const bankSelection = useMemo(
    () => bankUnmatched.filter((row) => selectedBankIds.has(row.id)),
    [bankUnmatched, selectedBankIds]
  );
  const glSelection = useMemo(() => glUnmatched.filter((row) => selectedGlIds.has(row.id)), [glUnmatched, selectedGlIds]);

  function handleConfirmManualMatch() {
    // createManualMatchGroup ตรวจเงื่อนไขซ้ำเองอีกครั้งภายใน (throw ถ้าไม่ผ่าน) — ในทางปฏิบัติจะไม่มีทาง throw
    // ตรงนี้เพราะปุ่มยืนยันใน BankReconcileManualMatchToolbar ถูก disable ไว้แล้วเมื่อเงื่อนไขไม่ผ่าน
    const group = createManualMatchGroup({ bankRows: bankSelection, glRows: glSelection });
    setMatchGroups((prev) => [...prev, group]);
    setBankUnmatched((prev) => prev.filter((row) => !selectedBankIds.has(row.id)));
    setGlUnmatched((prev) => prev.filter((row) => !selectedGlIds.has(row.id)));
    setSelectedBankIds(new Set());
    setSelectedGlIds(new Set());
  }

  // bankFile.rows/glFile.rows คือ "ชุดข้อมูลเต็มตามลำดับเดิมในไฟล์" เสมอ (ไม่เคยถูกแก้ไข/กรองทิ้งเลย
  // ตลอดทั้ง component นี้ — bankUnmatched/matchGroups[].bankRows เป็นแค่ subset ของ array เดียวกันนี้) จึง
  // ส่งตรงๆ เป็น allBankRows/allGlRows ให้ API ได้เลย โดยไม่ต้องประกอบชุดข้อมูลเต็มขึ้นมาใหม่ — ดู
  // lib/bankReconcileReportApi.ts สำหรับเหตุผลที่ต้องส่ง "ชุดเต็ม" แทนที่จะส่งแค่ bankUnmatched
  async function handleSaveConfirm(input: BankReconcileSaveInput) {
    if (!bankFile || !glFile) return;
    setSaving(true);
    setSaveError(null);
    const reportName = `กระทบยอดเดือน${thaiMonthName(input.periodMonth)} ${input.periodYear}`;
    try {
      const reportId = await saveReconcileReport(
        {
          id: currentReportId,
          reportName,
          periodMonth: input.periodMonth,
          periodYear: input.periodYear,
          status: input.status,
          bankFileName: bankFile.fileName,
          glFileName: glFile.fileName,
          toleranceDays: tolerance,
          allBankRows: bankFile.rows,
          allGlRows: glFile.rows,
          matchGroups,
        },
        { id: session?.user?.id ?? null, email: session?.user?.email ?? null }
      );
      setCurrentReportId(reportId);
      setLastSaved({ reportName, status: input.status, periodMonth: input.periodMonth, periodYear: input.periodYear });
      setShowSaveDialog(false);
      // รีเฟรช cache ของหน้า "ประวัติการกระทบยอด" (BankReconcileHistoryPage.tsx) ทันทีหลังบันทึกสำเร็จ — ไฟล์
      // นี้เองไม่ได้ใช้ useSWR กับ RECONCILE_REPORTS_SWR_KEY เลย (เขียนผ่าน RPC ตรงๆ) จึงต้องเรียก mutate()
      // แบบ global จากแพ็กเกจ swr ตรงๆ (ไม่ใช่ตัวที่ผูกกับ hook) เพื่อสั่งให้หน้าประวัติได้ข้อมูลใหม่ล่าสุดเสมอ
      // — ถ้าไม่เรียกตรงนี้ ผู้ใช้ที่สลับไปหน้าประวัติเร็วกว่าที่ SWR dedupingInterval จะยอม fetch ใหม่ให้เอง
      // (ค่าเริ่มต้นของ SWR คือ 2 วินาที) จะเห็นข้อมูลเก่าค้างอยู่ (พบจาก e2e test จริงตอนเขียนฟีเจอร์นี้ — กด
      // บันทึกแล้วสลับไปหน้าประวัติทันทีในเทสต์เร็วกว่า 2 วินาทีเสมอ) ครอบด้วย try/catch แยกต่างหาก เพราะการ
      // บันทึกจริงสำเร็จไปแล้ว (ได้ reportId มาแล้ว) ไม่ควรทำให้ทั้งฟังก์ชันดูเหมือน "บันทึกไม่สำเร็จ" แค่เพราะ
      // การรีเฟรช cache ของอีกหน้าหนึ่งมีปัญหาชั่วคราว (เช่นเน็ตกระตุก) — หน้าประวัติจะ fetch ใหม่เองตามปกติอยู่
      // ดีเมื่อผู้ใช้เปิดเข้าไปในภายหลัง
      try {
        await mutate(RECONCILE_REPORTS_SWR_KEY, fetchReconcileReports());
      } catch {
        // เพิกเฉยตามเหตุผลด้านบน
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setSaving(false);
    }
  }

  const summary: ReconcileSummary = useMemo(
    () => ({
      bankCount: bankFile?.rows.length ?? 0,
      glCount: glFile?.rows.length ?? 0,
      matchedCount: matchGroups.length,
      bankUnmatchedCount: bankUnmatched.length,
      glUnmatchedCount: glUnmatched.length,
    }),
    [bankFile, glFile, matchGroups, bankUnmatched, glUnmatched]
  );

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
        ฝั่งหนึ่ง รายการที่ระบบจับคู่ไม่ได้เองสามารถติ๊กเลือกจับคู่เองได้ และบันทึกเป็นประวัติไว้ดูภายหลังได้
      </p>

      {/* แบนเนอร์ "เปิดจากประวัติ" (เพิ่มเข้ามา 2026-07-19) — แสดงเฉพาะตอน initialData ไม่ null เท่านั้น
          (โหมดเปิดหน้าใหม่แบบอัปโหลดไฟล์เองไม่มีแบนเนอร์นี้) เพื่อให้ชัดเจนเสมอว่ากำลังแก้ไขรายการที่บันทึก
          ไว้แล้วอยู่ ไม่ใช่เริ่มรายการใหม่ — ไม่ใช้ entrance-delay ใดๆ (แสดงทันทีพร้อมข้อมูล ไม่ต้องรอลำดับ
          เหมือน section อื่นที่ทยอยปรากฏ) */}
      {initialData && (
        <div
          className="card-surface mb-6 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-primary/30 bg-primary-light/40 px-4 py-3"
          data-testid="bank-reconcile-loaded-banner"
        >
          <p className="text-sm text-text">
            กำลังแก้ไขรายการที่บันทึกไว้: <span className="font-semibold">{initialData.report.report_name}</span>
          </p>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              initialData.report.status === 'complete' ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
            }`}
          >
            {initialData.report.status === 'complete' ? 'เสร็จสมบูรณ์' : 'ทำค้างไว้'}
          </span>
        </div>
      )}

      {/* entrance-animate ทั้งหน้า (2026-07-18) — ผู้ใช้ขอให้กดเข้าหน้านี้แล้ว smooth เหมือนหน้า "สมุดรายชื่อ"
          (ContactsPage.tsx) ใช้คลาส entrance-animate/entrance-delay-1/2/3 ชุดเดิมจาก globals.css ซ้ำตรงๆ
          (ไม่เพิ่มคลาส/tier ใหม่) ไล่ลำดับตามขั้นตอนการใช้งานจากบนลงล่าง: อัปโหลดไฟล์ (delay-1) → ช่วงวันที่
          ที่ยอมรับได้+ปุ่มตรวจสอบ (delay-2) → ผลลัพธ์หรือ empty state (delay-3) */}
      <div className="entrance-animate entrance-delay-1 mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
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

      <div className="card-surface entrance-animate entrance-delay-2 mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-text">ช่วงวันที่ที่ยอมรับได้</span>
          <div className="flex rounded-[10px] border border-border bg-white/8 p-1" role="group" aria-label="เลือกช่วงวันที่ที่ยอมรับได้">
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

      {!hasChecked && (
        <div
          className="card-surface entrance-animate entrance-delay-3 rounded-2xl border border-dashed border-border p-12 text-center text-sm text-text-sub"
          data-testid="bank-reconcile-empty"
        >
          อัปโหลดไฟล์ Bank Statement และ GL ให้ครบทั้งสองไฟล์ แล้วกด &quot;ตรวจสอบข้อมูล&quot; เพื่อเริ่มกระทบยอด
        </div>
      )}

      {hasChecked && (
        // ครอบด้วย div (เดิมเป็น Fragment เปล่า) เพราะ entrance-animate ต้องมี element จริงให้ใส่ class ไม่ใช่
        // แค่กลุ่ม children เฉยๆ — ไม่กระทบ layout เดิมเลย เพราะ <main> ไม่มี flex/grid/space-y ควบคุมระยะห่าง
        // ระหว่าง element ลูกโดยตรงอยู่แล้ว (แต่ละ component ลูกจัดการ margin ของตัวเองอยู่แล้วเหมือนเดิม)
        <div className="entrance-animate entrance-delay-3">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            {lastSaved ? (
              <p className="text-sm text-text-sub" data-testid="bank-reconcile-save-status">
                บันทึกแล้ว: {lastSaved.reportName} · {lastSaved.status === 'complete' ? 'เสร็จสมบูรณ์' : 'ทำค้างไว้'}
              </p>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={() => {
                setSaveError(null);
                setShowSaveDialog(true);
              }}
              className="btn-press flex items-center gap-1.5 rounded-[10px] border border-primary/50 bg-primary-light px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/20"
              data-testid="bank-reconcile-save-button"
            >
              <Save size={16} aria-hidden="true" />
              บันทึกเป็นประวัติ
            </button>
          </div>

          <BankReconcileSummaryCards summary={summary} />
          <BankReconcileMatchedTable groups={matchGroups} />
          <BankReconcileUnmatchedTable
            title="Bank Statement ไม่สำเร็จ"
            testId="bank-unmatched"
            statusText="ไม่พบข้อมูลใน GL"
            emptyText="ไม่มีรายการ Bank Statement ที่ไม่พบข้อมูลใน GL"
            rows={bankUnmatched}
            selectedIds={selectedBankIds}
            onToggleRow={toggleBankRow}
            onToggleAll={toggleAllBank}
          />
          {(bankUnmatched.length > 0 || glUnmatched.length > 0) && (
            <BankReconcileManualMatchToolbar
              bankSelection={bankSelection}
              glSelection={glSelection}
              onConfirm={handleConfirmManualMatch}
            />
          )}
          <BankReconcileUnmatchedTable
            title="GL ไม่สำเร็จ"
            testId="gl-unmatched"
            statusText="ไม่พบข้อมูลใน Bank Statement"
            emptyText="ไม่มีรายการ GL ที่ไม่พบข้อมูลใน Bank Statement"
            rows={glUnmatched}
            showDocumentNo
            selectedIds={selectedGlIds}
            onToggleRow={toggleGlRow}
            onToggleAll={toggleAllGl}
          />
        </div>
      )}

      {showSaveDialog && (
        <BankReconcileSaveDialog
          defaultMonth={lastSaved?.periodMonth}
          defaultYear={lastSaved?.periodYear}
          defaultStatus={lastSaved?.status}
          saving={saving}
          errorMessage={saveError}
          onCancel={() => setShowSaveDialog(false)}
          onConfirm={handleSaveConfirm}
        />
      )}
    </main>
  );
}
