import type { RawFileTable } from '@/types/bankReconcile';
import type { TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api';

/**
 * ตัวอ่านไฟล์ PDF สำหรับ Bank Reconcile — ไฟล์ใหม่ทั้งไฟล์ เพิ่มเข้ามา 2026-07-17 ตามสเปกส่วน "9. SUPPORTED
 * FILES" ("Both Bank Statement and GL Express must support ... Text-based PDF") ใช้ไลบรารี pdfjs-dist
 * (ติดตั้งใหม่ — โปรเจกต์นี้มีแค่ jspdf/jspdf-autotable ซึ่งเป็นตัว "สร้าง" PDF ส่งออกรายงานเท่านั้น ไม่มีตัว
 * "อ่าน" PDF มาก่อนเลย) รันฝั่งเบราว์เซอร์ล้วนๆ (client-side) ให้สอดคล้องกับสถาปัตยกรรมเดิมของทั้งฟีเจอร์ที่อ่าน
 * Excel/CSV ในเบราว์เซอร์เช่นกัน (ดู lib/bankReconcileParse.ts, ไลบรารี xlsx)
 *
 * worker ของ pdfjs-dist ถูกก็อปปี้ไว้เป็นไฟล์ static ที่ public/pdf.worker.min.mjs แล้ว (คัดลอกจาก
 * node_modules/pdfjs-dist/build/pdf.worker.min.mjs ตรงๆ ไม่ผ่าน build step ใดๆ) เพื่อเลี่ยงปัญหาการ bundle
 * worker script ผ่าน Turbopack ที่ไม่แน่นอน — ถ้าอัปเกรดเวอร์ชัน pdfjs-dist ในอนาคต ต้องก็อปปี้ไฟล์นี้ทับใหม่
 * ให้ตรงเวอร์ชันเสมอ (เวอร์ชันไม่ตรงกันระหว่าง main thread กับ worker จะทำให้ pdfjs โยน error ทันที)
 *
 * ผลลัพธ์แปลงเป็น RawFileTable รูปแบบเดียวกับที่ lib/bankReconcileParse.ts ผลิตจาก Excel/CSV ทุกประการ เพื่อให้
 * เข้าสู่ UI จับคู่คอลัมน์ (components/BankReconcileColumnMapping.tsx) ชุดเดียวกันได้โดยไม่ต้องแก้โค้ดจุดนั้นเลย
 * — ไม่พยายามตรวจจับ "แถวหัวคอลัมน์" จากข้อความ PDF เอง (ต่างจาก Excel ที่แถวแรกคือ header เสมอ) เพราะ PDF
 * จริงมีรูปแบบหลากหลายเกินจะเดาได้แม่นยำ จึงสร้าง header ทั่วไป ("คอลัมน์ 1", "คอลัมน์ 2", ...) แล้วปล่อยให้
 * ผู้ใช้จับคู่คอลัมน์เองในขั้นตอนถัดไปเหมือน Excel/CSV ทุกประการ ถ้าบรรทัดหัวตารางของ PDF เองหลุดมาเป็นแถวข้อมูล
 * ด้วย (เช่น "วันที่ รายละเอียด เงินเข้า เงินออก") แถวนั้นจะหาทิศทาง/วันที่ไม่ได้ตามธรรมชาติ (ไม่ใช่ตัวเลข/วันที่
 * จริง) แล้วกลายเป็นแถวสถานะ "ไม่ถูกต้อง" ให้ผู้ใช้เห็นและกดยกเว้นเองได้ในขั้นตอนพรีวิว — ใช้กลไก "พรีวิว +
 * แก้ไข/ยกเว้นแถว" ที่มีอยู่แล้วเป็นตาข่ายนิรภัยแทนการเขียน heuristic ตรวจจับ/ตัดหัวตารางออกเองซึ่งเสี่ยงผิดพลาด
 * มากกว่า (จงใจไม่ทำตามคำแนะนำ "remove repeated header rows" ของสเปกฉบับก่อนหน้าที่ถูกยกเลิกไปแล้ว — สเปกฉบับ
 * rebuild นี้ไม่ได้ขอส่วนนั้นอีกต่อไป)
 */

const SCANNED_PDF_MESSAGE =
  'ไฟล์ PDF นี้เป็นเอกสารสแกน ระบบไม่สามารถอ่านข้อมูลได้อย่างแม่นยำ กรุณาใช้ Excel, CSV หรือ PDF ที่สามารถเลือกข้อความได้';

export { SCANNED_PDF_MESSAGE };

interface PositionedTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
}

