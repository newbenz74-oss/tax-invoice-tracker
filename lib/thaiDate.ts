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

/** แปลง 'YYYY-MM' (เช่นจาก computeMonthlyVatSummary) ให้เป็น "เดือน ปี" ภาษาไทย
 * หมายเหตุ: YYYY ในที่นี้คือปีตามปฏิทินของ transaction_date (ค.ศ.) ไม่ใช่ พ.ศ. — คงพฤติกรรมเดิมไว้
 * ทุกประการ (ฟังก์ชันนี้ย้ายมาจาก MonthlyVatSummary.tsx โดยไม่เปลี่ยนแปลง logic) */
export function formatMonthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${thaiMonthName(m)} ${y}`;
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
