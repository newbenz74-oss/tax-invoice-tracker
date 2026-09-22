import * as XLSX from 'xlsx';
import { deriveStatusForTaxType } from './invoiceLogic';
import { formatBuddhistDateInput } from './thaiDate';
import type { InvoiceWriteInput } from './invoiceApi';
import type { PendingTaxInvoice, TaxType } from '@/types/invoice';

/** หัวคอลัมน์ในไฟล์ Excel (ทั้งไฟล์เทมเพลตที่สร้างให้ และไฟล์ที่ผู้ใช้อัปโหลดกลับมา)
 * total_amount เป็นคอลัมน์อ้างอิงเฉยๆ (ตรงกับ total_amount ที่ฐานข้อมูลคำนวณอัตโนมัติอยู่แล้วเสมอ
 * จากยอดก่อน VAT + VAT) parseExcelRow() ไม่เขียนทับค่านี้ลงฐานข้อมูลเลย แต่จะ "เตือน" (ไม่ error) ถ้าค่า
 * ที่กรอกมาในไฟล์ไม่ตรงกับผลรวมที่คำนวณได้ ดูฟังก์ชัน parseExcelRow ด้านล่าง
 *
 * ⚠️ ตั้งแต่ 2026-07-15 ไม่มีคอลัมน์ "ประเภทภาษี" ให้กรอก/เลือกเองอีกต่อไปแล้ว (เคยมีช่วงสั้นๆ ก่อนหน้านี้)
 * — ระบบจำแนกว่ารายการมี VAT หรือไม่มี VAT จากยอดในคอลัมน์ "VAT" โดยตรงเสมอ (VAT > 0 → มี VAT,
 * VAT ว่าง/0/"-" → ไม่มี VAT) ดู parseVatCell/parseExcelRow ด้านล่างสำหรับ logic เต็ม ถ้าผู้ใช้ยังมี
 * ไฟล์เทมเพลตเก่าที่มีคอลัมน์ "ประเภทภาษี" อยู่ อัปโหลดได้ตามปกติ ระบบจะไม่อ่าน/ไม่สนใจคอลัมน์นั้นเลย
 * (ไม่ error ไม่มีผลใดๆ ต่อการนำเข้า) */
export const EXCEL_HEADERS = {
  vendor_name: 'ผู้ขาย',
  transaction_date: 'วันที่ทำรายการ',
  vendor_tax_id: 'เลขประจำตัวผู้เสียภาษี',
  // ชื่อผู้ติดต่อฝั่งผู้ขาย (เพิ่มเข้ามา 2026-08-17 ตามคำขอผู้ใช้) — ไม่บังคับกรอก ใช้บอกว่าควรตามเอกสาร
  // กับใคร ดู types/invoice.ts PendingTaxInvoice.contact_person สำหรับที่มาเต็ม
  contact_person: 'ผู้ติดต่อ',
  description: 'รายละเอียด',
  amount_excl_vat: 'ยอดก่อน VAT',
  vat_amount: 'VAT',
  // เพิ่มพร้อมฟีเจอร์ "หัก ณ ที่จ่าย" (migration_012, 2026-08-10) — ไม่บังคับกรอก เว้นว่าง/"-"/0 = ไม่มี
  // ยอดหัก ใช้ตรรกะแปลงค่าเดียวกับคอลัมน์ VAT (ดู parseVatCell) เพราะเป็นตัวเลขไม่ติดลบเหมือนกัน
  wht_amount: 'หัก ณ ที่จ่าย',
  total_amount: 'ยอดรวม',
  reference_no: 'เลขที่อ้างอิง',
  /** เอาออกจากเทมเพลตแล้ว (2026-09-22 ตามคำขอผู้ใช้ "ช่องนี้ฉันไม่เอา") — แต่ยังคงชื่อคอลัมน์ไว้ที่นี่
   *  โดยตั้งใจ เพื่อให้ไฟล์เทมเพลตเก่าที่ผู้ใช้เก็บไว้และยังมีคอลัมน์นี้อยู่ ถูกอ่านค่าเข้ามาได้ตามปกติ
   *  ไม่ใช่โดนทิ้งเงียบๆ — ดู EXCEL_HEADER_ORDER ด้านล่างซึ่งเป็นตัวกำหนดว่าเทมเพลต "ใหม่" มีคอลัมน์ไหนบ้าง
   *  (ช่องนี้ยังกรอกได้ตามปกติจากฟอร์มเพิ่มรายการในเว็บ และยังใช้คำนวณรายงานภาษีซื้อที่ยังไม่ได้รับอยู่) */
  expected_date: 'วันที่คาดว่าจะได้รับใบกำกับภาษี',
  notes: 'หมายเหตุ',
  /* ---- 4 คอลัมน์รับใบกำกับภาษี (เพิ่มเข้ามา 2026-09-21 ตามคำขอผู้ใช้) ----
   * "บางทีฉันจ่ายเงินออกไปก็ได้รับใบกำกับภาษีเลย ฉันจะได้ไม่ต้องไปนั่งกรอกรับใบกำกับภาษีทีละใบ"
   *
   * เดิมนำเข้าจาก Excel ได้อย่างเดียวคือรายการสถานะ "รอรับใบกำกับภาษี" แล้วต้องมากดเมนู "จัดการเอกสาร →
   * ได้รับแล้ว" ทีละรายการ ซึ่งไม่มีเหตุผลเลยสำหรับรายการที่ใบกำกับภาษีมาถึงพร้อมกับการจ่ายเงินอยู่แล้ว
   *
   * ทั้ง 4 คอลัมน์ไม่บังคับกรอก — เว้นว่างทั้งหมด = พฤติกรรมเดิมทุกประการ (ขึ้นรอรับ) ไฟล์เทมเพลตเก่าที่
   * ผู้ใช้เก็บไว้จึงยังนำเข้าได้ปกติ ไม่พัง (XLSX.utils.sheet_to_json คืน undefined ให้คอลัมน์ที่ไม่มี
   * ในไฟล์ ซึ่งโค้ดอ่านค่าด้านล่างมองเป็น "ไม่ได้กรอก" อยู่แล้ว)
   *
   * "เลขที่ใบกำกับภาษี" เป็นตัวสวิตช์: กรอกมา = ได้รับใบกำกับภาษีแล้ว ระบบจะตั้งสถานะเป็น received และเข้า
   * รายงานภาษีซื้อให้ทันที (ดู resolveTaxInvoiceReceipt ด้านล่างสำหรับกติกาเต็ม) */
  tax_invoice_number: 'เลขที่ใบกำกับภาษี',
  tax_invoice_date: 'วันที่ใบกำกับภาษี',
  received_date: 'วันที่ได้รับใบกำกับภาษี',
  vat_claim_period: 'เดือน/ปีที่ใช้เครดิต VAT',
} as const;

/**
 * ลำดับคอลัมน์ในไฟล์เทมเพลต — เขียนเรียงเองตรงๆ ไม่ใช้ Object.values(EXCEL_HEADERS) อีกต่อไป
 * (เปลี่ยน 2026-09-22 ตามลำดับที่ผู้ใช้ระบุมาเอง)
 *
 * แยกจาก EXCEL_HEADERS ด้วยเหตุผลสองข้อ:
 *   1. ลำดับที่ผู้ใช้อยากเห็นในไฟล์ ไม่จำเป็นต้องตรงกับลำดับที่สะดวกในการเขียนโค้ด
 *   2. บางคอลัมน์ "อ่านได้แต่ไม่อยู่ในเทมเพลตใหม่" (ตอนนี้คือ expected_date) ซึ่งแสดงออกได้ก็ต่อเมื่อ
 *      สองอย่างนี้แยกกัน
 *
 * เรียงตามลำดับการทำงานจริง: วันที่ → ใครขาย → เลขอ้างอิง → รายละเอียด → ตัวเลขเงินเรียงจากซ้ายไปขวา
 * (ยอดก่อน VAT → VAT → หัก ณ ที่จ่าย → ยอดรวม) → ข้อมูลเสริม
 */
export const EXCEL_HEADER_ORDER: string[] = [
  // ---- ฝั่งบันทึกการจ่ายเงิน (11 คอลัมน์) ----
  EXCEL_HEADERS.transaction_date,
  EXCEL_HEADERS.vendor_name,
  EXCEL_HEADERS.vendor_tax_id,
  EXCEL_HEADERS.reference_no,
  EXCEL_HEADERS.description,
  EXCEL_HEADERS.amount_excl_vat,
  EXCEL_HEADERS.vat_amount,
  EXCEL_HEADERS.wht_amount,
  EXCEL_HEADERS.total_amount,
  EXCEL_HEADERS.contact_person,
  EXCEL_HEADERS.notes,
  // ---- ฝั่งบันทึกใบกำกับภาษี (4 คอลัมน์) ----
  EXCEL_HEADERS.tax_invoice_number,
  EXCEL_HEADERS.tax_invoice_date,
  EXCEL_HEADERS.received_date,
  EXCEL_HEADERS.vat_claim_period,
];

/**
 * จำนวนคอลัมน์ของ "ฝั่งบันทึกการจ่ายเงิน" — คอลัมน์ที่เหลือทั้งหมดเป็น "ฝั่งบันทึกใบกำกับภาษี"
 *
 * ใช้ลากแถวหัวข้อกลุ่ม (merge cell) ในเทมเพลตให้คลุมช่วงคอลัมน์ถูกต้อง — ดู buildGroupedSheet
 * ผูกกับลำดับใน EXCEL_HEADER_ORDER ด้านบนโดยตรง ถ้าเพิ่ม/ย้ายคอลัมน์ ต้องมาปรับเลขนี้ให้ตรงกันเสมอ
 * (มีเทสต์คุมค่านี้ไว้แล้วในชุด buildTemplateBlob — ตรวจทั้งตำแหน่งหัวข้อกลุ่มและช่วง merge)
 */
const PAYMENT_COLUMN_COUNT = 11;

