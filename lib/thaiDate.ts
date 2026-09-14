// Utility กลางสำหรับชื่อเดือนไทยและปี พ.ศ. — เดิม THAI_MONTHS/formatMonthLabel อยู่ใน
// components/MonthlyVatSummary.tsx ไฟล์เดียว ย้ายมารวมไว้ที่นี่เพื่อให้ dropdown
// "เดือน/ปีที่ใช้เครดิต VAT" (มาร์คได้รับแล้ว) และตัวกรองของหน้ารายงานภาษีซื้อ/ภาษีขาย ใช้ร่วมกันได้
// โดยไม่ต้องประกาศซ้ำ — MonthlyVatSummary.tsx ยังทำงานเหมือนเดิมทุกประการ แค่ import จากที่นี่แทน

export const THAI_MONTHS = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
] as const;

/** ชื่อเดือนไทยจากเลขเดือน (1-12) — คืน '-' ถ้าเลขเดือนไม่ถูกต้อง */
export function thaiMonthName(month: number): string {
  return THAI_MONTHS[month - 1] ?? '-';
}

/** แปลง 'YYYY-MM' (เช่นจาก computeMonthlyVatSummary/groupOverdueByMonth) ให้เป็น "เดือน ปี" ภาษาไทย —
 * แสดงเป็นปี พ.ศ. เสมอ (แก้ไข 2026-08-18 ตามคำขอผู้ใช้ "แก้ไขให้การบันทึกทั้งระบบเป็น พ.ศ." — เดิมฟังก์ชันนี้
 * แสดงปีตามปฏิทิน ค.ศ. ตรงๆ ทำให้หน้า "สรุปยอด VAT รายเดือน"/"ภาษีซื้อที่ยังไม่ได้รับ" ที่ใช้ฟังก์ชันนี้แสดง
 * ปีไม่ตรงกับที่อื่นในระบบซึ่งเป็น พ.ศ. หมด สร้างความสับสนตามที่ผู้ใช้แจ้ง) month ที่รับเข้ายังเป็น 'YYYY-MM'
 * แบบ ค.ศ. เหมือนเดิมทุกประการ (เป็นแค่ key ภายในสำหรับจัดกลุ่ม/เรียงลำดับ ไม่ได้แสดงตรงๆ) แปลงเฉพาะตอนแสดงผล
 * เป็นข้อความเท่านั้น */
