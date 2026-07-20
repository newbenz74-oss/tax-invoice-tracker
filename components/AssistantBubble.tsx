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
 * (state เปิด/ปิดจริงอยู่ที่ AssistantRoot) ขนาดปรับตาม breakpoint: 128px (มือถือ) → 144px (md, 768px) →
 * 176px (min-[992px], breakpoint จอใหญ่จริงของแอปนี้ — ดู Sidebar.tsx ใช้ค่าเดียวกัน) — ทั้ง 3 ค่าเป็น 2 เท่า
 * ของขนาดเดิม (64/72/88px) ตามที่ผู้ใช้ขอ (2026-07-19) ตำแหน่ง (right/bottom margin) ไม่เปลี่ยน มีแค่ตัวกล่อง
 * ปุ่มเองที่ใหญ่ขึ้น — ดูคอมเมนต์คู่กันใน AssistantPanel.tsx ที่ปรับ bottom offset ของแผงแชทตามไปด้วย เพราะ
 * เดิมตั้งใจให้ขอบบนของปุ่มชนกับขอบล่างของแผงพอดี (ไม่ทับกัน ไม่เว้นช่องว่างเกินจำเป็น)
 *
 * เดิมมีเงาเรืองแสงสีฟ้า shadow-[0_0_14px_1px_rgba(47,167,226,0.5)] (ค่าเดียวกับปุ่มเมนูที่ active ใน
 * Sidebar.tsx) แต่ผู้ใช้ขอเอาออก (2026-07-19 หลังเห็นบน production จริงบนขนาด 2 เท่าแล้วรู้สึกว่าวงแหวนสีฟ้า
 * รอบหน้าเด่นเกินไป อยากให้เห็นแค่หน้าอวตารเฉยๆ) — ตัดออกไปรอบแรกแล้วเหลือ border border-white/10 +
 * bg-card-bg เป็นกรอบวงกลมเรียบๆ แทน แต่ผู้ใช้บอกต่อว่ายังไม่เอากรอบวงกลมเลย (ต้องการแค่ตัวอวตารลอยๆ ไม่มี
 * พื้นหลัง/เส้นขอบใดๆ ล้อมรอบเลย) จึงตัด border + bg-card-bg ออกทั้งคู่ด้วย (2026-07-19 เช่นกัน) เหลือแค่
 * `rounded-full` ไว้เฉยๆ (ไม่มีผลทางภาพแล้วเพราะไม่มี fill/border ให้ปัดมุม แต่ยังมีประโยชน์เป็น shape ของ
 * focus outline เริ่มต้นตอน Tab โฟกัสมาที่ปุ่มนี้ — เบราว์เซอร์ส่วนใหญ่วาด outline ตาม border-radius ของ
 * element) เนื้อหาที่เห็นจริงๆ คือวิดีโอ/ภาพที่ผ่าน chroma-key มาแล้วเท่านั้น (พื้นหลังโปร่งใสอยู่แล้วในตัว
 * ไฟล์เอง ไม่ใช่การ clip ด้วย CSS) — ดู ChromaKeyAvatar.tsx
 *
 * z-[45] (2026-07-19 ปรับลดจาก z-[70] เดิมวันเดียวกัน ตอนขยายปุ่มเป็น 2 เท่า) — ตั้งใจให้อยู่ "ต่ำกว่า" ทุก
 * modal/dialog จริงในระบบ (ทั้งหมดใช้ z-50 หรือ z-[60] — ดู ContactForm/InvoiceForm/BankReconcileSaveDialog/
 * OverdueInvoiceDetailModal/ContactsPage ยืนยัน grep แล้ว) แต่ยังสูงกว่าเนื้อหาปกติของหน้า (ไม่มี z-index)
 * และสูงกว่า overlay ของ Sidebar บนมือถือ (z-40) หลังขยายขนาดเป็น 2 เท่าแล้วพบว่าปุ่มลอย/แผงแชทเดิมที่ z-[70]
 * (สูงกว่าทุกอย่างรวมถึง modal ด้วย) ไปทับปุ่ม "บันทึก" ของฟอร์ม "เพิ่มรายชื่อ" จริงบนความละเอียดจอ 1280×720
 * (พิสูจน์ด้วย boundingBox() จริง — ปุ่มบันทึกอยู่ x:1082-1186,y:637-679 ปุ่มลอยอยู่ x:1112-1256,y:552-696
 * ทับกันสนิทตรงกึ่งกลางปุ่มบันทึกพอดี ทำให้คลิกไม่โดนปุ่มบันทึกเลยแต่ไปโดนปุ่มลอยแทน) ลดจาก z-[70] เป็น z-[45]
 * แก้ปัญหานี้ที่ต้นตอเดียว (แทนที่จะไล่แก้ทุก modal ที่อาจชนในอนาคต) เพราะตอนนี้ backdrop ทึบของ modal ใดๆ
 * (bg-black/40 เต็มจอ) จะไปวาดทับปุ่มลอย/แผงแชทเองแทน (ซ่อนไปโดยอัตโนมัติตราบใดที่ modal เปิดอยู่ — ผู้ใช้ปิด
 * modal ก่อนถึงจะกลับมาใช้ผู้ช่วยต่อได้ ซึ่งสมเหตุสมผลอยู่แล้วเพราะระหว่างกรอกฟอร์ม/ยืนยันอะไรสักอย่างไม่ควรมี
 * อะไรมาบังหรือแย่งคลิกได้เลย)
 */
export default function AssistantBubble({ isOpen, onToggle, ref }: AssistantBubbleProps) {
  return (
    <div className="fixed right-4 bottom-4 z-[45] sm:right-6 sm:bottom-6">
      <button
        ref={ref}
        type="button"
        onClick={onToggle}
        aria-label={isOpen ? `ปิดผู้ช่วย ${AVATAR_LABEL}` : `เปิดผู้ช่วย ${AVATAR_LABEL}`}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        data-testid="assistant-bubble"
        className="btn-press group relative flex h-32 w-32 items-center justify-center rounded-full md:h-[144px] md:w-[144px] min-[992px]:h-[176px] min-[992px]:w-[176px]"
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