export interface ExcelImportRow {
  rowNumber: number; // เลขแถวจริงในไฟล์ Excel (แถว 1 = header เสมอ)
  vendor_name: string;
  transaction_date: string; // ISO YYYY-MM-DD หรือ '' ถ้าไม่ถูกต้อง/ไม่ได้กรอก
  vendor_tax_id: string;
  contact_person: string; // ไม่บังคับกรอก — ดู EXCEL_HEADERS.contact_person ด้านบน
  description: string;
  amount_excl_vat: string;
  vat_amount: string;
  // ตรวจจับอัตโนมัติจากยอดในคอลัมน์ VAT เท่านั้นเสมอ (VAT > 0 → claimable_vat, VAT ว่าง/0/"-" →
  // no_vat) ไม่มีคอลัมน์ให้ผู้ใช้กรอก/เลือกเองอีกต่อไป — '' หมายถึงคอลัมน์ VAT มีค่าที่อ่านเป็นตัวเลข
  // ไม่ได้ (ดู errors) ยังจำแนกประเภทไม่ได้ แถวนี้จะ import ไม่ได้จนกว่าจะแก้ไขค่า VAT ให้ถูกต้อง
  tax_type: TaxType | '';
  // ไม่บังคับกรอก — ค่าว่าง/"-"/0 ล้วนหมายถึง "0" (ไม่มียอดหัก) เหมือนคอลัมน์ VAT ทุกประการ (parseVatCell)
  wht_amount: string;
  reference_no: string;
  expected_date: string;
  notes: string;
  /* ---- ข้อมูลการรับใบกำกับภาษี (2026-09-21) ----
   * ทั้ง 4 ค่าเป็น '' เมื่อไม่ได้กรอก/ยังไม่ได้รับใบกำกับภาษี — ดู resolveTaxInvoiceReceipt
   * tax_invoice_number มีค่า = แถวนี้จะถูกบันทึกเป็น "ได้รับใบกำกับภาษีแล้ว" ทันทีตอนนำเข้า */
  tax_invoice_number: string;
  tax_invoice_date: string; // ISO YYYY-MM-DD
  received_date: string; // ISO YYYY-MM-DD
  vat_claim_month: number | ''; // 1-12
  vat_claim_year: number | ''; // ปี พ.ศ. (ตรงกับที่ฐานข้อมูลเก็บ — ดู migration_002)
  errors: string[]; // ว่าง = ผ่านตรวจสอบพื้นฐาน แต่ยังต้องดู warnings/รายการซ้ำก่อน import อยู่ดี
  warnings: string[]; // ไม่ block การนำเข้า แต่ควรแจ้งเตือนให้ผู้ใช้ตรวจสอบก่อนยืนยัน
}

// ค่าเดียวกับ BUDDHIST_YEAR_OFFSET/GREGORIAN_LOOKING_YEAR_MAX ใน lib/thaiDate.ts (เป็น local const ไม่ได้
// export ออกมาที่นั่น จึงประกาศซ้ำที่นี่ — ไฟล์นี้ก็มี cellLooksLikeGregorianDmy ที่ hardcode ปี 2200 อยู่แล้ว
// เป็นแพทเทิร์นเดิมของไฟล์นี้) ใช้ตัดสินว่าปีที่พิมพ์ในเซลล์ข้อความ วว/ดด/ปปปป เป็น พ.ศ. (>= 2200) หรือ
// ค.ศ. ที่พิมพ์ผิดมาแทน (< 2200) ดูคอมเมนต์เต็มที่ lib/thaiDate.ts
const BUDDHIST_YEAR_OFFSET = 543;
const GREGORIAN_LOOKING_YEAR_MAX = 2200;

/**
 * แปลง Date เป็น ISO (YYYY-MM-DD) ตาม "เวลาท้องถิ่น" ของ Date นั้น
 *
 * ใช้กับ Date ที่ถูกสร้างขึ้นด้วยความหมายแบบท้องถิ่นเท่านั้น — คือ `new Date()` (วันนี้ของผู้ใช้) และ Date
 * ที่ผู้เรียกส่งเข้ามาตรงๆ เช่น new Date(2026, 8, 1) ซึ่ง "1 ก.ย." คือสิ่งที่คนเขียนโค้ดตั้งใจ ไม่ใช่ moment
 * สากล — ถ้าอ่านด้วย getter แบบ UTC จะเพี้ยนไปวันก่อนหน้าทันทีในโซนเวลาบวก
 *
 * ห้ามใช้กับ Date ที่แปลงมาจากเลข serial ของ Excel — ตัวนั้นยึดเที่ยงคืน UTC ต้องใช้ isoFromUtcDate
 * (แยกสองฟังก์ชันตั้งแต่ 2026-09-22 เพราะการใช้ตัวเดียวกันทั้งสองความหมายคือต้นเหตุของบั๊กวันที่เลื่อน)
 */
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * แปลง Date เป็น ISO (YYYY-MM-DD) ตามเวลา UTC — ใช้คู่กับ excelSerialToDate เท่านั้น
 *
 * excelSerialToDate สร้าง Date ที่เที่ยงคืน UTC เป๊ะๆ (คณิตศาสตร์ epoch ล้วน ไม่ขึ้นกับโซนเวลาเครื่อง)
 * จึงต้องอ่านกลับด้วยหน่วยเดียวกัน ไม่งั้นผู้ใช้ในโซนเวลาติดลบ (อเมริกา) จะได้วันที่ย้อนไป 1 วัน เพราะ
 * เที่ยงคืน UTC ตรงกับช่วงเย็นของ "วันก่อนหน้า" ในโซนนั้น
 */
function isoFromUtcDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** แปลงเลข serial ของ Excel ให้เป็น Date — วันที่ 0 ของ Excel คือ 1899-12-30 */
function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial)) return null;
  /* ปัดลง แต่เผื่อความคลาดเคลื่อนให้ 2 นาทีก่อน (แก้ 2026-09-22)
   *
   * เซลล์วันที่ล้วนควรมี serial เป็นจำนวนเต็ม แต่ไฟล์จากบางเครื่องมือมีเศษติดลบเล็กน้อยจากการปัดเวลา
   * (เช่น 46265.99977 = "1 ก.ย. ลบไป 20 วินาที") ถ้า Math.floor ตรงๆ จะกลายเป็น 31 ส.ค. แบบเงียบๆ
   *
   * ทำไมไม่ใช้ Math.round: เซลล์วันที่ของ statement ธนาคารมักมีเวลาติดมาด้วยจริงๆ (เช่น 1 ก.ย. 15:00
   * = .625) Math.round จะปัดขึ้นเป็น 2 ก.ย. ทันที ซึ่งผิดหนักกว่าเดิม — การเผื่อแค่ 2 นาทีครอบคลุม
   * ความคลาดเคลื่อนที่เจอจริง (มากสุดที่วัดได้ ~56 วินาที) โดยไม่ไปแตะเวลาในวันที่เป็นข้อมูลจริง
   */
  const utcDays = Math.floor(serial - 25569 + 2 / 1440);
  const date = new Date(utcDays * 86400 * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * ช่วงปี พ.ศ. ที่ถือว่า "เป็นเอกสารทางบัญชีจริงได้" — ชุดเดียวกับ check constraint ของ
 * bank_reconcile_reports.period_year (migration_006) เพื่อให้เกณฑ์นี้เป็นค่าเดียวกันทั้งระบบ
 */
const MIN_PLAUSIBLE_BUDDHIST_YEAR = 2500;
const MAX_PLAUSIBLE_BUDDHIST_YEAR = 2700;

/**
 * ตรวจว่าปี ค.ศ. ที่แปลงได้อยู่ในช่วงที่เป็นไปได้จริงของเอกสารทางบัญชีหรือไม่ (พ.ศ. 2500-2700)
 *
 * เพิ่ม 2026-09-22 ปิดช่องโหว่ "ค่าผิดแบบเงียบ": excelSerialToDate ถือว่าตัวเลขใดๆ คือ serial date ของ
 * Excel โดยไม่เช็คช่วงเลย ผู้ใช้ที่เผลอพิมพ์เลขลอยๆ ลงช่องวันที่ (เช่น 9 หรือ 2569) จะได้วันที่ปี 1900
 * กลับมาแล้วผ่านฉลุยโดยไม่มี error สักตัว — รายการนั้นจะหายไปจากรายงานภาษีซื้อ/รายงานเกินกำหนดแบบเงียบๆ
 * ซึ่งเป็นความผิดพลาดชนิดที่แย่ที่สุดสำหรับงานภาษี (หาไม่เจอจนกว่าสรรพากรจะทัก)
 *
 * ปฏิเสธไปเลยดีกว่า เพราะผู้เรียกทุกจุดขึ้น error ให้ผู้ใช้กลับไปแก้ไฟล์อยู่แล้ว ไม่ใช่เดาแทนเขา
 */
const MIN_PLAUSIBLE_GREGORIAN_YEAR = MIN_PLAUSIBLE_BUDDHIST_YEAR - 543;
const MAX_PLAUSIBLE_GREGORIAN_YEAR = MAX_PLAUSIBLE_BUDDHIST_YEAR - 543;

function isPlausibleAccountingIso(iso: string): boolean {
  const year = Number(iso.split('-')[0]);
  return year >= MIN_PLAUSIBLE_GREGORIAN_YEAR && year <= MAX_PLAUSIBLE_GREGORIAN_YEAR;
}

/**
 * ด่านสุดท้ายก่อนคืนค่า: ถ้าปีที่ได้ยัง "สูงเกินกว่าจะเป็น ค.ศ. จริง" แปลว่าเป็น พ.ศ. ที่หลุดรอดมา ให้ลบ 543
 *
 * เพิ่มเข้ามา 2026-09-15 หลังผู้ใช้แจ้งว่านำเข้าไฟล์เทมเพลตที่เป็น พ.ศ. 2569 แล้ววันที่กลายเป็น 3112
 * (= 2569 + 543 ตอนแสดงผล แปลว่าฐานข้อมูลเก็บปี 2569 ไว้ตรงๆ ซึ่งผิด ต้องเป็น 2026)
 *
 * รอบแก้ก่อนหน้า (2026-09-02) แก้ไว้เฉพาะเส้นทาง "ข้อความ วว/ดด/ปปปป" เท่านั้น แต่เซลล์วันที่ใน Excel มาถึง
 * โค้ดนี้ได้ 4 ทาง — Date object, เลข serial, ข้อความ YYYY-MM-DD และข้อความ วว/ดด/ปปปป — อีก 3 ทางที่เหลือ
 * ยังเก็บปีตามที่ไฟล์ให้มาตรงๆ ไฟล์บัญชีไทยที่เขียนปีเป็น พ.ศ. ลงในตัววันที่เองจึงยังหลุดเข้ามาได้อยู่ดี
 *
 * ย้ายการแปลงมาไว้ที่ทางออกทางเดียวของฟังก์ชันแทนการไล่แก้ทีละเส้นทาง เพื่อไม่ให้พลาดซ้ำอีกเวลาเพิ่มรูปแบบ
 * ใหม่ — เส้นทาง วว/ดด/ปปปป ที่ลบ 543 ไปแล้วจะไม่โดนลบซ้ำ เพราะผลลัพธ์ตกมาต่ำกว่าเกณฑ์นี้แล้ว
 *
 * ใช้เกณฑ์ 2400 (ไม่ใช่ 2200 เท่า GREGORIAN_LOOKING_YEAR_MAX) ให้ตรงกับ parseDateCellWithEraConversion ใน
 * lib/bankReconcileParse.ts ที่ทำเรื่องเดียวกันกับไฟล์ Bank Statement — ปี ค.ศ. 2200-2399 ไม่มีทางเป็น
 * เอกสารทางบัญชีจริงอยู่แล้ว แต่ถ้าเผลอแปลงจะเพี้ยนไป 543 ปีแบบเงียบๆ จึงตั้งเกณฑ์ให้ปลอดภัยไว้ก่อน
 */
function normalizeBuddhistEra(iso: string): string {
  const [yStr, mo, d] = iso.split('-');
  const year = Number(yStr);
  if (year < 2400) return iso;
  return `${String(year - BUDDHIST_YEAR_OFFSET).padStart(4, '0')}-${mo}-${d}`;
}

/**
 * แปลงค่าจากเซลล์ Excel ให้เป็นวันที่แบบ ISO (YYYY-MM-DD) — ปี ค.ศ. เสมอ ตาม convention ของคอลัมน์
 * ชนิด date ทั้งระบบ
 *
 * รองรับ 4 รูปแบบ: Date object (เซลล์รูปแบบวันที่จริงของ Excel), เลข serial ของ Excel, ข้อความแบบ
 * YYYY-MM-DD และข้อความแบบ DD/MM/YYYY (นิยมใช้ในไทย) — ทุกเส้นทางผ่าน normalizeBuddhistEra ด้านบน
 * ก่อนคืนค่าเสมอ จึงรับไฟล์ที่เขียนปีเป็น พ.ศ. มาได้ทุกรูปแบบ
 *
 * ทุกเส้นทางยังต้องผ่าน isPlausibleAccountingIso ด้วย (เพิ่ม 2026-09-22) — ปีที่หลุดช่วง พ.ศ. 2500-2700
 * ถือเป็น "อ่านไม่ออก" คืน null ให้ผู้เรียกขึ้น error แทนที่จะรับค่าผิดเข้าระบบเงียบๆ ดูเหตุผลเต็มที่
 * isPlausibleAccountingIso
 */
function finalizeIso(iso: string): string | null {
  return isPlausibleAccountingIso(iso) ? iso : null;
}

export function parseExcelDateCell(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : finalizeIso(normalizeBuddhistEra(toISODate(value)));
  }
  if (typeof value === 'number') {
    // ใช้ isoFromUtcDate (ไม่ใช่ toISODate) เพราะ excelSerialToDate คืน Date ที่เที่ยงคืน UTC —
    // ดูคอมเมนต์ของทั้งสองฟังก์ชันด้านบนว่าทำไมต้องแยกกัน
    const d = excelSerialToDate(value);
    return d ? finalizeIso(normalizeBuddhistEra(isoFromUtcDate(d))) : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const [, y, mo, d] = isoMatch;
      return isRealDate(Number(y), Number(mo), Number(d)) ? finalizeIso(normalizeBuddhistEra(trimmed)) : null;
    }
    const dmyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dmyMatch) {
      const [, d, mo, yRaw] = dmyMatch;
      // ปีที่พิมพ์ในเซลล์ข้อความ วว/ดด/ปปปป ปกติเป็น พ.ศ. เสมอตามความเคยชินของผู้ใช้ไทย (ดูคอมเมนต์เต็มที่
      // cellLooksLikeGregorianDmy ด้านล่าง — ใช้เกณฑ์ปี >= 2200 เดียวกัน) ต้องลบ 543 ออกก่อนเก็บเป็น ISO ค.ศ.
      // เหมือนกับ parseBuddhistDateInput ใน lib/thaiDate.ts มิเช่นนั้นวันที่จะถูกบันทึกเพี้ยนไปข้างหน้า 543 ปี
      // จริงในฐานข้อมูล (บั๊กที่พบและแก้ไข 2026-09-02 — transaction_date ของใบกำกับภาษีที่นำเข้าจาก Excel เกือบ
      // ทั้งหมดในระบบเพี้ยนไป 543 ปีจากบั๊กนี้ กระทบทั้งการแสดงผลและการคำนวณภาษีซื้อเกินกำหนด) ถ้าปีดูเหมือน
      // ค.ศ. อยู่แล้ว (< 2200) ให้เก็บตรงๆ ไม่แปลง — cellLooksLikeGregorianDmy จะเตือนผู้ใช้แยกต่างหากให้ตรวจสอบ
      const typedYear = Number(yRaw);
      const y = typedYear < GREGORIAN_LOOKING_YEAR_MAX ? typedYear : typedYear - BUDDHIST_YEAR_OFFSET;
      if (!isRealDate(y, Number(mo), Number(d))) return null;
      return finalizeIso(`${String(y).padStart(4, '0')}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`);
    }
    return null;
  }
  return null;
}

