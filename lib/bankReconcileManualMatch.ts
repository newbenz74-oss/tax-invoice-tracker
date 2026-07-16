import type {
  MatchBankRow,
  MatchGLRow,
  MatchGroup,
  MatchType,
  ManualConfirmStatus,
  ReconcileRow,
  ReviewFlag,
  RowNote,
} from '@/types/bankReconcile';
import { describeCandidateMatch, runReconciliationMatch } from './bankReconcileMatching';

/**
 * เครื่องมือจับคู่รายการด้วยตนเอง (Manual Reconciliation) — เฟส 3 ของ Bank Reconcile เพิ่มเข้ามา 2026-07-16
 *
 * ไฟล์นี้เป็น "อัลกอริทึมล้วนๆ" เหมือน lib/bankReconcileMatching.ts ของเฟส 2 ทุกประการ (ไม่มีข้อความแสดงผล/สี
 * badge ใดๆ — อยู่ใน lib/bankReconcileManualMatchLogic.ts แทน) หลักการที่ยึดตลอดทั้งไฟล์ตามสเปกตรงๆ:
 *   "Manual matching must never modify the original imported values. Store matching relationships
 *   separately from Bank and GL data." — ไม่มีจุดไหนในไฟล์นี้ที่แก้ไข MatchBankRow/MatchGLRow ที่รับเข้ามาเลย
 *   ทุกฟังก์ชันสร้าง object ใหม่ (MatchGroup/ReconcileRow) เก็บแยกต่างหากเสมอ อ้างอิงข้อมูลเดิมผ่าน id เท่านั้น
 *
 * หัวใจของไฟล์นี้คือ mergeManualMatches() — เรียก runReconciliationMatch() เดิมของเฟส 2 "ตรงๆ ไม่มีการแก้ไข"
 * กับเฉพาะ pool ของแถว Bank/GL ที่ยังไม่ถูกจับคู่ด้วยตนเอง (กรองออกก่อนเรียกเสมอ) แล้วนำผลที่ได้มาผสานกับผล
 * จับคู่ด้วยตนเอง (สังเคราะห์เป็น ReconcileRow ของตัวเอง) เป็นแนวทางที่ทำให้ "ไม่ต้องแก้โค้ดของเฟส 2 เลยแม้แต่
 * บรรทัดเดียว" ตามข้อกำหนดที่ระบุไว้ตรงๆ ("Do not rebuild Phase 2") — เมื่อไม่มีการจับคู่ด้วยตนเองเลย
 * (matchGroups ว่างเปล่า) ผลลัพธ์ของ mergeManualMatches() จะตรงกับผลของ runReconciliationMatch() ของเฟส 2
 * ทุกประการ (พิสูจน์ด้วย unit test โดยตรง) ทำให้ทุกเทสต์ e2e/unit เดิมของเฟส 2 ยังผ่านได้โดยไม่ต้องแก้ไขเลย
 */

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** ผลต่างจำนวนวันระหว่างวันที่ ISO สองค่า — คัดลอกมาจาก lib/bankReconcileMatching.ts ตามธรรมเนียม private
 * ต่อไฟล์ที่ใช้อยู่แล้วทั้งโปรเจกต์ (round2/dateDiffDays ไม่ได้แชร์ข้ามไฟล์ — ดู bankReconcileNormalize.ts,
 * overduePurchaseTaxLogic.ts เป็นตัวอย่างที่มีอยู่แล้ว) */
function dateDiffDays(isoA: string | null, isoB: string | null): number | null {
  if (!isoA || !isoB) return null;
  const [ya, ma, da] = isoA.split('-').map(Number);
  const [yb, mb, db] = isoB.split('-').map(Number);
  const msA = Date.UTC(ya, ma - 1, da);
  const msB = Date.UTC(yb, mb - 1, db);
  return Math.round(Math.abs(msA - msB) / 86400000);
}

