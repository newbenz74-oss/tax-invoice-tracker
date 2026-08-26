'use client';

import { useState } from 'react';
import { currentBuddhistYear, formatBuddhistDateInput, parseBuddhistDateInput } from '@/lib/thaiDate';

interface BuddhistDateInputProps {
  /** ค่า ISO ค.ศ. (YYYY-MM-DD) หรือ '' — รูปแบบเดียวกับที่ <input type="date"> เดิมใช้ทุกประการ เพื่อไม่ต้อง
   * แก้โค้ดฝั่ง state/validation/ส่งขึ้น API ที่เรียกใช้อยู่เดิมเลยสักจุด แค่เปลี่ยนตัว input เอง */
  value: string;
  onChange: (iso: string) => void;
  /** สร้าง className ของ <input> ตามสไตล์ของแต่ละไฟล์ (inputClass()/inlineInputClass ที่มีอยู่เดิมในแต่ละ
   * ไฟล์) รับ hasError รวม (ทั้ง error จากภายนอกที่ส่งมาผ่าน props.hasError และ error ของช่องนี้เอง เช่น
   * รูปแบบผิด/ปีดูเหมือน ค.ศ.) ไปตัดสินใจเลือกสีขอบให้เอง เหมือนที่ทุกไฟล์ทำกับ input ธรรมดาอยู่แล้ว — ส่ง
   * helper เดิมของแต่ละไฟล์เข้ามาตรงๆ ได้เลย (เช่น buildClassName={inputClass}) */
  buildClassName: (hasError: boolean) => string;
  /** error จาก validation ภายนอก (เช่น "required" ที่เช็คตอนกด submit) — ใช้ร่วมกับ error ของช่องนี้เองแค่
   * เพื่อตัดสินสีขอบเท่านั้น ไม่ได้แทนที่ข้อความ error ที่ผู้เรียกแสดงเองอยู่แล้ว (เช่นผ่าน Field) */
  hasError?: boolean;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  testId?: string;
}

/**
 * ช่องกรอกวันที่แบบ วว/ดด/ปปปป รับ "ปี พ.ศ." ตรงๆ (ไม่ใช่ ค.ศ.) — ใช้แทน <input type="date"> ธรรมดาทั่วทั้ง
 * ระบบ (เพิ่มเข้ามา 2026-08-18 ตามคำขอผู้ใช้ "ตรวจสอบดูให้หน่อยว่าตรงไหนที่บันทึกปีเป็น ค.ศ. ... แก้ไขให้
 * การบันทึกทั้งระบบเป็น พ.ศ." — ต้นตอคือ input type="date" ของเบราว์เซอร์ตีความปีที่พิมพ์เป็น ค.ศ. เสมอ พิมพ์
 * "2569" ตรงๆ จะกลายเป็นปี ค.ศ. 2569 จริง ไม่ใช่แปลงจาก พ.ศ. ให้ — ปัญหานี้เจอและแก้ไปแล้วครั้งหนึ่งเฉพาะช่อง
 * "วันที่ออกใบ" ของ IssueWhtCertificateModal.tsx (2026-08-17) ตอนนี้ดึง logic เดียวกันมาเป็น component กลาง
 * ใช้ร่วมกันทั้งระบบแทน ดู lib/thaiDate.ts สำหรับฟังก์ชัน format/parse ที่ใช้จริง)
 *
 * เก็บ buffer ข้อความที่พิมพ์ไว้ในตัวเอง (ไม่ใช่ controlled แบบเต็มจาก value โดยตรง) เพราะระหว่างพิมพ์ค่าอาจยัง
 * ไม่ใช่วันที่ที่สมบูรณ์ (เช่นพิมพ์ "17/08/" ค้างไว้) — onChange(iso) จะถูกเรียกก็ต่อเมื่อข้อความที่พิมพ์ครบ
 * รูปแบบและเป็นวันที่จริงเท่านั้น (เหมือน parent เดิมของ IssueWhtCertificateModal.tsx ทุกประการ) พิมพ์ช่องว่าง
 * ล้วนๆ (ลบข้อความจนหมด) จะเรียก onChange('') ทันทีเพื่อให้ validation "required" ภายนอกยังจับได้ถูกต้อง
 *
 * หมายเหตุ: ไม่มี useEffect sync ค่า value กลับเข้า buffer เพราะทุกจุดที่ใช้ component นี้ในระบบนี้ (ตรวจสอบ
 * แล้วทั้งหมด — InvoiceForm.tsx/IssueWhtCertificateModal.tsx mount ใหม่ผ่าน key ตอนเปลี่ยนรายการที่แก้ไข,
 * InvoiceTable.tsx/OverdueMonthDetail.tsx render modal/ฟอร์ม inline แบบ conditional ที่ mount ใหม่ทุกครั้งที่
 * เปิดรายการอื่น) ไม่มีเคสที่ต้อง sync ค่าจากภายนอกระหว่าง mount เดิมค้างอยู่เลย — ถ้าจุดใช้งานในอนาคตไม่เป็น
 * แบบนี้ (เช่น controlled fully จาก parent ที่ re-render โดยไม่ remount) ต้องเพิ่ม useEffect sync เองที่จุดนั้น
 *
 * ปีที่พิมพ์ต้อง >= 2200 เสมอ (ดู GREGORIAN_LOOKING_YEAR_MAX ใน lib/thaiDate.ts) ไม่งั้นถือว่า "ดูเหมือน ค.ศ."
 * (เช่นพิมพ์ 2026 แทนที่จะเป็น 2569) แสดงคำเตือนแทนที่จะเงียบยอมรับแล้วแปลงเป็นปีที่ผิดเพี้ยนไปเลย
 */