/** ตรวจว่าค่าดิบในเซลล์เป็นข้อความรูปแบบ วว/ดด/ปปปป (ไม่ใช่ Date object/เลข serial ของ Excel ซึ่งเป็น ค.ศ.
 * ที่ถูกต้องแน่นอนอยู่แล้วจากตัว Excel เอง ไม่ต้องเตือน) ที่ปีที่พิมพ์ "ดูเหมือน" เป็น ค.ศ. ไม่ใช่ พ.ศ. — เพิ่ม
 * เข้ามา 2026-08-18 ตามคำขอผู้ใช้ "ตรวจสอบดูให้หน่อยว่าตรงไหนที่บันทึกปีเป็น ค.ศ. ... แจ้งเตือนว่าโปรดบันทึก
 * เป็น พ.ศ." — ผู้ใช้ไทยที่พิมพ์วันที่เป็นข้อความ วว/ดด/ปปปป ลงในเซลล์ Excel ตรงๆ (ไม่ได้ใช้ตัวเลือกวันที่ของ
 * Excel เอง) มักตั้งใจพิมพ์ปี พ.ศ. เสมอตามความเคยชิน แต่ parseExcelDateCell ด้านบนไม่เคยแปลง/เตือนอะไรเลย
 * (เก็บปีตามที่พิมพ์ตรงๆ เป็น ISO ค.ศ.) ใช้เกณฑ์ปี < 2200 เดียวกับ lib/thaiDate.ts (ดูคอมเมนต์เต็มที่นั่น)
 * เป็นแค่คำเตือน (ไม่ error/ไม่บล็อกการนำเข้า) เพราะไฟล์ Excel บางไฟล์อาจ export มาจากระบบอื่นที่ใช้ ค.ศ. จริง
 * ก็ได้ ให้ผู้ใช้ตรวจสอบเองก่อนยืนยันนำเข้า */
function cellLooksLikeGregorianDmy(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return false;
  return Number(match[3]) < GREGORIAN_LOOKING_YEAR_MAX;
}

/** ตรวจสอบว่า ปี/เดือน/วัน ที่ให้มาเป็นวันที่จริงที่มีอยู่จริง (เช่น เดือน 13 หรือวันที่ 30 กุมภาพันธ์ ไม่ผ่าน) */
function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  return String(value).trim();
}

