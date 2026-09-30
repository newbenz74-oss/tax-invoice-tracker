import type jsPDF from 'jspdf';
import type { TextOptionsLight } from 'jspdf';
import type { CellHookData } from 'jspdf-autotable';
import { SARABUN_BOLD_BASE64, SARABUN_REGULAR_BASE64 } from './pdfFonts';

/** ชื่อฟอนต์ที่ลงทะเบียนไว้กับ jsPDF — ใช้ชื่อนี้ทุกจุดที่ตั้งค่าฟอนต์ในเอกสาร PDF (ทั้งข้อความ
 * หัวเรื่องและตารางของ jspdf-autotable) เพื่อให้แสดงภาษาไทยได้ถูกต้อง */
export const THAI_FONT_NAME = 'Sarabun';

/**
 * ฝังฟอนต์ Sarabun (Regular + Bold) ลงในเอกสาร PDF ที่สร้างขึ้น — ต้องเรียกทันทีหลังสร้าง
 * `new jsPDF()` และก่อนวาดข้อความ/ตารางใดๆ เสมอ เพราะฟอนต์มาตรฐานที่มากับ jsPDF (helvetica,
 * times, courier) ไม่มีตัวอักษรไทยอยู่เลย จะแสดงผลเป็นช่องว่างหรือกล่องว่างแทนตัวอักษร
 */
export function registerThaiFont(doc: jsPDF): void {
  doc.addFileToVFS('Sarabun-Regular.ttf', SARABUN_REGULAR_BASE64);
  doc.addFont('Sarabun-Regular.ttf', THAI_FONT_NAME, 'normal');
  doc.addFileToVFS('Sarabun-Bold.ttf', SARABUN_BOLD_BASE64);
  doc.addFont('Sarabun-Bold.ttf', THAI_FONT_NAME, 'bold');
  doc.setFont(THAI_FONT_NAME, 'normal');
}

/**
 * Wrapper รอบ doc.getTextWidth() — ทดสอบแยกแล้วยืนยันว่า doc.getTextWidth() คืนค่าถูกต้องเป็น mm เหมือนกันทั้ง
 * โหมด "compat" ปกติและโหมด "advanced" (ตอนใช้ doc.advancedAPI() ร่วมกับ transformation matrix เช่น ตอนวาด
 * ใบหัก ณ ที่จ่ายย่อลงครึ่งหน้า A4 แนวนอน — ดู lib/whtCertificatePdf.ts renderTwoUpSheet()) ไม่มีบั๊กแบบเดียวกับ
 * doc.getLineHeight() (ดูคอมเมนต์ getLineHeightMm ด้านล่าง) — เก็บฟังก์ชันนี้ไว้เป็นจุดเดียวที่เรียก
 * doc.getTextWidth() ทั่วทั้งโปรเจกต์เพื่อความสม่ำเสมอ/ป้องกันบั๊กแบบนี้ในอนาคตถ้าพฤติกรรม jsPDF เปลี่ยนไป
 *
 * 2026-09-30: วัดซ้ำอีกรอบเพื่อตัดข้อสงสัยว่า doc.setFontSize(<ค่า pt ดิบ>) ในโหมด advanced จะทำให้ค่าที่ได้
 * พองผิด — ผลคือ "ไม่พอง" doc.getTextWidth('ของกำไรสุทธิ') ที่ 7pt ได้ 13.209058333 mm เท่ากันเป๊ะทั้งสองโหมด
 * (เพราะ setFontSize/getFontSize ของ jsPDF หารและคูณ scaleFactor กลับให้เองเมื่ออยู่โหมด advanced) สมมติฐาน
 * "x เพี้ยนเพราะ getTextWidth พองในโหมด advanced" จึงตกไป ตัวการจริงคือแกน Y ดู createThaiAutoTableHooks
 */
export function getTextWidthMm(doc: jsPDF, text: string): number {
  return doc.getTextWidth(text);
}

/** ดูคอมเมนต์ getTextWidthMm ด้านบน — เหตุผลเดียวกัน แต่ doc.getLineHeight() ผิดเพี้ยนไปคนละทิศ (ไม่ต้องคูณ
 * กลับด้วย scaleFactor อีกครั้งตอนโหมด advanced เพราะ activeFontSize ที่มันใช้คำนวณเก็บเป็นค่า mm-equivalent
 * ไว้แล้วในโหมดนั้น) */
