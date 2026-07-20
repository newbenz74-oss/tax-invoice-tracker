'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import AssistantBubble from './AssistantBubble';
import AssistantPanel from './AssistantPanel';
import { useAssistantNavBridge } from '@/lib/assistantNavBridge';
import { clearHighlight, highlightElement } from '@/lib/assistantHighlight';
import { getAssistantReply } from '@/lib/assistantService';
import type { AssistantChatTurn } from '@/lib/assistantProviders';
import type { AssistantMatchContext, AssistantMessage, AssistantSuggestion } from '@/types/assistant';

const OPEN_STORAGE_KEY = 'benz_assistant_open';
const GREETING_TEXT =
  'สวัสดีค่ะ ดิฉันคือ ACC Reconcile AI Copilot ผู้ช่วยประจำระบบนี้ค่ะ ถามวิธีใช้งานหน้าต่างๆ ให้พาไปหน้าที่ต้องการ หรือให้ช่วยชี้ตำแหน่งปุ่ม/เมนูที่กำลังพูดถึงได้เลยค่ะ มีอะไรให้ช่วยไหมคะ?';
/** ส่งประวัติแชทไม่เกินกี่ผลัดล่าสุดไปกับคำขอ remote (ถ้าเปิดใช้งาน) — ตัวเลขเดียวกับ MAX_HISTORY_TURNS ฝั่ง
 * server (app/api/assistant/chat/route.ts) การตัดซ้ำสองชั้นไม่มีผลเสียใดๆ แค่กันไม่ให้ payload ฝั่ง client
 * ใหญ่เกินความจำเป็นตั้งแต่ต้นทางด้วยเช่นกัน */
const MAX_HISTORY_TURNS = 10;

/** ข้อความทักทายข้อความแรกเสมอ — id/createdAt เป็นค่าคงที่ตายตัวโดยตั้งใจ (ไม่ใช้ crypto.randomUUID()/
 * Date.now()) เพราะฟังก์ชันนี้ถูกเรียกผ่าน useState lazy initializer ซึ่งทำงานทั้งฝั่ง server (SSR) และฝั่ง
 * client (hydrate) — AssistantRoot mount แบบไม่มีเงื่อนไขที่ root layout ตั้งแต่หน้า /login จึงมีส่วนร่วมกับ
 * SSR จริง (ต่างจาก Sidebar.tsx ที่อยู่หลัง ProtectedRoute เสมอ ไม่เคย SSR จริง) ค่าที่สุ่ม/ผูกกับเวลาจริงจะ
 * ต่างกันระหว่างสองฝั่งได้ ถ้าถูก render ออกมาเป็น attribute จริงบน DOM (เช่น key/testid ที่ผูกกับ id) จะเสี่ยง
 * เกิด hydration mismatch — ข้อความทักทายมีแค่ข้อความเดียวเสมอ (ไม่มีทางซ้ำ id กับข้อความอื่นในอาร์เรย์เดียวกัน)
 * ค่าคงที่จึงถูกต้อง 100% อยู่แล้วไม่ต้องสุ่มเลย ข้อความที่เกิดจากการโต้ตอบจริงหลังจากนี้ (handleSend/
 * handleSuggestionClick ด้านล่าง) ทำงานเฉพาะฝั่ง client เท่านั้น (เกิดจาก event handler ไม่ใช่ตอน render) จึง
 * ใช้ crypto.randomUUID()/Date.now() ได้อย่างปลอดภัยตามปกติ ไม่มีทางเกิด hydration mismatch */
function createGreetingMessage(): AssistantMessage {
  return { id: 'greeting', role: 'assistant', text: GREETING_TEXT, createdAt: 0, suggestions: [] };
}

