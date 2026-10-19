/* ==============================================================================================
 * ไฟล์นำเข้าโปรแกรม RD Prep ของกรมสรรพากร — ภ.ง.ด.3 และ ภ.ง.ด.53
 *
 * ที่มา (ผู้ใช้ขอ 2026-10-11): "ใบหัก ณ ที่จ่าย เมื่อฉันออกเอกสารครบแล้ว ฉันต้องการไฟล์เพื่อไปใส่ใน RD prep
 * เป็นเว็บของสรรพากร" พร้อมแนบไฟล์ตัวอย่างที่ RD Prep รับจริงมาให้สองไฟล์ (PND3.TXT, PND53.TXT)
 *
 * ========================= รูปแบบไฟล์ (ถอดจากตัวอย่างจริง ไม่ได้เดา) =========================
 * - เข้ารหัส TIS-620 (ไม่ใช่ UTF-8 — ภาษาไทยจะเพี้ยนทั้งไฟล์ถ้าใช้ UTF-8) ไม่มี BOM
 * - จบบรรทัดด้วย CRLF ทุกบรรทัด รวมบรรทัดสุดท้าย
 * - คั่นด้วย "|" และ **มีไพพ์ครอบหัวท้าย** → บรรทัดขึ้นต้นด้วย | และลงท้ายด้วย |
 * - ทุกช่องกว้างคงที่: ข้อความเติมช่องว่างท้าย (pad right) ตัวเลขเงินเติมศูนย์หน้า (pad left)
 * - หนึ่งใบหัก ณ ที่จ่าย = หนึ่งบรรทัด
 * - แต่ละบรรทัดมี "ช่องเงินได้" 2 ชุด ชุดที่ 2 เว้นว่าง (ช่องว่างทั้งหมด ไม่ใช่ศูนย์) เพราะระบบนี้ออกใบ
 *   หนึ่งใบต่อหนึ่งประเภทเงินได้เสมอ
 *
 * ความยาวที่ตรวจแล้วตรงกับไฟล์ตัวอย่างทุกไบต์ (ดู rdPrepExport.test.ts ที่เทียบกับไฟล์จริง):
 *   ภ.ง.ด.3  = 414 ไบต์/บรรทัด + CRLF = 416   (19 ช่อง + 20 ไพพ์)
 *   ภ.ง.ด.53 = 353 ไบต์/บรรทัด + CRLF = 355   (18 ช่อง + 19 ไพพ์)
 * ต่างกันแค่ ภ.ง.ด.3 มีช่อง "นามสกุล" (60) เพิ่มมา เพราะผู้ถูกหักเป็นบุคคลธรรมดา
 *
 * ========================= ทำไมไม่ใช้ TextEncoder =========================
 * TextEncoder ของเบราว์เซอร์เขียนได้แต่ UTF-8 (ตามสเปก ไม่มีทางเลือกอื่น) จึงต้องแปลงเป็น TIS-620 เอง
 * ซึ่งทำได้ด้วยเลขคณิตตรงๆ เพราะบล็อกภาษาไทยใน Unicode (U+0E01–U+0E5B) เรียงตรงกับ TIS-620 (0xA1–0xFB)
 * แบบหนึ่งต่อหนึ่งพอดี → ไบต์ = codepoint - 0x0E00 + 0xA0
 * ============================================================================================ */

import { JURISTIC_TITLES, PERSON_TITLES } from './contactLogic';
import type { WhtCertificate, WhtDeductionType, WhtFormType } from '@/types/whtCertificate';

/* ============================== 1. เข้ารหัส TIS-620 ============================== */

const THAI_BLOCK_START = 0x0e00;
const THAI_BLOCK_END = 0x0e5b;
/** ระยะห่างระหว่าง codepoint ภาษาไทยกับไบต์ TIS-620 — ก ที่ U+0E01 อยู่ที่ 0xA1 พอดี */
const TIS620_THAI_OFFSET = 0xa0;