export function getLineHeightMm(doc: jsPDF): number {
  const height = doc.getLineHeight();
  return doc.isAdvancedAPI() ? height : height / doc.internal.scaleFactor;
}

/** ขนาดฟอนต์ปัจจุบันเป็น mm — doc.getFontSize() คืนค่าเป็น "pt-equivalent" เหมือนกันทั้งสองโหมด (ยืนยันด้วยการ
 * วัดจริงแล้ว ดูคอมเมนต์ getTextWidthMm) จึงหารด้วย scaleFactor ได้ตรงๆ ไม่ต้องแยกเคสตามโหมด */
function getFontSizeMm(doc: jsPDF): number {
  return doc.getFontSize() / doc.internal.scaleFactor;
}

// สระบน (ลอยเหนือพยัญชนะ) ที่วรรณยุกต์ต้องซ้อนทับข้างบนอีกที — ั(ไม้หันอากาศ) ิ ี ึ ื ็(ไม้ไต่คู้)
// ไม่รวม ์(ทัณฑฆาต) เพราะไม่มีวรรณยุกต์ตามหลังในภาษาไทย
const THAI_UPPER_VOWELS = 'ัิีึื็';
// วรรณยุกต์ทั้ง 4 ตัว: ไม้เอก ไม้โท ไม้ตรี ไม้จัตวา — เดิมโค้ดชุดนี้จำกัดไว้เฉพาะไม้เอกตัวเดียว เพราะวิธีแก้เดิม
// คือ "วาดทับซ้ำอีกรอบให้สูงขึ้น" ซึ่งใช้ได้เฉพาะไม้เอก (ตัวเดิมที่วาดผิดที่ถูกสระบนบังมิดพอดี มองไม่เห็น) ส่วน
// ไม้โท/ตรี/จัตวาตัวเดิมยังโผล่ออกมานอกสระบนอยู่ ถ้าวาดซ้ำจะได้ภาพซ้อนสองตัว — รอบนี้เปลี่ยนวิธีเป็น "ถอดออก
// ก่อนวาด แล้วค่อยวางกลับให้ถูกที่" จึงครอบคลุมได้ครบทั้ง 4 ตัว
const THAI_TONE_MARKS = '่้๊๋';
const VOWEL_TONE_PATTERN = new RegExp(`[${THAI_UPPER_VOWELS}][${THAI_TONE_MARKS}]`);

// ระยะยกวรรณยุกต์ขึ้น (สัดส่วนของขนาดฟอนต์) เมื่อมีสระบนตัวนั้นๆ อยู่ข้างใต้ — ไม่ได้เดาหรือปรับด้วยตาล้วนๆ
// แต่วัดมาจาก "ของจริง": เรนเดอร์คู่ สระบน+วรรณยุกต์ ทั้ง 24 คู่ด้วย HarfBuzz (PIL + layout engine raqm ซึ่ง
// อ่านตาราง GPOS ของ Sarabun ได้ถูกต้อง) ที่ em = 200px แล้ววัดว่าตัววรรณยุกต์ถูกยกขึ้นกี่พิกเซลเทียบกับตอน
// ไม่มีสระบน ผลที่ได้แทบไม่ขึ้นกับว่าเป็นวรรณยุกต์ตัวไหน (ต่างกันไม่เกิน 1px จาก 200) แต่ขึ้นกับ "ความสูงของ
// สระบน" ชัดเจน จึงทำเป็นตารางต่อสระบน 1 ค่า ไม่ใช่ค่าเดียวใช้หมด (เคยลองค่าเดียว 0.3 ทั้งหมด — วรรณยุกต์บน
// ไม้ไต่คู้จะจมลงไปทับ ส่วนบนสระอิจะลอยสูงเกินจริงเล็กน้อย)
//
// หมายเหตุ: GPOS ของจริงยังขยับ "แนวนอน" ด้วยในบางคู่ (ื ขยับซ้าย 0.05em, ็ ขยับซ้าย 0.15em นอกนั้น ~0) แต่
// จงใจไม่ทำตาม เพราะการวาดวรรณยุกต์ที่ x น้อยกว่าตัวก่อนหน้าทำให้ตัวแยกข้อความ (poppler/pdftotext) เรียงลำดับ
// ตัวอักษรสลับกัน เช่น "ภาษีซื้อ" ถูกดึงออกมาเป็น "ภาษีซ้ ือ" — แลกความเนี้ยบระดับ 0.05em ซึ่งมองไม่เห็นที่
// ขนาดฟอนต์ 5-15pt กับการ copy/paste ที่ถูกต้องแล้วคุ้มกว่ามาก
const TONE_MARK_LIFT_BY_VOWEL: Record<string, number> = {
  'ั': 0.29,
  'ิ': 0.27,
  'ี': 0.315,
  'ึ': 0.31,
  'ื': 0.315,
  '็': 0.39,
};

