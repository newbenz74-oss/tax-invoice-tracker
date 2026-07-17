'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { mutate } from 'swr';
import {
  Banknote,
  CheckCircle2,
  CircleCheck,
  Clock,
  FileX,
  Landmark,
  Layers,
  SearchX,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { normalizeBankRows, normalizeGLRows } from '@/lib/bankReconcileNormalize';
import { isBankMappingComplete, isGLMappingComplete } from '@/lib/bankReconcileValidation';
import { toMatchBankRows, toMatchGLRows } from '@/lib/bankReconcileMatching';
import { computeGLOnlyTotal, DATE_TOLERANCE_DAYS, DATE_TOLERANCE_LABELS, DEFAULT_DATE_TOLERANCE } from '@/lib/bankReconcileMatchLogic';
import { buildMatchGroup, deriveMatchType, mergeManualMatches, undoMatchGroup } from '@/lib/bankReconcileManualMatch';
import {
  AMOUNT_TOLERANCE_LABELS,
  computeReconcileRowSummary,
  computeReconcileTabCounts,
  DEFAULT_AMOUNT_TOLERANCE,
  DEFAULT_RECONCILE_ROW_FILTERS,
  filterReconcileRows,
  formatGroupSummary,
  RECONCILE_TAB_LABELS,
  resolveAmountTolerance,
  type ReconcileRowFilters,
  type ReconcileTab,
} from '@/lib/bankReconcileManualMatchLogic';
import { computeReconcileSessionKpi, validateSessionCompletion } from '@/lib/bankReconcileKpi';
import { remapRecordKeys } from '@/lib/bankReconcileSessionMapping';
import { createDebouncedSaver, type DebouncedSaver } from '@/lib/bankReconcileAutoSave';
import { setBankReconcileDirty } from '@/lib/bankReconcileNavGuard';
import {
  appendReconcileAuditLog,
  completeReconcileSession,
  exportReconcileSessionExcel,
  exportReconcileSessionPdf,
  fetchReconcileAuditLog,
  RECONCILE_SESSIONS_SWR_KEY,
  reopenReconcileSession,
  saveReconcileSession,
} from '@/lib/bankReconcileSessionApi';
import { downloadBlob } from '@/lib/reportExport';
import type {
  AmountToleranceOption,
  BankColumnMapping,
  DateToleranceOption,
  GLColumnMapping,
  MatchBankRow,
  MatchGLRow,
  MatchGroup,
  ReconcileRow,
  ReviewFlag,
  RowNote,
  UploadedFileState,
} from '@/types/bankReconcile';
import {
  RECALCULATE_MODE_LABELS,
  type LoadedSessionData,
  type PdfReportMode,
  type ReconcileAuditLogEntry,
  type ReconcileSession,
  type ReconcileSessionStatus,
  type RecalculateMode,
  type SaveStatus,
} from '@/types/bankReconcileSession';
import BankReconcileResultTable from './BankReconcileResultTable';
import BankReconcileCandidatesModal from './BankReconcileCandidatesModal';
import BankReconcileDetailDrawer from './BankReconcileDetailDrawer';
import BankReconcileUnmatchedGL from './BankReconcileUnmatchedGL';
import BankReconcileNoteDialog from './BankReconcileNoteDialog';
import BankReconcileUndoConfirmDialog from './BankReconcileUndoConfirmDialog';
import BankReconcileConfirmMatchDialog from './BankReconcileConfirmMatchDialog';
import BankReconcileMatchDrawer from './BankReconcileMatchDrawer';
import BankReconcileGroupDetailDrawer from './BankReconcileGroupDetailDrawer';
import BankReconcileSessionHeader from './BankReconcileSessionHeader';
import BankReconcileSaveSessionDialog, { type SaveSessionDialogValues } from './BankReconcileSaveSessionDialog';
import BankReconcileCompleteDialog from './BankReconcileCompleteDialog';
import BankReconcileReopenDialog from './BankReconcileReopenDialog';
import BankReconcileRecalculateDialog from './BankReconcileRecalculateDialog';
import BankReconcileAuditLogDrawer from './BankReconcileAuditLogDrawer';
import BankReconcileConfirmDialog from './BankReconcileConfirmDialog';

const THB2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

interface BankReconcileResultsProps {
  bankFile: UploadedFileState | null;
  glFile: UploadedFileState | null;
  bankMapping: BankColumnMapping;
  glMapping: GLColumnMapping;
  onBack: () => void;
  /** เฟส 4: ข้อมูล session ที่โหลดจากฐานข้อมูลมาแล้ว (ไม่ใช่ null เมื่อเปิดจากหน้ารายการ "ประวัติการกระทบยอด
   * ธนาคาร" ผ่านปุ่ม "เปิด"/"เปิดรอบใหม่") — เมื่อไม่ใช่ null จะใช้เป็นแหล่งข้อมูลเริ่มต้นแทน bankFile/glFile/
   * bankMapping/glMapping ทั้งหมด (bankFile/glFile จะเป็น null เสมอในกรณีนี้ — ดู components/BankReconcilePage.tsx)
   * ระบบไม่รันจับคู่อัตโนมัติซ้ำตอนโหลดตามสเปกส่วน "8. OPEN EXISTING SESSION" (matchGroups ที่โหลดมาคือรายการ
   * ที่ยืนยันด้วยตนเองแล้วเท่านั้น ส่วนข้อเสนอแนะอัตโนมัติของแถวที่เหลือคำนวณสดจาก mergeManualMatches เหมือนเดิม
   * ทุกประการ ไม่ใช่ "ผลเก่าที่บันทึกไว้" เพราะสถาปัตยกรรมเฟส 2/3 ไม่เคย persist ข้อเสนอแนะอัตโนมัติอยู่แล้ว) */
  loadedSession: LoadedSessionData | null;
  /** กลับไปหน้ารายการ "ประวัติการกระทบยอดธนาคาร" — ใช้แทน onBack เดิมทันทีที่ session นี้ถูกบันทึกแล้วอย่าง
   * น้อย 1 ครั้ง (มี sessionId แล้ว) ทั้งสองปุ่มถูกครอบด้วยตัวตรวจสอบการเปลี่ยนแปลงที่ยังไม่ได้บันทึกเหมือนกัน
   * (attemptLeave ด้านล่าง) */
  onBackToList: () => void;
}

const SEGMENTED_TABS: ReconcileTab[] = [
  'all',
  'matched_exact',
  'matched_tolerance',
  'confirmed',
  'ambiguous',
  'pending_review',
  'review_required',
  'not_found_in_gl',
];

const TOLERANCE_OPTIONS: DateToleranceOption[] = ['same_day', '1_day', '3_days', '7_days'];
const AMOUNT_TOLERANCE_OPTIONS: AmountToleranceOption[] = ['zero', 'small', 'one', 'custom'];

/** เป้าหมายที่กำลังแก้ไขหมายเหตุอยู่ — แถวเดี่ยว (RowNote ก่อนจับคู่) หรือกลุ่มจับคู่ด้วยตนเอง (MatchGroup.note)
 * เก็บแค่ id ไม่เก็บ object เต็ม เพื่อ derive ค่าล่าสุดจาก state จริงเสมอ (ดูหมายเหตุที่ viewingGroupId ด้านล่าง) */
type NoteEditTarget = { kind: 'row'; bankRowId: string } | { kind: 'group'; groupId: string };

function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * เฟส 3 ของ Bank Reconcile — เพิ่มเครื่องมือจับคู่รายการด้วยตนเอง (Manual Reconciliation) เข้าไปในเฟส 2 เดิม
 * ทำหน้าที่เป็น orchestrator เดียวที่คุมทุกอย่างเหมือนเดิม แค่เพิ่มชั้น "จับคู่ด้วยตนเอง" คั่นก่อนแสดงผล:
 * normalize (เฟส 1 เดิม ไม่แตะ) -> แปลงเป็นมุมมองจับคู่ (เฟส 2 เดิม ไม่แตะ) -> mergeManualMatches() (เฟส 3 ใหม่
 * — กรองแถวที่จับคู่ด้วยตนเองแล้วออกก่อน แล้วเรียก runReconciliationMatch() เดิมของเฟส 2 ตรงๆ กับส่วนที่เหลือ
 * แล้วผสานกลับ) -> กรอง/นับ/สรุป (เฟส 3 ใหม่ ขนานกับของเฟส 2) -> ส่งต่อให้ตาราง/การ์ด/Modal/Drawer แสดงผล
 *
 * เฟส 4 (2026-07-16) ต่อยอดเพิ่มอีกชั้นบนสุด: บันทึก/โหลด session จริงลง Supabase, auto-save, ป้องกันข้อมูล
 * หาย, ปิดรอบ/เปิดรอบใหม่, Export, ประวัติการแก้ไข — **ไม่แตะโค้ดเฟส 1/2/3 เดิมแม้แต่บรรทัดเดียว** (state/
 * useMemo/handler ทั้งหมดของเฟส 1-3 ที่มีอยู่แล้วด้านล่างนี้ทำงานเหมือนเดิมทุกประการเมื่อ loadedSession เป็น
 * null และยังไม่เคยบันทึก — สิ่งที่เพิ่มเข้ามาทั้งหมดเป็นการ "ครอบ" ไว้อีกชั้น) จุดเปลี่ยนแปลงสำคัญจุดเดียวที่
 * จำเป็นต้องแตะของเดิม: matchBankRows/matchGLRows เปลี่ยนจาก useMemo (คำนวณสดจาก bankFile ตลอด) เป็น useState
 * ที่ seed ครั้งแรกเหมือนเดิมทุกประการ (ผลลัพธ์เดิมเป๊ะสำหรับ flow เฟส 1-3 เพราะ bankFile/bankMapping ไม่มีทาง
 * เปลี่ยนขณะ component นี้ mount อยู่แล้วโดยธรรมชาติของ BankReconcilePage.tsx — ดูคอมเมนต์ยาวที่จุดประกาศ
 * state) เหตุผลที่จำเป็นต้องเปลี่ยน: หลังบันทึกครั้งแรกสำเร็จ แถวที่เพิ่งอัปโหลดสดๆ ("bank-N"/"gl-N") จะได้รับ
 * uuid ถาวรจากฐานข้อมูล (ดู lib/bankReconcileSessionMapping.ts) ต้อง setState ทับด้วย id ใหม่เสมอ ไม่เช่นนั้น
 * การบันทึกครั้งถัดไปจะสร้าง uuid ซ้ำไปเรื่อยๆ โดยไม่จำเป็น — เป็นสิ่งที่ useMemo (derive จาก bankFile เดิม)
 * ทำไม่ได้เลยตามธรรมชาติของมัน
 *
 * state ใหม่ทั้งหมดของเฟส 3 (matchGroups/reviewFlags/notes/amountToleranceOption/selectedBankIds) อยู่ในหน่วยความจำ
 * ล้วนๆ เหมือนกับ flaggedIds เดิมของเฟส 2 ทุกประการ (หายเมื่อรีเฟรชหน้า) — ปุ่ม "ทำเครื่องหมายรอตรวจสอบ" เดิม
 * ของเฟส 2 ถูกอัปเกรดให้ผูกกับ ReviewFlag ของเฟส 3 แทน flaggedIds Set เดิม (พฤติกรรม/DOM/testid ที่ผู้ใช้เห็น
 * เหมือนเดิมทุกประการ แค่โครงสร้างข้อมูลภายในเก็บ reviewed_by/reviewed_at เพิ่มตามสเปกเฟส 3 ส่วน "7. MARK FOR
 * REVIEW" — เป็นดุลยพินิจที่ตัดสินใจเอง ระบุไว้ในสรุปผล เพราะสองฟีเจอร์นี้ใช้ปุ่ม/ป้ายกำกับเดียวกันเป๊ะตามสเปก)
 *
 * Dialog/Drawer ที่เปิดอยู่ทั้งหมดเก็บแค่ "id" ไม่เก็บ object เต็ม (viewingGroupId ไม่ใช่ viewingGroup object) แล้ว
 * derive ค่าจริงจาก state ล่าสุดทุกครั้งที่ render (rowById.get(id)/matchGroups.find(...)) กัน bug ข้อมูลค้าง
 * (stale) เวลามีการแก้ไขบางอย่าง (เช่น แก้หมายเหตุ) ขณะที่ modal เดิมยังเปิดค้างอยู่ — ปลอดภัยกว่าการเก็บ
 * snapshot object ไว้ตรงๆ ซึ่งจะไม่อัปเดตตามการเปลี่ยนแปลงของ state ต้นทางเอง
 *
 * แถวที่ session ปิดแล้ว (status='completed') หรือถูกยกเลิก (status='cancelled') กลายเป็น "อ่านอย่างเดียว"
 * (isReadOnly ด้านล่าง) — เลือกกันการแก้ไขที่ระดับ "handler" แทนการเพิ่ม prop readOnly เข้าไปใน component ของ
 * เฟส 2/3 เดิมทุกตัว (BankReconcileResultTable/BankReconcileGroupDetailDrawer ฯลฯ) เพื่อไม่ต้องแตะไฟล์เหล่านั้น
 * เลยแม้แต่บรรทัดเดียวตามข้อจำกัด "ห้าม rebuild เฟส 1/2/3" — handler ที่ทำให้เกิดการเปลี่ยนแปลงข้อมูลทุกตัว (ไม่
 * ใช่ handler ที่แค่ "ดู") จะ return ทันทีโดยไม่ทำอะไรเมื่อ isReadOnly เป็น true เป็นดุลยพินิจที่ตัดสินใจเอง
 * ระบุไว้ในสรุปผลตอนส่งมอบด้วย (ข้อเสียคือปุ่มที่เกี่ยวข้องในตารางเดิมยังคลิกได้ทางสายตา แต่ไม่มีผลใดๆ เกิดขึ้น
 * จริง — ไม่ใช่ประสบการณ์ผู้ใช้ที่สมบูรณ์แบบที่สุดแต่ปลอดภัยต่อโค้ดเฟส 1-3 เดิมที่สุด)
 */
export default function BankReconcileResults({
  bankFile,
  glFile,
  bankMapping,
  glMapping,
  onBack,
  loadedSession,
  onBackToList,
}: BankReconcileResultsProps) {
  const { session } = useAuth();
  const currentUserEmail = session?.user?.email ?? '';
  const currentUserId = session?.user?.id ?? null;
  const actor = useMemo(() => ({ id: currentUserId, email: currentUserEmail || null }), [currentUserId, currentUserEmail]);

  const [dateTolerance, setDateTolerance] = useState<DateToleranceOption>(() => loadedSession?.dateTolerance ?? DEFAULT_DATE_TOLERANCE);
  const [amountToleranceOption, setAmountToleranceOption] = useState<AmountToleranceOption>(
    () => loadedSession?.amountToleranceOption ?? DEFAULT_AMOUNT_TOLERANCE
  );
  const [customAmountTolerance, setCustomAmountTolerance] = useState(() => loadedSession?.customAmountTolerance ?? 0);
  const [filters, setFilters] = useState<ReconcileRowFilters>(DEFAULT_RECONCILE_ROW_FILTERS);
  const [searchDraft, setSearchDraft] = useState('');

  // เฟส 3: ความสัมพันธ์การจับคู่ด้วยตนเองทั้งหมด เก็บแยกจากข้อมูล Bank/GL ต้นฉบับเสมอ (ไม่แก้ไข matchBankRows/
  // matchGLRows ที่ไหนเลยทั้งไฟล์นี้ ตามสเปก "Store matching relationships separately from Bank and GL data")
  //
  // เฟส 4: matchBankRows/matchGLRows เปลี่ยนจาก useMemo (คำนวณสดจาก bankFile) เป็น useState — seed ครั้งแรก
  // จาก loadedSession ถ้ามี ไม่เช่นนั้นคำนวณจาก bankFile/bankMapping เหมือนเฟส 1-3 เดิมทุกประการ (แค่คำนวณ
  // "ครั้งเดียวตอน mount" ผ่าน lazy initializer แทน "ทุกครั้งที่ dependency เปลี่ยน" — ให้ผลลัพธ์เดิมเป๊ะเพราะ
  // bankFile/bankMapping ไม่มีทางเปลี่ยนขณะ component นี้ mount อยู่จริงในทางปฏิบัติ ดู BankReconcilePage.tsx ที่
  // unmount component นี้ทิ้งทันทีที่ผู้ใช้กด "← กลับไปแก้ไขการจับคู่คอลัมน์" แทนการอัปเดต mapping สดๆ) จำเป็น
  // ต้องเป็น state (ไม่ใช่ derived) เพราะหลังบันทึกสำเร็จต้อง setState ทับด้วย id ถาวรที่ฐานข้อมูลกำหนดให้ (ดู
  // หมายเหตุยาวที่ท้าย JSDoc ของ component นี้)
  const [matchBankRows, setMatchBankRows] = useState<MatchBankRow[]>(() => {
    if (loadedSession) return loadedSession.matchBankRows;
    if (!bankFile) return [];
    return toMatchBankRows(bankFile.table, normalizeBankRows(bankFile.table, bankMapping));
  });
  const [matchGLRows, setMatchGLRows] = useState<MatchGLRow[]>(() => {
    if (loadedSession) return loadedSession.matchGLRows;
    if (!glFile) return [];
    return toMatchGLRows(glFile.table, normalizeGLRows(glFile.table, glMapping));
  });
  const [matchGroups, setMatchGroups] = useState<MatchGroup[]>(() => loadedSession?.matchGroups ?? []);
  const [reviewFlags, setReviewFlags] = useState<Record<string, ReviewFlag>>(() => loadedSession?.reviewFlags ?? {});
  const [notes, setNotes] = useState<Record<string, RowNote>>(() => loadedSession?.notes ?? {});
  const [selectedBankIds, setSelectedBankIds] = useState<Set<string>>(new Set());

  // Dialog/Drawer ที่เปิดอยู่ — เก็บ id ล้วนๆ (ดูหมายเหตุด้านบน)
  const [viewingDetailId, setViewingDetailId] = useState<string | null>(null);
  const [viewingCandidatesId, setViewingCandidatesId] = useState<string | null>(null);
  const [confirmingSuggestedId, setConfirmingSuggestedId] = useState<string | null>(null);
  const [matchDrawerBankIds, setMatchDrawerBankIds] = useState<string[] | null>(null);
  const [undoingGroupId, setUndoingGroupId] = useState<string | null>(null);
  const [viewingGroupId, setViewingGroupId] = useState<string | null>(null);
  const [noteEditTarget, setNoteEditTarget] = useState<NoteEditTarget | null>(null);

  // ============================== เฟส 4: session/บันทึก/สถานะ ==============================
  const [sessionMeta, setSessionMeta] = useState<ReconcileSession | null>(() => loadedSession?.session ?? null);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showSaveSessionDialog, setShowSaveSessionDialog] = useState(false);
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [showReopenDialog, setShowReopenDialog] = useState(false);
  const [showRecalculateDialog, setShowRecalculateDialog] = useState(false);
  const [showAuditLogDrawer, setShowAuditLogDrawer] = useState(false);
  const [auditLogEntries, setAuditLogEntries] = useState<ReconcileAuditLogEntry[]>([]);
  const [auditLogLoading, setAuditLogLoading] = useState(false);
  const [pdfMode, setPdfMode] = useState<PdfReportMode>('summary');
  const [exportingKind, setExportingKind] = useState<'excel' | 'pdf' | null>(null);
  const [pendingLeaveAction, setPendingLeaveAction] = useState<(() => void) | null>(null);

  const hasSavedSession = sessionMeta !== null;
  // completed/cancelled ทั้งคู่กลายเป็นอ่านอย่างเดียว (completed = ปิดรอบแล้วตามสเปก §10, cancelled = ยกเลิก
  // แล้วไม่ควรแก้ไขต่อ — สเปกไม่ได้พูดถึง "ยกเลิก" ในแง่นี้ตรงๆ แต่การให้แก้ไขรอบที่ยกเลิกไปแล้วต่อไม่สมเหตุสมผล
  // เป็นดุลยพินิจที่ตัดสินใจเอง) แบนเนอร์ "ปิดเรียบร้อยแล้ว" + ปุ่มเปิดรอบใหม่ ใน BankReconcileSessionHeader
  // แสดงเฉพาะ status==='completed' เท่านั้น (ไม่ใช่ isReadOnly เฉยๆ) เพื่อไม่ให้รอบที่ถูกยกเลิกดูเหมือน "ปิดรอบ
  // สำเร็จ" และไม่มีปุ่ม "เปิดรอบใหม่" ให้กด (ไม่มี workflow แบบนั้นตามสเปก — มีแค่ "เปิดรอบใหม่จาก completed")
  const isReadOnly = sessionMeta?.status === 'completed' || sessionMeta?.status === 'cancelled';

  const bankFileName = sessionMeta?.bank_file_name ?? bankFile?.fileName ?? '';
  const glFileName = sessionMeta?.gl_file_name ?? glFile?.fileName ?? '';

  const debouncedSaverRef = useRef<DebouncedSaver | null>(null);
  // performSave ใช้ actor/matchGroups/ฯลฯ ของ render ล่าสุดเสมอ แต่ debouncedSaverRef ต้องคงอยู่ตัวเดียวตลอด
  // อายุ component (สร้างครั้งเดียว) จึงเก็บฟังก์ชัน "เวอร์ชันล่าสุด" ไว้ใน ref แยกต่างหาก แล้วให้ debounced
  // callback เรียกผ่าน ref เสมอ (ตัว closure ของ .schedule()/setTimeout จะได้ไม่ยึด performSave เวอร์ชันเก่าค้าง)
  const performSaveRef = useRef<((overrideMeta?: SaveSessionDialogValues) => Promise<boolean>) | null>(null);

  // สร้าง debounced saver ครั้งเดียวตอน mount ผ่าน effect (ไม่ใช่ lazy-init ระหว่าง render ตรงๆ แบบเดิม —
  // แม้จะเช็ค null ก่อนเขียนก็ตาม เพราะฟังก์ชันที่ส่งเข้า createDebouncedSaver อ่านค่า ref (performSaveRef)
  // อยู่ในตัวเองด้วย ทำให้ eslint-plugin-react-hooks rule react-hooks/refs ของ React 19 มองว่าเป็นการ "อ่านค่า
  // ref ระหว่าง render" อยู่ดี ปลอดภัยที่จะย้ายมาไว้ใน effect เพราะ debouncedSaverRef.current ถูกอ่านจริงเฉพาะใน
  // event handler/callback แบบ async เท่านั้น (markDirtyAndScheduleSave/performSave/unmount cleanup ด้านล่าง)
  // ไม่มีจุดไหนอ่านระหว่าง render เลยสักที่เดียว จึงไม่มีทาง "เห็น" ค่า null ชั่วคราวก่อน effect นี้ทำงานได้จริง
  useEffect(() => {
    debouncedSaverRef.current = createDebouncedSaver(() => {
      void performSaveRef.current?.();
    });
  }, []);

  // ตั้งค่า/ล้างสถานะ "มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก" ของทั้งแอป (สเปกส่วน "5. UNSAVED CHANGES
  // PROTECTION") — DashboardShell (app/dashboard/page.tsx) อ่านค่านี้ก่อนอนุญาตให้สลับเมนู Sidebar เสมอ
  useEffect(() => {
    setBankReconcileDirty(dirty && !isReadOnly);
  }, [dirty, isReadOnly]);

  // ล้างสถานะ dirty ของแอปเมื่อ component นี้ถูกถอดออก (ไม่ว่าจะเพราะกลับไปหน้ารายการ/ปิดรอบสำเร็จ/สลับเมนูจน
  // ผู้ใช้ยืนยันออกจากหน้านี้) และยกเลิกกำหนดการ auto-save ที่รอไว้ กัน callback ยิงหลัง unmount ไปแล้ว
  useEffect(() => {
    return () => {
      setBankReconcileDirty(false);
      debouncedSaverRef.current?.cancel();
    };
  }, []);

  // เตือนก่อนปิดแท็บ/รีเฟรชเบราว์เซอร์ตรงๆ (browser API มาตรฐาน) — หมายเหตุ: เบราว์เซอร์สมัยใหม่ทุกตัวแทนที่
  // ข้อความที่กำหนดเองด้วยข้อความมาตรฐานของเบราว์เซอร์เองเสมอตั้งแต่ ~2016 เป็นเหตุผลด้านความปลอดภัย (กัน
  // เว็บไซต์ปลอมข้อความหลอกผู้ใช้) จึงไม่มีทางแสดงข้อความไทยที่สเปกกำหนดตรงนี้ได้จริง — ข้อความไทยที่สเปกกำหนด
  // ("มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้หรือไม่") ใช้กับ dialog ที่ควบคุมเองได้จริงแทน (ปุ่ม
  // "กลับไปหน้ารายการ" ในหน้านี้ และตอนสลับเมนู Sidebar ใน app/dashboard/page.tsx) เป็นข้อจำกัดของเบราว์เซอร์
  // เอง ไม่ใช่บั๊ก ระบุไว้ในสรุปผลตอนส่งมอบด้วย
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (dirty && !isReadOnly) {
        e.preventDefault();
        e.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty, isReadOnly]);

  const filesReady =
    loadedSession !== null ||
    (Boolean(bankFile?.validation.valid) &&
      Boolean(glFile?.validation.valid) &&
      isBankMappingComplete(bankMapping) &&
      isGLMappingComplete(glMapping));

  const toleranceDays = DATE_TOLERANCE_DAYS[dateTolerance];
  const amountTolerance = useMemo(
    () => resolveAmountTolerance(amountToleranceOption, customAmountTolerance),
    [amountToleranceOption, customAmountTolerance]
  );

  // หัวใจของเฟส 3 — ผสานผลจับคู่ด้วยตนเองเข้ากับเอนจินอัตโนมัติเดิมของเฟส 2 (ดูหมายเหตุยาวที่
  // mergeManualMatches ใน lib/bankReconcileManualMatch.ts)
  const mergedOutput = useMemo(
    () =>
      mergeManualMatches({
        matchBankRows,
        matchGLRows,
        toleranceDays,
        matchGroups,
        reviewFlags,
        notes,
      }),
    [matchBankRows, matchGLRows, toleranceDays, matchGroups, reviewFlags, notes]
  );

  const rowById = useMemo(() => new Map(mergedOutput.rows.map((r) => [r.bank.bank_row_id, r] as const)), [mergedOutput.rows]);

  const tabCounts = useMemo(() => computeReconcileTabCounts(mergedOutput.rows), [mergedOutput.rows]);
  const glOnlyTotal = useMemo(() => computeGLOnlyTotal(mergedOutput.glOnlyResults), [mergedOutput.glOnlyResults]);
  const summary = useMemo(
    () => computeReconcileRowSummary(mergedOutput.rows, mergedOutput.glOnlyResults.length, glOnlyTotal),
    [mergedOutput.rows, mergedOutput.glOnlyResults, glOnlyTotal]
  );
  const filteredRows = useMemo(() => filterReconcileRows(mergedOutput.rows, filters), [mergedOutput.rows, filters]);

  // เฟส 4: KPI ที่คำนวณใหม่จากข้อมูลจริงเสมอ (สเปกส่วน "15. FINAL KPI CALCULATION") — ใช้ทั้งตอนบันทึก (เติมลง
  // ReconcileSession) และตอนตรวจสอบความพร้อมก่อนปิดรอบ (validateSessionCompletion ด้านล่าง)
  const kpi = useMemo(() => computeReconcileSessionKpi(mergedOutput.rows, matchGLRows, matchGroups), [mergedOutput.rows, matchGLRows, matchGroups]);
  const completionValidation = useMemo(
    () => validateSessionCompletion({ reconcileRows: mergedOutput.rows, matchGLRows, matchGroups, bankFileName, glFileName, kpi }),
    [mergedOutput.rows, matchGLRows, matchGroups, bankFileName, glFileName, kpi]
  );

  // ---- derive ข้อมูลของ dialog/drawer ที่เปิดอยู่จาก id เสมอ (ไม่เก็บ snapshot) ----
  const viewingDetail = viewingDetailId ? rowById.get(viewingDetailId) ?? null : null;
  const viewingCandidates = viewingCandidatesId ? rowById.get(viewingCandidatesId) ?? null : null;
  const confirmingSuggested = confirmingSuggestedId ? rowById.get(confirmingSuggestedId) ?? null : null;
  const matchDrawerBankRows = useMemo(
    () => (matchDrawerBankIds ? matchBankRows.filter((b) => matchDrawerBankIds.includes(b.bank_row_id)) : null),
    [matchDrawerBankIds, matchBankRows]
  );
  const undoingGroup = undoingGroupId ? matchGroups.find((g) => g.match_group_id === undoingGroupId) ?? null : null;
  const undoingGroupBankRows = useMemo(
    () => (undoingGroup ? matchBankRows.filter((b) => undoingGroup.bank_transaction_ids.includes(b.bank_row_id)) : []),
    [undoingGroup, matchBankRows]
  );
  const undoingGroupGLRows = useMemo(
    () => (undoingGroup ? matchGLRows.filter((g) => undoingGroup.gl_transaction_ids.includes(g.gl_row_id)) : []),
    [undoingGroup, matchGLRows]
  );
  const viewingGroup = viewingGroupId ? matchGroups.find((g) => g.match_group_id === viewingGroupId) ?? null : null;
  const viewingGroupBankRows = useMemo(
    () => (viewingGroup ? matchBankRows.filter((b) => viewingGroup.bank_transaction_ids.includes(b.bank_row_id)) : []),
    [viewingGroup, matchBankRows]
  );
  const viewingGroupGLRows = useMemo(
    () => (viewingGroup ? matchGLRows.filter((g) => viewingGroup.gl_transaction_ids.includes(g.gl_row_id)) : []),
    [viewingGroup, matchGLRows]
  );
  const noteEditContext = useMemo(() => {
    if (!noteEditTarget) return null;
    if (noteEditTarget.kind === 'group') {
      const group = matchGroups.find((g) => g.match_group_id === noteEditTarget.groupId);
      if (!group) return null;
      return { title: 'แก้ไขหมายเหตุ', subtitle: formatGroupSummary(group), initialNote: group.note };
    }
    const row = rowById.get(noteEditTarget.bankRowId);
    if (!row) return null;
    return {
      title: row.note ? 'แก้ไขหมายเหตุ' : 'เพิ่มหมายเหตุ',
      subtitle: row.bank.bank_description || '-',
      initialNote: row.note?.note ?? '',
    };
  }, [noteEditTarget, matchGroups, rowById]);

  /** ทำเครื่องหมายว่ามีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก + ตั้งเวลา auto-save (สเปกส่วน "4. AUTO SAVE" —
   * debounce 800-1500ms ผ่าน lib/bankReconcileAutoSave.ts) — auto-save เริ่มทำงานได้ก็ต่อเมื่อบันทึกครั้งแรก
   * ไปแล้วเท่านั้น (มี sessionMeta/sessionId แล้ว) ก่อนหน้านั้นการบันทึกครั้งแรกต้องเป็นแอ็กชันที่ผู้ใช้ตั้งใจกด
   * เอง (เปิด BankReconcileSaveSessionDialog) เสมอตามธรรมชาติของฟีเจอร์ (ยังไม่มีชื่อ/session row ให้บันทึกทับ) */
  function markDirtyAndScheduleSave() {
    if (isReadOnly) return;
    setDirty(true);
    if (hasSavedSession) debouncedSaverRef.current?.schedule();
  }

  function handleTabClick(tab: ReconcileTab) {
    setFilters((prev) => ({ ...prev, tab }));
  }

  function handleSearchSubmit() {
    setFilters((prev) => ({ ...prev, search: searchDraft }));
  }

  function handleClearFilters() {
    setSearchDraft('');
    setFilters(DEFAULT_RECONCILE_ROW_FILTERS);
  }

  function handleDateToleranceChange(value: DateToleranceOption) {
    setDateTolerance(value);
    markDirtyAndScheduleSave();
  }

  function handleAmountToleranceOptionChange(value: AmountToleranceOption) {
    setAmountToleranceOption(value);
    markDirtyAndScheduleSave();
  }

  function handleCustomAmountToleranceChange(value: number) {
    setCustomAmountTolerance(value);
    markDirtyAndScheduleSave();
  }

  function handleToggleReviewFlag(row: ReconcileRow) {
    if (isReadOnly) return;
    const id = row.bank.bank_row_id;
    setReviewFlags((prev) => {
      const next = { ...prev };
      if (next[id]) {
        delete next[id];
      } else {
        next[id] = { review_required: true, reviewed_by: currentUserEmail, reviewed_at: new Date().toISOString() };
      }
      return next;
    });
    markDirtyAndScheduleSave();
  }

  function handleEditNote(row: ReconcileRow) {
    if (isReadOnly) return;
    setNoteEditTarget(
      row.matchGroup ? { kind: 'group', groupId: row.matchGroup.match_group_id } : { kind: 'row', bankRowId: row.bank.bank_row_id }
    );
  }

  function handleSaveNote(noteText: string) {
    if (!noteEditTarget) return;
    if (noteEditTarget.kind === 'group') {
      const groupId = noteEditTarget.groupId;
      setMatchGroups((prev) => prev.map((g) => (g.match_group_id === groupId ? { ...g, note: noteText } : g)));
    } else {
      const id = noteEditTarget.bankRowId;
      setNotes((prev) => ({
        ...prev,
        [id]: { note: noteText, updated_by: currentUserEmail, updated_at: new Date().toISOString() },
      }));
    }
    setNoteEditTarget(null);
    markDirtyAndScheduleSave();
  }

  function handleToggleSelectBank(bankRowId: string) {
    if (isReadOnly) return;
    setSelectedBankIds((prev) => {
      const next = new Set(prev);
      if (next.has(bankRowId)) next.delete(bankRowId);
      else next.add(bankRowId);
      return next;
    });
  }

  function handleCombineSelectedBankRows() {
    if (isReadOnly || selectedBankIds.size < 2) return;
    setMatchDrawerBankIds(Array.from(selectedBankIds));
  }

  function handleConfirmSuggested(note: string, suggestedGL: MatchGLRow) {
    if (isReadOnly || !confirmingSuggested) return;
    const group = buildMatchGroup({
      matchGroupId: `mg-${crypto.randomUUID()}`,
      matchType: deriveMatchType(1, 1, 'suggested'),
      bankRows: [confirmingSuggested.bank],
      glRows: [suggestedGL],
      matchedBy: currentUserEmail,
      matchedAt: new Date().toISOString(),
      note,
      amountTolerance,
      autoMatchScore: confirmingSuggested.matchScore,
      autoMatchReason: confirmingSuggested.matchReason,
    });
    setMatchGroups((prev) => [...prev, group]);
    setConfirmingSuggestedId(null);
    markDirtyAndScheduleSave();
  }

  function handleMatchDrawerConfirm(selectedGLRows: MatchGLRow[], note: string) {
    if (isReadOnly || !matchDrawerBankRows || matchDrawerBankRows.length === 0) return;
    const group = buildMatchGroup({
      matchGroupId: `mg-${crypto.randomUUID()}`,
      matchType: deriveMatchType(matchDrawerBankRows.length, selectedGLRows.length, 'manual'),
      bankRows: matchDrawerBankRows,
      glRows: selectedGLRows,
      matchedBy: currentUserEmail,
      matchedAt: new Date().toISOString(),
      note,
      amountTolerance,
      autoMatchScore: null,
      autoMatchReason: null,
    });
    setMatchGroups((prev) => [...prev, group]);
    setSelectedBankIds(new Set());
    setMatchDrawerBankIds(null);
    markDirtyAndScheduleSave();
  }

  function handleUndoMatchFromRow(row: ReconcileRow) {
    if (isReadOnly || !row.matchGroup) return;
    setUndoingGroupId(row.matchGroup.match_group_id);
  }

  function handleRequestUndoFromGroupDrawer() {
    if (isReadOnly || !viewingGroupId) return;
    setUndoingGroupId(viewingGroupId);
    setViewingGroupId(null);
  }

  function handleUndoConfirmed() {
    if (isReadOnly || !undoingGroupId) return;
    setMatchGroups((prev) => undoMatchGroup(prev, undoingGroupId));
    setUndoingGroupId(null);
    markDirtyAndScheduleSave();
  }

  function handleRequestEditMatch() {
    if (isReadOnly || !viewingGroupId) return;
    const group = matchGroups.find((g) => g.match_group_id === viewingGroupId);
    if (!group) return;
    setMatchGroups((prev) => undoMatchGroup(prev, viewingGroupId));
    setViewingGroupId(null);
    setMatchDrawerBankIds(group.bank_transaction_ids);
    markDirtyAndScheduleSave();
  }

  // ============================== เฟส 4: บันทึก/auto-save ==============================

  /** บันทึกรอบกระทบยอด (สเปกส่วน "3. DATABASE SAFETY" / "4. AUTO SAVE") — ใช้ทั้งตอนกดปุ่ม "บันทึก" เอง, ตอน
   * auto-save ยิงหลัง debounce, และเป็นขั้นตอนแรกก่อนปิดรอบเสมอ (กันข้อมูลที่ยังไม่ได้บันทึกหลุดไปพร้อมสถานะ
   * "เสร็จสมบูรณ์") คืนค่า boolean บอกผลสำเร็จ/ไม่สำเร็จ (ไม่ throw ออกไปให้ผู้เรียกต้อง try/catch เอง) เพื่อให้
   * handleCompleteConfirm ตัดสินใจได้ว่าจะปิดรอบต่อหรือไม่โดยไม่ต้องพึ่ง exception */
  async function performSave(overrideMeta?: SaveSessionDialogValues): Promise<boolean> {
    if (saveStatus === 'saving') return false;
    setSaveStatus('saving');
    setSaveError(null);
    try {
      const isFirst = sessionMeta === null;
      const nextStatus: ReconcileSessionStatus = isFirst
        ? 'draft'
        : sessionMeta!.status === 'draft'
          ? 'in_progress'
          : sessionMeta!.status;
      const result = await saveReconcileSession({
        sessionId: sessionMeta?.id ?? null,
        sessionName: (overrideMeta ? overrideMeta.sessionName : sessionMeta?.session_name ?? '').trim(),
        bankAccountNo: (overrideMeta ? overrideMeta.bankAccountNo : sessionMeta?.bank_account_no) || null,
        bankName: (overrideMeta ? overrideMeta.bankName : sessionMeta?.bank_name) || null,
        periodStart: (overrideMeta ? overrideMeta.periodStart : sessionMeta?.period_start) || null,
        periodEnd: (overrideMeta ? overrideMeta.periodEnd : sessionMeta?.period_end) || null,
        bankFileName,
        glFileName,
        reconcileRows: mergedOutput.rows,
        matchGLRows,
        matchGroups,
        dateToleranceDays: toleranceDays,
        amountTolerance,
        status: nextStatus,
        actor,
      });
      setMatchBankRows(result.matchBankRows);
      setMatchGLRows(result.matchGLRows);
      setMatchGroups(result.matchGroups);
      if (result.bankIdMap.size > 0) {
        setReviewFlags((prev) => remapRecordKeys(prev, result.bankIdMap));
        setNotes((prev) => remapRecordKeys(prev, result.bankIdMap));
      }
      setSessionMeta(result.session);
      setDirty(false);
      debouncedSaverRef.current?.cancel();
      setSaveStatus('saved');
      window.setTimeout(() => setSaveStatus((s) => (s === 'saved' ? 'idle' : s)), 3000);
      // เคลียร์ cache ของ SWR ที่หน้ารายการ "ประวัติการกระทบยอดธนาคาร" ใช้อยู่ทันทีที่บันทึกสำเร็จ (ไม่ว่าจะเป็น
      // การบันทึกครั้งแรก/บันทึกซ้ำ/auto-save ก็ตาม — ทั้งหมดวิ่งผ่านฟังก์ชันนี้จุดเดียว) กันปัญหา "กลับไปหน้า
      // รายการแล้วยังเห็นข้อมูลเก่า" — หน้ารายการไม่ได้ mount อยู่ตอนนี้ (กำลังอยู่หน้าผลลัพธ์) จึงไม่มี
      // subscriber ให้ mutate() สั่ง revalidate จริงได้ทันที แต่การเรียก mutate() ยังคงลบ dedupe marker ภายใน
      // ของ SWR ทิ้งเสมอ (ดู SWR internalMutate -> startRevalidate ที่ delete FETCH[key]/PRELOAD[key] ก่อนเช็ค
      // ว่ามี subscriber หรือไม่) ทำให้การ mount หน้ารายการครั้งถัดไปโหลดข้อมูลสดใหม่แน่นอน แทนที่จะโดน
      // dedupingInterval ค่าเริ่มต้น 2 วินาทีของ SWR บล็อกไว้ (เกิดขึ้นจริงได้ง่ายมากในโฟลว์ปกติ — เปิดรอบ ->
      // บันทึก -> กลับไปหน้ารายการ มักเสร็จภายใน 2 วินาที)
      void mutate(RECONCILE_SESSIONS_SWR_KEY);
      return true;
    } catch {
      setSaveStatus('error');
      setSaveError('บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง — การเชื่อมต่อฐานข้อมูลอาจขัดข้องชั่วคราว');
      return false;
    }
  }
  // เก็บ performSave เวอร์ชันล่าสุดของทุก render ไว้ใน ref หลัง commit เสร็จแล้วเสมอ (ไม่ใช่ระหว่าง render
  // ตรงๆ — การเขียน ref ระหว่าง render ถือว่าไม่บริสุทธิ์ตามกฎของ React/eslint-plugin-react-hooks rule
  // react-hooks/refs) ให้ debouncedSaverRef ด้านบนเรียกฟังก์ชันเวอร์ชันล่าสุดผ่าน ref นี้ได้เสมอโดยไม่ยึด
  // closure เก่าค้าง — ปลอดภัยเพราะจุดเดียวที่อ่าน performSaveRef.current (บรรทัด 257) ถูกเรียกจาก callback
  // ของ setTimeout แบบ debounce เท่านั้น (ไม่มีทางถูกอ่านแบบ synchronous ก่อน effect นี้ทำงานจริง)
  useEffect(() => {
    performSaveRef.current = performSave;
  });

  function handleSaveClick() {
    if (isReadOnly) return;
    if (sessionMeta === null) {
      setShowSaveSessionDialog(true);
    } else {
      void performSave();
    }
  }

  function handleSaveSessionDialogConfirm(values: SaveSessionDialogValues) {
    setShowSaveSessionDialog(false);
    void performSave(values);
  }

  // ============================== เฟส 4: คำนวณใหม่ ==============================

  function handleRecalculateConfirm(mode: RecalculateMode) {
    setShowRecalculateDialog(false);
    // unmatched_only/all_keep_manual: ข้อเสนอแนะอัตโนมัติของแถวที่ยังไม่ถูกจับคู่ด้วยตนเองคำนวณสดใหม่ทุก render
    // อยู่แล้วจาก matchBankRows/matchGLRows/matchGroups/toleranceDays ปัจจุบันเสมอผ่าน mergeManualMatches (ไม่
    // เคย persist ข้อเสนอแนะอัตโนมัติไว้เป็น "ผลเก่า" ที่ต้องล้าง/คำนวณซ้ำในสถาปัตยกรรมนี้ตั้งแต่เฟส 2/3 แล้ว)
    // สองโหมดนี้จึงไม่มีผลจริงต่อ state — ทำหน้าที่เป็นการ "ยืนยันเจตนาอย่างชัดเจน" ของผู้ใช้ตามสเปก ("do not
    // rerun automatic matching automatically") + บันทึกประวัติเสมอ เป็นดุลยพินิจที่ตัดสินใจเอง ระบุไว้ในสรุปผล
    // ตอนส่งมอบด้วย — มีเพียงโหมด "ล้างผลเดิมและคำนวณใหม่ทั้งหมด" เท่านั้นที่ล้าง matchGroups จริง (การจับคู่
    // ด้วยตนเองที่ยืนยันไว้ทั้งหมดหายไป กลับไปเป็นข้อเสนอแนะอัตโนมัติล้วนๆ ให้เริ่มยืนยันใหม่)
    if (mode === 'clear_and_recalculate_all') {
      setMatchGroups([]);
    }
    markDirtyAndScheduleSave();
    if (sessionMeta) {
      void appendReconcileAuditLog(sessionMeta.id, {
        actionType: 'auto_matching_completed',
        actor,
        actionNote: `คำนวณใหม่: ${RECALCULATE_MODE_LABELS[mode]}`,
      });
    }
  }

  // ============================== เฟส 4: ปิดรอบ / เปิดรอบใหม่ ==============================

  async function handleCompleteConfirm(completionNote: string | null) {
    if (!sessionMeta) return;
    const saved = await performSave();
    if (!saved) return;
    try {
      const updated = await completeReconcileSession(sessionMeta.id, completionNote, actor);
      setSessionMeta(updated);
      setShowCompleteDialog(false);
      void mutate(RECONCILE_SESSIONS_SWR_KEY); // ดูคอมเมนต์เต็มที่ performSave — เหตุผลเดียวกัน
    } catch {
      setSaveError('ปิดรอบกระทบยอดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    }
  }

  async function handleReopenConfirm(reason: string) {
    if (!sessionMeta) return;
    try {
      const updated = await reopenReconcileSession(sessionMeta.id, reason, actor);
      setSessionMeta(updated);
      setShowReopenDialog(false);
      void mutate(RECONCILE_SESSIONS_SWR_KEY); // ดูคอมเมนต์เต็มที่ performSave — เหตุผลเดียวกัน
    } catch {
      setSaveError('เปิดรอบใหม่ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    }
  }

  // ============================== เฟส 4: Export ==============================

  async function handleExportExcel() {
    if (!sessionMeta) return;
    setExportingKind('excel');
    setSaveError(null);
    try {
      const blob = await exportReconcileSessionExcel(sessionMeta.id);
      downloadBlob(blob, `กระทบยอดธนาคาร-${sessionMeta.session_name}.xlsx`);
      void appendReconcileAuditLog(sessionMeta.id, { actionType: 'export_created', actor, actionNote: 'Export Excel' });
    } catch {
      setSaveError('Export Excel ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setExportingKind(null);
    }
  }

  async function handleExportPdf() {
    if (!sessionMeta) return;
    setExportingKind('pdf');
    setSaveError(null);
    try {
      const blob = await exportReconcileSessionPdf(sessionMeta.id, pdfMode, currentUserEmail, todayISO());
      downloadBlob(blob, `กระทบยอดธนาคาร-${sessionMeta.session_name}.pdf`);
      void appendReconcileAuditLog(sessionMeta.id, { actionType: 'export_created', actor, actionNote: `Export PDF (${pdfMode === 'full' ? 'ฉบับเต็ม' : 'สรุป'})` });
    } catch {
      setSaveError('Export PDF ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setExportingKind(null);
    }
  }

  // ============================== เฟส 4: ประวัติการแก้ไข ==============================

  async function handleViewAuditLog() {
    if (!sessionMeta) return;
    setShowAuditLogDrawer(true);
    setAuditLogLoading(true);
    try {
      const entries = await fetchReconcileAuditLog(sessionMeta.id);
      setAuditLogEntries(entries);
    } catch {
      setAuditLogEntries([]);
    } finally {
      setAuditLogLoading(false);
    }
  }

  // ============================== เฟส 4: ป้องกันข้อมูลหาย (ปุ่มกลับหน้านี้เอง) ==============================

  /** เรียก action ทันทีถ้าไม่มีอะไรค้างบันทึก ไม่เช่นนั้นถามยืนยันก่อนเสมอ (ข้อความสเปกเป๊ะ) — ใช้กับปุ่ม
   * "กลับไปหน้ารายการ"/"← กลับไปแก้ไขการจับคู่คอลัมน์" ในหน้านี้เท่านั้น (การสลับเมนู Sidebar ใช้กลไกแยกต่างหาก
   * ผ่าน lib/bankReconcileNavGuard.ts + app/dashboard/page.tsx เพราะ dirty state ในนี้ unmount ไปพร้อมกับ
   * component เมื่อสลับเมนู เข้าถึงจาก DashboardShell ตรงๆ ไม่ได้) */
  function attemptLeave(action: () => void) {
    if (dirty && !isReadOnly) {
      setPendingLeaveAction(() => action);
    } else {
      action();
    }
  }

  function handleBackClick() {
    if (hasSavedSession) {
      attemptLeave(onBackToList);
    } else {
      attemptLeave(onBack);
    }
  }

  if (!filesReady) {
    return (
      <div
        className="card-surface rounded-2xl border border-dashed border-border bg-card-bg p-12 text-center text-sm text-text-sub"
        data-testid="reconcile-results-empty"
      >
        กรุณาอัปโหลดและตรวจสอบไฟล์ในขั้นตอนก่อนหน้า
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="reconcile-results">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleBackClick}
          className="btn-press rounded-[10px] border border-border bg-white px-4 py-2.5 text-sm font-medium text-text hover:bg-page-bg"
          data-testid={hasSavedSession ? 'done-back-to-list' : 'done-back-to-mapping'}
        >
          {hasSavedSession ? '← กลับไปหน้ารายการ' : '← กลับไปแก้ไขการจับคู่คอลัมน์'}
        </button>
      </div>

      <BankReconcileSessionHeader
        sessionName={sessionMeta?.session_name ?? ''}
        bankName={sessionMeta?.bank_name ?? null}
        bankAccountNo={sessionMeta?.bank_account_no ?? null}
        periodStart={sessionMeta?.period_start ?? null}
        periodEnd={sessionMeta?.period_end ?? null}
        status={sessionMeta?.status ?? null}
        saveStatus={saveStatus}
        updatedAt={sessionMeta?.updated_at ?? null}
        completedByEmail={sessionMeta?.completed_by_email ?? null}
        completedAt={sessionMeta?.completed_at ?? null}
        completionNote={sessionMeta?.completion_note ?? null}
        hasSavedSession={hasSavedSession}
        isReadOnly={isReadOnly}
        pdfMode={pdfMode}
        onPdfModeChange={setPdfMode}
        onSave={handleSaveClick}
        onExportExcel={() => void handleExportExcel()}
        onExportPdf={() => void handleExportPdf()}
        onRecalculate={() => setShowRecalculateDialog(true)}
        onComplete={() => setShowCompleteDialog(true)}
        onReopen={() => setShowReopenDialog(true)}
        onViewAuditLog={() => void handleViewAuditLog()}
      />

      {saveError && (
        <p role="alert" className="rounded-[10px] border border-danger/20 bg-danger/10 px-3.5 py-2.5 text-sm text-danger" data-testid="session-error-message">
          {saveError}
        </p>
      )}
      {exportingKind && (
        <p className="text-xs text-text-sub" data-testid="session-export-loading">
          กำลังสร้างไฟล์ {exportingKind === 'excel' ? 'Excel' : 'PDF'}...
        </p>
      )}

      {!isReadOnly && (
        <div className="card-surface flex flex-wrap items-center gap-3 rounded-2xl p-4">
          <label htmlFor="date-tolerance-select" className="text-sm font-medium text-text">
            ช่วงวันที่ที่ยอมรับได้ (Date Tolerance)
          </label>
          <select
            id="date-tolerance-select"
            value={dateTolerance}
            onChange={(e) => handleDateToleranceChange(e.target.value as DateToleranceOption)}
            className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-3 text-sm text-text"
            data-testid="date-tolerance-select"
          >
            {TOLERANCE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {DATE_TOLERANCE_LABELS[opt]}
              </option>
            ))}
          </select>

          <span className="hidden h-8 w-px bg-border sm:block" aria-hidden="true" />

          <label htmlFor="amount-tolerance-select" className="text-sm font-medium text-text">
            ค่าคลาดเคลื่อนของยอดเงินที่ยอมรับได้ (Amount Tolerance)
          </label>
          <select
            id="amount-tolerance-select"
            value={amountToleranceOption}
            onChange={(e) => handleAmountToleranceOptionChange(e.target.value as AmountToleranceOption)}
            className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-3 text-sm text-text"
            data-testid="amount-tolerance-select"
          >
            {AMOUNT_TOLERANCE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {AMOUNT_TOLERANCE_LABELS[opt]}
              </option>
            ))}
          </select>
          {amountToleranceOption === 'custom' && (
            <input
              type="number"
              min={0}
              step={0.01}
              value={customAmountTolerance}
              onChange={(e) => handleCustomAmountToleranceChange(Number(e.target.value))}
              className="focus-ring-primary h-11 w-32 rounded-[10px] border border-border bg-white px-3 text-sm text-text"
              data-testid="amount-tolerance-custom-input"
            />
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <KpiCard
          testId="kpi-total-bank"
          icon={Landmark}
          iconBg="bg-primary/15"
          iconColor="text-primary"
          label="รายการ Bank ทั้งหมด"
          value={summary.totalBank.toLocaleString('th-TH')}
        />
        <KpiCard
          testId="kpi-matched-exact"
          icon={CheckCircle2}
          iconBg="bg-success/15"
          iconColor="text-success"
          label="กระทบยอดเรียบร้อย"
          value={summary.matchedExact.toLocaleString('th-TH')}
        />
        <KpiCard
          testId="kpi-matched-tolerance"
          icon={CircleCheck}
          iconBg="bg-primary/15"
          iconColor="text-primary"
          label="น่าจะตรงกัน"
          value={summary.matchedTolerance.toLocaleString('th-TH')}
        />
        <KpiCard
          testId="kpi-confirmed-manual"
          icon={ShieldCheck}
          iconBg="bg-teal-100"
          iconColor="text-teal-700"
          label="ยืนยันด้วยตนเอง"
          value={summary.confirmedManual.toLocaleString('th-TH')}
        />
        <KpiCard
          testId="kpi-ambiguous"
          icon={Layers}
          iconBg="bg-orange-100"
          iconColor="text-orange-700"
          label="พบหลายรายการ"
          value={summary.ambiguous.toLocaleString('th-TH')}
        />
        <KpiCard
          testId="kpi-pending-review"
          icon={Clock}
          iconBg="bg-warning/15"
          iconColor="text-warning"
          label="รอตรวจสอบ"
          value={summary.pendingReview.toLocaleString('th-TH')}
        />
        <KpiCard
          testId="kpi-not-found-gl"
          icon={SearchX}
          iconBg="bg-danger/15"
          iconColor="text-danger"
          label="ไม่พบใน GL"
          value={summary.notFoundInGL.toLocaleString('th-TH')}
        />
        <KpiCard
          testId="kpi-not-found-bank"
          icon={FileX}
          iconBg="bg-purple-100"
          iconColor="text-purple-700"
          label="GL ไม่พบใน Bank"
          value={summary.notFoundInBank.toLocaleString('th-TH')}
        />
        <KpiCard
          testId="kpi-total-difference"
          icon={Banknote}
          iconBg="bg-page-bg"
          iconColor="text-text-sub"
          label="ผลต่างรวม (บาท)"
          value={summary.totalDifference.toLocaleString('th-TH', THB2)}
        />
      </div>

      <div className="flex flex-wrap gap-2" data-testid="reconcile-segmented-control">
        {SEGMENTED_TABS.map((tab) => {
          const isActive = filters.tab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => handleTabClick(tab)}
              className={`btn-press rounded-full px-4 py-2 text-xs font-semibold ${
                isActive
                  ? 'bg-primary text-white shadow-sm'
                  : 'border border-border bg-white text-text-sub hover:bg-page-bg'
              }`}
              data-testid={`reconcile-tab-${tab}`}
            >
              {RECONCILE_TAB_LABELS[tab]} ({tabCounts[tab].toLocaleString('th-TH')})
            </button>
          );
        })}
      </div>

      <div className="card-surface flex flex-wrap items-end gap-3 rounded-2xl p-4">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1.5 text-sm">
          <span className="font-medium text-text">ค้นหา</span>
          <input
            type="text"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearchSubmit();
            }}
            placeholder="รายละเอียด Bank, เลขที่เอกสาร GL, รายละเอียด GL, จำนวนเงิน, หมายเหตุ, ผู้ยืนยัน"
            className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-3 text-sm text-text"
            data-testid="reconcile-search-input"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-text">ตั้งแต่วันที่</span>
          <input
            type="date"
            value={filters.dateFrom ?? ''}
            onChange={(e) => setFilters((prev) => ({ ...prev, dateFrom: e.target.value || null }))}
            className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-3 text-sm text-text"
            data-testid="reconcile-date-from"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-text">ถึงวันที่</span>
          <input
            type="date"
            value={filters.dateTo ?? ''}
            onChange={(e) => setFilters((prev) => ({ ...prev, dateTo: e.target.value || null }))}
            className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-3 text-sm text-text"
            data-testid="reconcile-date-to"
          />
        </label>
        <label className="flex w-32 flex-col gap-1.5 text-sm">
          <span className="font-medium text-text">ยอดต่ำสุด</span>
          <input
            type="number"
            value={filters.amountMin ?? ''}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, amountMin: e.target.value === '' ? null : Number(e.target.value) }))
            }
            className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-3 text-sm text-text"
            data-testid="reconcile-amount-min"
          />
        </label>
        <label className="flex w-32 flex-col gap-1.5 text-sm">
          <span className="font-medium text-text">ยอดสูงสุด</span>
          <input
            type="number"
            value={filters.amountMax ?? ''}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, amountMax: e.target.value === '' ? null : Number(e.target.value) }))
            }
            className="focus-ring-primary h-11 rounded-[10px] border border-border bg-white px-3 text-sm text-text"
            data-testid="reconcile-amount-max"
          />
        </label>
        <button
          type="button"
          onClick={handleSearchSubmit}
          className="btn-press h-11 rounded-[10px] bg-primary px-4 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover"
          data-testid="reconcile-search-submit"
        >
          ค้นหา
        </button>
        <button
          type="button"
          onClick={handleClearFilters}
          className="btn-press h-11 rounded-[10px] border border-border bg-white px-4 text-sm font-medium text-text-sub hover:bg-page-bg"
          data-testid="reconcile-clear-filters"
        >
          ล้างตัวกรอง
        </button>
      </div>

      {!isReadOnly && selectedBankIds.size > 0 && (
        <div
          className="card-surface flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4"
          data-testid="reconcile-combine-bar"
        >
          <p className="text-sm font-medium text-text">
            เลือกไว้ {selectedBankIds.size} รายการ — รวมรายการ Bank เหล่านี้เพื่อจับคู่กับ GL รายการเดียวกัน
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSelectedBankIds(new Set())}
              className="btn-press rounded-[10px] border border-border bg-white px-3.5 py-2 text-xs font-medium text-text-sub hover:bg-page-bg"
              data-testid="reconcile-combine-clear"
            >
              ล้างการเลือก
            </button>
            <button
              type="button"
              disabled={selectedBankIds.size < 2}
              onClick={handleCombineSelectedBankRows}
              className="btn-press rounded-[10px] bg-primary px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="reconcile-combine-confirm"
            >
              รวมรายการ Bank เพื่อจับคู่
            </button>
          </div>
        </div>
      )}

      <BankReconcileResultTable
        results={filteredRows}
        selectedBankIds={selectedBankIds}
        onToggleSelect={handleToggleSelectBank}
        onViewDetail={(row) => setViewingDetailId(row.bank.bank_row_id)}
        onViewCandidates={(row) => setViewingCandidatesId(row.bank.bank_row_id)}
        onToggleReviewFlag={handleToggleReviewFlag}
        onEditNote={handleEditNote}
        onConfirmSuggested={(row) => {
          if (!isReadOnly) setConfirmingSuggestedId(row.bank.bank_row_id);
        }}
        onSelectGL={(row) => {
          if (!isReadOnly) setMatchDrawerBankIds([row.bank.bank_row_id]);
        }}
        onUndoMatch={handleUndoMatchFromRow}
        onViewGroup={(group) => setViewingGroupId(group.match_group_id)}
      />

      <BankReconcileUnmatchedGL glOnlyResults={mergedOutput.glOnlyResults} />

      {viewingDetail && (
        <BankReconcileDetailDrawer
          result={viewingDetail}
          onViewGroup={(group) => {
            setViewingDetailId(null);
            setViewingGroupId(group.match_group_id);
          }}
          onClose={() => setViewingDetailId(null)}
        />
      )}
      {viewingCandidates && (
        <BankReconcileCandidatesModal result={viewingCandidates} onClose={() => setViewingCandidatesId(null)} />
      )}
      {confirmingSuggested && (
        <BankReconcileConfirmMatchDialog
          row={confirmingSuggested}
          onConfirm={handleConfirmSuggested}
          onClose={() => setConfirmingSuggestedId(null)}
        />
      )}
      {matchDrawerBankRows && matchDrawerBankRows.length > 0 && (
        <BankReconcileMatchDrawer
          bankRows={matchDrawerBankRows}
          glRows={matchGLRows}
          consumedBankIds={mergedOutput.consumedBankIds}
          consumedGLIds={mergedOutput.consumedGLIds}
          autoUsedGLIds={mergedOutput.autoUsedGLIds}
          amountTolerance={amountTolerance}
          onConfirm={handleMatchDrawerConfirm}
          onClose={() => setMatchDrawerBankIds(null)}
        />
      )}
      {undoingGroup && (
        <BankReconcileUndoConfirmDialog
          group={undoingGroup}
          bankRows={undoingGroupBankRows}
          glRows={undoingGroupGLRows}
          onConfirm={handleUndoConfirmed}
          onClose={() => setUndoingGroupId(null)}
        />
      )}
      {viewingGroup && (
        <BankReconcileGroupDetailDrawer
          group={viewingGroup}
          bankRows={viewingGroupBankRows}
          glRows={viewingGroupGLRows}
          onRequestEditMatch={handleRequestEditMatch}
          onRequestUndoMatch={handleRequestUndoFromGroupDrawer}
          onRequestEditNote={() => {
            if (!isReadOnly) setNoteEditTarget({ kind: 'group', groupId: viewingGroup.match_group_id });
          }}
          onClose={() => setViewingGroupId(null)}
        />
      )}
      {noteEditContext && (
        <BankReconcileNoteDialog
          title={noteEditContext.title}
          subtitle={noteEditContext.subtitle}
          initialNote={noteEditContext.initialNote}
          onSave={handleSaveNote}
          onClose={() => setNoteEditTarget(null)}
        />
      )}

      {showSaveSessionDialog && (
        <BankReconcileSaveSessionDialog
          initialValues={{
            sessionName: sessionMeta?.session_name ?? '',
            bankName: sessionMeta?.bank_name ?? '',
            bankAccountNo: sessionMeta?.bank_account_no ?? '',
            periodStart: sessionMeta?.period_start ?? '',
            periodEnd: sessionMeta?.period_end ?? '',
          }}
          onSave={handleSaveSessionDialogConfirm}
          onClose={() => setShowSaveSessionDialog(false)}
        />
      )}

      {showCompleteDialog && (
        <BankReconcileCompleteDialog
          validation={completionValidation}
          onConfirm={handleCompleteConfirm}
          onClose={() => setShowCompleteDialog(false)}
        />
      )}

      {showReopenDialog && sessionMeta && (
        <BankReconcileReopenDialog
          session={sessionMeta}
          onConfirm={handleReopenConfirm}
          onClose={() => setShowReopenDialog(false)}
        />
      )}

      {showRecalculateDialog && (
        <BankReconcileRecalculateDialog onConfirm={handleRecalculateConfirm} onClose={() => setShowRecalculateDialog(false)} />
      )}

      {showAuditLogDrawer && (
        <BankReconcileAuditLogDrawer
          entries={auditLogEntries}
          loading={auditLogLoading}
          onClose={() => setShowAuditLogDrawer(false)}
        />
      )}

      {pendingLeaveAction && (
        <BankReconcileConfirmDialog
          testIdPrefix="unsaved-leave"
          title="ออกจากหน้านี้?"
          message="มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้หรือไม่"
          confirmLabel="ออกจากหน้านี้โดยไม่บันทึก"
          danger
          onConfirm={() => {
            const action = pendingLeaveAction;
            setPendingLeaveAction(null);
            action();
          }}
          onClose={() => setPendingLeaveAction(null)}
        />
      )}
    </div>
  );
}

function KpiCard({
  testId,
  icon: Icon,
  iconBg,
  iconColor,
  label,
  value,
}: {
  testId: string;
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
  label: string;
  value: string;
}) {
  return (
    <div className="card-surface card-hover-lift rounded-2xl p-5" data-testid={testId}>
      <div className={`flex h-10 w-10 items-center justify-center rounded-full ${iconBg} ${iconColor}`}>
        <Icon size={18} aria-hidden="true" />
      </div>
      <p className="font-numeric mt-3 text-xl font-bold text-text" data-testid={`${testId}-value`}>
        {value}
      </p>
      <p className="mt-1 text-xs text-text-sub">{label}</p>
    </div>
  );
}
