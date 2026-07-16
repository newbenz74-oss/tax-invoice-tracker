import type {
  BankRowMatchStatus,
  MatchBankRow,
  MatchGLRow,
  NormalizedBankRow,
  NormalizedGLRow,
  RawFileTable,
  ReconcileMatchOutput,
} from '@/types/bankReconcile';

/**
 * เครื่องมือจับคู่รายการ (Reconciliation Matching Engine) — เฟส 2 ของ Bank Reconcile เพิ่มเข้ามา 2026-07-16
 *
 * ไฟล์นี้เป็น "ตัวแปลงข้อมูล + อัลกอริทึมจับคู่ล้วนๆ" ไม่มีข้อความภาษาไทยสำหรับแสดงผล/สี badge ใดๆ ทั้งสิ้น
 * (LABELS/BADGE_CLASS อยู่ใน lib/bankReconcileMatchLogic.ts แทน) มีสถานะเดียวที่ไฟล์นี้ผลิตออกมาคือค่า enum
 * BankRowMatchStatus ล้วนๆ — เจตนาให้ไฟล์นี้ทดสอบแยกได้อิสระจากชั้น UI ทั้งหมด เหมือน lib/bankReconcileNormalize.ts
 *
 * กติกาการจับคู่ตามสเปกตรงๆ:
 * 1. ใช้ยอดเงิน (amount) และวันที่ทำรายการ (date) เท่านั้น — ห้ามใช้เลขที่อ้างอิง/รายละเอียดเป็นเงื่อนไข
 * 2. Bank Statement เป็น primary source of truth เสมอ — ทุกแถว Bank ต้องมีผลลัพธ์ 1 รายการเสมอไม่ว่าจะจับคู่ได้หรือไม่
 * 3. ห้ามใช้แถว GL แถวเดียวกันซ้ำ (never reuse a GL row already assigned to another Bank row)
 * 4. เทียบยอดเงินที่ทศนิยม 2 ตำแหน่งเสมอ (amountKey ด้านล่าง)
 *
 * แนวทาง Performance (ตามสเปก "avoid nested loops... prefer indexed lookup structures"): สร้างดัชนี
 * Map<amountKey, MatchGLRow[]> จากแถว GL ทั้งหมดครั้งเดียวก่อนเริ่ม (O(n)) จากนั้นแต่ละแถว Bank ค้นหาผู้สมัคร
 * ด้วย Map.get() ระดับ O(1) แล้วกรองเฉพาะที่ยังไม่ถูกใช้ (Set.has() ระดับ O(1) ต่อรายการ) แทนการวนลูปซ้อน
 * O(bank × gl) เต็มรูปแบบ — ไม่มีการแก้ไข amountIndex หลังสร้างเสร็จเลย (ใช้ usedGLIds แยกต่างหากกรองแทนการ
 * mutate ดัชนี เพื่อไม่ให้ต้องสร้างดัชนีใหม่ระหว่างทาง และไม่แตะข้อมูลต้นฉบับที่ import มาเลยตามสเปก
 * "Do not mutate the original imported data")
 */

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** key สำหรับดัชนีจำนวนเงิน — ใช้ string ทศนิยม 2 ตำแหน่งแทนตัวเลขตรงๆ เพื่อเลี่ยงปัญหา floating point
 * (เช่น 0.1 + 0.2 !== 0.3) ตามสเปก "Compare monetary values using two decimal places" ตรงตัว */
function amountKey(amount: number): string {
  return amount.toFixed(2);
}

function datesEqual(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a === b;
}

/** ผลต่างจำนวนวันระหว่างวันที่ ISO (YYYY-MM-DD) สองค่า — คืน null ถ้าค่าใดค่าหนึ่งเป็น null (ไม่มีทางเทียบได้)
 * ใช้ Date.UTC เสมอ (เหมือน isRealDate ใน lib/bankReconcileNormalize.ts) เพื่อไม่ให้ timezone/DST ของเครื่อง
 * ที่รันมีผลต่อผลลัพธ์เลย */
