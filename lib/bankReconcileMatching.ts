import { isRowUsable } from '@/types/bankReconcile';
import type { BankReconcileResultRow, BankRow, GLOnlyRow, GLRow, ReconcileMatchOutput } from '@/types/bankReconcile';

/**
 * เครื่องมือกระทบยอด (Reconciliation Matching Engine) เวอร์ชันใหม่ — เขียนใหม่ทั้งไฟล์ 2026-07-17 แทนที่
 * เครื่องมือเดิม (runReconciliationMatch เดิม มี date tolerance + match score + 8 ขั้นตอน priority + สถานะ
 * 9 ค่า) ด้วยกติกาที่ง่ายกว่ามากตามสเปก "REBUILD":
 *
 *   จับคู่ด้วย "ทิศทางธุรกรรม" (รับเงิน/จ่ายเงิน) + "จำนวนเงิน" เท่านั้น — ไม่ใช้วันที่/เลขที่อ้างอิง/
 *   รายละเอียดเป็นเงื่อนไขเลย ไม่มีคะแนน ไม่มีค่าคลาดเคลื่อน แถว GL หนึ่งแถวใช้ได้แค่ครั้งเดียว
 *
 * ==== ลำดับการประมวลผล (สเปกส่วน "7. MATCHING ORDER") ====
 * สเปกอธิบายเป็น 2 รอบแยกกัน (รอบที่ 1: ประมวลผลแถว Bank ทิศทาง "รับเงิน" ทั้งหมดก่อน จับคู่กับ GL รับเงินที่
 * ยังไม่ถูกใช้, รอบที่ 2: ประมวลผลแถว Bank ทิศทาง "จ่ายเงิน" ทั้งหมด จับคู่กับ GL จ่ายเงินที่ยังไม่ถูกใช้) แต่
 * เนื่องจากทิศทางเป็นส่วนหนึ่งของเงื่อนไขจับคู่เสมอ (ห้ามเทียบข้ามทิศทางกันเด็ดขาด) แถว "รับเงิน" กับแถว
 * "จ่ายเงิน" จึงไม่มีทางแย่งชิง GL แถวเดียวกันได้เลยไม่ว่าจะประมวลผลตามลำดับไหน — การวนลูปครั้งเดียวตามลำดับ
 * เดิมในไฟล์ (สลับรับเงิน/จ่ายเงินปนกันไปตามที่ผู้ใช้อัปโหลดมาจริง) จึงให้ผลลัพธ์เหมือนกันเป๊ะกับการทำสองรอบ
 * แยกทิศทางตามสเปก — และยังได้ผลพลอยได้ที่ต้องการอยู่แล้วคือ "Bank Statement order must remain the same as
 * the source file" (บรรทัดสุดท้ายของหัวข้อเดียวกัน) โดยไม่ต้องเรียงลำดับผลลัพธ์ใหม่ทีหลังเลย จึงเลือกวนลูป
 * เดียวเพื่อความเรียบง่าย (พิสูจน์ความเท่ากันด้วยตัวอย่างสองข้อของสเปกเองในหมายเหตุท้ายไฟล์)
 *
 * ==== การจัดการจำนวนซ้ำ (สเปกส่วน "6. DUPLICATE AMOUNTS") ====
 * ใช้ดัชนี Map<"ทิศทาง|จำนวนเงิน", GLRow[]> เป็นคิว (FIFO ตามลำดับเดิมในไฟล์ GL) แถว Bank แต่ละแถวที่ยอด+
 * ทิศทางตรงกันจะ "ดึง" GL แถวแรกสุดที่ยังไม่ถูกใช้ออกจากคิวมาใช้ ถ้าคิวว่างแล้ว = ไม่พบใน GL — ไม่มีการรวม/
 * merge แถวซ้ำเข้าด้วยกันเด็ดขาดตามสเปก ("Do not merge duplicated rows") แต่ละแถวยังคงเป็นแถวอิสระของตัวเอง
 * ในผลลัพธ์เสมอ
 */

function amountKey(direction: string, amount: number): string {
  return `${direction}|${amount.toFixed(2)}`;
}