export function formatMonthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${thaiMonthName(m)} ${y + BUDDHIST_YEAR_OFFSET}`;
}

const BUDDHIST_YEAR_OFFSET = 543;

/** ปี พ.ศ. ปัจจุบัน (จากวันที่เครื่อง) */
export function currentBuddhistYear(): number {
  return new Date().getFullYear() + BUDDHIST_YEAR_OFFSET;
}

/** เดือนปัจจุบัน (1-12) */
export function currentMonth(): number {
  return new Date().getMonth() + 1;
}

/** ตัวเลือกปี พ.ศ. สำหรับ dropdown "ปีที่ใช้เครดิต VAT" — ปีปัจจุบัน ± rangeYears เรียงล่าสุดขึ้นก่อน
 * (การขอคืน/เครดิตภาษีซื้อมักอยู่ในช่วงปีปัจจุบันหรือใกล้เคียงเท่านั้น ค่าเริ่มต้น ±2 ปีเผื่อกรณีย้อนแก้ไข) */
export function buddhistYearOptions(rangeYears: number = 2): number[] {
  const current = currentBuddhistYear();
  const years: number[] = [];
  for (let y = current + 1; y >= current - rangeYears; y--) years.push(y);
  return years;
}

/* ==============================================================================================
 * ช่องกรอกวันที่แบบ วว/ดด/ปปปป รับปี พ.ศ. ตรงๆ (ย้ายมาจาก components/IssueWhtCertificateModal.tsx,
 * 2026-08-18 ตามคำขอผู้ใช้ "ตรวจสอบดูให้หน่อยว่าตรงไหนที่บันทึกปีเป็น ค.ศ. ... แก้ไขให้การบันทึกทั้งระบบเป็น
 * พ.ศ." — ต้นตอเดิมของปัญหา: <input type="date"> ของเบราว์เซอร์รับ/แสดงปีเป็น ค.ศ. เสมอ พิมพ์ "2569" ตรงๆ
 * เข้าไปในช่องนั้นจะกลายเป็นปี ค.ศ. 2569 จริง (ไม่ใช่แปลงจาก พ.ศ. ให้) ทำให้ผู้ใช้ที่เคยชินกับการพิมพ์ปี พ.ศ.
 * บันทึกวันที่ผิดเพี้ยนไปโดยไม่รู้ตัว — ฟังก์ชันกลุ่มนี้เดิมมีแค่ในช่อง "วันที่ออกใบ" ของ
 * IssueWhtCertificateModal.tsx จุดเดียว (แก้ไปแล้ว 2026-08-17) ย้ายมารวมไว้ที่นี่เพื่อให้
 * components/BuddhistDateInput.tsx เรียกใช้ร่วมกันได้ทั่วทั้งระบบแทนที่ <input type="date"> เดิมทุกจุด
 * ==============================================================================================
 */

/** จำนวนวันของเดือน/ปี (ค.ศ.) ที่ระบุ — ใช้ตรวจว่าวันที่ที่พิมพ์เข้ามาใน parseBuddhistDateInput ด้านล่างมีอยู่
 * จริงไหม (เช่น 31 กุมภาพันธ์ ไม่มีจริง) new Date(year, month, 0) คือ trick มาตรฐานของ JS ที่ได้วันสุดท้ายของ
 * เดือนก่อนหน้า (month ที่ส่งเข้าเป็น 1-12 ปกติ ไม่ใช่ 0-11 แบบ Date API เพราะ "day 0 ของเดือนถัดไป" =
 * "วันสุดท้ายของเดือนนี้") */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** จัดรูปแบบ ISO ค.ศ. (YYYY-MM-DD) ให้เป็นข้อความ วว/ดด/ปปปป (ปี พ.ศ.) สำหรับแสดงในช่องกรอกวันที่ทั่วระบบ —
 * คู่กับ parseBuddhistDateInput ด้านล่าง (แปลงกลับทิศทางตรงข้าม) คืนค่าว่างถ้า iso ว่าง/รูปแบบผิด */
export function formatBuddhistDateInput(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y + BUDDHIST_YEAR_OFFSET}`;
}

/**
 * จัดรูปแบบ ISO ค.ศ. (YYYY-MM-DD) เป็น วว/ดด/ปปปป **ปี พ.ศ.** สำหรับ "แสดงผล" ทุกจุดในระบบ
 * (ตาราง การ์ด modal รายงาน และไฟล์ Excel/PDF ที่ส่งออก)
 *
 * เพิ่มเข้ามา 2026-09-14 หลังผู้ใช้แจ้งว่า "พิมพ์ พ.ศ. 2569 แต่พอกดบันทึกกลายเป็น 2026" — สาเหตุคือทั้งระบบ
 * มีฟังก์ชัน formatDate/formatDateDisplay/formatDateForExport ที่เขียนซ้ำกันเองถึง 14 ที่ และทุกที่พิมพ์ปี
 * จาก ISO ออกมาตรงๆ โดยไม่บวก 543 กลับ ผลคือ **ข้อมูลในฐานข้อมูลถูกต้องเสมอ** (2569 ถูกแปลงเป็น 2026 ตอน
 * บันทึกอย่างถูกต้องแล้ว) แต่ตอนแสดงผลกลับโชว์ ค.ศ. ซึ่งขัดกับช่องกรอกที่รับเป็น พ.ศ. อย่างเดียว
 *
 * แก้ที่ต้นทางด้วยฟังก์ชันกลางตัวเดียวแทนการไล่บวก 543 ทีละไฟล์ เพื่อไม่ให้เกิดปัญหาเดิมซ้ำอีกตอนมีหน้าใหม่
 * — ฟังก์ชันเดิมทั้ง 14 ที่ถูกเปลี่ยนให้เรียกตัวนี้ต่อ (คงชื่อเดิมไว้ ไม่ต้องแก้จุดที่เรียกใช้เลยสักจุด)
 *
 * ต่างจาก formatBuddhistDateInput ด้านบนตรงที่ตัวนั้นใช้กับ "ช่องกรอก" (คืนค่าว่างเมื่อไม่มีข้อมูล เพื่อให้
 * ช่องว่างจริงๆ) ส่วนตัวนี้ใช้กับ "การแสดงผล" (คืน '-' เพื่อให้ตารางไม่มีช่องโหว่ว่างๆ ที่ดูเหมือนระบบพัง)
 */