function dateDiffDays(isoA: string | null, isoB: string | null): number | null {
  if (!isoA || !isoB) return null;
  const [ya, ma, da] = isoA.split('-').map(Number);
  const [yb, mb, db] = isoB.split('-').map(Number);
  const msA = Date.UTC(ya, ma - 1, da);
  const msB = Date.UTC(yb, mb - 1, db);
  return Math.round(Math.abs(msA - msB) / 86400000);
}

/** คะแนนจับคู่ (match_score) ตามตารางที่สเปกให้ไว้ตรงๆ — เรียกเฉพาะกรณีที่ "ยอดเงินตรงกันแล้ว" เสมอ (สถานะ
 * not_found_in_gl ไม่เรียกฟังก์ชันนี้) จึงเริ่มที่ 70 เสมอ เป็นฟังก์ชันของ "ผลต่างวันที่จริง" ล้วนๆ ไม่ขึ้นกับ
 * ค่า Date Tolerance ที่ผู้ใช้ตั้งไว้ (ตัว tolerance มีผลแค่ตอนตัดสิน "สถานะ" ผ่าน MATCHING PRIORITY เท่านั้น
 * — ดูหมายเหตุเรื่อง match_score vs สถานะ ไม่ตรงกันเป๊ะทุกกรณีท้ายไฟล์นี้) */
function computeMatchScore(dateDiff: number | null): number {
  let score = 70;
  if (dateDiff === 0) score += 30;
  else if (dateDiff === 1) score += 20;
  else if (dateDiff !== null && dateDiff >= 2 && dateDiff <= 3) score += 10;
  else if (dateDiff !== null && dateDiff >= 4 && dateDiff <= 7) score += 5;
  // dateDiff === null (ไม่มีวันที่ให้เทียบ) หรือ dateDiff > 7 → ไม่บวกเพิ่ม (Outside selected tolerance: +0)
  return score;
}

/** ข้อความเหตุผลการจับคู่ — สองสถานะแรกใช้ประโยคตัวอย่างที่สเปกให้ไว้ตรงๆ ("ยอดเงินตรงกัน และวันที่ตรงกัน" /
 * "ยอดเงินตรงกัน แต่วันที่ต่างกัน N วัน") ส่วน ambiguous/pending_review/not_found_in_gl ไม่มีตัวอย่างในสเปก
 * จึงเขียนเองให้สื่อความหมายชัดเจนและแยกแยะจาก matched_tolerance ได้ (pending_review เติม "เกินช่วงเวลาที่
 * กำหนด" ต่อท้ายรูปประโยคเดียวกัน เพื่อไม่ให้ข้อความซ้ำกับ matched_tolerance จนแยกไม่ออกในตาราง) */
function buildMatchReason(
  status: BankRowMatchStatus,
  dateDiff: number | null,
  candidateCount: number
): string {
  switch (status) {
    case 'matched_exact':
      return 'ยอดเงินตรงกัน และวันที่ตรงกัน';
    case 'matched_tolerance':
      return `ยอดเงินตรงกัน แต่วันที่ต่างกัน ${dateDiff} วัน`;
    case 'ambiguous':
      return `พบ GL ที่ยอดเงินตรงกัน ${candidateCount} รายการ ไม่สามารถเลือกให้อัตโนมัติได้ ต้องตรวจสอบด้วยตนเอง`;
    case 'pending_review':
      return dateDiff !== null
        ? `ยอดเงินตรงกัน แต่วันที่ต่างกัน ${dateDiff} วัน (เกินช่วงเวลาที่กำหนด)`
        : 'ยอดเงินตรงกัน แต่ไม่สามารถเทียบวันที่ได้';
    case 'not_found_in_gl':
      return 'ไม่พบยอดเงินที่ตรงกันใน GL';
    default:
      return '';
  }
}

