import type { AssistantChatTurn } from '@/lib/assistantProviders';
import type { AssistantMatchContext, AssistantReply } from '@/types/assistant';
import { ASSISTANT_KNOWLEDGE } from './assistantKnowledge';
import { matchKnowledge } from './assistantMatcher';
import { parseNavigationCommand } from './assistantNavResolver';

/**
 * จุดเดียวที่ UI (components/AssistantPanel.tsx) เรียกเพื่อขอคำตอบ — ออกแบบให้ "ไม่ throw ออกไปเด็ดขาด" (เป็น
 * ข้อยกเว้นเดียวโดยตั้งใจต่อธรรมเนียม throw-never-swallow ปกติของโปรเจกต์นี้ เช่น lib/invoiceApi.ts — เพราะการ
 * เรียกนี้เป็น best-effort enhancement ที่มี fallback ปลอดภัยเสมอ ไม่ใช่การบันทึกข้อมูลที่ผู้ใช้ต้องรู้ว่า
 * ล้มเหลว) ลำดับการพยายามตอบ:
 *   1. คำสั่งนำทางที่ชัดเจน ("ไปหน้า...", "เปิด...") — ตรวจก่อนเรื่องอื่นเสมอเพราะเจาะจงกว่าคำถามทั่วไป ถ้า id
 *      ที่ตรงกันยังไม่ implemented ก็บอกตรงๆ ไม่แสร้งพาไปได้
 *   2. จับคู่ฐานความรู้ในเครื่อง (local, ไม่มีเครือข่ายเลย) — ถ้ามั่นใจพอ ตอบจากตรงนี้เลย
 *   3. ถ้าจับคู่ไม่มั่นใจ และเปิด NEXT_PUBLIC_ASSISTANT_REMOTE_ENABLED='true' ไว้ชัดเจนเท่านั้น ถึงจะลองยิงไป
 *      backend (app/api/assistant/chat/route.ts) — ล้มเหลวตรงไหนก็ตาม (ไม่ได้ตั้งค่า key, เครือข่ายพัง,
 *      response ไม่ 2xx, JSON ผิดรูป) ก็เงียบๆ แล้ว fallback กลับ local เสมอ ไม่โยน error ออกไปให้ UI เห็นเลย
 *   4. ข้อความสำรองสุดท้ายเสมอถ้าไม่เข้าเงื่อนไขไหนเลย
 */

const FALLBACK_ANSWER =
  'ขออภัยค่ะ ดิฉันไม่แน่ใจว่าเข้าใจคำถามถูกต้องหรือเปล่า ลองถามเกี่ยวกับการใช้งานหน้า Bank Reconcile, บันทึกการจ่ายเงิน, รายงานภาษีซื้อ หรือสมุดรายชื่อดูได้ค่ะ หรือพิมพ์ว่า "ช่วยอะไรได้บ้าง" เพื่อดูความสามารถทั้งหมดของดิฉันค่ะ';

async function callRemoteAssistant(query: string, history: AssistantChatTurn[]): Promise<string> {
  const response = await fetch('/api/assistant/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, history }),
  });
  if (!response.ok) {
    throw new Error(`Assistant API error: ${response.status}`);
  }
  const data = (await response.json()) as { text?: string };
  if (!data.text) {
    throw new Error('Assistant API ไม่ได้ส่งข้อความตอบกลับมา');
  }
  return data.text;
}

export async function getAssistantReply(
  query: string,
  context: AssistantMatchContext,
  history: AssistantChatTurn[] = []
): Promise<AssistantReply> {
  const navTarget = parseNavigationCommand(query);
  if (navTarget) {
    if (navTarget.implemented) {
      return {
        text: `พาไปหน้า "${navTarget.label}" ให้เลยค่ะ`,
        suggestions: [{ kind: 'navigate', label: `ไปหน้า ${navTarget.label}`, navigateTo: navTarget.id }],
        source: 'local',
      };
    }
    return {
      text: `ขออภัยค่ะ หน้า "${navTarget.label}" ยังไม่เปิดใช้งานจริงในระบบตอนนี้ค่ะ`,
      suggestions: [],
      source: 'local',
    };
  }

  const match = matchKnowledge(query, ASSISTANT_KNOWLEDGE, context);
  if (match.confident && match.entry) {
    return {
      text: match.entry.answer,
      suggestions: match.entry.suggestions ?? [],
      source: 'local',
    };
  }

  if (process.env.NEXT_PUBLIC_ASSISTANT_REMOTE_ENABLED === 'true') {
    try {
      const text = await callRemoteAssistant(query, history);
      return { text, suggestions: [], source: 'remote' };
    } catch {
      // เงียบๆ แล้วตกไป fallback ข้างล่างเสมอ — ดู docblock ด้านบนของไฟล์นี้ (ข้อยกเว้นเดียวที่ตั้งใจ swallow error)
    }
  }

  return { text: FALLBACK_ANSWER, suggestions: [], source: 'local' };
}
