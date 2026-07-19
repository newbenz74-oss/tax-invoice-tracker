'use client';

import { useEffect, useRef, type FormEvent } from 'react';
import { ArrowRight, Loader2, Send, Target, Trash2, X } from 'lucide-react';
import ChromaKeyAvatar from './ChromaKeyAvatar';
import type { AssistantMessage, AssistantSuggestion } from '@/types/assistant';

const ASSISTANT_NAME = 'ACC Reconcile AI Copilot';
/** breakpoint เดียวกับที่ Sidebar.tsx ใช้จริง (min-[992px]:hidden ของ overlay มือถือ) — "มือถือ" ในระบบนี้
 * หมายถึงต่ำกว่า 992px เสมอ ไม่ใช่ค่า sm/md ทั่วไปของ Tailwind default */
const MOBILE_BREAKPOINT_QUERY = '(max-width: 991px)';

interface AssistantPanelProps {
  isOpen: boolean;
  messages: AssistantMessage[];
  pending: boolean;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onClear: () => void;
  onClose: () => void;
  onSuggestionClick: (suggestion: AssistantSuggestion) => void;
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
 */
export default function AssistantPanel({
  isOpen,
  messages,
  pending,
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

  // เลื่อนไปข้อความล่าสุดเสมอเมื่อมีข้อความใหม่/สถานะกำลังพิมพ์เปลี่ยน — ตั้ง scrollTop ตรงๆ (ไม่ใช้
  // scrollIntoView({behavior:'smooth'})) ตั้งใจให้ "เลื่อนทันที" เสมอโดยไม่ต้องแยกสาขา prefers-reduced-motion
  // เหมือน lib/assistantHighlight.ts เพราะเป็นแค่การเลื่อน scroll ภายในกล่องแชทเล็กๆ ไม่ใช่การเลื่อนทั้งหน้า
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages.length, pending]);

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
      className={`card-surface fixed inset-x-3 top-20 bottom-3 z-[70] flex flex-col overflow-hidden rounded-2xl sm:inset-x-auto sm:top-auto sm:right-6 sm:bottom-24 sm:h-[70vh] sm:max-h-[640px] sm:w-[380px] min-[992px]:right-8 min-[992px]:bottom-28 ${
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
        {messages.map((message) => (
          <div key={message.id} className="flex flex-col gap-1.5">
            <div
              data-testid={message.role === 'user' ? 'assistant-message-user' : 'assistant-message-assistant'}
              className={
                message.role === 'user'
                  ? 'ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2.5 text-sm whitespace-pre-wrap text-white'
                  : 'mr-auto max-w-[85%] rounded-2xl rounded-bl-sm bg-white/8 px-3.5 py-2.5 text-sm whitespace-pre-wrap text-text'
              }
            >
              {message.text}
            </div>
            {message.suggestions && message.suggestions.length > 0 && (
              <div className="mr-auto flex max-w-[85%] flex-wrap gap-1.5">
                {message.suggestions.map((suggestion, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => onSuggestionClick(suggestion)}
                    className="btn-press flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20"
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
        ))}
        {pending && (
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