/** ผลรวมยอดฝั่ง Bank/GL ของกลุ่มที่กำลังจะจับคู่ + ผลต่างสัมบูรณ์ — ใช้ทั้งตอนสร้าง MatchGroup จริง และตอน
 * แสดงผลสด (real-time) ในสรุปเทียบยอดของ Manual Match Drawer ระหว่างผู้ใช้กำลังเลือกรายการอยู่ (ก่อนกดยืนยัน) */
export function computeGroupTotals(
  bankRows: MatchBankRow[],
  glRows: MatchGLRow[]
): { bankTotal: number; glTotal: number; amountDifference: number } {
  const bankTotal = round2(bankRows.reduce((sum, b) => sum + b.bank_amount, 0));
  const glTotal = round2(glRows.reduce((sum, g) => sum + g.gl_amount, 0));
  const amountDifference = round2(Math.abs(bankTotal - glTotal));
  return { bankTotal, glTotal, amountDifference };
}

/** จัดประเภทผลการยืนยันด้วยตนเองตามผลต่างยอดเงินเทียบกับค่าคลาดเคลื่อนที่ตั้งไว้ ณ ขณะยืนยัน (ตามสเปกตรงๆ ของ
 * ส่วน "AMOUNT TOLERANCE"): ผลต่าง 0 พอดี = ยืนยันด้วยตนเอง (เขียวเข้ม/ฟ้าอมเขียว), ผลต่าง > 0 แต่ไม่เกินค่า
 * คลาดเคลื่อน = ตรงกันภายในค่าคลาดเคลื่อน (ฟ้าอมเขียว), ผลต่างเกินค่าคลาดเคลื่อน = ยืนยันแบบมีผลต่าง (ต้องผ่าน
 * validateManualMatch ก่อนเสมอ — ฟังก์ชันนี้แค่จัดประเภท ไม่ตัดสินว่า "ยืนยันได้หรือยัง") */
export function classifyManualStatus(amountDifference: number, amountTolerance: number): ManualConfirmStatus {
  if (amountDifference <= 0) return 'confirmed_manual';
  if (amountDifference <= amountTolerance) return 'confirmed_tolerance';
  return 'confirmed_variance';
}

/** เดา match_type ที่เหมาะสมจากจำนวนแถว Bank/GL ที่เลือก + ที่มาของ flow (ยืนยันรายการที่แนะนำ vs เลือกเอง) —
 * ให้ component เรียกใช้แทนการเขียน if/else ซ้ำในหลายที่ ไม่ใช่ตัวบังคับ (ผู้เรียกยังส่ง match_type ที่ต้องการ
 * เข้า buildMatchGroup ตรงๆ ได้เสมอ) กรณี "หลาย Bank ต่อหลาย GL" ไม่ใช่กรณีที่สเปกระบุไว้ตรงๆ (สเปกมีแค่ 1:1,
 * 1:หลาย, หลาย:1) แต่รองรับไว้เป็น manual_override เพื่อไม่ให้โค้ดพังถ้าเกิดขึ้นจริง (UI ไม่ได้ชวนให้ทำแบบนี้) */
export function deriveMatchType(bankCount: number, glCount: number, origin: 'suggested' | 'manual'): MatchType {
  if (bankCount === 1 && glCount > 1) return 'one_to_many';
  if (bankCount > 1 && glCount === 1) return 'many_to_one';
  if (bankCount > 1 && glCount > 1) return 'manual_override';
  return origin === 'suggested' ? 'one_to_one' : 'manual_override';
}

export interface BuildMatchGroupParams {
  matchGroupId: string;
  matchType: MatchType;
  bankRows: MatchBankRow[];
  glRows: MatchGLRow[];
  matchedBy: string;
  matchedAt: string;
  note: string;
  amountTolerance: number;
  autoMatchScore: number | null;
  autoMatchReason: string | null;
}

/** สร้าง MatchGroup ใหม่หนึ่งกลุ่ม — status คำนวณครั้งเดียวตรงนี้แล้ว "แช่แข็ง" ถาวร (ดูหมายเหตุที่
 * ManualConfirmStatus ใน types/bankReconcile.ts) date_difference_days มีค่าเฉพาะกลุ่ม 1 ต่อ 1 เท่านั้น */