function cellToNumberString(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number') return String(value);
  const parsed = parseFloat(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? String(parsed) : String(value).trim();
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

type VatCellResult = { kind: 'ok'; amount: number } | { kind: 'invalid'; raw: string };

/** แปลงค่าจากคอลัมน์ "VAT" อย่างปลอดภัย — นี่คือแหล่งเดียวที่ใช้จำแนกว่ารายการ "มี VAT" หรือ "ไม่มี VAT"
 * (ไม่มีคอลัมน์ "ประเภทภาษี" ให้กรอก/เลือกเองอีกต่อไปตั้งแต่ 2026-07-15) รองรับ:
 * - ตัวเลขปกติ (7, 70, 140) และตัวเลขที่มี comma คั่นหลักพัน (เช่น "1,400.00")
 * - ค่าว่าง / ไม่มีค่า / เครื่องหมาย "-" / ข้อความที่มีแต่ช่องว่าง / 0 / 0.00 → ถือเป็น 0 ทั้งหมด (ไม่ error)
 * ห้ามคืนค่า NaN เด็ดขาด — ถ้าค่าที่กรอกมาไม่ใช่ตัวเลขล้วนๆ เลย (เช่น "abc" หรือ "12abc" ที่มีตัวอักษรปน)
 * จะคืนเป็น invalid ให้ parseExcelRow ใส่ error บล็อกแถวนั้นไว้จนกว่าจะแก้ไข */
export function parseVatCell(value: unknown): VatCellResult {
  if (value === null || value === undefined) return { kind: 'ok', amount: 0 };
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? { kind: 'ok', amount: value } : { kind: 'invalid', raw: String(value) };
  }
  const raw = String(value).trim();
  if (raw === '' || raw === '-') return { kind: 'ok', amount: 0 };
  const cleaned = raw.replace(/,/g, '');
  // ต้องเป็นตัวเลขล้วนๆ ทั้งสตริง (parseFloat("12abc") จะได้ 12 ทั้งที่ไม่ใช่ตัวเลขล้วน จึงเช็คด้วย
  // regex ควบคู่ไปด้วยเสมอ ไม่พึ่ง parseFloat อย่างเดียว)
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return { kind: 'invalid', raw };
  const parsed = parseFloat(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) return { kind: 'invalid', raw };
  return { kind: 'ok', amount: parsed };
}

/** ผลการตีความ 4 คอลัมน์รับใบกำกับภาษีของหนึ่งแถว — ดู resolveTaxInvoiceReceipt */
export interface TaxInvoiceReceipt {
  tax_invoice_number: string;
  tax_invoice_date: string;
  received_date: string;
  vat_claim_month: number | '';
  vat_claim_year: number | '';
  errors: string[];
  warnings: string[];
}

/** แปลงข้อความ "ดด/ปปปป" (ปี พ.ศ.) จากคอลัมน์ "เดือน/ปีที่ใช้เครดิต VAT" — รองรับ 8/2569 และ 08/2569
 *  คืน null ถ้ารูปแบบผิด/เดือนนอกช่วง 1-12 (ผู้เรียกจะขึ้น error ให้ผู้ใช้แก้ไฟล์)
 *
 *  บังคับให้ปีอยู่ในช่วง พ.ศ. 2500-2700 ด้วย — ต่างจากคอลัมน์วันที่อื่นที่แปลง ค.ศ.→พ.ศ. ให้อัตโนมัติ เพราะ
 *  vat_claim_year เก็บเป็นตัวเลข พ.ศ. ตรงๆ ในฐานข้อมูล (migration_002) ไม่ใช่ชนิด date ถ้าผู้ใช้พิมพ์
 *  "09/2026" มาแล้วเรารับไว้เงียบๆ รายการนั้นจะหายไปจากรายงานภาษีซื้อของปี 2569 โดยไม่มีอะไรเตือนเลย —
 *  ความผิดพลาดแบบเงียบในรายงานภาษีคือสิ่งที่แย่ที่สุด จึงเลือกปฏิเสธไปเลยให้ผู้ใช้แก้ไฟล์ */
function parseVatClaimPeriod(value: unknown): { month: number; year: number } | null {
  const text = cellToString(value).trim();
  if (!text) return null;

  const match = text.match(/^(\d{1,2})\s*\/\s*(\d{4})$/);
  if (match) {
    const month = Number(match[1]);
    const year = Number(match[2]);
    if (month < 1 || month > 12) return null;
    // ใช้ช่วงเดียวกับ isPlausibleAccountingIso — ปี ค.ศ. ที่พิมพ์มา (เช่น 09/2026) ตกต่ำกว่า 2500 จึงถูก
    // ปฏิเสธพร้อมกับปีที่เกินจริงอย่าง 09/9999 ในกติกาเดียวกัน ไม่ต้องมีเกณฑ์สองชุดให้สับสน
    if (year < MIN_PLAUSIBLE_BUDDHIST_YEAR || year > MAX_PLAUSIBLE_BUDDHIST_YEAR) return null;
    return { month, year };
  }

  /* เซลล์ที่ Excel "แปลงเป็นวันที่ให้เอง" (แก้ 2026-09-22 ตามที่ผู้ใช้แจ้ง)
   *
   * อาการ: ผู้ใช้พิมพ์ 09/2569 แล้วกด Enter — Excel เห็นว่าหน้าตาเหมือนวันที่ จึงแปลงเป็นเซลล์วันที่จริง
   * แล้วแสดงเป็น "ก.ย.-69" ทันที ค่าที่เก็บในไฟล์จึงไม่ใช่ข้อความ 09/2569 อีกต่อไป แต่เป็นวันที่ (1 ก.ย.)
   * ทำให้ตัวจับรูปแบบข้อความด้านบนไม่ตรง แล้วขึ้น error ทั้งที่ผู้ใช้กรอกถูกต้องทุกอย่าง
   *
   * ทางแก้ที่เลือก: ยอมรับเซลล์วันที่ด้วยเลย แล้วดึงเฉพาะเดือน/ปีมาใช้ — เพราะสิ่งที่ Excel ตีความ
   * ("เดือนกันยายน ปี 2569") ตรงกับสิ่งที่ผู้ใช้ตั้งใจพิมพ์พอดี ส่วนวันที่ 1 ที่ Excel เติมให้เองก็ทิ้งไป
   *
   * ทำไมไม่แก้ที่ฝั่งเทมเพลตให้ Excel ไม่แปลง: การบังคับรูปแบบเซลล์เป็น Text ต้องเขียน cell style ลงไฟล์
   * ซึ่งไลบรารี xlsx รุ่นฟรีที่ใช้อยู่ทำไม่ได้ และต่อให้ทำได้ ผู้ใช้ที่ก๊อปวางข้ามชีท/สร้างแถวใหม่เองก็หลุด
   * กติกานั้นได้อยู่ดี — รับให้ได้ทั้งสองแบบที่ปลายทางจึงทนทานกว่า
   *
   * ใช้ parseExcelDateCell เพื่อให้ได้ ISO ปี ค.ศ. ที่ผ่าน normalizeBuddhistEra มาแล้ว ครอบคลุมทั้งกรณี
   * Excel เก็บเป็น ค.ศ. 2026 และกรณีเก็บเป็น 2569 ตรงๆ (ขึ้นกับการตั้งค่าปฏิทินของแต่ละเครื่อง)
   */
  const iso = parseExcelDateCell(value);
  if (!iso) return null;
  // parseExcelDateCell กรองช่วงปีที่เป็นไปได้จริงให้แล้ว (isPlausibleAccountingIso) จึงไม่ต้องเช็คซ้ำที่นี่
  const [gregorianYear, month] = iso.split('-').map(Number);
  return { month, year: gregorianYear + BUDDHIST_YEAR_OFFSET };
}

/**
 * ตีความ 4 คอลัมน์รับใบกำกับภาษี แล้วตัดสินว่าแถวนี้ "ได้รับใบกำกับภาษีแล้วหรือยัง"
 *
 * กติกา (ตามที่ผู้ใช้เลือกไว้ 2026-09-21):
 * 1. ตัวสวิตช์คือ "เลขที่ใบกำกับภาษี" — ไม่กรอก = ยังไม่ได้รับ ทุกคอลัมน์ที่เหลือถูกมองข้ามทั้งหมด
 * 2. วันที่ใบกำกับภาษี "บังคับ" เมื่อกรอกเลขที่มาแล้ว เพราะรายงานภาษีซื้อใช้วันที่นี้เป็นวันที่หลักของรายการ
 *    (ดู lib/vatReportLogic.ts) ถ้าไม่มีก็ออกรายงานไม่ได้ จึงต้องเป็น error ไม่ใช่แค่เตือน
 * 3. วันที่ได้รับ ถ้าเว้นว่าง → ใช้วันที่ใบกำกับภาษีแทน เพราะกรณี "จ่ายเงินแล้วรับใบมาเลย" สองวันนี้มัก
 *    เป็นวันเดียวกันอยู่แล้ว ลดช่องที่ต้องกรอกลงโดยไม่เสียความถูกต้อง
 * 4. เดือน/ปีที่ใช้เครดิต VAT ถ้าเว้นว่าง → เดาจากเดือน/ปีของ "วันที่ได้รับ" ซึ่งเป็นพฤติกรรมปกติของการยื่น
 *    ภ.พ.30 (ใช้เครดิตในเดือนที่ได้รับเอกสาร) แต่ยังกรอกเองทับได้ถ้าบริษัทเลื่อนไปใช้เดือนถัดไป
 *
 * หมายเหตุเรื่องศักราช: vat_claim_year เก็บเป็น **พ.ศ.** ในฐานข้อมูลโดยตั้งใจมาตั้งแต่ migration_002
 * (เป็นเดือน/ปีที่ผู้ใช้เลือกจาก dropdown ไม่ใช่วันที่ปฏิทิน) ต่างจาก transaction_date/tax_invoice_date
 * ที่เป็นชนิด date จึงเก็บเป็น ค.ศ. — ตอนเดาค่าจาก received_date (ISO ค.ศ.) จึงต้องบวก 543 กลับเสมอ
 */
export function resolveTaxInvoiceReceipt(
  raw: Record<string, unknown>,
  context: { taxType: TaxType | ''; transactionDate: string }
): TaxInvoiceReceipt {
  const errors: string[] = [];
  const warnings: string[] = [];
  const empty: TaxInvoiceReceipt = {
    tax_invoice_number: '',
    tax_invoice_date: '',
    received_date: '',
    vat_claim_month: '',
    vat_claim_year: '',
    errors,
    warnings,
  };

  const numberText = cellToString(raw[EXCEL_HEADERS.tax_invoice_number]).trim();
  const taxInvoiceDateRaw = raw[EXCEL_HEADERS.tax_invoice_date];
  const receivedDateRaw = raw[EXCEL_HEADERS.received_date];
  const claimPeriodRaw = raw[EXCEL_HEADERS.vat_claim_period];
  const anyReceiptCellFilled =
    Boolean(numberText) ||
    cellToString(taxInvoiceDateRaw).trim() !== '' ||
    cellToString(receivedDateRaw).trim() !== '' ||
    cellToString(claimPeriodRaw).trim() !== '';

  if (!anyReceiptCellFilled) return empty;

  // รายการไม่มี VAT ไม่มีใบกำกับภาษีให้รับอยู่แล้ว (ถูกตั้งเป็น received ตั้งแต่ต้นโดย
  // deriveStatusForTaxType) — เตือนแล้วมองข้ามคอลัมน์กลุ่มนี้ทั้งหมด ไม่ error เพื่อไม่บล็อกการนำเข้า
  // เพราะผู้ใช้อาจแค่ก๊อปสูตรลงมาทั้งคอลัมน์
  if (context.taxType === 'no_vat') {
    warnings.push('รายการนี้ไม่มี VAT จึงไม่มีใบกำกับภาษีให้รับ — ข้อมูลในคอลัมน์กลุ่มใบกำกับภาษีจะถูกมองข้าม');
    return empty;
  }

  if (!numberText) {
    errors.push('กรอกข้อมูลใบกำกับภาษีมาบางส่วน แต่ไม่ได้กรอก "เลขที่ใบกำกับภาษี" (ถ้ายังไม่ได้รับใบกำกับภาษี ให้เว้นว่างทั้ง 4 คอลัมน์)');
    return empty;
  }

  const tax_invoice_date = parseExcelDateCell(taxInvoiceDateRaw) ?? '';
  if (!tax_invoice_date) {
    errors.push('กรอกเลขที่ใบกำกับภาษีมาแล้ว ต้องกรอก "วันที่ใบกำกับภาษี" ด้วย (รายงานภาษีซื้อใช้วันที่นี้)');
  }
  if (cellLooksLikeGregorianDmy(taxInvoiceDateRaw)) {
    warnings.push(`วันที่ใบกำกับภาษี "${cellToString(taxInvoiceDateRaw)}" ปีดูเหมือนเป็น ค.ศ. โปรดตรวจสอบว่าควรบันทึกเป็นปี พ.ศ. หรือไม่`);
  }

  // เว้นว่าง = ใช้วันที่ใบกำกับภาษีแทน (ข้อ 3) แต่ถ้ากรอกมาแล้วอ่านไม่ออก ต้องเป็น error ไม่ใช่เงียบๆ
  // ย้อนกลับไปใช้ค่า default เพราะผู้ใช้ตั้งใจระบุวันอื่นไว้จริง
  const receivedDateProvided = cellToString(receivedDateRaw).trim() !== '';
  const parsedReceivedDate = receivedDateProvided ? parseExcelDateCell(receivedDateRaw) : null;
  if (receivedDateProvided && !parsedReceivedDate) {
    errors.push('วันที่ได้รับใบกำกับภาษีไม่ถูกต้อง');
  }
  if (cellLooksLikeGregorianDmy(receivedDateRaw)) {
    warnings.push(`วันที่ได้รับใบกำกับภาษี "${cellToString(receivedDateRaw)}" ปีดูเหมือนเป็น ค.ศ. โปรดตรวจสอบว่าควรบันทึกเป็นปี พ.ศ. หรือไม่`);
  }
  const received_date = parsedReceivedDate ?? tax_invoice_date;

  if (tax_invoice_date && context.transactionDate && tax_invoice_date < context.transactionDate) {
    warnings.push('วันที่ใบกำกับภาษีอยู่ก่อนวันที่ทำรายการ — โปรดตรวจสอบว่ากรอกถูกต้อง');
  }

  // เดาเดือน/ปีที่ใช้เครดิตจากวันที่ได้รับ (ข้อ 4) — กรอกเองทับได้
  let vat_claim_month: number | '' = '';
  let vat_claim_year: number | '' = '';
  const claimPeriodProvided = cellToString(claimPeriodRaw).trim() !== '';
  if (claimPeriodProvided) {
    const parsed = parseVatClaimPeriod(claimPeriodRaw);
    if (!parsed) {
      errors.push(
        `เดือน/ปีที่ใช้เครดิต VAT ไม่ถูกต้อง: "${cellToString(claimPeriodRaw)}" (ต้องเป็นรูปแบบ ดด/ปปปป ปี พ.ศ. เช่น 09/2569)`
      );
    } else {
      vat_claim_month = parsed.month;
      vat_claim_year = parsed.year;
    }
  } else if (received_date) {
    const [y, m] = received_date.split('-').map(Number);
    vat_claim_month = m;
    vat_claim_year = y + BUDDHIST_YEAR_OFFSET;
  }

  return {
    tax_invoice_number: numberText,
    tax_invoice_date,
    received_date,
    vat_claim_month,
    vat_claim_year,
    errors,
    warnings,
  };
}

/**
 * แปลง 1 แถวดิบจาก Excel (object ที่ key ตรงกับหัวคอลัมน์ EXCEL_HEADERS) ให้เป็น ExcelImportRow
 * พร้อมตรวจสอบความถูกต้อง แถวที่ว่างทั้งแถว (เช่นแถวว่างท้ายไฟล์) จะคืนค่า null เพื่อข้ามไปได้
 *
 * การจำแนกประเภทภาษี (ตั้งแต่ 2026-07-15): ไม่มีคอลัมน์ "ประเภทภาษี" ให้กรอก/เลือกเองอีกต่อไปแล้ว —
 * ระบบตรวจจากยอดในคอลัมน์ "VAT" โดยตรงเสมอเพียงอย่างเดียว (ดู parseVatCell ด้านบนสำหรับการแปลงค่าที่
 * ปลอดภัย): VAT มากกว่า 0 → "มี VAT" (claimable_vat, เข้าขั้นตอนรอรับใบกำกับภาษีเดิมทุกประการ) VAT
 * เป็นค่าว่าง/0/0.00/เครื่องหมาย "-" → "ไม่มี VAT" (no_vat, ไม่มีขั้นตอนรอรับใดๆ) ข้อสังเกต: ก่อนหน้านี้
 * VAT ว่างจะถูกเสนอ 7% อัตโนมัติให้ (ระบบเดิมสมมติว่าผู้ใช้แค่ลืมกรอก) — ตอนนี้เปลี่ยนพฤติกรรมตามที่ระบุ
 * มาโดยตรง: VAT ว่าง = ไม่มี VAT จริงๆ ไม่ใช่ลืมกรอกอีกต่อไป (ฟอร์มเพิ่มรายการด้วยตนเองยังคงเสนอ 7%
 * อัตโนมัติเหมือนเดิมทุกประการ ไม่ถูกกระทบ — เปลี่ยนเฉพาะเส้นทางนำเข้าจาก Excel เท่านั้น)
 *
 * ถ้าคอลัมน์ VAT อ่านค่าเป็นตัวเลขไม่ได้เลย (เช่น "abc") จะถือเป็น error บล็อกแถวนั้นไว้ ยังไม่สามารถ
 * จำแนกประเภทภาษีได้ (tax_type จะเป็น '' ชั่วคราว) จนกว่าจะแก้ไขค่าให้ถูกต้อง
 *
 * ตั้งแต่ 2026-09-21 ยังตีความ 4 คอลัมน์ท้าย (ข้อมูลการรับใบกำกับภาษี) ด้วย — ดู resolveTaxInvoiceReceipt
 */
export function parseExcelRow(raw: Record<string, unknown>, rowNumber: number): ExcelImportRow | null {
  const vendor_name = cellToString(raw[EXCEL_HEADERS.vendor_name]);
  const transactionDateRaw = raw[EXCEL_HEADERS.transaction_date];
  const vendor_tax_id = cellToString(raw[EXCEL_HEADERS.vendor_tax_id]);
  const contact_person = cellToString(raw[EXCEL_HEADERS.contact_person]);
  const description = cellToString(raw[EXCEL_HEADERS.description]);
  const amountRaw = raw[EXCEL_HEADERS.amount_excl_vat];
  const vatRaw = raw[EXCEL_HEADERS.vat_amount];
  const whtRaw = raw[EXCEL_HEADERS.wht_amount];
  const totalRaw = raw[EXCEL_HEADERS.total_amount];
  const reference_no = cellToString(raw[EXCEL_HEADERS.reference_no]);
  const expectedDateRaw = raw[EXCEL_HEADERS.expected_date];
  const notes = cellToString(raw[EXCEL_HEADERS.notes]);

  const isRowEmpty =
    !vendor_name &&
    !transactionDateRaw &&
    !vendor_tax_id &&
    !contact_person &&
    !description &&
    (amountRaw === undefined || amountRaw === null || amountRaw === '') &&
    (vatRaw === undefined || vatRaw === null || vatRaw === '') &&
    !reference_no &&
    !expectedDateRaw &&
    !notes &&
    // นับคอลัมน์กลุ่มใบกำกับภาษีด้วย (2026-09-21) — ไม่งั้นแถวที่ผู้ใช้เผลอกรอกมาแต่ข้อมูลใบกำกับภาษี
    // อย่างเดียวจะถูกข้ามเงียบๆ โดยไม่มีอะไรบอกว่าทำไมแถวนั้นหายไปจากตารางตรวจสอบ
    !cellToString(raw[EXCEL_HEADERS.tax_invoice_number]).trim() &&
    !cellToString(raw[EXCEL_HEADERS.tax_invoice_date]).trim() &&
    !cellToString(raw[EXCEL_HEADERS.received_date]).trim() &&
    !cellToString(raw[EXCEL_HEADERS.vat_claim_period]).trim();
  if (isRowEmpty) return null;

  const errors: string[] = [];
  const warnings: string[] = [];

  if (!vendor_name) errors.push('ไม่ได้กรอกผู้ขาย');

  const transaction_date = parseExcelDateCell(transactionDateRaw) ?? '';
  if (!transaction_date) errors.push('วันที่ทำรายการไม่ถูกต้องหรือไม่ได้กรอก');
  if (cellLooksLikeGregorianDmy(transactionDateRaw)) {
    warnings.push(`วันที่ทำรายการ "${transactionDateRaw}" ปีดูเหมือนเป็น ค.ศ. โปรดตรวจสอบว่าควรบันทึกเป็นปี พ.ศ. หรือไม่`);
  }

  // เลขประจำตัวผู้เสียภาษีไม่บังคับกรอก แต่ถ้ากรอกมาต้องเป็นตัวเลข 13 หลักเท่านั้น (เหมือนฟอร์มเพิ่มรายการ)
  if (vendor_tax_id && !/^\d{13}$/.test(vendor_tax_id)) {
    errors.push('เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก');
  }

  const amount_excl_vat = cellToNumberString(amountRaw);
  const amountNum = parseFloat(amount_excl_vat);
  const amountValid = amount_excl_vat !== '' && Number.isFinite(amountNum) && amountNum > 0;
  if (!amountValid) errors.push('ยอดก่อน VAT ต้องเป็นตัวเลขมากกว่า 0');

  // จำแนกประเภทภาษีจากยอด VAT เพียงอย่างเดียวเสมอ (ดู parseVatCell) — ไม่มีทางอื่นให้ระบุอีกแล้ว
  const vatCell = parseVatCell(vatRaw);
  let vat_amount: string;
  let tax_type: TaxType | '';
  if (vatCell.kind === 'invalid') {
    errors.push(
      `VAT ไม่ถูกต้อง: "${vatCell.raw}" (ต้องเป็นตัวเลขที่ไม่ติดลบ เช่น 7, 70, 1,400.00 หรือเว้นว่าง/"-" ถ้าไม่มี VAT)`
    );
    vat_amount = cellToString(vatRaw); // เก็บค่าดิบไว้แสดงในหน้าตรวจสอบ ให้เห็นว่ากรอกอะไรมาผิด
    tax_type = ''; // ยังจำแนกไม่ได้ — แถวนี้ import ไม่ได้อยู่แล้วเพราะมี error ค้างอยู่
  } else {
    vat_amount = String(vatCell.amount);
    tax_type = vatCell.amount > 0 ? 'claimable_vat' : 'no_vat';
  }

  // หัก ณ ที่จ่าย — ไม่บังคับกรอก ใช้ตรรกะแปลงค่าเดียวกับคอลัมน์ VAT (ว่าง/"-"/0 = 0) ตรวจสอบเพิ่มว่า
  // ต้องไม่เกินยอดรวม (ยอดก่อน VAT + VAT) ที่คำนวณได้จากแถวนี้ เหมือนกับที่ฟอร์มเพิ่มรายการด้วยตนเอง
  // ตรวจสอบ (ดู validateInvoiceForm ใน lib/invoiceLogic.ts)
  const whtCell = parseVatCell(whtRaw);
  let wht_amount: string;
  if (whtCell.kind === 'invalid') {
    errors.push(
      `หัก ณ ที่จ่ายไม่ถูกต้อง: "${whtCell.raw}" (ต้องเป็นตัวเลขที่ไม่ติดลบ หรือเว้นว่าง/"-" ถ้าไม่มีการหัก)`
    );
    wht_amount = cellToString(whtRaw);
  } else {
    wht_amount = String(whtCell.amount);
    if (amountValid && vatCell.kind === 'ok') {
      const computedTotal = round2(amountNum + vatCell.amount);
      if (whtCell.amount > computedTotal) {
        errors.push('ยอดหัก ณ ที่จ่ายต้องไม่เกินยอดรวม (ยอดก่อน VAT + VAT)');
      }
    }
  }

  // ตรวจสอบยอดรวมที่ผู้ใช้กรอกมาในไฟล์ (ถ้ามี) เทียบกับผลรวมที่คำนวณได้จริง (ยอดก่อน VAT + VAT) — แค่
  // เตือนเฉยๆ ไม่ error และไม่มีทาง "เขียนทับ" อะไรอยู่แล้ว เพราะยอดรวมจริงในฐานข้อมูลเป็นคอลัมน์ที่
  // Supabase คำนวณอัตโนมัติเสมอ (generated column) ไม่เคยอ่านค่าจากคอลัมน์นี้ไปบันทึกตรงๆ
  const totalCellText = cellToString(totalRaw);
  if (totalCellText && amountValid && vatCell.kind === 'ok') {
    const totalNum = parseFloat(totalCellText.replace(/,/g, ''));
    if (Number.isFinite(totalNum)) {
      const computedTotal = round2(amountNum + vatCell.amount);
      if (Math.abs(totalNum - computedTotal) > 0.01) {
        warnings.push(
          `ยอดรวมที่กรอกมา (${totalNum.toFixed(2)}) ไม่ตรงกับยอดที่คำนวณได้ (${computedTotal.toFixed(2)} = ยอดก่อน VAT + VAT) — ระบบจะบันทึกยอดรวมตามที่คำนวณได้เสมอ`
        );
      }
    }
  }

  const isNoVat = tax_type === 'no_vat';
  const expected_date = isNoVat ? '' : parseExcelDateCell(expectedDateRaw) ?? '';
  const expectedDateProvided =
    !isNoVat && expectedDateRaw !== undefined && expectedDateRaw !== null && String(expectedDateRaw).trim() !== '';
  if (expectedDateProvided && !expected_date) {
    errors.push('วันที่คาดว่าจะได้รับไม่ถูกต้อง');
  }
  if (cellLooksLikeGregorianDmy(expectedDateRaw)) {
    warnings.push(`วันที่คาดว่าจะได้รับ "${expectedDateRaw}" ปีดูเหมือนเป็น ค.ศ. โปรดตรวจสอบว่าควรบันทึกเป็นปี พ.ศ. หรือไม่`);
  }
  if (expected_date && transaction_date && expected_date < transaction_date) {
    errors.push('วันที่คาดว่าจะได้รับต้องไม่ก่อนวันที่ทำรายการ');
  }

  // ข้อมูลการรับใบกำกับภาษี (2026-09-21) — ตรรกะทั้งหมดอยู่ใน resolveTaxInvoiceReceipt เพื่อให้เขียนเทสต์
  // แยกได้ชัดเจน ที่นี่แค่รวม errors/warnings ที่ได้กลับมาเข้ากับของแถว
  const receipt = resolveTaxInvoiceReceipt(raw, { taxType: tax_type, transactionDate: transaction_date });
  errors.push(...receipt.errors);
  warnings.push(...receipt.warnings);

  // ได้รับใบกำกับภาษีมาแล้วก็ไม่ต้องมี "วันที่คาดว่าจะได้รับ" อีก (ไม่เหลืออะไรให้รอ) — ล้างทิ้งเงียบๆ
  // ไม่เตือน เพราะผู้ใช้ที่กรอกมาทั้งสองช่องไม่ได้ทำอะไรผิด แค่ข้อมูลนั้นหมดประโยชน์ไปแล้ว
  const expectedDateFinal = receipt.tax_invoice_number ? '' : expected_date;

  return {
    rowNumber,
    vendor_name,
    transaction_date,
    vendor_tax_id,
    contact_person,
    description,
    amount_excl_vat,
    vat_amount,
    tax_type,
    wht_amount,
    reference_no,
    expected_date: expectedDateFinal,
    notes,
    tax_invoice_number: receipt.tax_invoice_number,
    tax_invoice_date: receipt.tax_invoice_date,
    received_date: receipt.received_date,
    vat_claim_month: receipt.vat_claim_month,
    vat_claim_year: receipt.vat_claim_year,
    errors,
    warnings,
  };
}

/** แปลงแถวดิบทั้งหมดจาก Excel (ตามลำดับในไฟล์) ให้เป็น ExcelImportRow[] โดยข้ามแถวว่างไปอัตโนมัติ */
export function parseExcelRows(rawRows: Record<string, unknown>[]): ExcelImportRow[] {
  const rows: ExcelImportRow[] = [];
  rawRows.forEach((raw, idx) => {
    // แถวที่ 1 ในไฟล์คือ header เสมอ ดังนั้นแถวข้อมูลแถวแรก (idx 0) = แถวที่ 2 จริง
    const parsed = parseExcelRow(raw, idx + 2);
    if (parsed) rows.push(parsed);
  });
  return rows;
}

function dedupeKey(vendorName: string, transactionDate: string, referenceNo: string | null, totalAmount: number): string {
  return [vendorName.trim().toLowerCase(), transactionDate, (referenceNo ?? '').trim().toLowerCase(), totalAmount.toFixed(2)].join(
    '|'
  );
}

/** ตรวจหารายการที่ดูเหมือนจะซ้ำกับรายการที่มีอยู่แล้วในระบบ ก่อนนำเข้าจาก Excel — เทียบจาก
 * ผู้ขาย + วันที่ทำรายการ + เลขที่อ้างอิง + ยอดรวม ตรงกันทั้งหมด คืนค่าเป็นเซ็ตของ rowNumber ที่ซ้ำ
 * ไม่ block การนำเข้า (แค่เตือน) — ผู้ใช้เลือกรวมรายการนั้นเข้าไปได้เองในหน้าตรวจสอบถ้ามั่นใจว่าไม่ซ้ำจริง
 * ข้ามแถวที่มี errors อยู่แล้วเพราะยังไงก็ import ไม่ได้ ไม่ต้องเสียเวลาตรวจซ้ำ */
export function findDuplicateRowNumbers(rows: ExcelImportRow[], existingInvoices: PendingTaxInvoice[]): Set<number> {
  const existingKeys = new Set(
    existingInvoices.map((inv) => dedupeKey(inv.vendor_name, inv.transaction_date, inv.reference_no, inv.total_amount))
  );
  const duplicates = new Set<number>();
  for (const row of rows) {
    if (row.errors.length > 0) continue;
    const amount = parseFloat(row.amount_excl_vat) || 0;
    const vat = parseFloat(row.vat_amount) || 0;
    const key = dedupeKey(row.vendor_name, row.transaction_date, row.reference_no, round2(amount + vat));
    if (existingKeys.has(key)) duplicates.add(row.rowNumber);
  }
  return duplicates;
}

/** แปลง ExcelImportRow ที่ผ่านการตรวจสอบและมีประเภทภาษีที่ชัดเจนแล้ว ให้เป็น payload สำหรับบันทึกลง
 * Supabase — สถานะ (pending/received) คำนวณอัตโนมัติตามประเภทภาษี (ดู deriveStatusForTaxType)
 * หมายเหตุ: ฟังก์ชันนี้ควรถูกเรียกเฉพาะแถวที่ tax_type ไม่ใช่ '' เท่านั้น (หน้าตรวจสอบกรองแถว error/
 * ยังจำแนกไม่ได้ออกไปก่อนแล้วเสมอ) ค่า default 'no_vat' ด้านล่างเป็นแค่ fallback ป้องกันไว้เฉยๆ ในทาง
 * ปฏิบัติไม่ควรถูกใช้จริง */
export function excelRowToWriteInput(row: ExcelImportRow): InvoiceWriteInput {
  const taxType: TaxType = row.tax_type || 'no_vat';
  const isNoVat = taxType === 'no_vat';

  // ไฟล์กรอกเลขที่ใบกำกับภาษีมาด้วย = ได้รับใบกำกับภาษีแล้ว (2026-09-21) — ข้ามขั้นตอน "รอรับ" ไปเลย
  // deriveStatusForTaxType(taxType, 'received') คืน 'received' เสมอสำหรับ claimable_vat (ดูตรรกะใน
  // lib/invoiceLogic.ts) จึงใช้ทางเดียวกับที่ฟอร์มแก้ไขรายการใช้ ไม่ต้องเขียน 'received' ตรงๆ ที่นี่
  // ซึ่งจะกลายเป็นตรรกะสถานะชุดที่สองที่ต้องคอยประสานกันเอง
  //
  // กันเหนียว: ต้องมีทั้งเลขที่และวันที่ใบกำกับภาษีถึงจะนับว่าได้รับแล้ว — resolveTaxInvoiceReceipt ทำให้
  // "มีเลขที่แต่ไม่มีวันที่" เป็น error อยู่แล้ว และหน้าตรวจสอบก็กรองแถวที่มี error ออกก่อนเสมอ แต่ฟังก์ชันนี้
  // เป็น export สาธารณะ ผู้เรียกในอนาคตอาจข้ามการกรองนั้นไป ถ้าหลุดมาได้จะเกิดรายการสถานะ "ได้รับแล้ว" ที่
  // ไม่มีวันที่ใบกำกับภาษี ซึ่งจะหายไปจากรายงานภาษีซื้อแบบเงียบๆ (รายงานใช้วันที่นั้นเป็นตัวกรองหลัก)
  const isReceived = Boolean(row.tax_invoice_number && row.tax_invoice_date);

  return {
    vendor_name: row.vendor_name.trim(),
    transaction_date: row.transaction_date,
    description: row.description.trim() || null,
    amount_excl_vat: parseFloat(row.amount_excl_vat) || 0,
    vat_amount: isNoVat ? 0 : parseFloat(row.vat_amount) || 0,
    wht_amount: parseFloat(row.wht_amount) || 0,
    reference_no: row.reference_no.trim() || null,
    contact_person: row.contact_person.trim() || null,
    expected_date: isNoVat ? null : row.expected_date || null,
    notes: row.notes.trim() || null,
    vendor_tax_id: row.vendor_tax_id.trim() || null,
    tax_type: taxType,
    status: deriveStatusForTaxType(taxType, isReceived ? 'received' : undefined),
    tax_invoice_number: row.tax_invoice_number || null,
    tax_invoice_date: row.tax_invoice_date || null,
    received_date: row.received_date || null,
    vat_claim_month: row.vat_claim_month === '' ? null : row.vat_claim_month,
    vat_claim_year: row.vat_claim_year === '' ? null : row.vat_claim_year,
  };
}

/** คอลัมน์ที่ต้องมีครบถึงจะถือว่าแถวนั้นคือ "แถวหัวคอลัมน์จริง" — เลือก 3 ตัวที่บังคับกรอกเสมอ จึงไม่มีทาง
 *  หายไปจากไฟล์ที่ใช้งานจริงได้ (ดู detectHeaderRow) */
const HEADER_DETECTION_KEYS: string[] = [
  EXCEL_HEADERS.vendor_name,
  EXCEL_HEADERS.transaction_date,
  EXCEL_HEADERS.amount_excl_vat,
];

/** จำนวนแถวแรกสุดที่ยอมไล่หาแถวหัวคอลัมน์ — เผื่อผู้ใช้แทรกแถวชื่อรายงาน/ช่วงวันที่ไว้ด้านบนเองด้วย */
const HEADER_SCAN_ROW_LIMIT = 10;

/**
 * หาว่าแถวไหนคือแถวหัวคอลัมน์จริง (0-based) — คืน 0 ถ้าหาไม่เจอ เพื่อให้พฤติกรรมเหมือนเดิมทุกประการ
 *
 * เพิ่มเข้ามา 2026-09-21 พร้อมการแบ่งเทมเพลตเป็น 2 ฝั่ง: เทมเพลตใหม่มีแถว "หัวข้อกลุ่ม" (บันทึกการจ่ายเงิน /
 * บันทึกใบกำกับภาษี) อยู่เหนือแถวหัวคอลัมน์ ถ้ายังอ่านแถวแรกเป็นหัวคอลัมน์ตายตัวแบบเดิม ทุกคอลัมน์จะกลาย
 * เป็นชื่อกลุ่มกับค่าว่าง แล้วไฟล์ทั้งไฟล์จะนำเข้าไม่ได้เลยสักแถว
 *
 * ผลพลอยได้: ไฟล์ที่ผู้ใช้แทรกแถวหัวรายงานของตัวเองไว้ด้านบน (ซึ่งเดิมนำเข้าไม่ได้เลย) ก็ใช้ได้ด้วย และไฟล์
 * เทมเพลตเก่าที่มีแถวหัวคอลัมน์อยู่แถวแรกก็ยังคืน 0 เหมือนเดิม ไม่กระทบอะไร
 *
 * แนวทางเดียวกับ detectHeaderRow ใน lib/bankReconcileParse.ts ที่ใช้กับไฟล์ Bank Statement อยู่แล้ว
 */
function detectHeaderRow(aoa: unknown[][]): number {
  const limit = Math.min(aoa.length, HEADER_SCAN_ROW_LIMIT);
  for (let r = 0; r < limit; r++) {
    const cells = (aoa[r] ?? []).map((cell) => String(cell ?? '').trim());
    if (HEADER_DETECTION_KEYS.every((key) => cells.includes(key))) return r;
  }
  return 0;
}

/** แปลง worksheet หนึ่งชีทเป็น array ของแถวดิบ (key ตรงกับหัวคอลัมน์) โดยหาแถวหัวคอลัมน์จริงให้เอง
 *  แยกออกมาเป็น export เพื่อให้เทสต์/e2e อ่านชีท "ตัวอย่าง" ด้วยตรรกะเดียวกันได้ ไม่ต้องรู้เรื่องแถวหัวข้อกลุ่ม */
/**
 * ตัวเลือกการอ่านไฟล์ Excel ที่ใช้ร่วมกันทุกจุด — **ห้ามใส่ `cellDates: true`**
 *
 * เหตุผล (แก้ 2026-09-22 จากบั๊กที่ผู้ใช้แจ้ง: กรอกกันยายนในเทมเพลต แต่ระบบบันทึกเป็นสิงหาคม):
 *
 * เมื่อเปิด cellDates ไลบรารี xlsx จะแปลงเซลล์วันที่เป็น Date object ให้เอง โดยคำนวณจาก "เที่ยงคืนของ
 * วันที่ 30 ธ.ค. 1899 ตามเวลาท้องถิ่น" แล้วบวก offset ด้วย getTimezoneOffset() ซึ่งคืนค่าเป็น "นาที"
 * เต็มหน่วยเท่านั้น — แต่โซนเวลาไทยในปี 1899 คือ UTC+6:42:04 (เวลาสุริยคติท้องถิ่นก่อนมีเขตเวลามาตรฐาน)
 * วินาทีที่ 4 จึงถูกปัดทิ้ง ทำให้ทุกวันที่ที่ไลบรารีสร้างในเครื่องที่ตั้งโซนเวลาเป็นไทย ขาดไป 4 วินาที
 * = ตกไปอยู่ "23:59:56 ของวันก่อนหน้า" พอดี
 *
 * ผลคือ 1 ก.ย. กลายเป็น 31 ส.ค. เงียบๆ — ไม่ใช่แค่ช่องเดือน/ปีที่ใช้เครดิต VAT แต่กระทบ "ทุกช่องวันที่"
 * ที่นำเข้าจาก Excel ในเครื่องผู้ใช้ไทย (ปัญหาเดียวกันเกิดกับ Asia/Jakarta, Asia/Kolkata, Asia/Singapore
 * ซึ่งมีเศษวินาทีแบบเดียวกัน)
 *
 * ทางแก้: ไม่ให้ไลบรารีสร้าง Date เลย รับเป็น "เลข serial" ดิบๆ แทน แล้วแปลงเองด้วย excelSerialToDate
 * ซึ่งใช้คณิตศาสตร์ UTC ล้วน ไม่ขึ้นกับโซนเวลาของเครื่องใดๆ ทั้งสิ้น — ต้องอ่านกลับด้วย isoFromUtcDate
 * (ไม่ใช่ toISODate ซึ่งอ่านแบบเวลาท้องถิ่นและมีไว้ใช้กับ Date ที่สร้างขึ้นเองในโค้ด) ขาดอย่างใดอย่างหนึ่ง
 * ก็ยังเพี้ยนอยู่ — ดูคอมเมนต์เปรียบเทียบสองฟังก์ชันนั้นประกอบ
 */
const WORKBOOK_READ_OPTIONS = { type: 'array' } as const;

export function readSheetRows(worksheet: XLSX.WorkSheet): Record<string, unknown>[] {
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, blankrows: true });
  const headerRow = detectHeaderRow(aoa);

  // แปลงเลขแถวให้เป็น "เลขแถวจริงของชีท" ก่อนส่งต่อ — สองฟังก์ชันนี้นับแถวคนละระบบกัน:
  //   sheet_to_json({header:1}) เริ่มนับจากแถวแรกที่ "มีข้อมูล" (!ref.s.r) → aoa[0] ไม่จำเป็นต้องเป็นแถว 1
  //   sheet_to_json({range:N})  N คือเลขแถวจริงของชีทเสมอ
  // สองค่านี้ตรงกันเฉพาะตอนชีทเริ่มที่ A1 เท่านั้น ไฟล์ที่ Excel บันทึก !ref เริ่มต่ำกว่านั้น (เช่น เว้นสองแถว
  // แรกว่างไว้จริงๆ → dimension ref="A3:P4") จะคลาดกันเท่ากับ !ref.s.r แล้วอ่านหัวคอลัมน์ผิดแถวจนนำเข้า
  // ไม่ได้เลยสักรายการแบบเงียบๆ — ซึ่งเป็นอาการเดียวกับที่โค้ดชุดนี้ตั้งใจจะแก้พอดี
  const firstUsedRow = XLSX.utils.decode_range(worksheet['!ref'] ?? 'A1').s.r;
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: '',
    range: firstUsedRow + headerRow,
  });
}

