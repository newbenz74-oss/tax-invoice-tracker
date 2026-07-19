/**
 * ประเภทข้อมูลสำหรับฟีเจอร์ "ACC Reconcile AI Copilot" (ผู้ช่วย AI ลอยอยู่ทุกหน้า ตั้งแต่หน้า Login) — v1
 * (2026-07-19) ดูสถาปัตยกรรมเต็มในแผนงาน (plan file) เป็นระบบใหม่ทั้งหมด แยกอิสระจาก business logic เดิม
 * ของแอป — จุดเชื่อมต่อเดียวกับของเดิมคือ lib/assistantNavBridge.ts ที่ DashboardShell (app/dashboard/page.tsx)
 * ลงทะเบียน AssistantNavBridge ของตัวเองเข้ามาตอน mount เท่านั้น
 */

export type AssistantMessageRole = 'user' | 'assistant';

/** 1 บรรทัดข้อความในประวัติแชท — เก็บใน state ของ AssistantRoot เท่านั้น (ไม่ persist ข้าม reload ตามที่
 * ตัดสินใจไว้ในแผนงาน — มีแต่สถานะเปิด/ปิด panel ที่ persist ผ่าน localStorage) */
export interface AssistantMessage {
  id: string;
  role: AssistantMessageRole;
  text: string;
  suggestions?: AssistantSuggestion[];
  createdAt: number;
}

export type AssistantSuggestionKind = 'navigate' | 'highlight';

/** ปุ่มแนะนำที่แนบมากับข้อความของผู้ช่วย — กดแล้วทำ action ทันที (นำทาง/ไฮไลต์) ไม่ใช่แค่ข้อความเฉยๆ
 * "Smart Action" ที่อนุญาตมีแค่ 2 อย่างนี้ตามสเปก (ห้าม save/delete/approve/submit แทนผู้ใช้เด็ดขาด) */
export interface AssistantSuggestion {
  kind: AssistantSuggestionKind;
  label: string;
  /** จำเป็นเมื่อ kind === 'navigate' — ต้องเป็น id ที่มีจริงใน NAV_STRUCTURE (lib/navigation.ts) เท่านั้น
   * ตรวจสอบผ่าน lib/assistantNavResolver.ts เสมอก่อนสร้าง suggestion นี้ ไม่มีทางหลุด id ปลอมออกไปได้ */
  navigateTo?: string;
  /** จำเป็นเมื่อ kind === 'highlight' — เป็น CSS selector ที่อ้างอิง data-testid ที่มีอยู่จริงในระบบเดิม
   * (ตั้งใจไม่สร้าง attribute data-assistant-id คู่ขนานใหม่ทั่วทั้งแอป — ดูเหตุผลในแผนงาน) */
  highlightSelector?: string;
}

/** 1 หัวข้อความรู้ในฐานความรู้ (lib/assistantKnowledge.ts) — ผูกกับคำสำคัญที่ผู้ใช้อาจพิมพ์ถาม */
export interface AssistantKnowledgeEntry {
  id: string;
  keywords: string[];
  answer: string;
  /** id หน้าที่หัวข้อนี้เกี่ยวข้องที่สุด (ให้คะแนนโบนัสตอนจับคู่ถ้าผู้ใช้อยู่หน้านั้นพอดี) — ไม่บังคับ เพราะ
   * บางหัวข้อ (เช่น คำถามเรื่องหน้า Login/สมัครสมาชิก) ไม่ได้ผูกกับ activeId ใดๆ ในแอป (อยู่ก่อน login) */
  pageScope?: string;
  suggestions?: AssistantSuggestion[];
}

export interface AssistantMatchContext {
  /** id ของหน้าปัจจุบัน — null เมื่ออยู่หน้า /login (ยังไม่มีแนวคิด "หน้า"/activeId ในแอปเลยตอนนั้น) */
  activeId: string | null;
}

export interface AssistantMatchResult {
  entry: AssistantKnowledgeEntry | null;
  score: number;
  confident: boolean;
}

export type AssistantReplySource = 'local' | 'remote';

export interface AssistantReply {
  text: string;
  suggestions: AssistantSuggestion[];
  source: AssistantReplySource;
}

/** ผูก(bridge)ความสามารถนำทางจริงของ DashboardShell เข้ากับผู้ช่วยที่ mount แยกอยู่ที่ root layout
 * (app/layout.tsx) คนละจุดกัน — ดู lib/assistantNavBridge.ts สำหรับกลไก useSyncExternalStore ที่ใช้ค่านี้
 * จริง DashboardShell เป็นคนเดียวที่ลงทะเบียน(register)ค่านี้ตอน mount และเลิกลงทะเบียนตอน unmount ผ่าน
 * useEffect เดียว — ผู้ช่วยเองอ่านอย่างเดียว ไม่เคยสร้างค่านี้เอง บนหน้า /login จะไม่มีการลงทะเบียนเลย (ยังไม่
 * ผ่าน ProtectedRoute) ทำให้คำสั่ง "นำทางไปหน้า X" ของผู้ช่วยจะไม่ถูกเสนอเลยตอนอยู่หน้า Login ซึ่งถูกต้องแล้ว */
export interface AssistantNavBridge {
  activeId: string;
  pageTitle: string;
  navigate: (id: string) => void;
}