/** เลือกผู้สมัครที่วันที่ใกล้เคียงวันที่ Bank มากที่สุดจากรายการที่ยอดเงินตรงกัน — ใช้เฉพาะตอนสรุปผล
 * pending_review (ยอดตรงแต่ทุกวันที่เกิน tolerance) เพื่อแสดง "วันที่ต่างกัน" ที่สื่อความหมายที่สุดในตาราง
 * คืน null ถ้า bankDate เป็น null หรือผู้สมัครทุกรายการไม่มีวันที่ให้เทียบเลย */
function pickClosestByDate(bankDate: string | null, candidates: MatchGLRow[]): MatchGLRow | null {
  if (!bankDate) return null;
  let best: MatchGLRow | null = null;
  let bestDiff = Infinity;
  for (const candidate of candidates) {
    const diff = dateDiffDays(bankDate, candidate.gl_date);
    if (diff !== null && diff < bestDiff) {
      bestDiff = diff;
      best = candidate;
    }
  }
  return best;
}

/** แปลงแถว Bank ที่ normalize แล้ว (เฟส 1) ให้เป็นมุมมองสำหรับเครื่องมือจับคู่ — ไม่ normalize ซ้ำ ใช้ผลลัพธ์
 * จาก normalizeBankRows() ตรงๆ table ต้องเป็น RawFileTable ตัวเดียวกับที่ส่งเข้า normalizeBankRows() เพื่อให้
 * raw_bank_row ชี้ไปแถวดิบที่ถูกต้อง (rowNumber = idx + 2 เสมอตามธรรมเนียมเดิม จึง idx ของแถวดิบ = rowNumber - 2) */
export function toMatchBankRows(table: RawFileTable, normalized: NormalizedBankRow[]): MatchBankRow[] {
  return normalized.map((row) => ({
    bank_row_id: `bank-${row.rowNumber}`,
    bank_date: row.transactionDate,
    bank_description: row.description,
    bank_money_in: row.moneyIn,
    bank_money_out: row.moneyOut,
    bank_amount: row.signedAmount,
    bank_balance: row.balance,
    raw_bank_row: table.rows[row.rowNumber - 2] ?? [],
  }));
}

/** แปลงแถว GL ที่ normalize แล้ว (เฟส 1) ให้เป็นมุมมองสำหรับเครื่องมือจับคู่ — เช่นเดียวกับ toMatchBankRows */
export function toMatchGLRows(table: RawFileTable, normalized: NormalizedGLRow[]): MatchGLRow[] {
  return normalized.map((row) => ({
    gl_row_id: `gl-${row.rowNumber}`,
    gl_date: row.date,
    gl_document_no: row.docNo,
    gl_description: row.description,
    gl_debit: row.debit,
    gl_credit: row.credit,
    gl_amount: row.signedAmount,
    raw_gl_row: table.rows[row.rowNumber - 2] ?? [],
  }));
}

/** คำนวณ "วันที่ต่างกัน" และ "คะแนนจับคู่" ของผู้สมัคร GL รายหนึ่งเทียบกับแถว Bank ที่กำหนด — ใช้เฉพาะแสดงผล
 * ในหน้าจอ (เช่น Modal "ดูรายการที่อาจตรงกัน") เท่านั้น ไม่มีผลต่อการตัดสินสถานะใดๆ (เป็นหน้าที่ของ
 * runReconciliationMatch ล้วนๆ) เผยแพร่ dateDiffDays/computeMatchScore ที่เป็น private ออกมาผ่านฟังก์ชันนี้
 * แทนการ export ตรงๆ เพื่อให้ผู้เรียกภายนอกเห็นเป็นหน่วยเดียวที่มีความหมายชัดเจน (สองค่านี้มาคู่กันเสมอ) */