/** ไบต์แทนตัวอักษรที่แปลงเป็น TIS-620 ไม่ได้ — ใช้ '?' (0x3F) ตามแบบเดียวกับที่ระบบแปลงรหัสทั่วไปทำ
 * ตั้งใจไม่ throw เพราะไฟล์ที่มี '?' โผล่มาหนึ่งตัวยังตรวจแก้ได้ แต่ export ที่พังทั้งไฟล์ทำอะไรไม่ได้เลย
 * (ตัวที่แปลงไม่ได้จริงๆ เช่น emoji หรืออักษรจีน ซึ่งไม่ควรมีในชื่อ/ที่อยู่ผู้เสียภาษีตั้งแต่ต้น) */
const TIS620_REPLACEMENT = 0x3f;

/** แปลงข้อความเป็นไบต์ TIS-620 — ASCII (0x00–0x7F) ใช้ค่าเดิม, ภาษาไทยใช้สูตรออฟเซ็ต, อื่นๆ เป็น '?'
 *
 * หมายเหตุสำคัญ: ภาษาไทยใน TIS-620 เป็น **1 ไบต์ต่อ 1 ตัวอักษร** (รวมสระและวรรณยุกต์ซึ่งนับเป็นตัวอักษร
 * แยกกัน) ดังนั้นจำนวนตัวอักษรของ string ใน JavaScript = จำนวนไบต์ในไฟล์เสมอ การ pad ด้วย String.padEnd
 * จึงให้ความกว้างไบต์ที่ถูกต้องพอดี ไม่ต้องนับไบต์แยก */
export function encodeTis620(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 0x7f) {
      bytes[i] = code;
    } else if (code >= THAI_BLOCK_START && code <= THAI_BLOCK_END) {
      bytes[i] = code - THAI_BLOCK_START + TIS620_THAI_OFFSET;
    } else {
      bytes[i] = TIS620_REPLACEMENT;
    }
  }
  return bytes;
}

/* ============================== 2. จัดช่องตามความกว้าง ============================== */

/** ช่องข้อความ: เติมช่องว่างท้ายให้ครบความกว้าง / ตัดทิ้งถ้ายาวเกิน
 *
 * ตัดท้ายทิ้งเงียบๆ โดยตั้งใจ — ความกว้างช่องเป็นข้อกำหนดของ RD Prep แก้ไม่ได้ และไฟล์ที่ความกว้างเพี้ยน
 * RD Prep จะไม่รับทั้งไฟล์ ส่วนข้อมูลที่ถูกตัดจะถูกรายงานแยกผ่าน findRdPrepIssues() ให้ผู้ใช้เห็นก่อนยื่น */
export function padTextField(value: string, width: number): string {
  const normalized = value.replace(/[\r\n|]/g, ' ').trim();
  return normalized.length > width ? normalized.slice(0, width) : normalized.padEnd(width, ' ');
}

/** ช่องตัวเลขเงิน: ทศนิยม 2 ตำแหน่งเสมอ เติมศูนย์หน้าให้ครบความกว้าง (เช่น 35000 → '00000035000.00') */
export function padAmountField(value: number, width: number): string {
  const text = value.toFixed(2);
  // ยาวเกินช่องแปลว่ายอดเงินใหญ่กว่าที่ฟอร์แมตรองรับ (14 หลัก = เกินหมื่นล้าน) ไม่ควรเกิดในทางปฏิบัติ
  // แต่ถ้าเกิดต้องไม่ยอมเขียนไฟล์ที่ความกว้างเพี้ยน เพราะ RD Prep จะอ่านช่องถัดไปเลื่อนไปทั้งบรรทัด
  if (text.length > width) throw new Error(`ยอดเงิน ${text} ยาวเกินช่อง ${width} ตัวอักษรของไฟล์ RD Prep`);
  return text.padStart(width, '0');
}

/** ช่องตัวเลขล้วน (ลำดับที่ / เลขผู้เสียภาษี / เลขสาขา): เติมศูนย์หน้า ตัดอักขระที่ไม่ใช่ตัวเลขออกก่อน */
export function padDigitsField(value: string, width: number): string {
  const digits = value.replace(/\D/g, '');
  return digits.length > width ? digits.slice(-width) : digits.padStart(width, '0');
}