export function buildMatchGroup(params: BuildMatchGroupParams): MatchGroup {
  const { bankTotal, glTotal, amountDifference } = computeGroupTotals(params.bankRows, params.glRows);
  const status = classifyManualStatus(amountDifference, params.amountTolerance);
  const dateDifferenceDays =
    params.bankRows.length === 1 && params.glRows.length === 1
      ? dateDiffDays(params.bankRows[0].bank_date, params.glRows[0].gl_date)
      : null;

  return {
    match_group_id: params.matchGroupId,
    match_type: params.matchType,
    status,
    bank_transaction_ids: params.bankRows.map((b) => b.bank_row_id),
    gl_transaction_ids: params.glRows.map((g) => g.gl_row_id),
    bank_total: bankTotal,
    gl_total: glTotal,
    amount_difference: amountDifference,
    date_difference_days: dateDifferenceDays,
    manual_match: true,
    matched_by: params.matchedBy,
    matched_at: params.matchedAt,
    note: params.note,
    auto_match_score: params.autoMatchScore,
    auto_match_reason: params.autoMatchReason,
  };
}

/** ยกเลิกกลุ่มจับคู่หนึ่งกลุ่ม — คืน array ใหม่โดยไม่มีกลุ่มนั้นอีกต่อไป การ "ปล่อยแถว GL ให้กลับมาใช้ได้" และ
 * "รันจับคู่อัตโนมัติใหม่ให้แถวที่เกี่ยวข้อง" เกิดขึ้นเองโดยธรรมชาติจากสถาปัตยกรรมของ mergeManualMatches() ด้าน
 * ล่าง (ไม่มีกลุ่มนี้ในรายการ -> แถว Bank/GL ที่เคยอยู่ในกลุ่มนี้จะไหลกลับเข้า pool ของ runReconciliationMatch
 * ทันทีในการ merge ครั้งถัดไป) ไม่ต้องเขียนโค้ด "restore" แยกต่างหากเลย — เหมือนหลักการ duplicate-protection ที่
 * "เกิดขึ้นเองจากอัลกอริทึม" ของเฟส 2 (ดูหมายเหตุท้าย lib/bankReconcileMatching.ts) */
export function undoMatchGroup(groups: MatchGroup[], matchGroupId: string): MatchGroup[] {
  return groups.filter((g) => g.match_group_id !== matchGroupId);
}

/** คำนวณ "วันที่ต่างกัน/คะแนนจับคู่/ผลต่างยอดเงิน" ของผู้สมัคร GL รายหนึ่งเทียบกับแถว Bank — ใช้ใน Manual Match
 * Drawer (ตาราง candidate ที่อาจมียอดเงินไม่เท่ากับ Bank เลยก็ได้ ต่างจาก candidates ของเฟส 2 ที่ยอดตรงกันเสมอ
 * โดยโครงสร้าง) ห่อ describeCandidateMatch ของเฟส 2 (คำนวณเฉพาะวันที่/คะแนน) แล้วเพิ่มผลต่างยอดเงินเข้าไป */
export function describeGLCandidate(
  bank: Pick<MatchBankRow, 'bank_date' | 'bank_amount'>,
  candidate: Pick<MatchGLRow, 'gl_date' | 'gl_amount'>
): { dateDiffDays: number | null; matchScore: number; amountDifference: number } {
  const { dateDiffDays: diff, matchScore } = describeCandidateMatch(bank, candidate);
  const amountDifference = round2(Math.abs(bank.bank_amount - candidate.gl_amount));
  return { dateDiffDays: diff, matchScore, amountDifference };
}

/** เลือกผู้สมัคร GL ที่ "ดีที่สุด" จากรายการผู้สมัคร (candidates ของแถว matched_tolerance/pending_review ที่
 * ยอดเงินตรงกันอยู่แล้วโดยโครงสร้าง) สำหรับพรีฟิลใน Confirm Suggested Match Dialog — เรียงตามคะแนนจับคู่สูงสุด
 * ก่อน (ตรงกับเกณฑ์ "highest match score" ของสเปก) เสมอกันให้วันที่ใกล้ที่สุดชนะ คืน null ถ้าไม่มีผู้สมัครเลย */