export function describeCandidateMatch(
  bank: Pick<MatchBankRow, 'bank_date'>,
  candidate: Pick<MatchGLRow, 'gl_date'>
): { dateDiffDays: number | null; matchScore: number } {
  const diff = dateDiffDays(bank.bank_date, candidate.gl_date);
  return { dateDiffDays: diff, matchScore: computeMatchScore(diff) };
}

/**
 * รันการจับคู่รายการทั้งหมด — ประมวลผลแถว Bank ตามลำดับเดิมในไฟล์ (สำคัญต่อความ deterministic ของกรณี
 * ยอดเงินซ้ำกันหลายแถว — ดูหมายเหตุท้ายไฟล์) ตาม MATCHING PRIORITY 8 ขั้นตอนที่สเปกระบุไว้เป๊ะ:
 *   1-3: ยอดเงิน+วันที่ตรงเป๊ะ → 1 ผู้สมัคร = เรียบร้อย, มากกว่า 1 = พบหลายรายการที่อาจตรงกัน
 *   4-6: (ถ้าไม่มีวันที่ตรงเป๊ะ) ยอดเงินตรงเป๊ะ+อยู่ในช่วง tolerance → 1 ผู้สมัคร = น่าจะตรงกัน, มากกว่า 1 = พบหลายรายการที่อาจตรงกัน
 *   7: ยอดเงินตรงแต่ทุกวันที่เกิน tolerance → รอตรวจสอบ
 *   8: ไม่มียอดเงินที่ตรงกันเลยในบรรดา GL ที่ยังไม่ถูกใช้ → ไม่พบใน GL
 * ไม่มีทางใช้แถว GL ซ้ำ (usedGLIds กันไว้) — สถานะ ambiguous ไม่ยึด GL แถวใดไว้เลย (ตามสเปก "Do not
 * automatically choose a GL row") จึงยังเปิดให้แถว Bank อื่นที่ยอดตรงกันมาแข่งดูได้อีกในรอบถัดไป
 */