/** ช่องว่างทั้งช่อง — ใช้กับ "ช่องเงินได้ชุดที่ 2" ที่ไม่ได้ใช้ (ต้องเป็นช่องว่าง ไม่ใช่ศูนย์ ตามไฟล์ตัวอย่าง) */
function blankField(width: number): string {
  return ' '.repeat(width);
}

/* ============================== 3. แยกคำนำหน้าออกจากชื่อ ============================== */

/* รายการคำนำหน้าหลักมาจาก lib/contactLogic.ts (แหล่งความจริงเดียวของทั้งระบบ ใช้กับ dropdown ในสมุด
   รายชื่อด้วย) — ที่นี่ต่อท้ายด้วยคำนำหน้าที่ "เคยเจอในข้อมูลเก่า" แต่ไม่ได้อยู่ใน dropdown มาตรฐาน เพราะ
   ใบหัก ณ ที่จ่ายเก็บชื่อผู้ถูกหักเป็นข้อความเดียว (snapshot ณ วันออกใบ) จึงต้องแยกคำนำหน้าออกมาเองตอน
   ส่งออก และข้อความเก่าอาจสะกดต่างจากรายการมาตรฐาน
   เรียงยาวก่อนสั้นเสมอ เพื่อให้ 'นางสาว' ชนะ 'นาง' และ 'ห้างหุ้นส่วนจำกัด' ชนะ 'ห้างหุ้นส่วนสามัญ' */
const byLengthDesc = (list: readonly string[]) => [...new Set(list)].sort((a, b) => b.length - a.length);

const PERSON_PREFIXES = byLengthDesc([...PERSON_TITLES, 'นส.', 'ดร.']);

const JURISTIC_PREFIXES = byLengthDesc([...JURISTIC_TITLES, 'บริษัทมหาชนจำกัด']);

export interface SplitName {
  prefix: string;
  firstName: string;
  lastName: string;
}

/** แยกชื่อที่เก็บเป็นข้อความเดียวบนใบ (payee_name) ออกเป็น คำนำหน้า / ชื่อ / นามสกุล ตามที่ RD Prep ต้องการ
 *
 * ทำไมต้องแยกเอง: wht_certificates เก็บ payee_name เป็น snapshot ข้อความเดียว (มาจาก getContactDisplayName)
 * ไม่ได้เก็บคำนำหน้าแยกช่อง — ส่วนสมุดรายชื่อก็ไม่มีช่องคำนำหน้าเลย ผู้ใช้พิมพ์รวมมาในช่องชื่อ เช่นข้อมูลจริง
 * ในระบบคือ 'นายวทัญญู สุวรรณาพิสิทธิ์' (คำนำหน้าติดกับชื่อ ไม่เว้นวรรค) และ 'บริษัท เท็นเซ็นต์(ประเทศไทย) จำกัด'
 *
 * จึงตัดคำนำหน้าที่รู้จักออกจากหัวข้อความ แล้วที่เหลือคือชื่อจริง — ถ้าไม่เจอคำนำหน้าที่รู้จัก คืน prefix ว่าง
 * และไม่เดาให้ (findRdPrepIssues จะเตือนให้ผู้ใช้ไปแก้ชื่อในสมุดรายชื่อเอง ดีกว่าใส่ 'นาย' ให้ผู้หญิง)
 *
 * นิติบุคคล (ภ.ง.ด.53) ใช้แค่ prefix + firstName — ช่องนามสกุลไม่มีในฟอร์แมตนั้น */
