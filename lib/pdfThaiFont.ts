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

// สระบน (ลอยเหนือพยัญชนะ) ที่วรรณยุกต์ต้องซ้อนทับข้างบนอีกที — ั(มัน) ิ(สระอิ) ี(สระอี) ึ(สระอึ)
// ื(สระอือ) ็(ไม้ไต่คู้)
const THAI_UPPER_VOWELS = 'ัิีึื็';
// ตรวจสอบแล้วด้วยการเรนเดอร์ตารางทดสอบครบทุกคู่ (6 สระบน x 4 วรรณยุกต์ x 4 พยัญชนะ = 96 คู่) ว่า
// jsPDF/Sarabun วาดพลาดเฉพาะ "ไม้เอก" (่, U+0E48) ซ้อนบนสระบนเท่านั้น — ไม้โท(้)/ไม้ตรี(๊)/ไม้จัตวา(๋)
// ซ้อนบนสระบนเดียวกันกลับวาดถูกต้องเองอยู่แล้วทุกคู่ (ไม่ต้องแก้ ถ้าแก้จะกลายเป็นวาดซ้ำซ้อนทับของเดิม
// ทำให้ดูเป็นก้อนเบลอผิดรูปแทน) จึงจำกัดขอบเขตการแก้ไว้เฉพาะไม้เอกเท่านั้น
const THAI_TONE_MARKS = '่';
const VOWEL_TONE_PATTERN = new RegExp(`[${THAI_UPPER_VOWELS}][${THAI_TONE_MARKS}]`, 'g');

/**
 * แก้บั๊ก jsPDF ไม่รองรับ mark-to-mark positioning ของฟอนต์ไทย (jsPDF วาดตัวอักษรต่อกันตาม advance
 * width เฉยๆ ไม่อ่านตาราง GPOS ของฟอนต์เลย) ทำให้วรรณยุกต์ที่ต้องลอยซ้อนเหนือสระบนอีกที (เช่น "ที่" =
 * ท+สระอี+ไม้เอก) หายไปเงียบๆ ทั้งที่ตัวอักษรในไฟล์ PDF ถูกต้อง 100% (ตรวจสอบด้วย pdftotext แล้วข้อความ
 * ถูกต้อง) แค่ "วาดผิดตำแหน่ง/มองไม่เห็น" เท่านั้น — ยืนยันด้วยการสร้างไฟล์ทดสอบแยกและซูมดูเองแล้ว บั๊กนี้
 * มีอยู่เดิมทั่วทั้งระบบ (พบเหมือนกันในรายงานภาษีซื้อที่มีอยู่ก่อนแล้ว) ไม่ใช่สิ่งที่เพิ่งเกิดจากการแก้ไขรอบนี้
 *
 * วิธีแก้ (แบบเร็ว ตามที่ผู้ใช้เลือกใน AskUserQuestion แทนการเปลี่ยนไปใช้ text shaping engine เต็มรูปแบบ
 * ซึ่งใช้เวลามากกว่ามาก): วาดข้อความปกติก่อนเหมือนเดิมทุกอย่าง (ตำแหน่ง/align/ตัดบรรทัดไม่เปลี่ยน) แล้ว
 * สแกนหาคู่ "สระบน+วรรณยุกต์" ในข้อความ วาดตัววรรณยุกต์ตัวนั้นซ้ำอีกทีเฉพาะจุด แต่ขยับขึ้นไปให้ลอยเหนือ
 * สระที่มันซ้อนทับอยู่แทน — ใช้แทน doc.text() ได้ทุกจุดในไฟล์นี้ (เป็น superset: ถ้าข้อความไม่มีคู่ปัญหาเลย
 * ก็แค่วาดปกติเหมือน doc.text() ทุกประการ ไม่มีผลข้างเคียง)
 */
export function drawThaiText(doc: jsPDF, text: string | string[], x: number, y: number, options?: TextOptionsLight): void {
  const lines = Array.isArray(text) ? text : [text];
  const align = options?.align;
  const needsManualAlign = align === 'center' || align === 'right';

  // สำคัญ: doc.text() ที่ align:'center'/'right' ของ jsPDF คำนวณตำแหน่งจริงภายในผิดเพี้ยนไป (เลื่อนซ้าย/ขวา
  // ไกลมาก ไม่ตรงกับสูตร x - lineWidth/2 มาตรฐาน) เมื่ออยู่ในโหมด doc.advancedAPI() ร่วมกับ transformation
  // matrix (ใช้ตอนวาดใบหัก ณ ที่จ่ายย่อลงครึ่งหน้า A4 แนวนอน — ดู lib/whtCertificatePdf.ts renderTwoUpSheet())
  // *และ* มี doc.text() อื่นถูกเรียกมาก่อนหน้าในบริบทเดียวกันอย่างน้อย 1 ครั้ง (ยืนยันด้วยการไอโซเลตทดสอบทีละ
  // ขั้นแล้ว: เรียกครั้งแรกครั้งเดียวไม่เป็นบั๊ก แต่พอมี doc.text() ก่อนหน้าแม้แค่ 1 ครั้ง — ไม่ว่าจะเป็น
  // ภาษาไทยหรืออังกฤษ ไม่เกี่ยวกับวรรณยุกต์เลย — ตำแหน่ง align ครั้งถัดไปจะเพี้ยนทันที) เป็นบั๊กของ jsPDF เอง
  // ไม่ใช่แค่กระทบตัววรรณยุกต์ที่วาดซ้ำ แต่กระทบข้อความหลักที่มองเห็นด้วย จึงต้องเลี่ยง align option ของ
  // doc.text() ไปเลยเมื่อเป็น center/right — คำนวณตำแหน่งซ้าย (baseX) เองด้วย getTextWidthMm (ยืนยันแล้วว่า
  // ค่านี้ถูกต้องเสมอไม่ว่าโหมดไหน ดูคอมเมนต์ getTextWidthMm) แล้ววาดแบบ align ซ้ายเองทั้งข้อความหลักและ
  // วรรณยุกต์ที่ซ้อนทับ รับประกันว่าตำแหน่งตรงกันเสมอ ไม่พึ่งพฤติกรรม align ภายในของ doc.text() เลย
  if (!needsManualAlign) {
    doc.text(text, x, y, options);
  }

  const lineHeightMm = getLineHeightMm(doc);

  lines.forEach((line, lineIndex) => {
    const lineY = y + lineIndex * lineHeightMm;
    let baseX = x;
    if (align === 'center') baseX = x - getTextWidthMm(doc, line) / 2;
    else if (align === 'right') baseX = x - getTextWidthMm(doc, line);

    if (needsManualAlign) {
      doc.text(line, baseX, lineY, { ...options, align: undefined });
    }

    const hasProblemPattern = VOWEL_TONE_PATTERN.test(line);
    VOWEL_TONE_PATTERN.lastIndex = 0;
    if (hasProblemPattern) {
      redrawToneMarksForLine(doc, line, baseX, lineY);
    }
  });
}