/** โหลด pdfjs-dist แบบ dynamic import (โหลดเฉพาะตอนผู้ใช้เลือกไฟล์ PDF จริงๆ เท่านั้น ไม่ให้ไลบรารีขนาดใหญ่นี้
 * ไปอยู่ใน bundle หลักที่โหลดทุกครั้งที่เข้าเมนู) ตั้งค่า workerSrc ครั้งเดียวแล้ว cache promise ไว้ใช้ซ้ำ */
let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

async function loadPdfJs(): Promise<typeof import('pdfjs-dist')> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      return mod;
    });
  }
  return pdfjsPromise;
}

function normalizeSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** type guard แยก TextItem (มีข้อความ+พิกัด) ออกจาก TextMarkedContent (marker ของ pdfjs ที่ไม่มีข้อความ/พิกัด
 * เลย — เช่น จุดเริ่ม/จบของ marked content section) ของ textContent.items — ตรวจสอบชนิดของ .str ตรงๆ (ไม่ใช่แค่
 * `'str' in it` เฉยๆ) เพื่อให้ TypeScript แคบชนิดลงเหลือ TextItem เดียวจริงๆ ไม่ใช่ intersection กับ
 * TextMarkedContent ที่ไม่มี .transform/.width ให้ (สาเหตุของ TS2339 เดิม) */
function isTextItemWithContent(it: TextItem | TextMarkedContent): it is TextItem {
  return typeof (it as TextItem).str === 'string' && (it as TextItem).str.trim() !== '';
}

/** จัดกลุ่ม text item ดิบของหนึ่งหน้าให้เป็น "แถว" (บรรทัด) ตามพิกัด Y แล้วภายในแต่ละแถวจัดกลุ่มเป็น "เซลล์"
 * (คอลัมน์) ตามช่องว่างของพิกัด X — ช่องว่างแคบ = คำในวลีเดียวกัน (รวมเป็นเซลล์เดียว) ช่องว่างกว้าง = คอลัมน์ใหม่
 * ของตาราง เป็น heuristic ล้วนๆ (PDF ไม่มีแนวคิด "ตาราง" ในตัวเองจริงๆ) แม่นยำระดับ "พอใช้งานได้" ไม่ใช่สมบูรณ์
 * แบบ — ความไม่แม่นยำที่หลงเหลือถูกจับได้ที่ขั้นตอนพรีวิว/ตรวจสอบข้อมูลต่อไป (แถวที่แยกคอลัมน์ผิดจะหาวันที่/
 * ทิศทางไม่ได้ตามธรรมชาติ กลายเป็นแถว "ไม่ถูกต้อง" ให้ผู้ใช้แก้ไขเอง) ไม่ merge บรรทัดที่อยู่คนละแถว Y กันเด็ดขาด */
function groupItemsIntoLines(items: PositionedTextItem[]): string[][] {
  const Y_TOLERANCE = 3;
  const COLUMN_GAP_THRESHOLD = 10;

  const sorted = [...items].sort((a, b) => b.y - a.y); // แกน Y ของ PDF: ค่ามาก = อยู่บนกว่า เรียงบนลงล่าง
  const lineGroups: PositionedTextItem[][] = [];
  for (const item of sorted) {
    const group = lineGroups.find((g) => Math.abs(g[0].y - item.y) <= Y_TOLERANCE);
    if (group) group.push(item);
    else lineGroups.push([item]);
  }

  return lineGroups.map((group) => {
    const sortedByX = [...group].sort((a, b) => a.x - b.x);
    const cells: string[] = [];
    let currentCell = '';
    let prevEndX: number | null = null;
    for (const item of sortedByX) {
      if (prevEndX !== null && item.x - prevEndX > COLUMN_GAP_THRESHOLD) {
        cells.push(normalizeSpaces(currentCell));
        currentCell = item.str;
      } else {
        currentCell += currentCell ? ` ${item.str}` : item.str;
      }
      prevEndX = item.x + item.width;
    }
    if (currentCell) cells.push(normalizeSpaces(currentCell));
    return cells;
  });
}