export function splitPayeeName(payeeName: string, entityType: 'individual' | 'company'): SplitName {
  const name = payeeName.trim().replace(/\s+/g, ' ');
  const prefixes: readonly string[] = entityType === 'company' ? JURISTIC_PREFIXES : PERSON_PREFIXES;
  const matched = prefixes.find((p) => name.startsWith(p)) ?? '';
  const rest = name.slice(matched.length).trim();

  if (entityType === 'company') {
    return { prefix: matched, firstName: rest, lastName: '' };
  }
  // บุคคลธรรมดา: ตัดที่ช่องว่างแรก ที่เหลือทั้งหมดเป็นนามสกุล (นามสกุลไทยบางนามสกุลมีช่องว่างในตัว)
  const spaceAt = rest.indexOf(' ');
  if (spaceAt < 0) return { prefix: matched, firstName: rest, lastName: '' };
  return { prefix: matched, firstName: rest.slice(0, spaceAt), lastName: rest.slice(spaceAt + 1).trim() };
}

/* ============================== 4. ที่อยู่ ============================== */

/** ความกว้างช่องที่อยู่ในไฟล์ RD Prep (ทั้ง ภ.ง.ด.3 และ 53) */
const ADDRESS_WIDTH = 100;

/** คำเรียกเขตการปกครองต่างกันระหว่างกรุงเทพฯ (แขวง/เขต) กับต่างจังหวัด (ตำบล/อำเภอ) — ไฟล์ตัวอย่างใช้
 * 'แขวงสัมพันธวงศ์ เขตสัมพันธวงศ์' สำหรับที่อยู่ในกรุงเทพฯ */
function subdistrictWord(province: string): string {
  return province.includes('กรุงเทพ') ? 'แขวง' : 'ตำบล';
}

function districtWord(province: string): string {
  return province.includes('กรุงเทพ') ? 'เขต' : 'อำเภอ';
}

export interface AddressParts {
  address: string | null;
  subdistrict: string | null;
  district: string | null;
  province: string | null;
  postal_code: string | null;
}

/** ประกอบที่อยู่หลายช่องเป็นข้อความเดียวตามรูปแบบในไฟล์ตัวอย่าง:
 *   '55 ถนนบำรุงรัฐ แขวงสัมพันธวงศ์ เขตสัมพันธวงศ์ กรุงเทพมหานคร  10100'
 * (สังเกตว่ามีช่องว่าง **สองตัว** คั่นก่อนรหัสไปรษณีย์ — ตรงตามไฟล์ที่ RD Prep รับจริง)
 *
 * ถ้ายาวเกิน 100 ตัวอักษร จะตัด "เฉพาะส่วนบ้านเลขที่/ถนน" ให้สั้นลง ไม่ตัดท้ายทั้งก้อน เพื่อให้ตำบล/อำเภอ/
 * จังหวัด/รหัสไปรษณีย์รอดครบ — ท่อนท้ายเหล่านี้คือส่วนที่สรรพากรใช้ระบุพื้นที่ ถ้าหายไปจะเสียหายกว่าชื่อถนน
 * ที่ถูกตัด (และ findRdPrepIssues จะเตือนว่าที่อยู่ใบนี้ถูกตัดให้ผู้ใช้รู้ตัว) */
export function buildRdPrepAddress(parts: AddressParts): string {
  const province = parts.province?.trim() ?? '';
  const tail = [
    parts.subdistrict?.trim() ? `${subdistrictWord(province)}${parts.subdistrict.trim()}` : '',
    parts.district?.trim() ? `${districtWord(province)}${parts.district.trim()}` : '',
    province,
  ]
    .filter(Boolean)
    .join(' ');
  const postal = parts.postal_code?.trim() ?? '';
  const suffix = [tail, postal].filter(Boolean).join('  ');
  const street = (parts.address?.trim() ?? '').replace(/\s+/g, ' ');

  const full = [street, suffix].filter(Boolean).join(' ');
  if (full.length <= ADDRESS_WIDTH) return full;

  // ยาวเกิน — หั่นส่วนบ้านเลขที่/ถนนลงเท่าที่จำเป็น (เผื่อช่องว่าง 1 ตัวที่ใช้คั่น)
  const room = ADDRESS_WIDTH - suffix.length - 1;
  if (room <= 0) return suffix.slice(0, ADDRESS_WIDTH);
  return `${street.slice(0, room).trimEnd()} ${suffix}`;
}

/* ============================== 5. ช่องอื่นๆ ============================== */