export function formatThaiDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-').map(Number);
  // รูปแบบไม่ใช่ ISO ที่คาดไว้ — คืนค่าเดิมดิบๆ ดีกว่าคืน '-' เพราะอย่างน้อยผู้ใช้ยังเห็นว่าข้อมูลจริงคืออะไร
  if (!y || !m || !d) return iso;
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y + BUDDHIST_YEAR_OFFSET}`;
}

/** เกณฑ์แยกว่าปีที่พิมพ์เข้าช่องกรอกวันที่แบบ พ.ศ. "ดูเหมือน" เป็น ค.ศ. ที่พิมพ์ผิดมาแทน — เดิม
 * parseBuddhistDateInput ไม่เคยเช็คจุดนี้เลย พิมพ์ปี ค.ศ. เข้ามาตรงๆ (เช่น "17/08/2026") จะถูกลบ 543 เงียบๆ
 * กลายเป็น พ.ศ. 1483 (ค.ศ. 940) ผิดเพี้ยนไปไกลมากโดยไม่มีการเตือนอะไรเลย ปี พ.ศ. ของเอกสารธุรกิจทั่วไป (อดีต
 * ไม่กี่ปี ถึงอนาคตไม่กี่ปีจากวันนี้) จะอยู่แถวๆ 2560 ขึ้นไปเสมอ ส่วนปี ค.ศ. ที่พิมพ์ผิดมาแทนจะอยู่แถวๆ
 * 1900-2100 เสมอ ห่างกันมากพอที่จะใช้ 2200 ตัดแบ่งได้ปลอดภัยโดยไม่ชนของจริงฝั่งไหนเลย (ปี พ.ศ. 2200 = ค.ศ.
 * 1657 — เก่าเกินกว่าจะเป็นเอกสารธุรกิจจริงอยู่แล้ว) */
const GREGORIAN_LOOKING_YEAR_MAX = 2200;

export interface BuddhistDateParseResult {
  /** ISO ค.ศ. (YYYY-MM-DD) ถ้าพิมพ์ถูกต้องครบและเป็นวันที่จริง — null ถ้ายังพิมพ์ไม่ครบ/ผิดรูปแบบ/ไม่ใช่
   * วันที่จริง/ปีดูเหมือน ค.ศ. (ดู looksLikeGregorian) */
  iso: string | null;
  /** true = รูปแบบ วว/ดด/ปปปป ถูกต้อง แต่ปีที่พิมพ์ (< 2200) ดูเหมือนเป็น ค.ศ. ไม่ใช่ พ.ศ. จริง — ผู้เรียก
   * ควรแสดงคำเตือนเฉพาะ ("โปรดบันทึกเป็น พ.ศ.") แทนข้อความ "รูปแบบผิด" ทั่วไป ดูคอมเมนต์
   * GREGORIAN_LOOKING_YEAR_MAX ด้านบน */
  looksLikeGregorian: boolean;
}

/** แปลงข้อความ วว/ดด/ปปปป (ปี พ.ศ. ที่ผู้ใช้พิมพ์เอง) กลับเป็น ISO ค.ศ. (YYYY-MM-DD) — ตั้งใจไม่ยอมรับรูปแบบ
 * อื่นเลย (เช่น "17-08-2569" หรือพิมพ์ค้างไม่ครบ) เพื่อไม่ให้ตีความวันที่ผิดเพี้ยนแบบเงียบๆ ผู้เรียก (เช่น
 * components/BuddhistDateInput.tsx) จะไม่อัปเดตค่าจริงเลยถ้าฟังก์ชันนี้คืน iso เป็น null รอจนกว่าจะพิมพ์ครบ
 * รูปแบบที่ถูกต้อง */
export function parseBuddhistDateInput(text: string): BuddhistDateParseResult {
  const match = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return { iso: null, looksLikeGregorian: false };
  const d = Number(match[1]);
  const m = Number(match[2]);
  const typedYear = Number(match[3]);
  if (m < 1 || m > 12) return { iso: null, looksLikeGregorian: false };
  if (typedYear < GREGORIAN_LOOKING_YEAR_MAX) return { iso: null, looksLikeGregorian: true };
  const y = typedYear - BUDDHIST_YEAR_OFFSET;
  if (y < 1000) return { iso: null, looksLikeGregorian: false };
  if (d < 1 || d > daysInMonth(y, m)) return { iso: null, looksLikeGregorian: false };
  return {
    iso: `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    looksLikeGregorian: false,
  };
}
