import type { BankRowMatchStatus, MatchGLRow, MatchGroup, ReconcileRow } from '@/types/bankReconcile';
import type { CompletionValidationResult, ReconcileSessionKpi } from '@/types/bankReconcileSession';

/**
 * คำนวณ KPI/ผลต่างสุทธิของรอบกระทบยอดใหม่ทั้งหมดจากข้อมูลรายการ/กลุ่มจับคู่โดยตรงเสมอ (เฟส 4 สเปกส่วน
 * "15. FINAL KPI CALCULATION" — "must be calculated from the stored transaction/match-group data, not
 * cached values") + ตรวจสอบความพร้อมก่อนปิดรอบ (สเปกส่วน "9. COMPLETION VALIDATION") เพิ่มเข้ามา 2026-07-16
 * เป็นไฟล์ pure function ล้วนๆ ไม่เรียก Supabase เลย เรียกใช้ได้ทั้งตอนบันทึก (เติมค่าลง ReconcileSession)
 * ตอนแสดง KPI card บนจอ (ให้ตรงกับสิ่งที่จะถูกบันทึก/exportเป๊ะ) และตอน export Excel/PDF
 */

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** สถานะที่ถือว่า "กระทบยอดแล้ว" — คัดลอกความหมายเดียวกับ RESOLVED_STATUSES ใน
 * lib/bankReconcileManualMatchLogic.ts ตั้งใจ (ไฟล์นั้นไม่ได้ export ค่านี้ออกมา และไม่แก้ไฟล์เฟส 3 เพื่อ
 * export เพิ่มตามข้อจำกัด "ห้าม rebuild เฟส 1/2/3" แม้จะเป็นการเปลี่ยนแค่ 1 คำก็ตาม) รวม matched_tolerance
 * เข้าไปด้วยเหมือนกันทุกประการ (เฟส 2/3 ถือว่า "แนะนำแล้ว" ก็นับเป็นกระทบยอดแล้วสำหรับ KPI แม้ยังไม่กดยืนยัน) */
export const RESOLVED_STATUSES: readonly BankRowMatchStatus[] = [
  'matched_exact',
  'matched_tolerance',
  'confirmed_manual',
  'confirmed_tolerance',
  'confirmed_variance',
];

/** สถานะ "มีข้อเสนอแนะรออยู่" — matched_tolerance/pending_review คือสองสถานะเดียวที่ตารางแสดงปุ่ม "ยืนยันว่า
 * ตรงกัน" (ดู canConfirmSuggested ใน components/BankReconcileResultTable.tsx) จึงใช้เป็นนิยามของ
 * suggested_count ตรงๆ ให้สอดคล้องกับสิ่งที่ผู้ใช้เห็นบนตารางจริง */
const SUGGESTED_STATUSES: readonly BankRowMatchStatus[] = ['matched_tolerance', 'pending_review'];

/**
 * สูตรผลต่างสุทธิตามสเปกเป๊ะ (ระบุไว้ตรงๆ ในส่วน "15. FINAL KPI CALCULATION"):
 *   net_difference = unmatched_bank_total - unmatched_gl_total + (ผลรวมผลต่างของกลุ่มจับคู่ที่ยืนยันแล้ว)
 * unmatched_bank_total/unmatched_gl_total เป็นผลรวมแบบมีเครื่องหมาย (ไม่ใช่ค่าสัมบูรณ์) โดยเจตนา — ต่างจาก
 * totalDifference ของเฟส 2/3 บนหน้าจอ (ที่ใช้ Math.abs รวมทุกฝั่งเข้าด้วยกัน) เพราะ "ผลต่างสุทธิ" (net) ต้อง
 * สะท้อนทิศทางเงินเข้า/ออกจริง ไม่เช่นนั้นรายการไม่จับคู่ที่หักล้างกันเองพอดี (เช่น +1000 กับ -1000) จะกลาย
 * เป็นผลต่าง 2000 ทั้งที่ผลสุทธิจริงคือ 0 — เป็นดุลยพินิจที่ตัดสินใจเอง ระบุไว้ในสรุปผลตอนส่งมอบด้วย
 * ผลรวมผลต่างของกลุ่มจับคู่ = ผลรวม MatchGroup.amount_difference ของทุกกลุ่ม (ฟิลด์นี้มีอยู่แล้วในเฟส 3 —
 * คำนวณตอนยืนยันแต่ละกลุ่มไว้แล้ว ไม่ต้องคำนวณซ้ำที่นี่)
 */