/** ข้อความประเภทเงินได้ตามที่ RD Prep รับ — ไฟล์ตัวอย่างใช้ '6.อื่นๆ(ค่าจ้าง)' และ '6.อื่นๆ(ค่าบริการ)'
 * คือ "<รหัส>.<ชื่อหมวด>(<รายละเอียดที่ผู้ใช้พิมพ์>)" โดยไม่มีช่องว่างหลังจุด
 *
 * ⚠️ ยืนยันกับไฟล์จริงได้เฉพาะรหัส 6 เท่านั้น (ตัวอย่างที่ผู้ใช้ส่งมามีแต่รหัส 6 ซึ่งเป็นค่าเริ่มต้นและเป็น
 * กรณีที่ใช้จริงเกือบทั้งหมดในระบบนี้) รหัส 1/2/3/5 ใช้ข้อความตามหมวดบนฟอร์ม ภ.ง.ด. ซึ่งน่าจะตรง แต่ยังไม่ได้
 * ทดลองนำเข้า RD Prep จริง — ถ้า RD Prep ปฏิเสธ ให้แก้ข้อความในตารางนี้ที่เดียว ไม่ต้องแก้ที่อื่น */
const RD_PREP_INCOME_CATEGORY: Record<string, string> = {
  '1': 'เงินเดือน ค่าจ้าง ฯลฯ',
  '2': 'ค่าธรรมเนียม ค่านายหน้า ฯลฯ',
  '3': 'ค่าแห่งลิขสิทธิ์ ฯลฯ',
  '5': 'ตามคำสั่งกรมสรรพากร',
  '6': 'อื่นๆ',
};

export function buildRdPrepIncomeType(incomeTypeCode: string, incomeTypeLabel: string | null): string {
  const category = RD_PREP_INCOME_CATEGORY[incomeTypeCode] ?? 'อื่นๆ';
  const detail = incomeTypeLabel?.trim() ?? '';
  return detail ? `${incomeTypeCode}.${category}(${detail})` : `${incomeTypeCode}.${category}`;
}

/** รหัสเงื่อนไขการหักภาษี ช่องสุดท้ายของชุดเงินได้ — ไฟล์ตัวอย่างเป็น '1' ทุกบรรทัด (หักภาษี ณ ที่จ่าย)
 * ลำดับตรงกับช่องติ๊กบนฟอร์มจริงและกับ WhtDeductionType ของระบบ */
const RD_PREP_CONDITION_CODE: Record<WhtDeductionType, string> = {
  withholding: '1',
  pay_forever: '2',
  pay_once: '3',
  other: '4',
};

/** หยิบช่องที่อยู่ "ฝั่งผู้ถูกหักภาษี" ออกมาเป็น AddressParts — ไฟล์ RD Prep ใช้ที่อยู่ผู้ถูกหักเท่านั้น
 * (ที่อยู่ผู้จ่ายเงินอยู่ในส่วนหัวของแบบ ไม่ได้อยู่ในไฟล์รายบรรทัดนี้) */
function payeeAddressParts(cert: WhtCertificate): AddressParts {
  return {
    address: cert.payee_address,
    subdistrict: cert.payee_subdistrict,
    district: cert.payee_district,
    province: cert.payee_province,
    postal_code: cert.payee_postal_code,
  };
}

/** เลขสาขา 5 หลัก — สำนักงานใหญ่คือ '00000' ตามไฟล์ตัวอย่าง */
function branchField(cert: Pick<WhtCertificate, 'payee_branch_type' | 'payee_branch_number'>): string {
  if (cert.payee_branch_type === 'head_office') return '00000';
  return padDigitsField(cert.payee_branch_number ?? '', 5);
}

/** อัตราภาษีในไฟล์ กว้าง 5 ทศนิยม 2 ตำแหน่ง เติมศูนย์หน้า (3% → '03.00')
 * คำนวณจากฐานก่อน VAT เสมอ (ดู lib/whtCertificateLogic.ts whtRatePercent และ migration_032) */
export function padRateField(ratePercent: number): string {
  return padAmountField(ratePercent, 5);
}

