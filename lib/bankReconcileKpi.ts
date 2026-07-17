import type { ReconcileMatchOutput } from '@/types/bankReconcile';
import type { ReconcileSessionKpi } from '@/types/bankReconcileSession';

/**
 * คำนวณ 9 KPI ของรอบกระทบยอด (สเปกส่วน "13. RECONCILIATION SUMMARY") — เขียนใหม่ทั้งไฟล์ 2026-07-17 แทนที่
 * ฟังก์ชันเดิม (คำนวณจาก ReconcileRow/MatchGLRow/MatchGroup ของโมเดลเก่า) ด้วยฟังก์ชัน pure ล้วนๆ ที่รับ
 * ผลลัพธ์ตรงจาก runSimpleReconciliation() (lib/bankReconcileMatching.ts) เท่านั้น — ไม่มี tolerance/manual
 * match/review flag เข้ามาเกี่ยวข้องกับการคำนวณ KPI เลยตามสเปก (ธงตรวจสอบไม่มีผลต่อผลกระทบยอด จึงไม่มีผลต่อ
 * KPI ด้วยเช่นกัน)
 *
 * นิยาม "รายการ Bank ทั้งหมด"/"รายการ GL ทั้งหมด" (KPI #1/#4): นับเฉพาะแถวที่ผ่านเข้าสู่การกระทบยอดจริง
 * (isRowUsable แล้ว) เท่านั้น ไม่รวมแถวที่ผู้ใช้ยกเว้นไว้ตั้งแต่ขั้นตอนพรีวิว — เพราะแถวที่ถูกยกเว้นไม่ใช่ส่วน
 * หนึ่งของ "การกระทบยอดครั้งนี้" อีกต่อไปตามเจตนาของผู้ใช้ จึงได้อินเวอร์เรียนต์ที่ดี:
 *   bank_row_count = found_count + bank_not_found_count เสมอ
 *   gl_row_count   = found_count + gl_not_found_count เสมอ (GL แถวหนึ่งถูกใช้ได้แค่ครั้งเดียว)
 */

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeReconcileSessionKpi(matchOutput: ReconcileMatchOutput): ReconcileSessionKpi {
  const { bankResults, glOnlyResults } = matchOutput;

  const found = bankResults.filter((r) => r.status === 'found_in_gl');
  const bankNotFound = bankResults.filter((r) => r.status === 'not_found_in_gl');

  const bankIncomeTotal = round2(
    bankResults.filter((r) => r.bank.direction === 'income').reduce((s, r) => s + r.bank.amount, 0)
  );
  const bankPaymentTotal = round2(
    bankResults.filter((r) => r.bank.direction === 'payment').reduce((s, r) => s + r.bank.amount, 0)
  );

  // ยอดฝั่ง GL รวมทั้ง GL ที่ถูกจับคู่แล้ว (matchedGL ของแถว found_in_gl) และ GL ที่เหลือค้าง (glOnlyResults) —
  // เพื่อให้ gl_income_total/gl_payment_total สะท้อนยอด GL ทั้งหมดที่ใช้งานได้จริง ไม่ใช่แค่ส่วนที่จับคู่ได้
  const matchedGL = found.map((r) => r.matchedGL!);
  const allGLRows = [...matchedGL, ...glOnlyResults.map((r) => r.gl)];
  const glIncomeTotal = round2(allGLRows.filter((g) => g.direction === 'income').reduce((s, g) => s + g.amount, 0));
  const glPaymentTotal = round2(allGLRows.filter((g) => g.direction === 'payment').reduce((s, g) => s + g.amount, 0));

  return {
    bank_row_count: bankResults.length,
    gl_row_count: matchedGL.length + glOnlyResults.length,
    found_count: found.length,
    bank_not_found_count: bankNotFound.length,
    gl_not_found_count: glOnlyResults.length,
    bank_income_total: bankIncomeTotal,
    bank_payment_total: bankPaymentTotal,
    gl_income_total: glIncomeTotal,
    gl_payment_total: glPaymentTotal,
    income_difference: round2(bankIncomeTotal - glIncomeTotal),
    payment_difference: round2(bankPaymentTotal - glPaymentTotal),
  };
}
