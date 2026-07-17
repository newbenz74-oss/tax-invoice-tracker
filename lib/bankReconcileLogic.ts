import type {
  BankTransaction,
  DateTolerance,
  GLTransaction,
  MatchedPair,
  ReconcileResult,
} from '@/types/bankReconcile';

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** แปลงวันที่ ISO (YYYY-MM-DD) เป็นจำนวนวันนับจาก epoch แบบ UTC — ใช้ Date.UTC เสมอเพื่อไม่ให้ผลต่างวัน
 * คลาดเคลื่อนจาก timezone ของเครื่องผู้ใช้ หรือปัญหา DST */
function isoToUtcDays(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1) / 86400000;
}

/** ผลต่างจำนวนวันแบบ absolute ระหว่างวันที่ ISO สองค่า */
function daysBetweenISO(a: string, b: string): number {
  return Math.abs(isoToUtcDays(b) - isoToUtcDays(a));
}

/** key สำหรับจัดกลุ่มแถว GL ตาม (ประเภท, จำนวนเงิน) — ปัดเศษ 2 ตำแหน่งก่อนแปลงเป็น string เสมอ กัน
 * floating point คลาดเคลื่อน (เช่น 0.1 + 0.2 !== 0.3) ทำให้จำนวนเงินที่ "เท่ากันจริง" เทียบกันไม่ตรง */
function amountKey(type: 'receive' | 'payment', amount: number): string {
  return `${type}|${round2(amount).toFixed(2)}`;
}

/**
 * กระทบยอด Bank Statement (master dataset เสมอ) กับ GL ตามกติกาที่กำหนดไว้ในสเปก:
 *
 * 1. รับ ↔ รับ เท่านั้น, จ่าย ↔ จ่าย เท่านั้น (แยกกลุ่มผู้สมัครด้วย amountKey ด้านบนตั้งแต่ต้น)
 * 2. จำนวนเงินต้องเท่ากันเป๊ะ (เทียบผ่าน amountKey ที่ปัดเศษ 2 ตำแหน่งแล้วเท่านั้น)
 * 3. วันที่ตรงกันก่อนเสมอ ถ้าไม่เจอค่อยขยายขอบเขตไป ±toleranceDays วัน
 * 4. ถ้ามีหลายแถว GL เข้าเงื่อนไขพร้อมกัน (อยู่ในช่วงวันที่ที่ยอมรับได้ทั้งคู่): เลือกวันที่ใกล้ที่สุดก่อน
 *    ถ้ายังเสมอกันอีก เลือกแถวที่ยังไม่ถูกใช้ตัวแรกสุดตามลำดับเดิมในไฟล์ GL
 * 5. แถว Bank แต่ละแถว จับคู่ได้กับ GL ได้อย่างมากที่สุด 1 แถว และแถว GL แต่ละแถวก็ถูกใช้ได้แค่ครั้งเดียว
 *    เท่านั้น (1 ต่อ 1 เท่านั้น ไม่รองรับ one-to-many / many-to-one / many-to-many)
 *
 * ลำดับการประมวลผล: วนตามแถว Bank ตามลำดับเดิมในไฟล์ (Bank เป็น master ที่ "ขับเคลื่อน" การจับคู่) —
 * แต่ละแถว Bank ค้นหาคู่ที่ดีที่สุดของ "ตัวเอง" จากแถว GL ที่ยังไม่ถูกใช้เท่านั้น แล้วจับคู่ทันทีก่อนไปแถว
 * ถัดไป (greedy, ไม่ย้อนกลับมาแก้ไขคู่ที่จับไปแล้ว) วิธีนี้ตรงกับตัวสเปกที่สุด (ระบุกติกาการค้นหาของ "1
 * แถว Bank" ก่อน แล้วค่อยระบุ tie-break ในกรณีที่แถวนั้นมีผู้สมัครมากกว่า 1 แถว)
 *
 * Performance: จัดกลุ่มแถว GL ทั้งหมดด้วย Map ตาม (ประเภท, จำนวนเงิน) ไว้ล่วงหน้าก่อนเริ่มวนลูป Bank
 * ทำให้แต่ละแถว Bank เทียบวันที่กับเฉพาะ GL ที่ประเภท+จำนวนเงินตรงกันเท่านั้น (ไม่ใช่ O(N×M) กับทั้งไฟล์)
 * รองรับไฟล์ขนาดใหญ่ได้ดีในทางปฏิบัติ ตราบใดที่จำนวนแถวที่มีจำนวนเงินซ้ำกันเป๊ะไม่ได้เยอะผิดปกติ
 */
export function reconcileTransactions(
  bankRows: BankTransaction[],
  glRows: GLTransaction[],
  toleranceDays: DateTolerance
): ReconcileResult {
  const glUsed: boolean[] = new Array(glRows.length).fill(false);
  const glGroups = new Map<string, number[]>();
  glRows.forEach((gl, idx) => {
    const key = amountKey(gl.type, gl.amount);
    const list = glGroups.get(key);
    if (list) list.push(idx);
    else glGroups.set(key, [idx]);
  });

  const matched: MatchedPair[] = [];
  const bankUnmatched: BankTransaction[] = [];

  for (const bank of bankRows) {
    const candidates = glGroups.get(amountKey(bank.type, bank.amount));
    let bestIdx = -1;
    let bestDiff = Infinity;

    if (candidates) {
      for (const idx of candidates) {
        if (glUsed[idx]) continue;
        const diff = daysBetweenISO(bank.date, glRows[idx].date);
        if (diff > toleranceDays) continue;
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIdx = idx;
          if (diff === 0) break; // วันที่ตรงกันเป๊ะ = ดีที่สุดเท่าที่เป็นไปได้แล้ว ไม่ต้องหาต่อ
        }
      }
    }

    if (bestIdx === -1) {
      bankUnmatched.push(bank);
      continue;
    }
    glUsed[bestIdx] = true;
    matched.push({ bank, gl: glRows[bestIdx] });
  }

  const glUnmatched = glRows.filter((_, idx) => !glUsed[idx]);

  return {
    matched,
    bankUnmatched,
    glUnmatched,
    summary: {
      bankCount: bankRows.length,
      glCount: glRows.length,
      matchedCount: matched.length,
      bankUnmatchedCount: bankUnmatched.length,
      glUnmatchedCount: glUnmatched.length,
    },
  };
}