/** ตำแหน่งของวรรณยุกต์ 1 ตัวที่ถูกถอดออกจากข้อความ — prefix คือข้อความส่วนหน้า "ของสตริงที่ถอดวรรณยุกต์ออก
 * แล้ว" จนถึงจุดที่ปากกาอยู่ตอนจะวาดวรรณยุกต์ตัวนี้ (เก็บเป็นสตริงแทนที่จะเป็นตัวเลข mm เพื่อให้ฟังก์ชันนี้เป็น
 * pure function ทดสอบได้โดยไม่ต้องมี jsPDF — ผู้เรียกเอาไปวัดความกว้างเองด้วย getTextWidthMm) */
export interface ThaiToneMarkPlacement {
  char: string;
  prefix: string;
  /** สระบนที่วรรณยุกต์ตัวนี้ซ้อนอยู่ข้างบน — ใช้เลือกระยะขยับจาก TONE_MARK_OFFSETS */
  vowel: string;
}

export interface ThaiToneMarkSplit {
  /** ข้อความที่ถอดวรรณยุกต์ที่มีปัญหาออกแล้ว — เอาไปวาดจริงแทนต้นฉบับ */
  text: string;
  /** วรรณยุกต์ที่ถอดออกมา เรียงตามลำดับที่ปรากฏ ว่างเปล่าถ้าข้อความนี้ไม่มีปัญหา */
  marks: ThaiToneMarkPlacement[];
}

/**
 * ถอด "วรรณยุกต์ที่ซ้อนอยู่บนสระบน" ออกจากข้อความ 1 บรรทัด พร้อมบอกตำแหน่งที่ต้องเอาไปวางคืน
 *
 * ที่ต้องทำแบบนี้เพราะ jsPDF ไม่อ่านตาราง GPOS ของฟอนต์เลย มันวาดตัวอักษรเรียงกันตาม advance width ล้วนๆ
 * วรรณยุกต์กับสระบนจึงถูกวาดที่ตำแหน่งปากกาเดียวกันเป๊ะ (ทั้งคู่ advance width = 0.0000 ยืนยันด้วย
 * doc.getTextWidth แล้วทุกตัวทุกขนาด) กลายเป็นก้อนทับกันอ่านไม่ออก เช่น "เบี้ยเลี้ยง"
 *
 * ปลอดภัยที่จะถอดออกเพราะ advance width = 0 → ถอดแล้วตัวอักษรอื่นไม่ขยับเลยแม้แต่นิดเดียว ความกว้างรวมของ
 * บรรทัดเท่าเดิม การตัดบรรทัด (splitTextToSize / autoTable linebreak) จึงไม่เปลี่ยนตามไปด้วย
 *
 * เคยลองวิธี "วาดข้อความปกติแล้ววาดวรรณยุกต์ซ้ำทับอีกทีให้สูงขึ้น" มาก่อน (ดูประวัติไฟล์นี้) — ใช้ไม่ได้จริง
 * เพราะตัวเดิมยังอยู่ ได้ภาพซ้อนสองตัวสำหรับ ้ ๊ ๋ (ไม้เอกตัวเดียวที่รอดเพราะถูกสระบนบังมิดพอดี) จึงต้อง
 * "ถอดออกก่อน" เท่านั้น
 */