/** อ่านไฟล์ Excel (ArrayBuffer) แล้วแปลงชีทแรกให้เป็น array ของแถวดิบ (key ตรงกับหัวคอลัมน์) */
export function readWorkbookRows(data: ArrayBuffer): Record<string, unknown>[] {
  const workbook = XLSX.read(data, WORKBOOK_READ_OPTIONS);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  return readSheetRows(workbook.Sheets[sheetName]);
}

/** สร้างไฟล์ Excel เทมเพลต คืนค่าเป็น Blob พร้อมดาวน์โหลด — 3 ชีท (ปรับโครงสร้าง 2026-09-21):
 *
 *   รายการ   ชีทที่กรอกข้อมูลจริง มีแต่หัวคอลัมน์ ไม่มีแถวตัวอย่างปน (readWorkbookRows อ่านชีทนี้)
 *   ตัวอย่าง  3 แถวสาธิต — มี VAT+ได้รับใบกำกับภาษีแล้ว / มี VAT แต่ยังไม่ได้รับ / ไม่มี VAT
 *   วิธีใช้   ตารางบอกว่าคอลัมน์ไหนบังคับกรอก และกติกาที่เดาจากหัวคอลัมน์ไม่ได้
 *
 * ไม่มีคอลัมน์ "ประเภทภาษี" ให้กรอกเอง ระบบตรวจจากคอลัมน์ VAT อย่างเดียว (กรอก = มี VAT, เว้นว่าง = ไม่มี)
 * ซึ่งเป็นเหตุผลที่ต้องมีตัวอย่างทั้งสองแบบให้เห็นคู่กัน */