export function resolveSuggestedCandidate(bank: MatchBankRow, candidates: MatchGLRow[]): MatchGLRow | null {
  let best: MatchGLRow | null = null;
  let bestScore = -Infinity;
  let bestDiff = Infinity;
  for (const candidate of candidates) {
    const { dateDiffDays: diff, matchScore } = describeGLCandidate(bank, candidate);
    const effectiveDiff = diff ?? Infinity;
    if (matchScore > bestScore || (matchScore === bestScore && effectiveDiff < bestDiff)) {
      best = candidate;
      bestScore = matchScore;
      bestDiff = effectiveDiff;
    }
  }
  return best;
}

/** หมายเหตุ "จริง" ของแถวหนึ่งแถว — ถ้าแถวเป็นส่วนหนึ่งของกลุ่มจับคู่ด้วยตนเองแล้ว ให้ใช้ MatchGroup.note เสมอ
 * (ไม่ใช่ RowNote.note ซึ่งมีความหมายเฉพาะ "ก่อนจับคู่" เท่านั้น) ดูเหตุผลเต็มที่ RowNote ใน types/bankReconcile.ts */
export function getRowNote(row: ReconcileRow): string {
  return row.matchGroup?.note ?? row.note?.note ?? '';
}

export interface ManualMatchValidationInput {
  selectedBankIds: string[];
  selectedGLIds: string[];
  /** แถว Bank ที่ถูกใช้ในกลุ่มจับคู่ด้วยตนเอง "อื่น" ไปแล้ว (ไม่รวมกลุ่มที่กำลังแก้ไขอยู่ ถ้ามี) */
  consumedBankIds: Set<string>;
  /** แถว GL ที่ถูกใช้ในกลุ่มจับคู่ด้วยตนเอง "อื่น" ไปแล้ว (ไม่รวมกลุ่มที่กำลังแก้ไขอยู่ ถ้ามี) */
  consumedGLIds: Set<string>;
  /** แถว GL ที่เอนจินอัตโนมัติ (เฟส 2) จับคู่ไปแล้วในรอบปัจจุบัน — กันชนกับผลอัตโนมัติด้วยตามสเปก concurrency */
  autoUsedGLIds: Set<string>;
  amountDifference: number;
  amountTolerance: number;
  overrideConfirmed: boolean;
  note: string;
}

export interface ManualMatchValidationResult {
  valid: boolean;
  errors: string[];
  /** ผลต่างเกินค่าคลาดเคลื่อน -> UI ต้องซ่อนปุ่ม "ยืนยันการจับคู่" ปกติ แล้วโชว์ปุ่ม "ยืนยันแบบมีผลต่าง" แทน */
  requiresOverride: boolean;
  /** ต้องกรอกหมายเหตุก่อนยืนยันได้ (เกิดพร้อมกับ requiresOverride เสมอตามสเปก "Require a note for any manual
   * override with non-zero difference") */
  requiresNote: boolean;
}

/** ตรวจสอบก่อนยืนยันการจับคู่ด้วยตนเอง ครบทุกกฎตามสเปกส่วน "MANUAL MATCH VALIDATION" (ยกเว้นข้อที่ตรวจสอบ
 * ไม่ได้จริงในรันไทม์เพราะรับประกันโดยโครงสร้างข้อมูลอยู่แล้ว เช่น "amounts are valid numeric values" —
 * MatchBankRow/MatchGLRow ผ่าน normalize ของเฟส 1 มาแล้วเสมอ ไม่มีทางเป็น NaN) คืน errors ทุกข้อที่พบพร้อมกัน
 * (ไม่ return แค่ข้อแรก) ตามธรรมเนียมเดิมของโปรเจกต์ (เทียบ validateParsedTable ของเฟส 1) */