/* ============================== 6. ตรวจความพร้อมก่อนส่งออก ============================== */

export interface RdPrepIssue {
  certNumber: string;
  payeeName: string;
  /** ข้อความบอกว่าขาดอะไร เขียนให้ผู้ใช้อ่านรู้เรื่องและรู้ว่าต้องไปแก้ที่ไหน */
  problem: string;
  /** true = ไฟล์ยังสร้างได้แต่ข้อมูลไม่ครบ/ถูกตัด, false = ร้ายแรงพอที่ RD Prep จะไม่รับ */
  warningOnly: boolean;
}

/** หาสิ่งที่ยังไม่พร้อมยื่นในใบแต่ละฉบับ — เรียกก่อนสร้างไฟล์เพื่อให้ผู้ใช้เห็นและไปแก้ต้นทางได้
 *
 * ตั้งใจ "เตือนแต่ยังสร้างไฟล์ให้" สำหรับเรื่องที่แก้ในไฟล์ไม่ได้ (เช่นไม่มีคำนำหน้า) เพราะผู้ใช้อาจต้องการ
 * ไฟล์ไปแก้ต่อใน RD Prep เอง — ส่วนเรื่องที่ขาดแล้วยื่นไม่ได้จริง (ไม่มีเลขผู้เสียภาษี / ไม่มีฐานภาษี) ขึ้น
 * เป็นข้อผิดพลาดเต็มรูปแบบ */
export function findRdPrepIssues(certs: WhtCertificate[]): RdPrepIssue[] {
  const issues: RdPrepIssue[] = [];
  for (const cert of certs) {
    const add = (problem: string, warningOnly: boolean) =>
      issues.push({ certNumber: cert.cert_number, payeeName: cert.payee_name, problem, warningOnly });

    if (cert.total_amount_excl_vat === null) {
      add('ไม่มียอดก่อน VAT (ฐานภาษี) — ออกใบใหม่แทนใบนี้ หรือกรอกยอดก่อน VAT ก่อนยื่น', false);
    }
    const taxIdDigits = (cert.payee_tax_id ?? '').replace(/\D/g, '');
    if (!taxIdDigits) {
      add('ไม่มีเลขประจำตัวผู้เสียภาษี — เพิ่มในสมุดรายชื่อแล้วออกใบใหม่', false);
    } else if (taxIdDigits.length !== 13) {
      add(`เลขประจำตัวผู้เสียภาษีมี ${taxIdDigits.length} หลัก (ต้องเป็น 13 หลัก)`, false);
    }

    const { prefix, firstName, lastName } = splitPayeeName(cert.payee_name, cert.payee_entity_type);
    if (!prefix) {
      add('ไม่พบคำนำหน้าชื่อ (เช่น นาย/นาง/นางสาว/บริษัท) — เพิ่มไว้หน้าชื่อในสมุดรายชื่อ', true);
    }
    if (!firstName) {
      add('ไม่มีชื่อผู้ถูกหักภาษีหลังคำนำหน้า', false);
    }
    if (cert.payee_entity_type === 'individual' && !lastName) {
      add('ไม่มีนามสกุลผู้ถูกหักภาษี', true);
    }

    if (!cert.payee_address?.trim() || !cert.payee_province?.trim()) {
      add('ที่อยู่ผู้ถูกหักภาษีไม่ครบ — เพิ่มในสมุดรายชื่อแล้วออกใบใหม่', true);
    } else {
      const addressText = buildRdPrepAddress(payeeAddressParts(cert));
      const untruncated = [
        cert.payee_address.trim(),
        cert.payee_subdistrict?.trim(),
        cert.payee_district?.trim(),
        cert.payee_province.trim(),
        cert.payee_postal_code?.trim(),
      ]
        .filter(Boolean)
        .join(' ');
      if (addressText.length >= ADDRESS_WIDTH && untruncated.length > ADDRESS_WIDTH) {
        add('ที่อยู่ยาวเกิน 100 ตัวอักษร ชื่อถนน/อาคารถูกตัดให้สั้นลงในไฟล์', true);
      }
    }

    if (!cert.payee_postal_code?.trim()) {
      add('ไม่มีรหัสไปรษณีย์', true);
    }
    if (cert.payee_branch_type === 'branch' && !cert.payee_branch_number?.trim()) {
      add('ระบุว่าเป็นสาขาแต่ไม่มีเลขสาขา', true);
    }
  }
  return issues;
}