/**
 * รันการกระทบยอดทั้งหมด — กรองเฉพาะแถวที่ isRowUsable() ก่อนเข้าสู่การจับคู่เสมอ (แถวที่ถูกยกเว้นหรือยังมี
 * error ค้างจะไม่ปรากฏใน bankResults/glOnlyResults เลย — ผู้ใช้ต้องแก้ไข/ยกเว้นให้ครบตั้งแต่ขั้นตอนพรีวิวก่อน
 * ตามสเปก "Do not start reconciliation until all included rows are valid") bankResults ยาวเท่ากับจำนวนแถว
 * Bank ที่ใช้งานได้เสมอ เรียงลำดับเดิมตามไฟล์ต้นฉบับ ("Every Bank Statement transaction must remain visible")
 */
export function runSimpleReconciliation(bankRows: BankRow[], glRows: GLRow[]): ReconcileMatchOutput {
  const usableBank = bankRows.filter(isRowUsable);
  const usableGL = glRows.filter(isRowUsable);

  const glQueues = new Map<string, GLRow[]>();
  for (const gl of usableGL) {
    const key = amountKey(gl.direction as string, gl.amount);
    const bucket = glQueues.get(key);
    if (bucket) bucket.push(gl);
    else glQueues.set(key, [gl]);
  }

  const usedGLIds = new Set<string>();
  const bankResults: BankReconcileResultRow[] = [];

  for (const bank of usableBank) {
    const key = amountKey(bank.direction as string, bank.amount);
    const queue = glQueues.get(key);
    // ดึง GL แถวแรกสุดที่ยังไม่ถูกใช้ออกจากคิว (FIFO ตามลำดับเดิมในไฟล์ GL) — ตรงตามสเปก "compare duplicates
    // one-to-one based on available row count" โดยไม่ต้องเขียน logic นับจำนวนแยกต่างหากเลย
    const matched = queue?.shift() ?? null;

    if (matched) {
      usedGLIds.add(matched.id);
      bankResults.push({
        bank,
        status: 'found_in_gl',
        matchedGL: matched,
        difference: 0, // ยอดตรงกันเป๊ะเสมอ (เงื่อนไขจับคู่ = ยอดเท่ากันเป๊ะ ไม่มี tolerance)
      });
    } else {
      bankResults.push({
        bank,
        status: 'not_found_in_gl',
        matchedGL: null,
        difference: bank.amount,
      });
    }
  }

  const glOnlyResults: GLOnlyRow[] = usableGL
    .filter((gl) => !usedGLIds.has(gl.id))
    .map((gl) => ({ gl, status: 'not_found_in_bank' as const }));

  return { bankResults, glOnlyResults };
}

/*
 * หมายเหตุ — ตรวจทานตัวอย่างทั้งสองข้อของสเปกส่วน "6. DUPLICATE AMOUNTS" ตรงๆ:
 *
 * ตัวอย่างที่ 1: Bank รับเงิน 1,000.00 จำนวน 3 รายการ, GL รับเงิน 1,000.00 จำนวน 2 รายการ
 *   → คิว income|1000.00 ของ GL มี 2 รายการตอนเริ่ม บิ๊บ Bank แถวที่ 1 ดึง GL รายการแรกออกมา (คิวเหลือ 1),
 *     แถวที่ 2 ดึงรายการที่สอง (คิวเหลือ 0), แถวที่ 3 คิวว่างแล้ว → not_found_in_gl
 *     ผลลัพธ์: Bank 2 แถว = found_in_gl, Bank 1 แถว = not_found_in_gl, GL เหลือใช้ 0 ✓ ตรงตามสเปกเป๊ะ
 *
 * ตัวอย่างที่ 2: Bank จ่ายเงิน 500.00 จำนวน 1 รายการ, GL จ่ายเงิน 500.00 จำนวน 3 รายการ
 *   → คิว payment|500.00 ของ GL มี 3 รายการ Bank แถวเดียวดึงออกมา 1 รายการ (คิวเหลือ 2) วนจบแล้วเหลือ GL
 *     2 รายการที่ไม่เคยถูกดึงเลย → glOnlyResults
 *     ผลลัพธ์: Bank 1 แถว = found_in_gl, GL 2 แถว = "มีใน GL แต่ไม่มีใน Bank" ✓ ตรงตามสเปกเป๊ะ
 *
 * ทั้งสองตัวอย่างตรงกับผลลัพธ์ที่สเปกกำหนดไว้เป๊ะทุกประการ โดยไม่ต้องเขียนโค้ดนับจำนวน/จัดกลุ่มพิเศษเพิ่มเลย
 * เพราะกลไกคิว FIFO ต่อ (ทิศทาง, จำนวนเงิน) จัดการเรื่อง "จำนวนซ้ำ" ให้เองตามธรรมชาติอยู่แล้ว
 */
