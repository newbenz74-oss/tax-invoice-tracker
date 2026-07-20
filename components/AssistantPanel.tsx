'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { ArrowRight, Loader2, Send, Target, Trash2, X } from 'lucide-react';
import ChromaKeyAvatar from './ChromaKeyAvatar';
import type { AssistantMessage, AssistantSuggestion } from '@/types/assistant';

const ASSISTANT_NAME = 'ACC Reconcile AI Copilot';
/** breakpoint เดียวกับที่ Sidebar.tsx ใช้จริง (min-[992px]:hidden ของ overlay มือถือ) — "มือถือ" ในระบบนี้
 * หมายถึงต่ำกว่า 992px เสมอ ไม่ใช่ค่า sm/md ทั่วไปของ Tailwind default */
const MOBILE_BREAKPOINT_QUERY = '(max-width: 991px)';

/** ตัวอักษร/รอบ และความถี่ของ effect "พิมพ์ทีละตัว" (2026-07-19 ผู้ใช้ขอหลัง deploy จริง — เดิมข้อความผู้ช่วย
 * โผล่มาเต็มประโยคทันทีทำให้ดูไม่เหมือนกำลังคุยกันอยู่) 3 ตัวอักษร/20ms = ~150 ตัวอักษร/วินาที — เร็วกว่าคนพิมพ์
 * จริงมาก (ตั้งใจ ไม่ใช่เลียนแบบความเร็วคนจริง) แค่ให้พอเห็นการเคลื่อนไหวแบบทยอยมา คำตอบยาวที่สุดในฐานความรู้
 * (lib/assistantKnowledge.ts ตอนนี้ยาวสุด 391 ตัวอักษร) ใช้เวลาราว 2.6 วินาทีเท่านั้น ไม่ลากยาวจนน่ารำคาญ */
const TYPEWRITER_CHARS_PER_TICK = 3;
const TYPEWRITER_TICK_MS = 20;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** subscribe/getSnapshot สำหรับ useSyncExternalStore เช็ค prefers-reduced-motion — คัดลอก pattern เดียวกับที่
 * components/ChromaKeyAvatar.tsx ใช้อยู่แล้วทุกประการ (ซึ่งตัวมันเองก็คัดลอกมาจาก app/login/page.tsx อีกที)
 * ไม่ export ออกมาใช้ร่วมกันเพราะเป็น local pattern เล็กๆ ในแต่ละไฟล์ ไม่คุ้มที่จะแยกเป็น shared hook ใหม่ —
 * ผู้ใช้ที่ตั้งค่า reduced-motion ไว้จะเห็นข้อความเต็มทันที ไม่ต้องรอ effect พิมพ์ทีละตัวเลย (เหมือนอวตารที่ข้าม
 * ไปแสดง poster นิ่งแทนวิดีโอ) */
function subscribeReducedMotion(callback: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
  mediaQuery.addEventListener('change', callback);
  return () => mediaQuery.removeEventListener('change', callback);
}
function getReducedMotionSnapshot(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}
function getReducedMotionServerSnapshot(): boolean {
  return false;
}

interface AssistantPanelProps {
  isOpen: boolean;
  messages: AssistantMessage[];
  pending: boolean;
  /** id ของข้อความผู้ช่วยที่กำลังทยอย "พิมพ์" อยู่ตอนนี้ (null = ไม่มีข้อความไหนกำลังพิมพ์อยู่) — ข้อความอื่น
   * ทั้งหมดใน messages (รวมข้อความทักทายแรกสุด) แสดงเต็มทันทีเสมอ ไม่มีทางถูกเลือกให้พิมพ์ทีละตัวย้อนหลัง เพราะ
   * AssistantRoot.tsx เป็นคนกำหนดค่านี้แค่ตอนเพิ่งเพิ่มข้อความใหม่เข้ามาเท่านั้น (ดู doc comment เต็มที่นั่น) */
  typingMessageId: string | null;
  /** เรียกตอนพิมพ์ข้อความ id นี้ครบทุกตัวอักษรแล้ว (หรือข้ามไปเลยเพราะ prefers-reduced-motion) —
   * AssistantRoot.tsx ใช้สัญญาณนี้ปลด pending กลับเป็น false (เปิดให้พิมพ์/กดปุ่มต่างๆ ได้อีกครั้ง) */
  onTypingDone: (id: string) => void;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onClear: () => void;
  onClose: () => void;
  onSuggestionClick: (suggestion: AssistantSuggestion) => void;
}