// อ่านสถานะเปิด/ปิดล่าสุดจาก localStorage แบบ SSR-safe — เลียนแบบ pattern เดียวกับ canvasSupported ใน
// ChromaKeyAvatar.tsx ทุกประการ (useSyncExternalStore + subscribe แบบ no-op เพราะค่านี้ไม่มีทางเปลี่ยนจาก
// แหล่งภายนอกระหว่าง session เดียวกันเลย นอกจากโค้ดเราเองเขียนทับ ซึ่ง userToggledOpen ด้านล่างจัดการ
// ทันทีอยู่แล้วโดยไม่ต้องรอ subscription round-trip) ไม่ใช้ useState+useEffect ตรงๆ เพราะจะชน
// react-hooks/set-state-in-effect (severity error ของโปรเจกต์นี้) getServerSnapshot คืน false เสมอ (ฝั่ง
// server ไม่มี window/localStorage ให้เช็ค) — ต่างจาก prefersReducedMotion ที่ subscribe การเปลี่ยนแปลงจริง
// เพราะค่านั้นเปลี่ยนจากภายนอก (ผู้ใช้ปรับตั้งค่าเครื่อง) ได้ระหว่าง session
function subscribeOpenStorage(): () => void {
  return () => {};
}
function getOpenSnapshot(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(OPEN_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}
function getOpenServerSnapshot(): boolean {
  return false;
}

/**
 * Component เดียวที่ mount จาก app/layout.tsx (เป็น sibling ของ {children} ภายใน AuthProvider) — แสดงทุกหน้า
 * ตั้งแต่ /login เป็นต้นไปตามแผนงาน เป็นเจ้าของ state ทั้งหมดของฟีเจอร์นี้ (ข้อความแชท/เปิดปิด/กำลังพิมพ์) และ
 * ประกอบ AssistantBubble + AssistantPanel เข้าด้วยกัน อ่านความสามารถนำทางจริงผ่าน useAssistantNavBridge()
 * (null ตอนอยู่หน้า /login ที่ยังไม่ผ่าน ProtectedRoute — ดู lib/assistantNavBridge.ts)
 */
export default function AssistantRoot() {
  const navBridge = useAssistantNavBridge();
  const bubbleRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);

  const [messages, setMessages] = useState<AssistantMessage[]>(() => [createGreetingMessage()]);
  const [inputValue, setInputValue] = useState('');
  const [pending, setPending] = useState(false);
  // id ของข้อความผู้ช่วยที่ AssistantPanel.tsx กำลังพิมพ์ทีละตัวโชว์อยู่ตอนนี้ (2026-07-19 เพิ่ม effect "พิมพ์
  // ทีละตัว" ตามที่ผู้ใช้ขอหลัง deploy จริง — เดิมข้อความโผล่มาเต็มประโยคทันทีเดียว) null = ไม่มีข้อความไหนกำลัง
  // พิมพ์อยู่ ตั้งค่านี้ทุกครั้งที่มีข้อความผู้ช่วยใหม่ถูกเพิ่มเข้ามา (ทั้งจาก handleSend เมื่อได้คำตอบจริง และ
  // จาก appendAssistantNotice เมื่อมีข้อความแจ้งเตือนสั้นๆ) — pending ยังคงเป็น true ต่อเนื่องไปจนกว่าจะพิมพ์ครบ
  // (ดู handleTypingDone ด้านล่าง) ไม่ใช่ปลดทันทีตอนคำตอบมาถึงเหมือนเดิมอีกต่อไป เพื่อกันช่องพิมพ์/ปุ่มต่างๆ
  // ระหว่างที่ยังพิมพ์ไม่จบ (ดูคอมเมนต์เต็มที่ AssistantPanel.tsx)
  const [typingMessageId, setTypingMessageId] = useState<string | null>(null);
  // override เฉพาะตอนผู้ใช้กดเปิด/ปิดเองใน session นี้เท่านั้น — null หมายถึง "ยังไม่เคยกดเลย ใช้ค่าที่
  // persist ไว้จาก localStorage แทน" (persistedOpen ด้านล่าง) ต้องแยกสอง state ออกจากกันเพื่อความปลอดภัยจาก
  // SSR hydration mismatch (persistedOpen เริ่มที่ false เสมอตอน render รอบแรกทั้งฝั่ง server/client แล้วค่อย
  // sync เป็นค่าจริงหลัง hydrate เสร็จ — ถ้าใช้ localStorage ตรงๆ เป็นค่าเริ่มต้นของ useState เฉยๆ จะได้ค่า
  // ต่างกันระหว่าง SSR/client ทันที)
  const [userToggledOpen, setUserToggledOpen] = useState<boolean | null>(null);

  const persistedOpen = useSyncExternalStore(subscribeOpenStorage, getOpenSnapshot, getOpenServerSnapshot);
  const isOpen = userToggledOpen ?? persistedOpen;

  // บันทึกสถานะเปิด/ปิดไว้ทุกครั้งที่ผู้ใช้กดเปลี่ยนเอง (ไม่บันทึกตอน userToggledOpen ยังเป็น null — ยังไม่
  // เคยกดอะไรเลยใน session นี้ ไม่มีอะไรใหม่ให้บันทึก) เลียนแบบ pattern การเขียน localStorage เดิมของระบบ
  // (Sidebar.tsx expanded, ContactsPage.tsx partnerFilter, DashboardShell activeId) ทุกประการ
  useEffect(() => {
    if (userToggledOpen === null) return;
    try {
      localStorage.setItem(OPEN_STORAGE_KEY, String(userToggledOpen));
    } catch {
      // เขียน localStorage ไม่ได้ก็ไม่เป็นไร แค่จำสถานะเปิด/ปิดข้าม refresh ไม่ได้
    }
  }, [userToggledOpen]);

  // คืน focus กลับไปยังปุ่มลอย (bubble) หลังแผงปิดสนิท — เลียนแบบ pattern เดียวกับ ContactsPage.tsx
  // (wasOpenRef เช็คว่าเพิ่งเปลี่ยนจากเปิด→ปิดจริงๆ ไม่ใช่ค่าเริ่มต้น false ตอน mount ครั้งแรกซึ่งไม่ควรสั่ง
  // focus อะไรเลย)
  useEffect(() => {
    if (!isOpen && wasOpenRef.current) {
      bubbleRef.current?.focus();
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  function handleToggle() {
    setUserToggledOpen(!isOpen);
  }

  function handleClose() {
    setUserToggledOpen(false);
  }

  // ข้อความแจ้งเตือนสั้นๆ ของผู้ช่วย (มาจาก handleSuggestionClick ด้านล่างเท่านั้น — ไม่ใช่คำตอบจริงจาก
  // getAssistantReply) ก็ให้พิมพ์ทีละตัวเหมือนกันเพื่อความสม่ำเสมอ (ผู้ใช้พูดถึง "ข้อความของผู้ช่วย" โดยรวม ไม่ได้
  // จำกัดแค่คำตอบจากคำถามที่พิมพ์ส่งไปเท่านั้น) ปุ่มแนะนำที่ทำให้เกิดข้อความเหล่านี้ถูกปิดไว้ระหว่าง pending อยู่
  // แล้วด้วย (ดู AssistantPanel.tsx) จึงมั่นใจได้ว่าฟังก์ชันนี้จะไม่ถูกเรียกซ้อนทับตอนที่ข้อความอื่นกำลังพิมพ์
  // ทีละตัวค้างอยู่ (pending ต้อง false ก่อนเสมอถึงจะกดปุ่มแนะนำได้)
  function appendAssistantNotice(text: string) {
    const id = crypto.randomUUID();
    setMessages((prev) => [...prev, { id, role: 'assistant', text, createdAt: Date.now() }]);
    setTypingMessageId(id);
    setPending(true);
  }

  function handleClear() {
    setMessages([createGreetingMessage()]);
    // ปกติเรียก handleClear ไม่ได้อยู่แล้วระหว่าง pending (ปุ่ม "ล้างการสนทนา" ถูก disabled ไว้ตอนนั้น — ดู
    // AssistantPanel.tsx) จึง typingMessageId ควรเป็น null อยู่แล้วเสมอตอนมาถึงจุดนี้ได้จริง — รีเซ็ตซ้ำไว้ตรงนี้
    // อีกชั้นเผื่อไว้เฉยๆ ไม่ให้พังถ้าอนาคตมีทางเรียกฟังก์ชันนี้จากที่อื่นเพิ่มโดยไม่ผ่านเงื่อนไข disabled เดิม
    setTypingMessageId(null);
    clearHighlight();
  }

  // เรียกจาก AssistantPanel.tsx ตอนพิมพ์ข้อความ id นี้ครบทุกตัวอักษรแล้ว (หรือข้ามเพราะ prefers-reduced-motion)
  // — ห่อด้วย useCallback เพราะฟังก์ชันนี้เป็น dependency ของ useEffect ฝั่ง AssistantPanel.tsx ด้วย (เลียนแบบ
  // เหตุผลเดียวกับ commitNav/handleSelect ใน app/dashboard/page.tsx ที่ห่อ useCallback ไว้เพื่อไม่ให้ effect
  // ที่พึ่งพา identity ของฟังก์ชันนี้ต้อง re-run ทุก render โดยไม่จำเป็น) เช็ค current === id ก่อนเคลียร์เผื่อไว้
  // เป็นตาข่ายนิรภัย (ในทางปฏิบัติไม่ควรเกิด เพราะ interval ฝั่ง AssistantPanel.tsx ถูก clearInterval ไปแล้วเสมอ
  // ก่อนที่ typingMessageId จะเปลี่ยนค่าไปเป็นอย่างอื่นได้)
  const handleTypingDone = useCallback((id: string) => {
    setTypingMessageId((current) => (current === id ? null : current));
    setPending(false);
  }, []);

  // จุดเดียวที่ Smart Action ของผู้ช่วยถูกสั่งทำงานจริง (นำทาง/ไฮไลต์) — จำกัดแค่ 2 อย่างนี้ตามสเปกเดิม
  // (ห้าม save/delete/approve/submit แทนผู้ใช้เด็ดขาด — ผู้ช่วยไม่มีปุ่ม suggestion ชนิดอื่นให้กดได้เลยตั้งแต่
  // ต้นทาง ดู types/assistant.ts AssistantSuggestionKind)
  function handleSuggestionClick(suggestion: AssistantSuggestion) {
    if (suggestion.kind === 'navigate' && suggestion.navigateTo) {
      // lib/assistantNavResolver.ts ตรวจสอบแค่ว่า id มีจริงใน NAV_STRUCTURE เท่านั้น (ไม่รู้จัก/ไม่แคร์เรื่อง
      // nav bridge เลย) จึงเสนอปุ่มแนะนำนี้ได้แม้อยู่หน้า /login ที่ยังไม่มี DashboardShell mount อยู่จริง —
      // ถ้าไม่กันตรงนี้ไว้ ปุ่มที่ดูกดได้จะไม่ทำอะไรเลยเงียบๆ (dead end) ขัดกับหลักการของฟีเจอร์นี้ทั้งหมดที่
      // ตั้งใจไม่ให้มีทางตันแบบเงียบๆ (เทียบกับ FALLBACK_ANSWER/ข้อความ "ไม่พบองค์ประกอบนี้" ด้านล่าง)
      if (navBridge) {
        navBridge.navigate(suggestion.navigateTo);
      } else {
        appendAssistantNotice('ขออภัยค่ะ ต้องเข้าสู่ระบบก่อนถึงจะพาไปหน้านั้นได้นะคะ');
      }
      return;
    }
    if (suggestion.kind === 'highlight' && suggestion.highlightSelector) {
      const found = highlightElement(suggestion.highlightSelector);
      if (!found) {
        // element ที่ถามถึงไม่ได้ render อยู่จริงตอนนี้ (เช่น อยู่หลัง section ที่ยุบอยู่ หรือหน้าที่เกี่ยวข้อง
        // ยังไม่ได้เปิด) — บอกตรงๆ แทนที่จะเงียบเฉยๆ โดยไม่มีอะไรเกิดขึ้นเลย (ดู lib/assistantHighlight.ts)
        appendAssistantNotice(
          'ขออภัยค่ะ ไม่พบองค์ประกอบนี้ในหน้าปัจจุบัน อาจต้องไปหน้าที่เกี่ยวข้องก่อนแล้วลองถามใหม่อีกครั้งค่ะ'
        );
      }
    }
  }

  async function handleSend() {
    const query = inputValue.trim();
    if (!query || pending) return;

    const userMessage: AssistantMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: query,
      createdAt: Date.now(),
    };
    // อ่าน messages ปัจจุบันตรงๆ จาก closure ปลอดภัยตรงนี้ (ไม่มี await คั่นก่อนหน้า) — ใช้สร้าง history ที่
    // ส่งไป getAssistantReply เท่านั้น ส่วนการอัปเดต state จริงหลัง await ด้านล่างใช้ functional updater เสมอ
    // (setMessages(prev => ...)) เพราะระหว่างรอ reply ผู้ใช้อาจกด "ล้างการสนทนา" ได้ (ปุ่มนั้น disabled ระหว่าง
    // pending อยู่แล้วก็จริง แต่ functional updater ยังเป็นนิสัยที่ปลอดภัยกว่าเสมอเมื่อมี await คั่นกลาง)
    const historySource = [...messages, userMessage];
    setMessages(historySource);
    setInputValue('');
    setPending(true);

    const history: AssistantChatTurn[] = historySource
      .slice(-MAX_HISTORY_TURNS)
      .map((m) => ({ role: m.role, text: m.text }));
    const context: AssistantMatchContext = { activeId: navBridge?.activeId ?? null };

    try {
      // getAssistantReply ออกแบบให้ไม่ throw ออกมาเด็ดขาด (ดู doc comment เต็มในไฟล์นั้น) — เดิม finally ปลด
      // pending ทันทีตรงนี้เลย แต่ตั้งแต่มี effect "พิมพ์ทีละตัว" (2026-07-19) ต้องปล่อยให้ pending ยังเป็น true
      // ต่อไปจนกว่า AssistantPanel.tsx จะพิมพ์ข้อความนี้ครบแล้วเรียก handleTypingDone กลับมา (ไม่งั้นช่องพิมพ์/
      // ปุ่มต่างๆ จะกลับมาใช้ได้ก่อนที่ข้อความจะพิมพ์จบ ดูขัดกับความรู้สึก "กำลังคุยกันอยู่" ที่ผู้ใช้ขอ)
      const reply = await getAssistantReply(query, context, history);
      const replyId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        {
          id: replyId,
          role: 'assistant',
          text: reply.text,
          suggestions: reply.suggestions,
          createdAt: Date.now(),
        },
      ]);
      setTypingMessageId(replyId);
    } catch {
      // ไม่ควรเกิดขึ้นจริงตามสัญญาของ getAssistantReply (ดูด้านบน) แต่ถ้าเกิดขึ้นจริงต้องปลด pending ทันทีตรงนี้
      // เอง เพราะไม่มีข้อความใหม่ถูกเพิ่มเข้ามาให้ typingMessageId ชี้ถึง — ไม่มี handleTypingDone ใดๆ จะถูกเรียก
      // มาปลดให้ในอนาคต ถ้าไม่ปลดตรงนี้ pending จะค้าง true ตลอดไป (ตาข่ายนิรภัยชั้นที่สอง เหมือน finally เดิม
      // ไม่ใช่การ swallow error ตั้งใจ — ยังไม่เคยเจอ error จริงจากจุดนี้เลยตลอดการทดสอบ)
      setPending(false);
    }
  }

  return (
    <>
      <AssistantBubble ref={bubbleRef} isOpen={isOpen} onToggle={handleToggle} />
      <AssistantPanel
        isOpen={isOpen}
        messages={messages}
        pending={pending}
        typingMessageId={typingMessageId}
        onTypingDone={handleTypingDone}
        inputValue={inputValue}
        onInputChange={setInputValue}
        onSend={handleSend}
        onClear={handleClear}
        onClose={handleClose}
        onSuggestionClick={handleSuggestionClick}
      />
    </>
  );
}