export function computeReconcileSessionKpi(
  reconcileRows: ReconcileRow[],
  matchGLRows: MatchGLRow[],
  matchGroups: MatchGroup[]
): ReconcileSessionKpi {
  const usedGlIds = new Set(matchGroups.flatMap((g) => g.gl_transaction_ids));
  const unmatchedGLRows = matchGLRows.filter((g) => !usedGlIds.has(g.gl_row_id));
  const matchedGLRows = matchGLRows.filter((g) => usedGlIds.has(g.gl_row_id));

  const matchedRows = reconcileRows.filter((r) => RESOLVED_STATUSES.includes(r.status));
  const unmatchedBankRows = reconcileRows.filter((r) => !RESOLVED_STATUSES.includes(r.status));
  const suggestedRows = reconcileRows.filter((r) => SUGGESTED_STATUSES.includes(r.status));
  const manualMatchRows = reconcileRows.filter((r) => r.matchGroup !== null);
  const reviewRows = reconcileRows.filter((r) => r.reviewFlag !== null);

  const sumBank = (rows: ReconcileRow[]) => round2(rows.reduce((s, r) => s + r.bank.bank_amount, 0));
  const sumGL = (rows: MatchGLRow[]) => round2(rows.reduce((s, r) => s + r.gl_amount, 0));

  const unmatched_bank_total = sumBank(unmatchedBankRows);
  const unmatched_gl_total = sumGL(unmatchedGLRows);
  const confirmedDifferenceSum = round2(matchGroups.reduce((s, g) => s + g.amount_difference, 0));

  return {
    bank_row_count: reconcileRows.length,
    gl_row_count: matchGLRows.length,
    matched_count: matchedRows.length,
    suggested_count: suggestedRows.length,
    manual_match_count: manualMatchRows.length,
    review_count: reviewRows.length,
    unmatched_bank_count: unmatchedBankRows.length,
    unmatched_gl_count: unmatchedGLRows.length,
    bank_total: sumBank(reconcileRows),
    gl_total: sumGL(matchGLRows),
    matched_bank_total: sumBank(matchedRows),
    matched_gl_total: sumGL(matchedGLRows),
    unmatched_bank_total,
    unmatched_gl_total,
    net_difference: round2(unmatched_bank_total - unmatched_gl_total + confirmedDifferenceSum),
  };
}

export interface ValidateSessionCompletionParams {
  reconcileRows: ReconcileRow[];
  matchGLRows: MatchGLRow[];
  matchGroups: MatchGroup[];
  bankFileName: string;
  glFileName: string;
  kpi: ReconcileSessionKpi;
}

/**
 * ตรวจสอบความพร้อมก่อนปิดรอบกระทบยอดตามสเปกส่วน "9. COMPLETION VALIDATION" ทุกข้อที่ตรวจสอบได้จริงจากข้อมูล
 * ที่มีอยู่ (สองข้อในสเปกที่ไม่มีนิยามเป็นรูปธรรมในระบบเดิมเลย — "every Bank row has valid status" และ "no
 * invalid imported rows remain" — รับประกันอยู่แล้วโดยธรรมชาติของระบบชนิด TypeScript ของเฟส 1-3 เอง (status
 * เป็น union type ที่คอมไพเลอร์บังคับ ไม่มีทางมีค่าอื่นหลุดเข้ามาได้) จึงไม่ต้องมี runtime check ซ้ำอีกที่นี่)
 */