export function splitThaiToneMarks(line: string): ThaiToneMarkSplit {
  if (!VOWEL_TONE_PATTERN.test(line)) return { text: line, marks: [] };

  let text = '';
  const marks: ThaiToneMarkPlacement[] = [];
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    // เช็คกับ text (สตริงที่ถอดแล้ว) ไม่ใช่ line เพราะถ้ามีวรรณยุกต์ซ้อนกันเองผิดรูป เช่น สระบน+วรรณยุกต์+
    // วรรณยุกต์ ตัวที่สองก็ยังต้องนับว่าซ้อนสระบนตัวเดิมอยู่ดี
    const prevChar = text[text.length - 1] ?? '';
    if (THAI_TONE_MARKS.includes(char) && THAI_UPPER_VOWELS.includes(prevChar)) {
      marks.push({ char, prefix: text, vowel: prevChar });
    } else {
      text += char;
    }
  }
  return { text, marks };
}

/**
 * วาดข้อความไทย 1 บรรทัดที่ baseline เดียว โดยชิดซ้ายจาก baseX เสมอ (ผู้เรียกคำนวณ align มาเองแล้ว) —
 * เป็นหัวใจของการแก้บั๊กทั้งไฟล์นี้ ใช้ร่วมกันทั้งทาง doc.text ปกติและทางเซลของ jspdf-autotable
 *
 * วิธีวาด: ตัดบรรทัดเป็นชิ้นๆ ตาม "ลำดับเดิมของตัวอักษร" แล้ววาดเรียงกันไปตามตำแหน่งปากกาที่คำนวณเอง —
 * ...ถึงสระบน → วรรณยุกต์ (ยกขึ้น) → ...ต่อ → วรรณยุกต์ (ยกขึ้น) → ...ที่เหลือ
 * ตำแหน่ง x ของแต่ละชิ้นคำนวณจากความกว้างสะสมของชิ้นก่อนหน้า จึงได้ภาพเหมือนวาดรวดเดียวทุกประการ
 *
 * ทำไมต้อง "เรียงตามลำดับเดิม" ไม่ใช่ "วาดข้อความที่ถอดวรรณยุกต์ออกรวดเดียวแล้วค่อยแปะวรรณยุกต์ทีหลัง":
 * เพราะเรื่อง text extraction (copy/paste, ค้นหา, pdftotext) — ตัวอักษรในไฟล์ PDF ต้องปรากฏครบถ้วนและเรียง
 * ลำดับเดิมจึงจะดึงข้อความกลับออกมาได้ตรงต้นฉบับ
 *
 * เคยลองวิธีที่ตรงไปตรงมากว่า: วาดข้อความที่ถอดวรรณยุกต์ออก (มองเห็น) + แปะวรรณยุกต์ทีหลัง + วาดข้อความ
 * "ต้นฉบับเต็ม" ซ้ำอีกรอบแบบ renderingMode:'invisible' ทับไว้ให้ extraction อ่านได้ — **ใช้ไม่ได้** ทดสอบ
 * ด้วย pdftotext กับไฟล์จริงแล้วได้วรรณยุกต์ซ้ำสองตัว เช่น "ที่จ่าย" กลายเป็น "ที่่จ่าย" (poppler รวมข้อความ
 * ที่ทับกันสนิทให้ก็จริง แต่วรรณยุกต์ที่แปะแยกไม่ได้ทับสนิทกับตัวไหน จึงถูกนับเพิ่มมาอีกตัว) วิธีวาดเรียงตาม
 * ลำดับนี้ไม่มีตัวอักษรซ้ำเลยแม้แต่ตัวเดียว ยืนยันด้วย pdftotext แล้วว่าได้ข้อความตรงต้นฉบับทุกบรรทัด
 */
function drawThaiLine(doc: jsPDF, line: string, baseX: number, baselineY: number, options?: TextOptionsLight): void {
  const { text, marks } = splitThaiToneMarks(line);
  if (marks.length === 0) {
    doc.text(line, baseX, baselineY, options);
    return;
  }

  const fontSizeMm = getFontSizeMm(doc);
  let drawn = '';
  for (const mark of marks) {
    const segment = mark.prefix.slice(drawn.length);
    if (segment) {
      doc.text(segment, baseX + getTextWidthMm(doc, drawn), baselineY, options);
      drawn = mark.prefix;
    }
    const lift = TONE_MARK_LIFT_BY_VOWEL[mark.vowel];
    doc.text(mark.char, baseX + getTextWidthMm(doc, drawn), baselineY - lift * fontSizeMm, options);
  }
  const tail = text.slice(drawn.length);
  if (tail) doc.text(tail, baseX + getTextWidthMm(doc, drawn), baselineY, options);
}