export interface PdfExtractionResult {
  table: RawFileTable;
  pageCount: number;
  isScanned: boolean;
}

/**
 * อ่านไฟล์ PDF ทั้งไฟล์ (ทีละหน้า) แล้วแปลงเป็น RawFileTable — ตรวจพบว่าเป็นเอกสารสแกน/ภาพล้วนด้วยฮิวริสติก
 * "จำนวนตัวอักษรที่อ่านได้เฉลี่ยต่อหน้า" (ถ้าต่ำกว่าเกณฑ์มาก แปลว่าไม่มี text layer จริง หรือมีน้อยมากจนเชื่อถือ
 * ไม่ได้) ถ้าเป็นเอกสารสแกน คืน isScanned:true พร้อมตารางว่างเปล่าทันที (ไม่พยายามอ่านต่อ — ผู้เรียกต้องแสดง
 * ข้อความเตือน SCANNED_PDF_MESSAGE แล้วไม่ให้ดำเนินการต่อ ตามสเปก "Do not build unreliable OCR")
 *
 * โยน Error (ข้อความภาษาไทยพร้อมแสดงผู้ใช้ได้ตรงๆ ไม่ใช่ raw parser error) ในสองกรณี: ไฟล์เสียหาย/ไม่ใช่ PDF
 * จริงแม้นามสกุลถูกต้อง, หรืออ่านได้แต่ไม่พบเนื้อหาที่พอจะเป็นตารางได้เลยแม้แต่แถวเดียว
 */
export async function extractPdfToRawTable(file: File): Promise<PdfExtractionResult> {
  const pdfjsLib = await loadPdfJs();

  let doc;
  try {
    const arrayBuffer = await file.arrayBuffer();
    doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  } catch {
    throw new Error('ไม่สามารถอ่านไฟล์ PDF นี้ได้');
  }

  const pageCount = doc.numPages;
  const allLines: string[][] = [];
  let totalChars = 0;

  for (let pageNum = 1; pageNum <= pageCount; pageNum += 1) {
    // ประมวลผลทีละหน้า (await ต่อหน้า ไม่ใช้ Promise.all รวมทุกหน้าพร้อมกัน) เพื่อไม่ให้ไฟล์ PDF ขนาดใหญ่หลาย
    // สิบหน้าค้างเบราว์เซอร์ทั้งหมดพร้อมกัน — คืน control ให้ event loop ระหว่างหน้าโดยธรรมชาติจาก await เอง
    // (กฎ no-await-in-loop ไม่ได้เปิดใช้งานใน eslint config ของโปรเจกต์นี้ จึงไม่ต้องใส่ eslint-disable กำกับ)
    const page = await doc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const items: PositionedTextItem[] = textContent.items
      .filter(isTextItemWithContent)
      .map((it) => ({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
        width: it.width,
      }));
    totalChars += items.reduce((sum, it) => sum + it.str.replace(/\s/g, '').length, 0);
    allLines.push(...groupItemsIntoLines(items));
  }

  const isScanned = pageCount > 0 && totalChars < pageCount * 10;
  if (isScanned) {
    return { table: { headers: [], rows: [] }, pageCount, isScanned: true };
  }

  const nonEmptyLines = allLines.filter((line) => line.some((cell) => cell.trim() !== ''));
  if (nonEmptyLines.length === 0) {
    throw new Error('ไม่พบตารางรายการในเอกสาร');
  }

  const maxCols = nonEmptyLines.reduce((max, line) => Math.max(max, line.length), 0);
  const headers = Array.from({ length: maxCols }, (_, i) => `คอลัมน์ ${i + 1}`);

  return { table: { headers, rows: nonEmptyLines }, pageCount, isScanned: false };
}