export function runReconciliationMatch(
  bankRows: MatchBankRow[],
  glRows: MatchGLRow[],
  toleranceDays: number
): ReconcileMatchOutput {
  const amountIndex = new Map<string, MatchGLRow[]>();
  for (const gl of glRows) {
    const key = amountKey(gl.gl_amount);
    const bucket = amountIndex.get(key);
    if (bucket) bucket.push(gl);
    else amountIndex.set(key, [gl]);
  }

  const usedGLIds = new Set<string>();
  const bankResults: ReconcileMatchOutput['bankResults'] = [];

  for (const bank of bankRows) {
    const pool = amountIndex.get(amountKey(bank.bank_amount)) ?? [];
    const sameAmountCandidates = pool.filter((gl) => !usedGLIds.has(gl.gl_row_id));

    // ขั้นตอนที่ 8: ไม่มี GL ที่ยังไม่ถูกใช้ที่ยอดเงินตรงกันเลย
    if (sameAmountCandidates.length === 0) {
      bankResults.push({
        bank,
        status: 'not_found_in_gl',
        matchedGL: null,
        candidates: [],
        matchScore: null,
        amountDifference: null,
        dateDifferenceDays: null,
        matchReason: buildMatchReason('not_found_in_gl', null, 0),
      });
      continue;
    }

    // ขั้นตอนที่ 1-3: ยอดเงิน+วันที่ตรงเป๊ะ
    const exactMatches = sameAmountCandidates.filter((gl) => datesEqual(bank.bank_date, gl.gl_date));

    if (exactMatches.length === 1) {
      const matched = exactMatches[0];
      usedGLIds.add(matched.gl_row_id);
      bankResults.push({
        bank,
        status: 'matched_exact',
        matchedGL: matched,
        candidates: sameAmountCandidates,
        matchScore: 100,
        amountDifference: round2(Math.abs(bank.bank_amount - matched.gl_amount)),
        dateDifferenceDays: 0,
        matchReason: buildMatchReason('matched_exact', 0, 1),
      });
      continue;
    }

    if (exactMatches.length > 1) {
      bankResults.push({
        bank,
        status: 'ambiguous',
        matchedGL: null,
        candidates: sameAmountCandidates,
        matchScore: null,
        amountDifference: null,
        dateDifferenceDays: null,
        matchReason: buildMatchReason('ambiguous', null, exactMatches.length),
      });
      continue;
    }

    // ขั้นตอนที่ 4-6: ไม่มีวันที่ตรงเป๊ะ ลองช่วง tolerance ต่อ (ยอมรับเฉพาะ diff > 0 เพราะ diff === 0 ถูก
    // ดักไปแล้วในขั้นตอนก่อนหน้า — ถ้า toleranceDays === 0 ("วันเดียวกันเท่านั้น") ช่วงนี้จะว่างเสมอโดยธรรมชาติ)
    const toleranceMatches = sameAmountCandidates.filter((gl) => {
      const diff = dateDiffDays(bank.bank_date, gl.gl_date);
      return diff !== null && diff > 0 && diff <= toleranceDays;
    });

    if (toleranceMatches.length === 1) {
      const matched = toleranceMatches[0];
      const diff = dateDiffDays(bank.bank_date, matched.gl_date)!;
      usedGLIds.add(matched.gl_row_id);
      bankResults.push({
        bank,
        status: 'matched_tolerance',
        matchedGL: matched,
        candidates: sameAmountCandidates,
        matchScore: computeMatchScore(diff),
        amountDifference: round2(Math.abs(bank.bank_amount - matched.gl_amount)),
        dateDifferenceDays: diff,
        matchReason: buildMatchReason('matched_tolerance', diff, 1),
      });
      continue;
    }

    if (toleranceMatches.length > 1) {
      bankResults.push({
        bank,
        status: 'ambiguous',
        matchedGL: null,
        candidates: sameAmountCandidates,
        matchScore: null,
        amountDifference: null,
        dateDifferenceDays: null,
        matchReason: buildMatchReason('ambiguous', null, toleranceMatches.length),
      });
      continue;
    }

    // ขั้นตอนที่ 7: ยอดเงินตรงกันแต่ทุกวันที่ที่มีอยู่เกินช่วง tolerance ทั้งหมด — รอตรวจสอบ
    const closest = pickClosestByDate(bank.bank_date, sameAmountCandidates);
    const diff = closest ? dateDiffDays(bank.bank_date, closest.gl_date) : null;
    bankResults.push({
      bank,
      status: 'pending_review',
      matchedGL: null,
      candidates: sameAmountCandidates,
      matchScore: 70,
      amountDifference: closest ? round2(Math.abs(bank.bank_amount - closest.gl_amount)) : null,
      dateDifferenceDays: diff,
      matchReason: buildMatchReason('pending_review', diff, sameAmountCandidates.length),
    });
  }

  const glOnlyResults: ReconcileMatchOutput['glOnlyResults'] = glRows
    .filter((gl) => !usedGLIds.has(gl.gl_row_id))
    .map((gl) => ({ gl, status: 'not_found_in_bank' as const }));

  return { bankResults, glOnlyResults };
}