/**
 * ใช้แทน doc.text() ได้ทุกจุด (เป็น superset: ถ้าข้อความไม่มีคู่ "สระบน+วรรณยุกต์" เลย ก็วาดเหมือน doc.text()
 * ทุกประการ) — จัดการบั๊กวรรณยุกต์ซ้อนสระบนของ jsPDF ให้ในตัว ดูคอมเมนต์ splitThaiToneMarks
 */
export function drawThaiText(doc: jsPDF, text: string | string[], x: number, y: number, options?: TextOptionsLight): void {
  const lines = Array.isArray(text) ? text : [text];
  const splits = lines.map(splitThaiToneMarks);
  const align = options?.align;
  const needsManualAlign = align === 'center' || align === 'right';

  // สำคัญ: doc.text() ที่ align:'center'/'right' ของ jsPDF คำนวณตำแหน่งจริงภายในผิดเพี้ยนไป (เลื่อนซ้าย/ขวา
  // ไกลมาก ไม่ตรงกับสูตร x - lineWidth/2 มาตรฐาน) เมื่ออยู่ในโหมด doc.advancedAPI() ร่วมกับ transformation
  // matrix (ใช้ตอนวาดใบหัก ณ ที่จ่ายย่อลงครึ่งหน้า A4 แนวนอน — ดู lib/whtCertificatePdf.ts renderTwoUpSheet())
  // *และ* มี doc.text() อื่นถูกเรียกมาก่อนหน้าในบริบทเดียวกันอย่างน้อย 1 ครั้ง (ยืนยันด้วยการไอโซเลตทดสอบทีละ
  // ขั้นแล้ว: เรียกครั้งแรกครั้งเดียวไม่เป็นบั๊ก แต่พอมี doc.text() ก่อนหน้าแม้แค่ 1 ครั้ง — ไม่ว่าจะเป็น
  // ภาษาไทยหรืออังกฤษ ไม่เกี่ยวกับวรรณยุกต์เลย — ตำแหน่ง align ครั้งถัดไปจะเพี้ยนทันที) เป็นบั๊กของ jsPDF เอง
  // ไม่ใช่แค่กระทบตัววรรณยุกต์ที่วางทีหลัง แต่กระทบข้อความหลักที่มองเห็นด้วย จึงต้องเลี่ยง align option ของ
  // doc.text() ไปเลยเมื่อเป็น center/right — คำนวณตำแหน่งซ้าย (baseX) เองด้วย getTextWidthMm (ยืนยันแล้วว่า
  // ค่านี้ถูกต้องเสมอไม่ว่าโหมดไหน ดูคอมเมนต์ getTextWidthMm) แล้ววาดแบบ align ซ้ายเองทั้งข้อความหลักและ
  // วรรณยุกต์ที่ถอดออกมาวางคืน รับประกันว่าตำแหน่งตรงกันเสมอ ไม่พึ่งพฤติกรรม align ภายในของ doc.text() เลย

  // ทางลัดสำหรับกรณีที่ไม่มีอะไรต้องแก้เลย (ข้อความส่วนใหญ่ของเอกสารเป็นแบบนี้): ส่งต่อให้ doc.text() ทั้งก้อน
  // เหมือนเดิมเป๊ะๆ รวมถึงปล่อยให้ jsPDF จัดระยะบรรทัดของ array เอง — ไม่เปลี่ยนวิธีวาดโดยไม่จำเป็น
  if (!needsManualAlign && !splits.some((s) => s.marks.length > 0)) {
    doc.text(text, x, y, options);
    return;
  }

  // ระยะบรรทัดที่ใช้ตรงนี้ตรงกับที่ jsPDF ใช้เองตอนรับ array (leading = ขนาดฟอนต์ x lineHeightFactor)
  // ทั้งโหมด compat และ advanced — ดูคอมเมนต์ getLineHeightMm
  const lineHeightMm = getLineHeightMm(doc);
  const lineOptions: TextOptionsLight = { ...options, align: undefined, maxWidth: undefined };

  lines.forEach((line, lineIndex) => {
    const lineY = y + lineIndex * lineHeightMm;
    let baseX = x;
    // ความกว้างวัดจากข้อความที่ถอดวรรณยุกต์แล้วหรือต้นฉบับก็ได้ค่าเท่ากัน (วรรณยุกต์ advance width = 0)
    if (align === 'center') baseX = x - getTextWidthMm(doc, splits[lineIndex].text) / 2;
    else if (align === 'right') baseX = x - getTextWidthMm(doc, splits[lineIndex].text);
    drawThaiLine(doc, line, baseX, lineY, lineOptions);
  });
}