export function validateManualMatch(input: ManualMatchValidationInput): ManualMatchValidationResult {
  const errors: string[] = [];

  if (input.selectedBankIds.length === 0) {
    errors.push('กรุณาเลือกรายการ Bank อย่างน้อย 1 รายการ');
  }
  if (input.selectedGLIds.length === 0) {
    errors.push('กรุณาเลือกรายการ GL อย่างน้อย 1 รายการ');
  }
  if (input.selectedBankIds.some((id) => input.consumedBankIds.has(id))) {
    errors.push('มีรายการ Bank ที่ถูกใช้ในการจับคู่ด้วยตนเองอื่นอยู่แล้ว กรุณาเลือกใหม่');
  }
  if (input.selectedGLIds.some((id) => input.consumedGLIds.has(id) || input.autoUsedGLIds.has(id))) {
    errors.push('มีรายการ GL ที่ถูกใช้ในการจับคู่อื่นอยู่แล้ว (อัตโนมัติหรือด้วยตนเอง) กรุณาเลือกใหม่');
  }

  const withinTolerance = input.amountDifference <= input.amountTolerance;
  const requiresOverride = !withinTolerance;
  const requiresNote = !withinTolerance;

  if (requiresOverride && !input.overrideConfirmed) {
    errors.push('ผลต่างยอดเงินเกินค่าคลาดเคลื่อนที่กำหนด กรุณากด "ยืนยันแบบมีผลต่าง" หากต้องการดำเนินการต่อ');
  }
  if (requiresNote && !input.note.trim()) {
    errors.push('กรุณาระบุหมายเหตุสำหรับการยืนยันที่มีผลต่างยอดเงิน');
  }

  return { valid: errors.length === 0, errors, requiresOverride, requiresNote };
}

export interface MergeManualMatchesInput {
  matchBankRows: MatchBankRow[];
  matchGLRows: MatchGLRow[];
  toleranceDays: number;
  matchGroups: MatchGroup[];
  reviewFlags: Record<string, ReviewFlag>;
  notes: Record<string, RowNote>;
}

export interface MergeManualMatchesOutput {
  /** ยาวเท่าจำนวนแถว Bank ทั้งหมดเสมอ เรียงตามลำดับแถวในไฟล์ต้นฉบับเสมอ (ไม่ใช่ลำดับที่ยืนยันจับคู่) — สืบทอด
   * invariant "Every Bank Statement row must remain visible" ของเฟส 2 มาตรงๆ */
  rows: ReconcileRow[];
  glOnlyResults: ReturnType<typeof runReconciliationMatch>['glOnlyResults'];
  /** แถว Bank ที่อยู่ในกลุ่มจับคู่ด้วยตนเองแล้ว (จากทุกกลุ่มรวมกัน) */
  consumedBankIds: Set<string>;
  /** แถว GL ที่อยู่ในกลุ่มจับคู่ด้วยตนเองแล้ว (จากทุกกลุ่มรวมกัน) */
  consumedGLIds: Set<string>;
  /** แถว GL ที่เอนจินอัตโนมัติจับคู่ไปแล้วในรอบนี้ (ไม่รวมที่ manual ใช้ไปแล้ว เพราะถูกกรองออกจาก pool ก่อนรัน) —
   * ส่งให้ Manual Match Drawer ใช้ปิดใช้งาน GL ที่ "กำลังถูกใช้อยู่" ตามสเปก concurrency safety */
  autoUsedGLIds: Set<string>;
}