interface AssistantTypewriterTextProps {
  text: string;
  messageId: string;
  onDone: (id: string) => void;
  onProgress: () => void;
}

/**
 * ตัวแสดงข้อความผู้ช่วยแบบ "พิมพ์ทีละตัว" — แยกเป็น component ของตัวเองโดยเฉพาะเพื่อให้ typedLength เป็น state
 * ที่ "เกิดใหม่" ทุกครั้งที่มีข้อความใหม่ต้องพิมพ์ (mount ด้วย key={message.id} ที่จุดเรียกใช้ใน AssistantPanel
 * ด้านล่าง) ค่าเริ่มต้น 0 จาก useState เองถูกต้องอยู่แล้วโดยธรรมชาติ — ไม่ต้องมี effect ไหนคอยเรียก
 * setTypedLength(0) แบบ sync ตรงๆ ในตัว effect เลย (จุดที่เคยชนกฎ react-hooks/set-state-in-effect ตอนยังรวม
 * logic นี้ไว้ใน AssistantPanel เอง) ส่วนการเรียก setTypedLength(revealed) ด้านล่างนี้เกิดขึ้นเฉพาะภายใน
 * callback ของ setInterval (asynchronous เสมอ ไม่ใช่ตรงๆ ใน effect body ตอน effect รันครั้งแรก) จึงไม่ถูกกฎ
 * เดียวกันนี้ตัดสินว่าเป็นปัญหา — เหมือน pattern เดิมที่เคยใช้ได้มาตลอด
 *
 * onDone/onProgress ที่รับมาต้องเป็น reference คงที่ข้ามการ re-render ของ AssistantPanel เสมอ (onDone คือ
 * onTypingDone ตัวเดิมจาก props ตรงๆ ที่ AssistantRoot.tsx ห่อด้วย useCallback ไว้แล้ว, onProgress คือ
 * scrollMessagesToBottom ที่ AssistantPanel ห่อด้วย useCallback เองอีกที) — ไม่งั้นถ้า identity เปลี่ยนทุก
 * re-render ของ AssistantPanel ระหว่างที่ยังพิมพ์ไม่จบ effect ด้านล่างจะ cleanup+restart ใหม่ทุกครั้ง (เริ่มนับ
 * ตัวอักษรใหม่จาก 0 ซ้ำๆ ทั้งที่ข้อความยังพิมพ์ไม่จบเลยสักครั้ง)
 */
function AssistantTypewriterText({ text, messageId, onDone, onProgress }: AssistantTypewriterTextProps) {
  const [typedLength, setTypedLength] = useState(0);

  useEffect(() => {
    if (text.length === 0) {
      onDone(messageId);
      return;
    }
    let revealed = 0;
    const intervalId = window.setInterval(() => {
      revealed = Math.min(revealed + TYPEWRITER_CHARS_PER_TICK, text.length);
      setTypedLength(revealed);
      onProgress();
      if (revealed >= text.length) {
        window.clearInterval(intervalId);
        onDone(messageId);
      }
    }, TYPEWRITER_TICK_MS);
    return () => window.clearInterval(intervalId);
  }, [text, messageId, onDone, onProgress]);

  return <>{text.slice(0, typedLength)}</>;
}

