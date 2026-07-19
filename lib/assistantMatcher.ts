import type { AssistantKnowledgeEntry, AssistantMatchContext, AssistantMatchResult } from '@/types/assistant';

/** คะแนนขั้นต่ำที่ถือว่า "มั่นใจ" พอจะตอบตรงๆ — ต่ำกว่านี้ถือว่าจับคู่ไม่ชัดเจนพอ ให้ตอบแบบข้อความสำรอง
 * (fallback) แทนใน lib/assistantService.ts ปรับตัวเลขนี้ได้อิสระถ้าฐานความรู้ขยายใหญ่ขึ้นแล้วพบว่าหลวม/
 * เข้มเกินไปจากการใช้งานจริง ไม่ผูกกับ logic ส่วนอื่นเลย */
export const MIN_CONFIDENCE_SCORE = 2;

/** คะแนนโบนัสเมื่อหัวข้อความรู้ตรงกับหน้าปัจจุบันของผู้ใช้พอดี (entry.pageScope === context.activeId) —
 * ช่วยให้คำถามกำกวมสั้นๆ เอนเอียงไปทางหัวข้อของหน้าที่กำลังเปิดอยู่ก่อนหัวข้อของหน้าอื่นที่บังเอิญมีคำสำคัญ
 * คล้ายกัน */
export const PAGE_SCOPE_BONUS = 2;

/**
 * จับคู่คำถามของผู้ใช้กับฐานความรู้ — ให้คะแนนแบบ substring-containment ต่อคำสำคัญ (ไม่ตัดคำภาษาไทย เพราะ
 * ภาษาไทยไม่มีการเว้นวรรคระหว่างคำที่เชื่อถือได้ การดึงไลบรารีตัดคำมาใช้จะขัดกับหลักการ "ไม่มี dependency
 * ภายนอกเพิ่ม" ของฟีเจอร์นี้ — ดูแผนงาน) คะแนนต่อคำสำคัญคำนวณจากความยาวตัวอักษร (ปัดเศษขึ้น หารด้วย 4 อย่าง
 * น้อย 1 แต้ม) เพื่อให้รางวัลคำที่เจาะจงกว่าคำทั่วไปสั้นๆ
 *
 * Tie-break: ถ้าคะแนนเท่ากันเป๊ะระหว่างหลายหัวข้อ หัวข้อที่มาก่อนใน `entries` ชนะเสมอ (ใช้ `>` ไม่ใช่ `>=`
 * ตอนเทียบคะแนนสูงสุด) — เป็นพฤติกรรมที่ตั้งใจและมีเทสต์ยืนยันไว้ ไม่ใช่ผลข้างเคียงโดยบังเอิญ
 */
export function matchKnowledge(
  query: string,
  entries: AssistantKnowledgeEntry[],
  context: AssistantMatchContext
): AssistantMatchResult {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return { entry: null, score: 0, confident: false };
  }

  let best: AssistantKnowledgeEntry | null = null;
  let bestScore = 0;

  for (const entry of entries) {
    let score = 0;
    for (const keyword of entry.keywords) {
      const normalizedKeyword = keyword.trim().toLowerCase();
      if (normalizedKeyword && normalizedQuery.includes(normalizedKeyword)) {
        score += Math.max(1, Math.ceil(normalizedKeyword.length / 4));
      }
    }
    if (score > 0 && entry.pageScope && context.activeId && entry.pageScope === context.activeId) {
      score += PAGE_SCOPE_BONUS;
    }
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  return {
    entry: best,
    score: bestScore,
    confident: best !== null && bestScore >= MIN_CONFIDENCE_SCORE,
  };
}