/* ============================== 7. สร้างบรรทัด ============================== */

/** หนึ่งบรรทัดของไฟล์ ภ.ง.ด.3 (ผู้ถูกหักเป็นบุคคลธรรมดา) — 19 ช่อง */
export function buildPnd3Line(cert: WhtCertificate, sequence: number, ratePercent: number): string {
  const { prefix, firstName, lastName } = splitPayeeName(cert.payee_name, cert.payee_entity_type);
  const fields = [
    padDigitsField(String(sequence), 5),
    padDigitsField(cert.payee_tax_id ?? '', 13),
    branchField(cert),
    padTextField(prefix, 15),
    padTextField(firstName, 60),
    padTextField(lastName, 60),
    padTextField(buildRdPrepAddress(payeeAddressParts(cert)), ADDRESS_WIDTH),
    formatRdPrepDate(cert.payment_date),
    padTextField(buildRdPrepIncomeType(cert.income_type_code, cert.income_type_label), 25),
    padRateField(ratePercent),
    padAmountField(cert.total_amount_excl_vat ?? 0, 14),
    padAmountField(cert.total_wht_amount, 13),
    RD_PREP_CONDITION_CODE[cert.deduction_type],
    // ชุดเงินได้ที่ 2 — ไม่ใช้ เว้นว่างตามไฟล์ตัวอย่าง
    blankField(10),
    blankField(25),
    blankField(5),
    blankField(14),
    blankField(13),
    blankField(1),
  ];
  return `|${fields.join('|')}|`;
}

/** หนึ่งบรรทัดของไฟล์ ภ.ง.ด.53 (ผู้ถูกหักเป็นนิติบุคคล) — 18 ช่อง เหมือน ภ.ง.ด.3 แต่ไม่มีช่องนามสกุล */
export function buildPnd53Line(cert: WhtCertificate, sequence: number, ratePercent: number): string {
  const { prefix, firstName } = splitPayeeName(cert.payee_name, cert.payee_entity_type);
  const fields = [
    padDigitsField(String(sequence), 5),
    padDigitsField(cert.payee_tax_id ?? '', 13),
    branchField(cert),
    padTextField(prefix, 15),
    padTextField(firstName, 60),
    padTextField(buildRdPrepAddress(payeeAddressParts(cert)), ADDRESS_WIDTH),
    formatRdPrepDate(cert.payment_date),
    padTextField(buildRdPrepIncomeType(cert.income_type_code, cert.income_type_label), 25),
    padRateField(ratePercent),
    padAmountField(cert.total_amount_excl_vat ?? 0, 14),
    padAmountField(cert.total_wht_amount, 13),
    RD_PREP_CONDITION_CODE[cert.deduction_type],
    blankField(10),
    blankField(25),
    blankField(5),
    blankField(14),
    blankField(13),
    blankField(1),
  ];
  return `|${fields.join('|')}|`;
}

/** วันที่จ่ายในรูปแบบ วว/ดด/ปปปป ปี พ.ศ. (ไฟล์ตัวอย่างเป็น '30/09/2569') — ใช้ตัวแปลงกลางของระบบ
 * เพื่อไม่ให้เกิดปัญหาปี ค.ศ./พ.ศ. ซ้ำรอยเดิม ดูคอมเมนต์ formatThaiDate ใน lib/thaiDate.ts */
function formatRdPrepDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`วันที่จ่ายของใบหัก ณ ที่จ่ายไม่ถูกต้อง: ${iso}`);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y + 543}`;
}

/* ============================== 8. สร้างไฟล์ ============================== */

/** จำนวนบรรทัดต่อไฟล์ที่ไม่ควรเกิน — ไม่ใช่ข้อจำกัดของ RD Prep แต่เป็นสัญญาณว่าผู้ใช้เลือกช่วงผิด
 * (ยื่นรายเดือน หนึ่งเดือนมีผู้รับเงินเป็นหลักพันรายถือว่าเยอะผิดปกติสำหรับกิจการขนาดนี้) */
export const RD_PREP_ROW_WARNING_THRESHOLD = 1000;

export interface RdPrepFile {
  filename: string;
  /** เนื้อไฟล์เป็นไบต์ TIS-620 พร้อมเขียนลงไฟล์/ดาวน์โหลด (ห้ามแปลงเป็น string อีก จะเสียการเข้ารหัส) */
  bytes: Uint8Array;
  rowCount: number;
}

/** คัดใบที่จะเข้าไฟล์: เฉพาะใบที่ยัง issued (ใบที่ยกเลิกไม่ต้องยื่น) และตรงแบบที่ขอ แล้วเรียงตามวันที่จ่าย
 * → เลขที่ใบ เพื่อให้ลำดับในไฟล์คงที่ (ยื่นซ้ำได้ผลเหมือนเดิมทุกครั้ง ตรวจทานง่าย) */
export function selectCertsForRdPrep(
  certs: WhtCertificate[],
  formType: WhtFormType,
  periodYear: number,
  periodMonth: number
): WhtCertificate[] {
  const prefix = `${periodYear}-${String(periodMonth).padStart(2, '0')}`;
  return certs
    .filter(
      (c) => c.status === 'issued' && c.form_type === formType && c.payment_date.startsWith(prefix)
    )
    .sort((a, b) =>
      a.payment_date === b.payment_date
        ? a.cert_number.localeCompare(b.cert_number)
        : a.payment_date.localeCompare(b.payment_date)
    );
}

/** ชื่อไฟล์ — ใส่เดือน/ปี พ.ศ. ต่อท้ายเพื่อให้เก็บหลายเดือนในโฟลเดอร์เดียวไม่ทับกัน (RD Prep ไม่สนชื่อไฟล์
 * อ่านแต่เนื้อใน ไฟล์ตัวอย่างชื่อ PND3.TXT/PND53.TXT เฉยๆ) */
export function rdPrepFilename(formType: WhtFormType, periodYear: number, periodMonth: number): string {
  const form = formType === '03' ? 'PND3' : 'PND53';
  const buddhistYear = periodYear + 543;
  return `${form}_${buddhistYear}${String(periodMonth).padStart(2, '0')}.TXT`;
}

/** สร้างเนื้อไฟล์ RD Prep จากใบที่คัดมาแล้ว
 *
 * อัตราภาษีคำนวณจากฐานก่อน VAT ของแต่ละใบเอง ไม่ได้ hard-code 3% — ระบบรองรับอัตราอื่น (1/2/5/10%) และถ้า
 * ตัวเลขบนใบไม่ลงตัวพอดี ไฟล์จะสะท้อนตัวเลขจริงออกมา ไม่ปัดให้สวยเอง (ตัวเลขที่ยื่นต้องตรงกับใบที่ออกไป) */
export function buildRdPrepFile(
  certs: WhtCertificate[],
  formType: WhtFormType,
  periodYear: number,
  periodMonth: number
): RdPrepFile {
  const lines = certs.map((cert, index) => {
    const base = cert.total_amount_excl_vat;
    const rate = base && base !== 0 ? Math.round((cert.total_wht_amount / base) * 10000) / 100 : 0;
    const sequence = index + 1;
    return formType === '03'
      ? buildPnd3Line(cert, sequence, rate)
      : buildPnd53Line(cert, sequence, rate);
  });

  // CRLF ปิดท้ายทุกบรรทัดรวมบรรทัดสุดท้าย (ตรงตามไฟล์ตัวอย่าง: 1 บรรทัด = 416 ไบต์พอดี)
  const text = lines.map((line) => `${line}\r\n`).join('');
  return {
    filename: rdPrepFilename(formType, periodYear, periodMonth),
    bytes: encodeTis620(text),
    rowCount: lines.length,
  };
}