export function buildTemplateBlob(): Blob {
  // ตัวอย่างวันที่ในเทมเพลต (เพิ่มคอมเมนต์ 2026-08-26 แก้ตามที่ผู้ใช้ทักว่า "ทำไมตัวอย่างเป็น ค.ศ. ทั้งๆ
  // ที่ขอแก้เป็น พ.ศ. ทั้งระบบแล้ว") — เดิมใส่ `new Date()` ตรงๆ ซึ่ง XLSX.utils.json_to_sheet แปลงเป็นเซลล์
  // วันที่จริงของ Excel (native date cell) เซลล์ประเภทนี้ Excel เองมีปฏิทินเดียวคือเกรกอเรียน ไม่มีตัวเลือก
  // พ.ศ. ให้เลย จึงโชว์ปี ค.ศ. เสมอไม่ว่าจะพยายามจัด numFmt ยังไงก็ตาม (จุดนี้ไม่เกี่ยวกับ parseExcelDateCell
  // ที่ตั้งใจเชื่อปี ค.ศ. ตรงๆ จากเซลล์วันที่จริงของ Excel อยู่แล้ว — ดูคอมเมนต์ cellLooksLikeGregorianDmy
  // ด้านบน — แต่เป็นคนละเรื่องกับที่ผู้ใช้เห็นแล้วสับสน เพราะเซลล์ตัวอย่างนี้ไม่ได้ตั้งใจจะสาธิตการพิมพ์ปี ค.ศ.
  // แต่อย่างใด) แก้โดยเปลี่ยนเป็นข้อความ วว/ดด/ปปปป (พ.ศ.) ธรรมดาแทน — ผ่าน parseExcelDateCell ทาง branch
  // string ปกติ ซึ่งลบ 543 ให้อัตโนมัติเมื่อปี >= 2200 (แก้ 2026-09-02) และไม่โดน cellLooksLikeGregorianDmy
  // เตือนด้วย
  //
  // (แก้คอมเมนต์ 2026-09-21) ข้อความเดิมตรงนี้เขียนว่า "เก็บปีตามที่พิมพ์ตรงๆ ไม่แปลง ตรงกับ convention
  // ปีในระบบทั้งหมดที่เก็บเป็นเลข พ.ศ. ตรงๆ" ซึ่ง **ไม่จริงแล้ว** และเป็นคำอธิบายที่อันตราย: คอลัมน์ชนิด
  // date ทั้งหมดในฐานข้อมูลเก็บเป็น ค.ศ. เสมอ (มีแค่ vat_claim_year กับ period_year ที่เป็น พ.ศ. เพราะ
  // เป็นตัวเลขธรรมดาไม่ใช่วันที่) ปล่อยคอมเมนต์ผิดไว้เสี่ยงให้คนแก้โค้ดรอบหน้าทำพังซ้ำรอยเดิม
  const exampleDateText = formatBuddhistDateInput(toISODate(new Date()));
  const exampleRows: Record<string, unknown>[] = [
    {
      // แถวที่ 1 — มี VAT และ "ได้รับใบกำกับภาษีมาแล้ว" (เพิ่ม 2026-09-21) สาธิตการกรอก 4 คอลัมน์ท้าย
      // ซึ่งเป็นกรณีที่ผู้ใช้บอกว่าเจอบ่อย: จ่ายเงินออกไปแล้วได้ใบกำกับภาษีมาพร้อมกันเลย
      [EXCEL_HEADERS.vendor_name]: 'บริษัท ตัวอย่าง จำกัด',
      [EXCEL_HEADERS.transaction_date]: exampleDateText,
      [EXCEL_HEADERS.vendor_tax_id]: '',
      [EXCEL_HEADERS.contact_person]: 'คุณสมชาย (ฝ่ายบัญชี)',
      [EXCEL_HEADERS.description]: 'ตัวอย่าง: มี VAT และได้รับใบกำกับภาษีแล้ว',
      [EXCEL_HEADERS.amount_excl_vat]: 1000,
      [EXCEL_HEADERS.vat_amount]: 70,
      [EXCEL_HEADERS.wht_amount]: 30,
      [EXCEL_HEADERS.total_amount]: '',
      [EXCEL_HEADERS.reference_no]: 'PO-0001',
      [EXCEL_HEADERS.expected_date]: '',
      [EXCEL_HEADERS.notes]: '',
      [EXCEL_HEADERS.tax_invoice_number]: 'INV-0001',
      [EXCEL_HEADERS.tax_invoice_date]: exampleDateText,
      [EXCEL_HEADERS.received_date]: '',
      [EXCEL_HEADERS.vat_claim_period]: '',
    },
    {
      // แถวที่ 2 — มี VAT แต่ "ยังไม่ได้รับใบกำกับภาษี" (เว้น 4 คอลัมน์ท้ายว่างไว้) จะขึ้นสถานะรอรับ
      // แล้วค่อยไปกด "ได้รับแล้ว" ทีหลังตามเดิม
      [EXCEL_HEADERS.vendor_name]: 'บริษัท ตัวอย่าง 2 จำกัด',
      [EXCEL_HEADERS.transaction_date]: exampleDateText,
      [EXCEL_HEADERS.vendor_tax_id]: '',
      [EXCEL_HEADERS.contact_person]: '',
      [EXCEL_HEADERS.description]: 'ตัวอย่าง: มี VAT แต่ยังไม่ได้รับใบกำกับภาษี (เว้น 4 ช่องท้ายว่างไว้)',
      [EXCEL_HEADERS.amount_excl_vat]: 2000,
      [EXCEL_HEADERS.vat_amount]: 140,
      [EXCEL_HEADERS.wht_amount]: '',
      [EXCEL_HEADERS.total_amount]: '',
      [EXCEL_HEADERS.reference_no]: '',
      [EXCEL_HEADERS.notes]: '',
      [EXCEL_HEADERS.tax_invoice_number]: '',
      [EXCEL_HEADERS.tax_invoice_date]: '',
      [EXCEL_HEADERS.received_date]: '',
      [EXCEL_HEADERS.vat_claim_period]: '',
    },
    {
      // แถวที่ 3 — ไม่มี VAT (เว้นช่อง VAT ว่าง) ไม่มีขั้นตอนใบกำกับภาษีเลย
      [EXCEL_HEADERS.vendor_name]: 'ร้านค้า ตัวอย่าง 3',
      [EXCEL_HEADERS.transaction_date]: exampleDateText,
      [EXCEL_HEADERS.vendor_tax_id]: '',
      [EXCEL_HEADERS.contact_person]: '',
      [EXCEL_HEADERS.description]: 'ตัวอย่าง: ไม่มี VAT — เว้นช่อง VAT ว่างไว้',
      [EXCEL_HEADERS.amount_excl_vat]: 500,
      [EXCEL_HEADERS.vat_amount]: '',
      [EXCEL_HEADERS.wht_amount]: '',
      [EXCEL_HEADERS.total_amount]: '',
      [EXCEL_HEADERS.reference_no]: '',
      [EXCEL_HEADERS.notes]: '',
      [EXCEL_HEADERS.tax_invoice_number]: '',
      [EXCEL_HEADERS.tax_invoice_date]: '',
      [EXCEL_HEADERS.received_date]: '',
      [EXCEL_HEADERS.vat_claim_period]: '',
    },
  ];

  /* ชีท "รายการ" = ที่กรอกข้อมูลจริง มีแต่หัวคอลัมน์ ไม่มีแถวตัวอย่างปน (เปลี่ยน 2026-09-21)
   *
   * เดิมวางตัวอย่างไว้ในชีทเดียวกับข้อมูลจริง พร้อมข้อความกำกับว่า "ลบแถวนี้ทิ้งแล้วกรอกของจริงแทนได้เลย"
   * แต่ในทางปฏิบัติผู้ใช้ลืมลบเป็นเรื่องปกติมาก แล้ว "บริษัท ตัวอย่าง จำกัด" ก็หลุดเข้าไปเป็นรายการจริง
   * — ย้ายตัวอย่างไปชีทที่สองชื่อ "ตัวอย่าง" แทน ซึ่ง readWorkbookRows อ่านเฉพาะชีทแรกเสมอ (ดูฟังก์ชัน
   * ด้านบน) จึงไม่มีทางถูกนำเข้าโดยไม่ตั้งใจได้เลย ไม่ต้องพึ่งวินัยของผู้ใช้อีกต่อไป */
  const dataSheet = buildGroupedSheet([]);
  const exampleSheet = buildGroupedSheet(exampleRows);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, dataSheet, 'รายการ');
  XLSX.utils.book_append_sheet(workbook, exampleSheet, 'ตัวอย่าง');
  XLSX.utils.book_append_sheet(workbook, buildGuideSheet(), 'วิธีใช้');
  const arrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Blob([arrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

const PAYMENT_GROUP_LABEL = '① ฝั่งบันทึกการจ่ายเงิน — กรอกทุกรายการ';
const TAX_INVOICE_GROUP_LABEL = '② ฝั่งบันทึกใบกำกับภาษี — กรอกเฉพาะรายการที่ได้รับใบกำกับภาษีมาแล้ว';

/**
 * สร้างชีทที่มี "แถวหัวข้อกลุ่ม" คร่อมอยู่เหนือแถวหัวคอลัมน์ (เพิ่ม 2026-09-21 ตามคำขอผู้ใช้ให้แบ่งสองฝั่ง
 * ให้ชัดเจน) โครงสร้าง 3 ชั้น:
 *
 *   แถว 1  หัวข้อกลุ่ม 2 ช่อง (merge) — ฝั่งจ่ายเงิน | ฝั่งใบกำกับภาษี
 *   แถว 2  หัวคอลัมน์จริง (EXCEL_HEADER_ORDER)
 *   แถว 3+ ข้อมูล
 *
 * ทำไมใช้แถวหัวข้อกลุ่มไม่ใช่สีพื้น: ไลบรารี xlsx รุ่นฟรีที่โปรเจกต์ใช้อยู่ "เขียนสีลงเซลล์ไม่ได้" (เป็น
 * ฟีเจอร์ของรุ่นเสียเงิน) จะทำสีต้องลงไลบรารีเพิ่ม ซึ่งผู้ใช้เลือกไม่ลง (2026-09-21) — แถวหัวข้อกลุ่มแบบ
 * รวมเซลล์จึงเป็นวิธีที่แบ่งสายตาได้ชัดที่สุดเท่าที่ทำได้โดยไม่เพิ่ม dependency
 *
 * ผู้อ่านไฟล์ไม่ต้องรู้เรื่องแถวนี้เลย — readSheetRows หาแถวหัวคอลัมน์จริงเองด้วย detectHeaderRow
 */
function buildGroupedSheet(rows: Record<string, unknown>[]): XLSX.WorkSheet {
  const groupRow: string[] = new Array(EXCEL_HEADER_ORDER.length).fill('');
  groupRow[0] = PAYMENT_GROUP_LABEL;
  groupRow[PAYMENT_COLUMN_COUNT] = TAX_INVOICE_GROUP_LABEL;

  const body = rows.map((row) => EXCEL_HEADER_ORDER.map((header) => row[header] ?? ''));
  const sheet = XLSX.utils.aoa_to_sheet([groupRow, [...EXCEL_HEADER_ORDER], ...body]);

  // รวมเซลล์หัวข้อกลุ่มให้คลุมช่วงคอลัมน์ของแต่ละฝั่ง เพื่อให้เห็นเป็นสองบล็อกชัดๆ ตอนเปิดใน Excel
  sheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: PAYMENT_COLUMN_COUNT - 1 } },
    { s: { r: 0, c: PAYMENT_COLUMN_COUNT }, e: { r: 0, c: EXCEL_HEADER_ORDER.length - 1 } },
  ];
  sheet['!cols'] = EXCEL_HEADER_ORDER.map((h) => ({ wch: Math.max(h.length + 2, 16) }));
  return sheet;
}