export function validateSessionCompletion(params: ValidateSessionCompletionParams): CompletionValidationResult {
  const blockingErrors: string[] = [];
  const warnings: string[] = [];

  if (!params.bankFileName.trim() || !params.glFileName.trim()) {
    blockingErrors.push('ไม่พบไฟล์ต้นฉบับของรอบกระทบยอดนี้ (Bank Statement หรือ GL)');
  }

  // ไม่มีกลุ่มจับคู่ใดอ้างอิงรายการ Bank/GL ที่ถูกลบไปแล้ว (เช่น จากการคำนวณใหม่แบบ "ล้างผลเดิมและคำนวณใหม่
  // ทั้งหมด" ที่อาจทำให้แถวเดิมหายไปโดยที่กลุ่มจับคู่เก่ายังค้างอยู่ — ไม่ควรเกิดขึ้นได้จริงถ้า flow ถูกต้อง
  // แต่ตรวจสอบซ้ำไว้เพื่อความปลอดภัยของข้อมูลก่อนปิดรอบเสมอ)
  const validBankIds = new Set(params.reconcileRows.map((r) => r.bank.bank_row_id));
  const validGLIds = new Set(params.matchGLRows.map((r) => r.gl_row_id));
  const groupsWithDeletedRefs = params.matchGroups.filter(
    (g) => g.bank_transaction_ids.some((id) => !validBankIds.has(id)) || g.gl_transaction_ids.some((id) => !validGLIds.has(id))
  );
  if (groupsWithDeletedRefs.length > 0) {
    blockingErrors.push(`มีกลุ่มจับคู่ ${groupsWithDeletedRefs.length} กลุ่มอ้างอิงรายการที่ถูกลบไปแล้ว กรุณายกเลิกการจับคู่นั้นก่อน`);
  }

  // ไม่มี GL แถวใดถูกใช้ในมากกว่า 1 กลุ่มจับคู่พร้อมกัน
  const glUsageCount = new Map<string, number>();
  for (const group of params.matchGroups) {
    for (const id of group.gl_transaction_ids) glUsageCount.set(id, (glUsageCount.get(id) ?? 0) + 1);
  }
  const duplicateGLCount = [...glUsageCount.values()].filter((c) => c > 1).length;
  if (duplicateGLCount > 0) {
    blockingErrors.push(`พบข้อมูลการจับคู่ซ้ำ ${duplicateGLCount} รายการ กรุณาตรวจสอบก่อนปิดรอบ`);
  }

  // ทุกการยืนยันด้วยตนเองที่มีผลต่างยอดเงิน (≠ 0) ต้องมีหมายเหตุกำกับเสมอ
  const groupsMissingNote = params.matchGroups.filter((g) => g.amount_difference !== 0 && !g.note.trim());
  if (groupsMissingNote.length > 0) {
    blockingErrors.push(`มีการยืนยันที่มีผลต่างยอดเงินแต่ยังไม่ได้กรอกหมายเหตุ ${groupsMissingNote.length} รายการ`);
  }

  // ค่า KPI ที่กำลังจะบันทึก/ปิดรอบต้องเป็นตัวเลขที่ถูกต้องเสมอ (กันข้อมูลเพี้ยนหลุดเข้าฐานข้อมูลตอนปิดรอบ)
  const hasInvalidNumber = Object.values(params.kpi).some((v) => typeof v === 'number' && !Number.isFinite(v));
  if (hasInvalidNumber) {
    blockingErrors.push('คำนวณสรุปผลไม่สำเร็จ (พบค่าตัวเลขไม่ถูกต้อง) กรุณารีเฟรชหน้าแล้วลองใหม่');
  }

  if (params.kpi.unmatched_bank_count > 0) {
    warnings.push(`ยังมีรายการไม่พบใน GL จำนวน ${params.kpi.unmatched_bank_count} รายการ`);
  }
  if (params.kpi.unmatched_gl_count > 0) {
    warnings.push(`รายการ GL ไม่พบใน Bank จำนวน ${params.kpi.unmatched_gl_count} รายการ`);
  }

  const requiresNote =
    params.kpi.net_difference !== 0 ||
    params.kpi.unmatched_bank_count > 0 ||
    params.kpi.unmatched_gl_count > 0 ||
    params.kpi.review_count > 0;

  return {
    canComplete: blockingErrors.length === 0,
    blockingErrors,
    warnings,
    requiresNote,
  };
}
