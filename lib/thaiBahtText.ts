/** แปลงจำนวนเงินเป็นคำอ่านภาษาไทย เช่น 42800 -> "สี่หมื่นสองพันแปดร้อยบาทถ้วน" — ใช้กับบรรทัดสรุปยอดบนใบหัก
 * ณ ที่จ่าย (PDF) ที่ต้องมีทั้งตัวเลขและตัวอักษรกำกับ ตามแบบฟอร์มราชการทั่วไป
 *
 * กฎการอ่านตัวเลขภาษาไทยที่ implement ตรงนี้:
 * - หลักหน่วย: เลข 1 อ่านเป็น "เอ็ด" ถ้ามีหลักอื่นอยู่ข้างหน้า (ไม่ใช่แค่เลข 1 โดดๆ)
 * - หลักสิบ: เลข 1 อ่าน "สิบ" เฉยๆ (ไม่ใช่ "หนึ่งสิบ"), เลข 2 อ่าน "ยี่สิบ" (ไม่ใช่ "สองสิบ")
 * - จัดกลุ่มทีละ 6 หลัก คั่นด้วย "ล้าน" (ถ้าเกินล้านไปอีกระดับ ซ้ำคำว่า "ล้าน" ตามจำนวนระดับ)
 */

const DIGIT_TEXT = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
// index = ตำแหน่งหลักนับจากขวา (0=หน่วย, 1=สิบ, 2=ร้อย, 3=พัน, 4=หมื่น, 5=แสน) ใช้กับ placeIndex >= 2 เท่านั้น
// (หลักหน่วยและหลักสิบมี logic พิเศษแยกต่างหากด้านล่าง)
const PLACE_TEXT = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

/** แปลงตัวเลขในกลุ่มเดียว (สูงสุด 6 หลัก) เป็นคำอ่าน — รับ string ดิบที่ยังไม่ตัด leading zero ออก เพราะ
 * ความยาว string ใช้กำหนดตำแหน่งหลัก (หมื่น/แสน ฯลฯ) ถ้าตัด leading zero ก่อนจะทำให้ตำแหน่งหลักเพี้ยน */
function convertChunk(chunkStr: string): string {
  const digits = chunkStr.split('').map(Number);
  const len = digits.length;
  let result = '';
  for (let i = 0; i < len; i++) {
    const digit = digits[i];
    if (digit === 0) continue;
    const placeIndex = len - i - 1;
    if (placeIndex === 0) {
      result += digit === 1 && len > 1 ? 'เอ็ด' : DIGIT_TEXT[digit];
    } else if (placeIndex === 1) {
      if (digit === 1) result += 'สิบ';
      else if (digit === 2) result += 'ยี่สิบ';
      else result += DIGIT_TEXT[digit] + 'สิบ';
    } else {
      result += DIGIT_TEXT[digit] + PLACE_TEXT[placeIndex];
    }
  }
  return result;
}

/** แปลงจำนวนเต็มไม่ติดลบเป็นคำอ่านภาษาไทย (ไม่มีคำว่า "บาท"/"สตางค์" ต่อท้าย ใช้ประกอบใน thaiBahtText()
 * หรือใช้แปลงตัวเลขจำนวนเต็มทั่วไปได้เอง) */
export function numberToThaiText(value: number): string {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new Error('numberToThaiText: ต้องเป็นจำนวนเต็มไม่ติดลบเท่านั้น');
  }
  if (value === 0) return 'ศูนย์';

  let numStr = String(value);
  const chunks: string[] = [];
  while (numStr.length > 0) {
    chunks.unshift(numStr.slice(-6));
    numStr = numStr.slice(0, -6);
  }

  const numChunks = chunks.length;
  let result = '';
  for (let i = 0; i < numChunks; i++) {
    const chunkText = convertChunk(chunks[i]);
    if (chunkText === '') continue;
    const millionLevels = numChunks - 1 - i;
    result += chunkText + 'ล้าน'.repeat(millionLevels);
  }
  return result;
}

/** แปลงจำนวนเงิน (บาท มีทศนิยมได้) เป็นคำอ่านเต็มรูปแบบ "...บาทถ้วน" หรือ "...บาท...สตางค์" ปัดเศษเป็นสตางค์
 * ก่อนแปลงเสมอ (กันปัญหา floating point เช่น 42800.1 - 42800 ได้ 0.09999...) รองรับเลขติดลบ (ขึ้นต้นด้วย "ลบ")
 * แม้ในทางปฏิบัติยอดเงินบนใบหัก ณ ที่จ่ายจะไม่ติดลบก็ตาม */
export function thaiBahtText(amount: number): string {
  const roundedSatang = Math.round(amount * 100);
  const negative = roundedSatang < 0;
  const absSatangTotal = Math.abs(roundedSatang);
  const baht = Math.floor(absSatangTotal / 100);
  const satang = absSatangTotal % 100;

  const bahtText = numberToThaiText(baht);
  const satangText = satang === 0 ? 'ถ้วน' : `${numberToThaiText(satang)}สตางค์`;

  const result = `${bahtText}บาท${satangText}`;
  return negative ? `ลบ${result}` : result;
}