/** ชีท "วิธีใช้" — บอกว่าคอลัมน์ไหนบังคับกรอก และกติกาที่เดาเองไม่ได้ (เพิ่ม 2026-09-21)
 *
 * เดิมข้อมูลพวกนี้ไม่มีอยู่ในไฟล์เลย ผู้ใช้ต้องอัปโหลดแล้วรอดู error ถึงจะรู้ว่าอะไรบังคับบ้าง — ที่แย่กว่านั้น
 * คือกติกาบางข้อ (เช่น ระบบดูจากคอลัมน์ VAT ว่ามี/ไม่มี VAT, กรอกเลขที่ใบกำกับภาษี = ถือว่าได้รับแล้ว)
 * ไม่มีทางเดาได้จากหัวคอลัมน์เลยแม้แต่น้อย */
function buildGuideSheet(): XLSX.WorkSheet {
  const rows = [
    ['คอลัมน์', 'บังคับกรอก', 'คำอธิบาย'],
    [PAYMENT_GROUP_LABEL, '', 'คอลัมน์ที่ 1-11 ของชีท "รายการ" — ทุกรายการต้องกรอกฝั่งนี้เสมอ'],
    [EXCEL_HEADERS.transaction_date, 'บังคับ', 'วันที่จ่ายเงิน รูปแบบ วว/ดด/ปปปป เป็นปี พ.ศ. เช่น 21/09/2569'],
    [EXCEL_HEADERS.vendor_name, 'บังคับ', 'ชื่อผู้ขาย/ผู้รับเงิน'],
    [EXCEL_HEADERS.vendor_tax_id, 'ไม่บังคับ', 'ถ้ากรอกต้องเป็นตัวเลข 13 หลัก'],
    [EXCEL_HEADERS.reference_no, 'ไม่บังคับ', 'เลขที่ PO / เลขที่อ้างอิงภายใน'],
    [EXCEL_HEADERS.description, 'ไม่บังคับ', 'รายละเอียดรายการ'],
    [EXCEL_HEADERS.amount_excl_vat, 'บังคับ', 'ยอดก่อน VAT ต้องมากกว่า 0'],
    [EXCEL_HEADERS.vat_amount, 'ไม่บังคับ', 'กรอก = รายการมี VAT / เว้นว่างหรือใส่ "-" = ไม่มี VAT (ระบบดูจากช่องนี้ช่องเดียว)'],
    [EXCEL_HEADERS.wht_amount, 'ไม่บังคับ', 'ยอดหัก ณ ที่จ่าย เว้นว่างถ้าไม่มี'],
    [EXCEL_HEADERS.total_amount, 'ไม่ต้องกรอก', 'ระบบคำนวณให้เสมอ (ยอดก่อน VAT + VAT) กรอกมาก็ไม่ถูกใช้'],
    [EXCEL_HEADERS.contact_person, 'ไม่บังคับ', 'ชื่อคนที่ต้องตามเอกสารด้วย'],
    [EXCEL_HEADERS.notes, 'ไม่บังคับ', 'หมายเหตุ'],
    ['', '', ''],
    [TAX_INVOICE_GROUP_LABEL, '', 'คอลัมน์ที่ 12-15 ของชีท "รายการ" — เว้นว่างทั้งฝั่ง = รายการขึ้นสถานะรอรับใบกำกับภาษีตามปกติ'],
    [EXCEL_HEADERS.tax_invoice_number, 'เป็นตัวสวิตช์', 'กรอกเมื่อใดก็ตาม = ระบบบันทึกเป็น "ได้รับใบกำกับภาษีแล้ว" และเข้ารายงานภาษีซื้อทันที'],
    [EXCEL_HEADERS.tax_invoice_date, 'บังคับเมื่อกรอกเลขที่', 'วันที่บนใบกำกับภาษี — รายงานภาษีซื้อใช้วันที่นี้เป็นหลัก'],
    [EXCEL_HEADERS.received_date, 'ไม่บังคับ', 'วันที่รับเอกสารจริง เว้นว่าง = ใช้วันที่ใบกำกับภาษีแทน'],
    [
      EXCEL_HEADERS.vat_claim_period,
      'ไม่บังคับ',
      'เดือน/ปีที่จะนำไปยื่น ภ.พ.30 รูปแบบ ดด/ปปปป (พ.ศ.) เช่น 09/2569 — เว้นว่าง = ใช้เดือน/ปีของวันที่ได้รับ ' +
        '(ถ้า Excel เปลี่ยนช่องนี้เป็นรูปแบบวันที่ให้เองหลังกด Enter ก็ไม่เป็นไร ระบบอ่านเดือน/ปีออกได้เหมือนกัน)',
    ],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [{ wch: 30 }, { wch: 22 }, { wch: 78 }];
  return sheet;
}