/**
 * jspdf-autotable วาดข้อความในเซลเองภายใน (ไม่ผ่าน drawThaiText ของเรา) จึงเจอบั๊กวรรณยุกต์ซ้อนสระบนแบบ
 * เดียวกัน — คืน hook คู่ (willDrawCell + didDrawCell) ที่เอาไป spread ลงใน options ของ autoTable ได้เลย
 *
 * ทำไมต้องเป็น "คู่" ไม่ใช่ didDrawCell ตัวเดียวเหมือนเดิม: เฉพาะเซลที่มีคู่ "สระบน+วรรณยุกต์" เราต้อง "ยึด
 * การวาดข้อความของเซลนั้นมาทำเอง" ทั้งหมด เพราะการวาดที่ถูกต้องต้องแบ่งบรรทัดเป็นชิ้นๆ เรียงตามลำดับตัวอักษร
 * เดิม (ดูคอมเมนต์ drawThaiLine) ซึ่ง autoTable ทำให้ไม่ได้ — willDrawCell จึงล้าง cell.text เป็นสตริงว่าง
 * (autoTable วาดกรอบ/พื้นหลังให้ตามปกติแต่ไม่วาดตัวหนังสือ) แล้ว didDrawCell วาดข้อความจริงเองทุกบรรทัด
 * เลือก willDrawCell แทน didParseCell เพราะ willDrawCell ถูกเรียกหลัง autoTable ตัดบรรทัดเสร็จแล้ว
 * (cell.text เป็นบรรทัดที่ wrap แล้วจริงๆ) และเป็นจุดที่ความกว้าง/ความสูงของเซลถูกคำนวณไปเรียบร้อยแล้ว การ
 * เข้าไปยุ่งกับ cell.text ตรงนี้จึงไม่กระทบเลย์เอาต์ของตารางเลย
 *
 * *** ต้นตอจริงของบั๊ก "วรรณยุกต์ไปโผล่ไกลจากที่ควรอยู่" ที่แก้รอบนี้ ***
 * เดิมโค้ดใช้ data.cell.getTextPos().y เป็น baseline ตรงๆ แต่ autoTable ไม่ได้วาดที่ y นั้น — ฟังก์ชัน
 * autoTableText() ภายในของมันบวกเพิ่มอีก `fontSizeMm * (2 - 1.15)` (= 0.85 เท่าของขนาดฟอนต์) ก่อนเรียก
 * doc.text() เสมอ (และหักลบเพิ่มอีกถ้า valign เป็น middle/bottom) วรรณยุกต์ที่วาดตาม getTextPos() ตรงๆ จึงสูง
 * เกินไปประมาณ 0.85em ซึ่งเกือบเท่าระยะบรรทัดพอดี (1.15em) → ไปตกอยู่บน "บรรทัดก่อนหน้า" ที่มีตัวอักษรคนละชุด
 * เลยดูเหมือนว่า x เพี้ยนไป ~20mm ทั้งที่ x ถูกต้องมาตลอด — วัดยืนยันแล้วด้วยการวาดขีดสีลงไฟล์จริงแล้วหา
 * พิกัดพิกเซลของขีดเทียบกับ baseline ของแต่ละบรรทัด: ค่าที่คลาดเคลื่อนเป็น "ค่าคงที่ตามแกน Y" ไม่ใช่สะสมตาม
 * บรรทัด และไม่ใช่ความเพี้ยนตามแกน X (สมมติฐานเดิมที่ว่า setFontSize ในโหมด advanced ทำให้ getTextWidth พอง
 * ตกไป — วัดแล้วได้ค่าเท่ากันเป๊ะทั้งสองโหมด ดูคอมเมนต์ getTextWidthMm)
 */