/*
 * หมายเหตุทางเทคนิค — เหตุผลที่ไม่ต้องเขียนโค้ดตรวจจับ "การจับคู่แบบ 1:1 ที่ deterministic" แยกต่างหาก
 * (ตามตัวอย่างในสเปก DUPLICATE PROTECTION ข้อสอง: Bank 2 แถว 1,000/1,000 คู่กับ GL 2 แถว 1,000/1,000):
 *
 * อัลกอริทึมข้างบนประมวลผลแถว Bank ตามลำดับเดิมในไฟล์ และ "ambiguous ไม่ยึด GL แถวใดไว้เลย" (usedGLIds ไม่ถูก
 * เพิ่มในกรณี ambiguous) ทำให้พฤติกรรมที่ถูกต้องเกิดขึ้นเองโดยไม่ต้องเขียนโค้ดตรวจจับคู่แบบ bijective เพิ่ม:
 *
 * - ถ้าวันที่ของ Bank ทั้งสองแถวเหมือนกันทุกประการ (เหมือนตัวอย่างในสเปกเป๊ะ) → แถว Bank แรกเห็นผู้สมัคร GL
 *   ที่ยอด+วันที่ตรงเป๊ะ 2 รายการ (ยังไม่มีอะไรถูกใช้เลย) → ambiguous ทั้งคู่ ไม่ยึด GL ไว้ → แถว Bank ที่สอง
 *   เห็นผู้สมัคร GL 2 รายการเดิมเหมือนเดิม (ไม่มีอะไรถูกใช้ไปก่อนหน้า) → ambiguous เช่นกัน ตรงตามสเปกที่ว่า
 *   "ถ้าไม่ deterministic ต้องอยู่ใน duplicate-review ทั้งคู่" — เพราะกรณีนี้ไม่มีสัญญาณใดๆ ที่จะแยกแยะได้จริง
 *   (สลับคู่กันก็ยังถูกต้องเท่ากันเป๊ะ ไม่มีทาง "deterministic" ได้จากข้อมูลที่มีอยู่)
 * - ถ้าวันที่ของ Bank สองแถวต่างกัน (เช่น แถวหนึ่ง 15/07 อีกแถว 16/07 ยอดเท่ากัน) และ GL ก็มีวันที่ตรงกับแต่ละ
 *   แถวคนละวัน → แถว Bank แรกกรองด้วยวันที่ของตัวเองเจอผู้สมัครที่ตรงเป๊ะแค่ 1 รายการ (matched_exact ทันที
 *   ไม่ใช่ ambiguous เพราะ exactMatches กรองด้วย "วันที่ของแถว Bank นี้เท่านั้น" ไม่ใช่ทั้ง pool) → ยึด GL
 *   แถวนั้นไว้ → แถว Bank ที่สองเหลือผู้สมัคร GL อีกแถวเดียว (อีกแถวถูกใช้ไปแล้ว) → matched_exact เช่นกัน —
 *   นี่คือกรณี "deterministic" ที่สเปกอนุญาตให้จับคู่ 1:1 อัตโนมัติได้ ซึ่งเกิดขึ้นเองจากวันที่ที่ต่างกันจริง
 *   โดยไม่ต้องเขียน logic พิเศษเพิ่มเลยแม้แต่บรรทัดเดียว
 *
 * หมายเหตุที่สอง — match_score vs สถานะ (MATCHING PRIORITY) ไม่ใช่แหล่งความจริงเดียวกันเป๊ะทุกกรณี:
 * ตารางคะแนนของสเปก (Exact amount +70, exact date +30, 1 day +20, 2-3 days +10, 4-7 days +5, outside +0)
 * กับตาราง classification (100=เรียบร้อย, 80-99=น่าจะตรงกัน, 70=รอตรวจสอบ) ไม่ครอบคลุมคะแนน 75 (กรณี
 * matched_tolerance ที่ diff = 4-7 วัน คิดเป็น 70+5=75) ซึ่งไม่เข้าเกณฑ์ทั้ง 70 และ 80-99 พอดี — ไฟล์นี้ยึด
 * MATCHING PRIORITY (8 ขั้นตอน) เป็นแหล่งความจริงเดียวในการตัดสิน "สถานะ" เสมอ ส่วน match_score เป็นตัวเลข
 * โปร่งใสประกอบการตัดสินใจของผู้ใช้เท่านั้น (ไม่ใช่ตัวตัดสินสถานะ) — เป็นดุลยพินิจที่ตัดสินใจเอง เพราะสเปกให้
 * กติกาสองชุดที่ทับซ้อนกันไม่สนิท จึงเลือกยึดกติกาที่ระบุขั้นตอนไว้ชัดเจนกว่า (MATCHING PRIORITY) เป็นหลัก
 */