/**
 * แผงแชทแบบเลื่อนเข้า (slide-in) ของผู้ช่วย AI — mount ค้างไว้เสมอ (ไม่ conditional unmount) แล้วสลับด้วยคลาส
 * .assistant-panel-open/.assistant-panel-closed (app/globals.css) เพื่อให้เล่น animation ปิดได้จริง (ไม่มีทาง
 * animate การ unmount DOM ได้) จับคู่กับ attribute `inert` ตอนปิดเพื่อตัดออกจาก Tab order/accessibility tree
 * โดยสมบูรณ์ (React 19 รองรับ inert เป็น boolean prop มาตรฐานแล้ว ไม่ต้องพึ่ง ref/manual DOM APIs)
 *
 * ตั้งใจใช้ role="dialog" แบบ non-modal (ไม่มี aria-modal, ไม่มี Tab-focus-trap, ไม่มี backdrop มืดครอบพื้น
 * หลัง) ต่างจาก modal ปกติของระบบ (เทียบ ContactsPage.tsx) เพราะแผงนี้ตามแผนงานต้อง "อยู่ร่วมกับแอปที่ยัง
 * ใช้งานได้อยู่ข้างหลังเสมอ" ไม่ใช่ blocking modal — เป็นเหตุผลเดียวกับที่ตั้งใจไม่ทำ click-outside-to-close
 * ด้วย (ผู้ใช้ต้องคลิกอย่างอื่นข้างหลังได้โดยไม่ปิดผู้ช่วยไปเฉยๆ) ยังคง ESC-to-close และ focus-in ตอนเปิด/
 * focus-restore ตอนปิด (ทำที่ AssistantRoot.tsx เพราะเป็นคนถือ ref ของปุ่ม bubble) ไว้ตามหลัก accessibility
 * ปกติ — เลือก focus เข้า "ช่องพิมพ์" ตรงๆ ตอนเปิด (ไม่ใช่ปุ่มปิดหรือ element แรกสุด) เพราะจุดประสงค์หลักที่
 * ผู้ใช้เปิดผู้ช่วยขึ้นมาคือจะพิมพ์ถามอะไรสักอย่างอยู่แล้ว
 *
 * z-[45] (2026-07-19 ปรับลดจาก z-[70] พร้อมกับ AssistantBubble.tsx — ดูคอมเมนต์เต็มที่นั่นว่าทำไม) ต่ำกว่า
 * modal จริงทุกตัวในระบบ (z-50/z-[60]) โดยตั้งใจ ให้ backdrop ทึบของ modal ใดๆ ที่เปิดอยู่บังแผงนี้ไปด้วยเลย
 * (ไม่ใช่แค่ปุ่มลอย) แทนที่จะให้แผงลอยไปทับ/แย่งคลิกจากฟอร์มที่ผู้ใช้กำลังกรอกอยู่
 */