export function createThaiAutoTableHooks(doc: jsPDF): {
  willDrawCell: (data: CellHookData) => void;
  didDrawCell: (data: CellHookData) => void;
} {
  // เก็บข้อความต้นฉบับของเซลที่กำลังจะวาดไว้ส่งต่อจาก willDrawCell → didDrawCell — autoTable วาดทีละเซลจบเป็น
  // คู่ๆ เสมอ (willDrawCell แล้ว didDrawCell ของเซลเดียวกันทันที) จึงใช้ตัวแปรเดียวพอ ไม่ต้องทำ Map
  let pendingOriginalLines: string[] | null = null;

  return {
    willDrawCell: (data) => {
      pendingOriginalLines = null;
      const lines = data.cell.text;
      if (!lines || lines.length === 0) return;
      const splits = lines.map(splitThaiToneMarks);
      if (!splits.some((s) => s.marks.length > 0)) return;
      pendingOriginalLines = lines;
      // คงจำนวนบรรทัดไว้เท่าเดิม เพราะ autoTableText() ใช้จำนวนบรรทัดคำนวณ valign middle/bottom ต่อ (ต้องให้
      // มันเดินเลข/สถานะภายในเหมือนเดิมทุกอย่าง แค่ไม่มีตัวหนังสือออกมา)
      data.cell.text = lines.map(() => '');
    },
    didDrawCell: (data) => {
      const originalLines = pendingOriginalLines;
      pendingOriginalLines = null;
      if (!originalLines) return;

      // คืนค่า cell.text เดิมกลับทันที เผื่อ autoTable/โค้ดอื่นอ่านซ้ำภายหลัง (เช่น ตอนคำนวณหน้าใหม่)
      data.cell.text = originalLines;

      const prevFont = doc.getFont();
      const prevFontSize = doc.getFontSize();

      const styles = data.cell.styles;
      doc.setFont(styles.font, styles.fontStyle);
      doc.setFontSize(styles.fontSize);

      const textPos = data.cell.getTextPos();
      const fontSizeMm = getFontSizeMm(doc);
      const lineHeightMm = getLineHeightMm(doc);

      // จำลองสูตรของ autoTableText() ใน jspdf-autotable แบบบรรทัดต่อบรรทัด (ดูคอมเมนต์ยาวด้านบน):
      //   y += fontSizeMm * (2 - 1.15)          ← ค่า 1.15 ในซอร์สของ autoTable เป็นเลขตายตัว ไม่ใช่
      //                                            getLineHeightFactor() จึงเขียนตายตัวตามเป๊ะๆ ที่นี่ด้วย
      //   valign middle → y -= จำนวนบรรทัด/2 * lineHeight
      //   valign bottom → y -= จำนวนบรรทัด * lineHeight
      const valign = styles.valign ?? 'top';
      let firstBaselineY = textPos.y + fontSizeMm * (2 - 1.15);
      if (valign === 'middle') firstBaselineY -= (originalLines.length / 2) * lineHeightMm;
      else if (valign === 'bottom') firstBaselineY -= originalLines.length * lineHeightMm;

      const halign = styles.halign ?? 'left';

      originalLines.forEach((line, lineIndex) => {
        const split = splitThaiToneMarks(line);
        const lineY = firstBaselineY + lineIndex * lineHeightMm;
        // autoTable จัด center/right ด้วยการเลื่อนจาก textPos.x ไปทางซ้ายตามความกว้างบรรทัดตรงๆ
        // (textPos.x = ขอบขวาในเคส right / จุดกึ่งกลางในเคส center) — ทำตามสูตรเดียวกันเป๊ะ
        let baseX = textPos.x;
        if (halign === 'right') baseX -= getTextWidthMm(doc, split.text);
        else if (halign === 'center') baseX -= getTextWidthMm(doc, split.text) / 2;

        drawThaiLine(doc, line, baseX, lineY);
      });

      doc.setFont(prevFont.fontName, prevFont.fontStyle);
      doc.setFontSize(prevFontSize);
    },
  };
}