export default function BuddhistDateInput({
  value,
  onChange,
  buildClassName,
  hasError,
  placeholder = 'วว/ดด/ปปปป',
  id,
  disabled,
  testId,
}: BuddhistDateInputProps) {
  const [text, setText] = useState(() => formatBuddhistDateInput(value));
  const result = parseBuddhistDateInput(text);
  const hasFormatError = text.trim() !== '' && result.iso === null && !result.looksLikeGregorian;
  const ownError = hasFormatError || result.looksLikeGregorian;

  function handleChange(next: string) {
    setText(next);
    if (next.trim() === '') {
      onChange('');
      return;
    }
    const parsed = parseBuddhistDateInput(next);
    if (parsed.iso) onChange(parsed.iso);
  }

  // ตอนออกจากช่อง (blur) — ถ้าพิมพ์ไม่ครบ/ผิดรูปแบบ/ปีดูเหมือน ค.ศ. ให้แสดงค่า value ล่าสุดที่ถูกต้องกลับคืน
  // แทน (ไม่ปล่อยให้ช่องค้างข้อความขยะ) ถ้าพิมพ์ถูกต้อง ให้จัดรูปแบบใหม่ให้เรียบร้อย (เติมเลข 0 นำหน้าให้ครบ
  // เช่น "7/8/2569" -> "07/08/2569")
  function handleBlur() {
    const parsed = parseBuddhistDateInput(text);
    setText(formatBuddhistDateInput(parsed.iso ?? value));
  }

  return (
    <div>
      <input
        type="text"
        inputMode="numeric"
        id={id}
        placeholder={placeholder}
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        disabled={disabled}
        className={buildClassName(Boolean(hasError) || ownError)}
        data-testid={testId}
      />
      {result.looksLikeGregorian && (
        <p className="mt-1 text-xs text-danger">
          ปีนี้ดูเหมือนเป็น ค.ศ. โปรดบันทึกเป็นปี พ.ศ. (เช่น {currentBuddhistYear()})
        </p>
      )}
      {hasFormatError && <p className="mt-1 text-xs text-danger">รูปแบบไม่ถูกต้อง กรุณากรอกเป็น วว/ดด/ปปปป</p>}
    </div>
  );
}
