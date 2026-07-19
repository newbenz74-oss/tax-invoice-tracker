'use client';

import type { Ref } from 'react';
import ChromaKeyAvatar from './ChromaKeyAvatar';

const GREETING_TOOLTIP = 'มีอะไรให้ช่วยไหมคะ?';
const AVATAR_LABEL = 'ACC Reconcile AI Copilot';

interface AssistantBubbleProps {
  isOpen: boolean;
  onToggle: () => void;
  /** React 19 รับ ref เป็น prop ธรรมดาได้เลย ไม่ต้องพึ่ง forwardRef แล้ว (โปรเจกต์นี้ไม่มี forwardRef ใช้
   * งานที่ไหนเลย ยืนยันว่าไม่ได้ตั้งใจรองรับ React รุ่นเก่ากว่านี้) ใช้ทำ focus-restore ตอนปิด panel — ดู
   * AssistantRoot.tsx */
  ref?: Ref<HTMLButtonElement>;
}

/**
 * ปุ่มลอย (floating trigger) ของผู้ช่วย AI — แสดงทุกหน้าตั้งแต่ /login เป็นต้นไป (mount ครั้งเดียวจาก
 * components/AssistantRoot.tsx ที่ root layout) กดสลับเปิด/ปิด AssistantPanel เท่านั้น ไม่มี logic อื่นเลย
 * (state เปิด/ปิดจริงอยู่ที่ AssistantRoot) ขนาดปรับตาม breakpoint: 64px (มือถือ) → 72px (md, 768px) →
 * 88px (min-[992px], breakpoint จอใหญ่จริงของแอปนี้ — ดู Sidebar.tsx ใช้ค่าเดียวกัน) เงาเรืองแสงใช้ค่า
 * shadow-[0_0_14px_1px_rgba(47,167,226,0.5)] เดิมเป๊ะ (เหมือนปุ่มเมนูที่ active ใน Sidebar.tsx ไม่ได้คิด
 * สูตรใหม่) z-[70] สูงกว่าทุกอย่างที่มีอยู่เดิมในระบบ (ค่าสูงสุดเดิมคือ z-[60] ใน ContactsPage.tsx)
 */
export default function AssistantBubble({ isOpen, onToggle, ref }: AssistantBubbleProps) {
  return (
    <div className="fixed right-4 bottom-4 z-[70] sm:right-6 sm:bottom-6">
      <button
        ref={ref}
        type="button"
        onClick={onToggle}
        aria-label={isOpen ? `ปิดผู้ช่วย ${AVATAR_LABEL}` : `เปิดผู้ช่วย ${AVATAR_LABEL}`}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        data-testid="assistant-bubble"
        className="btn-press group relative flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-card-bg shadow-[0_0_14px_1px_rgba(47,167,226,0.5)] md:h-[72px] md:w-[72px] min-[992px]:h-[88px] min-[992px]:w-[88px]"
      >
        <ChromaKeyAvatar className="h-full w-full rounded-full" />

        {/* Tooltip: แสดงตอน hover เท่านั้น (ไม่ใช่ตอน panel เปิดอยู่แล้ว — ไม่มีประโยชน์ซ้ำซ้อน) เป็นแพทเทิร์น
            ใหม่ในระบบนี้ (ยังไม่มี tooltip แบบ custom ที่ไหนมาก่อน) ใช้ CSS transition ธรรมดาล้วนๆ ไม่มี JS
            state เพิ่ม — prefers-reduced-motion ที่ครอบคลุมทั้งระบบใน globals.css จัดการ transition-duration
            ให้อัตโนมัติอยู่แล้ว */}
        {!isOpen && (
          <span
            role="tooltip"
            className="card-surface pointer-events-none absolute right-0 bottom-full mb-2 hidden max-w-[180px] rounded-lg px-3 py-1.5 text-xs whitespace-normal text-text opacity-0 transition-opacity duration-200 group-hover:opacity-100 sm:block"
          >
            {GREETING_TOOLTIP}
          </span>
        )}
      </button>
    </div>
  );
}