/**
 * ผสานผลจับคู่ด้วยตนเอง (matchGroups) เข้ากับเครื่องมือจับคู่อัตโนมัติเดิมของเฟส 2 — ฟังก์ชันหลักที่ orchestrator
 * (BankReconcileResults.tsx) เรียกแทน runReconciliationMatch() ตรงๆ นับตั้งแต่เฟส 3 เป็นต้นไป
 *
 * ขั้นตอน: (1) รวบรวม id ของแถว Bank/GL ที่ถูกใช้ไปแล้วในกลุ่มจับคู่ด้วยตนเองทั้งหมด (2) กรองแถวเหล่านั้นออกจาก
 * pool ก่อนส่งเข้า runReconciliationMatch() ของเฟส 2 (เรียกฟังก์ชันเดิมตรงๆ ไม่มีการแก้ไขใดๆ ทั้งสิ้น) (3)
 * สังเคราะห์ ReconcileRow ของแถวที่จับคู่ด้วยตนเองจาก MatchGroup โดยตรง (4) รวมสองชุดผลลัพธ์แล้วเรียงกลับตาม
 * ลำดับแถว Bank ต้นฉบับเสมอ — เมื่อ matchGroups ว่างเปล่า ผลลัพธ์จะเหมือนกับเรียก runReconciliationMatch()
 * ตรงๆ ทุกประการ (ดู unit test "ไม่มีการจับคู่ด้วยตนเองเลย")
 */
export function mergeManualMatches(input: MergeManualMatchesInput): MergeManualMatchesOutput {
  const { matchBankRows, matchGLRows, toleranceDays, matchGroups, reviewFlags, notes } = input;

  const consumedBankIds = new Set<string>();
  const consumedGLIds = new Set<string>();
  for (const group of matchGroups) {
    for (const id of group.bank_transaction_ids) consumedBankIds.add(id);
    for (const id of group.gl_transaction_ids) consumedGLIds.add(id);
  }

  const autoBankRows = matchBankRows.filter((b) => !consumedBankIds.has(b.bank_row_id));
  const autoGLRows = matchGLRows.filter((g) => !consumedGLIds.has(g.gl_row_id));
  const autoOutput = runReconciliationMatch(autoBankRows, autoGLRows, toleranceDays);

  const autoUsedGLIds = new Set<string>();
  for (const r of autoOutput.bankResults) {
    if (r.matchedGL) autoUsedGLIds.add(r.matchedGL.gl_row_id);
  }

  const bankById = new Map(matchBankRows.map((b) => [b.bank_row_id, b] as const));
  const glById = new Map(matchGLRows.map((g) => [g.gl_row_id, g] as const));
  const rowById = new Map<string, ReconcileRow>();

  for (const r of autoOutput.bankResults) {
    rowById.set(r.bank.bank_row_id, {
      bank: r.bank,
      status: r.status,
      matchedGL: r.matchedGL,
      matchedGLRows: r.matchedGL ? [r.matchedGL] : [],
      candidates: r.candidates,
      matchScore: r.matchScore,
      amountDifference: r.amountDifference,
      dateDifferenceDays: r.dateDifferenceDays,
      matchReason: r.matchReason,
      matchGroup: null,
      reviewFlag: reviewFlags[r.bank.bank_row_id] ?? null,
      note: notes[r.bank.bank_row_id] ?? null,
    });
  }

  for (const group of matchGroups) {
    const glRows = group.gl_transaction_ids
      .map((id) => glById.get(id))
      .filter((g): g is MatchGLRow => Boolean(g));
    const singleGL = glRows.length === 1 ? glRows[0] : null;

    for (const bankId of group.bank_transaction_ids) {
      const bank = bankById.get(bankId);
      if (!bank) continue; // กันข้อมูลเพี้ยน (ไม่ควรเกิดจริงถ้า state สอดคล้องกันเสมอ)
      rowById.set(bankId, {
        bank,
        status: group.status,
        matchedGL: singleGL,
        matchedGLRows: glRows,
        candidates: [],
        matchScore: group.auto_match_score,
        amountDifference: group.amount_difference,
        dateDifferenceDays: group.date_difference_days,
        matchReason: group.auto_match_reason ?? '',
        matchGroup: group,
        reviewFlag: reviewFlags[bankId] ?? null,
        note: null,
      });
    }
  }

  const rows: ReconcileRow[] = matchBankRows.map((b) => rowById.get(b.bank_row_id)!);

  return {
    rows,
    glOnlyResults: autoOutput.glOnlyResults,
    consumedBankIds,
    consumedGLIds,
    autoUsedGLIds,
  };
}