/** วาดวรรณยุกต์ซ้ำเฉพาะจุดที่ซ้อนทับสระบน (ดูคอมเมนต์ยาวด้านบน drawThaiText) ให้บรรทัดเดียว โดยรู้ตำแหน่ง
 * เริ่มบรรทัด (baseX ซ้ายสุดของบรรทัดนั้นๆ หลังคิด align แล้ว) และ baseline (lineY) มาล่วงหน้า — ใช้ร่วมกัน
 * ทั้งจาก drawThaiText (ข้อความทั่วไป) และ fixAutoTableCellThaiText (เซลตารางของ jspdf-autotable) */
function redrawToneMarksForLine(doc: jsPDF, line: string, baseX: number, lineY: number): void {
  const fontSizeMm = doc.getFontSize() / doc.internal.scaleFactor;
  const toneMarkLiftMm = fontSizeMm * 0.24; // ปรับด้วยตาจากการเรนเดอร์จริงหลายรอบ
  VOWEL_TONE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = VOWEL_TONE_PATTERN.exec(line)) !== null) {
    const toneMarkIndex = match.index + 1; // ตัวที่ 2 ของคู่ที่แมตช์ (ตัววรรณยุกต์)
    const toneMarkChar = line[toneMarkIndex];
    const prefixWidth = getTextWidthMm(doc, line.slice(0, toneMarkIndex));
    doc.text(toneMarkChar, baseX + prefixWidth, lineY - toneMarkLiftMm);
  }
}

/**
 * เวอร์ชันสำหรับเซลตารางของ jspdf-autotable โดยเฉพาะ — autoTable วาดข้อความในเซลเองภายใน (ไม่ผ่าน
 * drawThaiText ของเรา) จึงเจอบั๊กวรรณยุกต์หายแบบเดียวกัน ใช้เป็น didDrawCell hook: เรียกหลัง autoTable
 * วาดเซลเสร็จแล้ว อ่านตำแหน่งบรรทัดแรกจาก cell.getTextPos() (คำนวณ padding/valign ให้แล้วในตัว) แล้ว
 * ไล่ทีละบรรทัดด้วย lineHeight เดียวกับที่ jsPDF ใช้ทั่วไป — ต้อง setFont/setFontSize ให้ตรงกับสไตล์ของ
 * เซลนั้นๆ ก่อนวัดความกว้างเสมอ (ไม่งั้นจะเพี้ยนถ้าเซลก่อนหน้าตั้งฟอนต์/ขนาดไว้ต่างกัน) แล้วคืนค่าฟอนต์เดิม
 * กลับหลังทำเสร็จ เพื่อไม่ให้กระทบเซลถัดไปที่ autoTable จะวาดต่อ
 */
export function fixAutoTableCellThaiText(doc: jsPDF, data: CellHookData): void {
  const lines = data.cell.text;
  if (!lines || lines.length === 0) return;
  const hasProblemPattern = lines.some((line) => VOWEL_TONE_PATTERN.test(line));
  VOWEL_TONE_PATTERN.lastIndex = 0;
  if (!hasProblemPattern) return;

  const prevFont = doc.getFont();
  const prevFontSize = doc.getFontSize();

  const styles = data.cell.styles;
  doc.setFont(styles.font, styles.fontStyle);
  doc.setFontSize(styles.fontSize);

  const textPos = data.cell.getTextPos();
  const lineHeightMm = getLineHeightMm(doc);
  const halign = styles.halign ?? 'left';

  lines.forEach((line, lineIndex) => {
    const lineY = textPos.y + lineIndex * lineHeightMm;
    let baseX = textPos.x;
    if (halign === 'center' || halign === 'right') {
      const lineWidth = getTextWidthMm(doc, line);
      const rightEdge = data.cell.x + data.cell.width - data.cell.padding('right');
      baseX = halign === 'right' ? rightEdge - lineWidth : (data.cell.x + data.cell.padding('left') + rightEdge) / 2 - lineWidth / 2;
    }
    redrawToneMarksForLine(doc, line, baseX, lineY);
  });

  doc.setFont(prevFont.fontName, prevFont.fontStyle);
  doc.setFontSize(prevFontSize);
}