export default function AssistantPanel({
  isOpen,
  messages,
  pending,
  typingMessageId,
  onTypingDone,
  inputValue,
  onInputChange,
  onSend,
  onClear,
  onClose,
  onSuggestionClick,
}: AssistantPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);
  const prefersReducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot
  );

  // เอฟเฟกต์เฉพาะเคส prefers-reduced-motion: ข้ามการพิมพ์ทีละตัวไปเลย (แสดงข้อความเต็มทันทีที่ JSX ด้านล่าง
  // ผ่าน isTyping ที่ปิดไว้เมื่อ prefersReducedMotion เป็นจริง) หน้าที่เดียวของ effect นี้คือแจ้ง onTypingDone
  // (callback prop ของ AssistantRoot.tsx ไม่ใช่ setState ของ component นี้เอง — จึงไม่ชนกฎ
  // react-hooks/set-state-in-effect) กลับไปทันทีโดยไม่ต้องรอ interval ใดๆ เลย เคสพิมพ์ทีละตัวจริง (ไม่ reduced
  // motion) แยกไปอยู่ที่ AssistantTypewriterText ด้านล่างทั้งหมดแทน (component ของตัวเอง mount ใหม่ทุกครั้งด้วย
  // key={message.id} — ดูตอน render — ทำให้ typedLength เริ่มที่ 0 ถูกต้องเสมอโดยไม่ต้องมี effect คอย reset
  // มันแบบ sync ตรงๆ ที่นี่เลย ซึ่งจะชนกฎเดียวกันนี้)
  useEffect(() => {
    if (!typingMessageId || !prefersReducedMotion) return;
    onTypingDone(typingMessageId);
  }, [typingMessageId, prefersReducedMotion, onTypingDone]);

  // focus เข้าช่องพิมพ์ทันทีตอน "เปิด" แผงเท่านั้น (ไม่ใช่ทุกครั้งที่ prop อื่นเปลี่ยนระหว่างเปิดอยู่แล้ว เช่น
  // ข้อความใหม่มาถึง) — ใช้ wasOpenRef เช็คว่าเพิ่งเปลี่ยนจากปิด→เปิดจริงๆ เลียนแบบ pattern เดียวกับ
  // ContactsPage.tsx (wasOpenRef) ทุกประการ
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      inputRef.current?.focus();
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  // ESC ปิดแผง — ไม่มี Tab-focus-trap คู่กัน (ต่างจาก modal ปกติของระบบ) ตามที่ตัดสินใจไว้ในดอกคอมเมนต์บนสุด
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // ล็อกการ scroll ของพื้นหลังเฉพาะตอนอยู่บนมือถือเท่านั้น — ต่างจาก Sidebar.tsx/ContactsPage.tsx ที่ isOpen
  // ของมันเองเป็นจริงได้แค่บนมือถืออยู่แล้วโดยธรรมชาติ แผงนี้เปิดได้ทั้งจอเล็ก/ใหญ่ จึงต้องเช็ค viewport ตรงๆ
  // ด้วย matchMedia เพิ่มอีกชั้น ไม่งั้นจะล็อก scroll ทั้งหน้าบนจอใหญ่ทั้งที่แผงลอยเป็นการ์ดเล็กๆ ไม่ได้บังเนื้อหา
  // เลย (ดูคอมเมนต์ MOBILE_BREAKPOINT_QUERY ด้านบนว่าทำไมใช้ 991px)
  useEffect(() => {
    if (!isOpen) return;
    if (typeof window === 'undefined' || !window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  // ฟังก์ชันเลื่อนไปข้อความล่าสุด — ห่อด้วย useCallback (deps ว่างเพราะอ้างแค่ ref) เพื่อให้ reference คงที่
  // ข้ามการ re-render เสมอ ใช้ทั้งจาก effect ด้านล่าง (ตอนมีข้อความใหม่/pending เปลี่ยน) และส่งลงไปเป็น onProgress
  // ของ AssistantTypewriterText ด้านบน (เรียกตรงๆ ทุก tick ตอนกำลังพิมพ์ทีละตัว — ไม่ผ่าน state/dependency ใดๆ
  // ของ component นี้เลย จึงไม่ต้องมี typedLength อยู่ใน dependency array ของ component นี้อีกต่อไป ตั้ง scrollTop
  // ตรงๆ (ไม่ใช้ scrollIntoView({behavior:'smooth'})) ตั้งใจให้ "เลื่อนทันที" เสมอโดยไม่ต้องแยกสาขา
  // prefers-reduced-motion เหมือน lib/assistantHighlight.ts เพราะเป็นแค่การเลื่อน scroll ภายในกล่องแชทเล็กๆ
  // ไม่ใช่การเลื่อนทั้งหน้า
  const scrollMessagesToBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, []);

  // เลื่อนไปข้อความล่าสุดตอนมีข้อความใหม่เพิ่มเข้ามา หรือสถานะ pending เปลี่ยน (เช่นจุดไข่ปลา "กำลังพิมพ์..."
  // โผล่มา/หายไป) ส่วนตอนกำลังพิมพ์ทีละตัวอยู่ AssistantTypewriterText เรียก scrollMessagesToBottom เองตรงๆ ทุก
  // tick อยู่แล้ว (ผ่าน onProgress) ไม่ต้องพึ่ง effect นี้ระหว่างพิมพ์เลย
  useEffect(() => {
    scrollMessagesToBottom();
  }, [messages.length, pending, scrollMessagesToBottom]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSend();
  }

  return (
    <div
      role="dialog"
      aria-label={`แผงแชทผู้ช่วย ${ASSISTANT_NAME}`}
      inert={!isOpen}
      data-testid="assistant-panel"
      // sm:bottom-[168px] / min-[992px]:bottom-[200px] (2026-07-19 ผู้ใช้ขอขยายปุ่มลอยเป็น 2 เท่า — ดู
      // AssistantBubble.tsx) = bottom margin ของปุ่มลอย (24px) + ความสูงปุ่มลอยของแต่ละ breakpoint
      // (144px ที่ md/768px ขึ้นไปจนถึงก่อน 992px, 176px ที่ min-[992px] ขึ้นไป) ให้ขอบล่างของแผงชนกับขอบบน
      // ของปุ่มพอดีเป๊ะเหมือนก่อนขยายขนาด (ไม่ทับกัน ไม่เว้นช่องว่างเกินจำเป็น) — ค่า sm: ใช้ความสูงของปุ่มที่
      // md (768px) เป็นตัวตั้งเพราะช่วง 640-768px ปุ่มยังใช้ขนาดเริ่มต้น (128px) เล็กกว่า จึงมีช่องว่างเพิ่ม
      // อีกเล็กน้อยในช่วงนั้น (เท่าเดิมเป๊ะเมื่อเทียบสัดส่วนกับก่อนขยาย 2 เท่า)
      className={`card-surface fixed inset-x-3 top-20 bottom-3 z-[45] flex flex-col overflow-hidden rounded-2xl sm:inset-x-auto sm:top-auto sm:right-6 sm:bottom-[168px] sm:h-[70vh] sm:max-h-[640px] sm:w-[380px] min-[992px]:right-8 min-[992px]:bottom-[200px] ${
        isOpen ? 'assistant-panel-open' : 'assistant-panel-closed'
      }`}
    >
      <div className="flex flex-none items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <ChromaKeyAvatar className="h-9 w-9 flex-none rounded-full" />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-text">{ASSISTANT_NAME}</p>
            <p className="truncate text-[11px] text-text-sub">ผู้ช่วยการใช้งานระบบ</p>
          </div>
        </div>
        <div className="flex flex-none items-center gap-1">
          <button
            type="button"
            onClick={onClear}
            disabled={pending}
            aria-label="ล้างการสนทนา"
            data-testid="clear-assistant-chat"
            className="rounded-md p-1.5 text-text-sub transition-colors duration-[250ms] hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 size={18} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดผู้ช่วย"
            data-testid="close-assistant-panel"
            className="rounded-md p-1.5 text-text-sub transition-colors duration-[250ms] hover:bg-primary-light"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      <div
        ref={messagesContainerRef}
        role="log"
        aria-live="polite"
        aria-atomic="false"
        data-testid="assistant-message-list"
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-4"
      >
        {messages.map((message) => {
          // ข้อความที่กำลังถูกพิมพ์ทีละตัวอยู่ตอนนี้เท่านั้นที่ผ่าน AssistantTypewriterText (component ของตัวเอง
          // ด้านบน ซึ่งเป็นเจ้าของ state typedLength เอง) — ข้อความอื่นทั้งหมด (ทักทายแรกสุด, ข้อความเก่าที่พิมพ์
          // ครบไปแล้วก่อนหน้านี้) แสดงเต็มเสมอ ไม่มีทาง "พิมพ์ซ้ำ" ตอน re-render — เช็ค !prefersReducedMotion
          // ควบคู่ไปด้วยเสมอ เพราะเคสนั้น effect สำหรับ prefers-reduced-motion ด้านบน (ก่อน useEffect โฟกัส
          // ช่องพิมพ์) แจ้ง onTypingDone ทันทีโดยไม่ mount AssistantTypewriterText เลยสักครั้ง
          const isTyping = message.id === typingMessageId && !prefersReducedMotion;
          return (
            <div key={message.id} className="flex flex-col gap-1.5">
              <div
                data-testid={message.role === 'user' ? 'assistant-message-user' : 'assistant-message-assistant'}
                className={
                  message.role === 'user'
                    ? 'ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2.5 text-sm whitespace-pre-wrap text-white'
                    : 'mr-auto max-w-[85%] rounded-2xl rounded-bl-sm bg-white/8 px-3.5 py-2.5 text-sm whitespace-pre-wrap text-text'
                }
              >
                {isTyping ? (
                  <AssistantTypewriterText
                    key={message.id}
                    messageId={message.id}
                    text={message.text}
                    onDone={onTypingDone}
                    onProgress={scrollMessagesToBottom}
                  />
                ) : (
                  message.text
                )}
              </div>
              {message.suggestions && message.suggestions.length > 0 && (
                <div className="mr-auto flex max-w-[85%] flex-wrap gap-1.5">
                  {message.suggestions.map((suggestion, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => onSuggestionClick(suggestion)}
                      // ปิดปุ่มแนะนำระหว่าง pending ด้วย (2026-07-19 พร้อมฟีเจอร์พิมพ์ทีละตัว) — กัน edge case ที่
                      // ผู้ใช้กดปุ่มแนะนำของข้อความ "เก่า" ระหว่างที่ข้อความ "ใหม่" กว่ากำลังพิมพ์ทีละตัวอยู่พอดี
                      // (ปุ่มแนะนำไม่ผูกกับ isTyping ของข้อความตัวเอง เพราะงั้นถ้าไม่กันไว้ตรงนี้ กดแล้วอาจไป
                      // เพิ่มข้อความแจ้งเตือนใหม่ (appendAssistantNotice) พร้อมสั่งพิมพ์ทีละตัวซ้อนทับของเดิมที่
                      // ยังพิมพ์ไม่จบ ทำให้ข้อความเดิมค้างพิมพ์ไม่ครบไปตลอด) เหมือนกับช่องพิมพ์/ปุ่มส่ง/ปุ่มล้าง
                      // การสนทนาที่ปิดระหว่าง pending อยู่แล้วทุกจุด
                      disabled={pending}
                      className="btn-press flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
                      data-testid="assistant-suggestion-chip"
                    >
                      {suggestion.kind === 'navigate' ? (
                        <ArrowRight size={13} aria-hidden="true" />
                      ) : (
                        <Target size={13} aria-hidden="true" />
                      )}
                      {suggestion.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {/* จุดไข่ปลา "กำลังพิมพ์..." โชว์เฉพาะช่วงรอผลจริงๆ เท่านั้น (ยังไม่มีข้อความผู้ช่วยโผล่มาเลย) — พอข้อความ
            มาถึงและเริ่มทยอยพิมพ์ทีละตัว (typingMessageId ไม่ใช่ null แล้ว) ต้องซ่อนจุดไข่ปลานี้ทันที ไม่งั้นจะ
            เห็นทั้งจุดไข่ปลาและข้อความที่กำลังพิมพ์ซ้อนกันพร้อมกัน — pending ยังคงเป็น true ต่อไปตลอดช่วงพิมพ์ทีละ
            ตัว (ปลดจริงตอน onTypingDone เท่านั้น) แต่ตัวบ่งชี้ "กำลังพิมพ์" ที่ผู้ใช้เห็นได้เปลี่ยนจากจุดไข่ปลา
            ไปเป็นตัวข้อความที่ทยอยโผล่เองแทนแล้ว */}
        {pending && !typingMessageId && (
          <div
            data-testid="assistant-pending-indicator"
            className="mr-auto flex items-center gap-2 rounded-2xl rounded-bl-sm bg-white/8 px-3.5 py-2.5 text-sm text-text-sub"
          >
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            กำลังพิมพ์...
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-none items-center gap-2 border-t border-border p-3">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder="พิมพ์คำถาม..."
          disabled={pending}
          aria-label="พิมพ์คำถามถึงผู้ช่วย"
          data-testid="assistant-input"
          className="focus-ring-primary h-11 min-w-0 flex-1 rounded-xl border border-border bg-white/5 px-3.5 text-sm text-text placeholder:text-text-sub disabled:opacity-60"
        />
        <button
          // ตั้งใจไม่ใช้ type="submit" (2026-07-19 พบจาก e2e regression) — แผงนี้ mount ค้างไว้ทุกหน้ารวม
          // ถึง /login เสมอ (แม้ตอนปิด) ถ้าเป็น type="submit" ปุ่มนี้จะไปตรงกับ selector แบบกว้างๆ
          // `button[type="submit"]` ที่เทสต์เดิมของหน้า Login ใช้อยู่หลายจุด (e2e/auth.spec.ts,
          // e2e/loginDesign.spec.ts) ทำให้ selector เจอ 2 element พร้อมกัน (strict mode violation) ทั้งที่
          // ปุ่มนี้มองไม่เห็น/กดไม่ได้เลยตอนแผงปิดอยู่ (inert+pointer-events:none) — ใช้ type="button" +
          // onClick ตรงๆ แทน ส่วนการกด Enter ในช่องพิมพ์ยังกดส่งได้ตามปกติผ่าน <form onSubmit> ด้านบน
          // (ฟอร์มที่มีช่องข้อความเดียวและไม่มีปุ่ม submit เลย ยัง implicit-submit ตอนกด Enter ได้เองตาม
          // พฤติกรรมมาตรฐานของ HTML — มีเทสต์ยืนยันไว้ใน e2e/assistant.spec.ts)
          type="button"
          onClick={onSend}
          disabled={pending || !inputValue.trim()}
          aria-label="ส่งข้อความ"
          data-testid="send-assistant-message"
          className="btn-press flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-primary text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? (
            <Loader2 size={18} className="animate-spin" aria-hidden="true" />
          ) : (
            <Send size={18} aria-hidden="true" />
          )}
        </button>
      </form>
    </div>
  );
}
