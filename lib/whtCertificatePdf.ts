import jsPDF from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { registerThaiFont, THAI_FONT_NAME, drawThaiText, fixAutoTableCellThaiText, getTextWidthMm } from './pdfThaiFont';
import { formatBranchLabel } from './contactLogic';
import { thaiBahtText } from './thaiBahtText';
import type { PendingTaxInvoice } from '@/types/invoice';
import type { WhtCertificate } from '@/types/whtCertificate';

/**
 * สร้างไฟล์ PDF ใบหัก ณ ที่จ่าย (หนังสือรับรองการหักภาษี ณ ที่จ่าย ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร) —
 * เขียนใหม่ทั้งไฟล์รอบที่ 3 (2026-08-12) ให้ตรงกับแบบฟอร์มราชการต้นฉบับเปล่า
 * ("D.2-หนังสือรับรองการหักภาษี-ณ-ที่จ่าย-PDF.pdf") ที่ผู้ใช้ส่งมาแล้วบอกว่า "ชอบแบบนี้ทั้งหมด" — แทนที่
 * เวอร์ชันก่อนหน้าซึ่งอ้างอิงจากไฟล์ตัวอย่างที่กรอกข้อมูลจริงแล้ว (A4 แนวนอน 2 ฉบับข้างกัน) จุดที่ต่างจาก
 * เวอร์ชันก่อนอย่างมีนัยสำคัญ (ยืนยันกับผู้ใช้ผ่าน AskUserQuestion ก่อนแก้ทุกจุด):
 *
 * 1. หน้ากระดาษเป็น A4 แนวตั้ง (portrait) เต็มหน้าต่อ 1 ฉบับ (ฉบับที่ 1 = หน้า 1, ฉบับที่ 2 = หน้า 2) ไม่ใช่
 *    แนวนอนวาง 2 ฉบับข้างกันแบบเดิม — กฎหมายกำหนดให้ออก 2 ฉบับเสมอ ระบบนี้ยังคงออกครบ 2 ฉบับเหมือนเดิม
 *    เพียงแค่เปลี่ยนเป็นคนละหน้าเต็มแทน
 * 2. เอาป้ายแคปซูล (pill) สีเขียว "ฉบับที่ N. ..." ออก แทนที่ด้วยข้อความธรรมดา 2 บรรทัดมุมซ้ายบน
 *    ("ฉบับที่ 1 (สำหรับ...)" / "ฉบับที่ 2 (สำหรับ...)") ตรงกับต้นฉบับราชการเป๊ะๆ
 * 3. เพิ่มช่อง "เล่มที่" (มุมขวาบน คู่กับ "เลขที่") — ระบบนี้ไม่ได้เก็บเลขเล่ม จึงเว้นว่างเป็นเส้นประเสมอ
 * 4. เพิ่มช่องกล่องตัวเลข (comb box) แยก 2 ชุดต่อฝ่าย: "เลขประจำตัวประชาชน" (13 หลัก จัดกลุ่ม 1-4-5-2-1
 *    ตามบัตรประชาชนไทย) กับ "เลขประจำตัวผู้เสียภาษีอากร" (ให้กรอกเฉพาะผู้ไม่มีเลขประจำตัวประชาชน) — ฝั่งผู้จ่าย
 *    (บริษัทผู้ใช้เอง) ถือเป็นนิติบุคคลเสมอจึงใส่เลขในช่องผู้เสียภาษีอากรเท่านั้น ฝั่งผู้ถูกหักภาษีจัดเข้าตาม
 *    payee_entity_type: บุคคลธรรมดา→ช่องบัตรประชาชน, นิติบุคคล→ช่องผู้เสียภาษีอากร (ยืนยันกับผู้ใช้แล้ว)
 * 5. เพิ่มแถว "ลำดับที่ [ ] ในแบบ" พร้อมช่องติ๊กเลือกแบบยื่นภาษีทั้ง 7 แบบ (ภ.ง.ด.1ก/1ก พิเศษ/2/3/2ก/3ก/53)
 *    ตามต้นฉบับ — ระบบนี้ออกได้แค่ 2 แบบ (WhtFormType: '03'→ภ.ง.ด.3, '53'→ภ.ง.ด.53) จึงติ๊กเฉพาะแบบที่ตรง
 *    ช่องอื่นแสดงไว้เฉยๆ ไม่ติ๊ก (เหมือนแบบฟอร์มจริงที่มีครบทุกตัวเลือกให้เลือกติ๊กเอง) "ลำดับที่" ไม่มีข้อมูลเก็บ
 *    ในระบบ จึงเป็นกล่องว่างให้กรอกเอง
 * 6. ตารางประเภทเงินได้: เพิ่มแถวสรุปยอดรวม ("รวมเงินที่จ่ายและภาษีที่หักนำส่ง") เป็นแถวสุดท้ายในตารางเอง (colSpan
 *    3 ช่องซ้าย) พร้อมพื้นเทาอ่อนที่ช่องตัวเลข แทนที่การเขียนแยกไว้นอกตารางแบบเดิม ตรงกับต้นฉบับ
 * 7. บรรทัด "เงินที่จ่ายเข้า กบข./กสจ./กองทุนสงเคราะห์ครูโรงเรียนเอกชน..บาท กองทุนประกันสังคม..บาท กองทุนสำรอง
 *    เลี้ยงชีพ..บาท" รวมเป็นบรรทัดเดียว (เดิมแยก 2 บรรทัด และไม่มี กบข./กสจ./กองทุนสงเคราะห์ครูฯ) — ทั้งหมดเว้น
 *    ว่างเสมอเพราะระบบไม่ได้เก็บข้อมูล 3 รายการนี้
 * 8. ช่องติ๊ก "ผู้จ่ายเงิน" มีเลขกำกับ (1)-(4) และใช้คำเป๊ะๆ ตามต้นฉบับ ("หัก ณ ที่จ่าย" ไม่ใช่ "หักภาษี ณ ที่จ่าย")
 * 9. เอาการพิมพ์ชื่อผู้ลงนามตรงๆ ออก เปลี่ยนเป็นเส้นว่าง "ลงชื่อ....." ให้เซ็นเองด้วยมือ + วงกลมประทับตรา
 *    นิติบุคคล (ถ้ามี) ด้านข้าง ตามต้นฉบับ (ยืนยันกับผู้ใช้แล้ว)
 * 10. "หมายเหตุ" (เกี่ยวกับลำดับที่) ย้ายไปอยู่ใต้แถวลำดับที่/ช่องติ๊กแบบยื่นภาษี (ตรงตำแหน่งในต้นฉบับ) ส่วน
 *     "คำเตือน" (บทลงโทษ) อยู่มุมล่างซ้ายคู่กับข้อความรับรอง/ลงชื่อฝั่งขวา
 * 11. เปลี่ยนกลับเป็นขาวดำ/เทาล้วน (ไม่มีสีน้ำเงิน) ตามต้นฉบับราชการจริง — เส้นกรอบเหลี่ยมคม ไม่ปัดมุมโค้ง
 *     ยกเว้นพื้นเทาอ่อนที่ช่องตัวเลขรวมยอดในตาราง (ของต้นฉบับจริงก็มีพื้นเทาช่องนี้เหมือนกัน)
 *
 * เนื้อหาที่ "คง" ไว้จากเวอร์ชันก่อนหน้า (ไม่ใช่ของใหม่ทั้งหมด): รายละเอียดเต็มของหมวด 4/5 ในตาราง
 * (FORM_INCOME_TYPE_CONTENT ยืนยันตรงตามข้อความจริงจากไฟล์ตัวอย่างจริงในรอบก่อน), ช่องติ๊กสำนักงานใหญ่/สาขา
 * ในกล่องผู้จ่าย/ผู้ถูกหักภาษี (ต้นฉบับราชการฉบับเปล่าไม่มีช่องนี้ แต่เป็นข้อมูลจริงที่มีประโยชน์และไม่ขัดกับ
 * โครงสร้างต้นฉบับ จึงคงไว้แบบเรียบง่ายไม่เด่นเกินไป)
 */

const THB = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// A4 แนวตั้ง — กว้างxสูง 210x297mm เต็มหน้าต่อ 1 ฉบับ
const PAGE_WIDTH = 210;
const MARGIN = 14;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
// ต้นฉบับราชการมีกรอบนอกเหลี่ยมคม (sharp corner) ล้อมทั้งฟอร์ม (ตั้งแต่หัวเรื่องลงไปถึงท้ายลายเซ็น) โดยมีช่องไฟ
// ว่างเล็กน้อยก่อนถึงกล่อง/ตารางด้านในซึ่งมีมุมโค้ง (rounded) ของตัวเอง — ข้อความ "ฉบับที่ 1/2" มุมซ้ายบนอยู่
// นอกกรอบนี้ (ยืนยันจากการซูมไฟล์ต้นฉบับจริงทีละจุด หลังผู้ใช้บอกว่า "ไม่เหมือนอะ ขอแบบตรงต้นฉบับ 100%")
const FRAME_INSET = 3;

// โทนสีขาวดำ/เทาล้วน ตามต้นฉบับราชการฉบับเปล่า (2026-08-12 เปลี่ยนกลับจากเวอร์ชันสีน้ำเงินรอบก่อน ตามคำขอ
// ผู้ใช้ "ชอบแบบนี้ทั้งหมด" ของ D.2-หนังสือรับรองการหักภาษี-ณ-ที่จ่าย-PDF.pdf ซึ่งเป็นขาวดำล้วน)
const COLOR_TEXT: [number, number, number] = [15, 15, 15]; // ตัวหนังสือเนื้อหาหลัก
const COLOR_MUTED: [number, number, number] = [95, 95, 95]; // ข้อความหมายเหตุ/คำอธิบายตัวเล็กอิตาลิก
const COLOR_FILL_TOTAL: [number, number, number] = [228, 228, 228]; // พื้นเทาอ่อนช่องตัวเลขแถวรวมยอดในตาราง

// สีไฮไลต์ข้อความ "ฉบับที่ N ..." มุมซ้ายบนของแต่ละสำเนา — 1 สีต่อ 1 สำเนา ให้แยกด้วยตาได้ทันทีว่าใบไหนคือฉบับ
// ไหน (เพิ่มตามคำขอผู้ใช้ 2026-08-13) ตัวสีอ้างอิงจากโทน Tailwind -600 (เข้มพออ่านชัดบนกระดาษขาว) — เคยลองทำ
// เป็นป้ายกรอบเหลี่ยมมนพื้นหลังสี (ตัวหนังสือดำ) แล้วผู้ใช้ขอกลับมาเป็นตัวหนังสือสีตรงๆ แบบเดิม (ไม่มีป้าย/ไฮไล
// พื้นหลัง) 2026-08-13 เช่นกัน
const COLOR_COPY_BLUE: [number, number, number] = [37, 99, 235]; // ฉบับที่ 1 (ผู้ถูกหัก)
const COLOR_COPY_GREEN: [number, number, number] = [22, 163, 74]; // ฉบับที่ 2 (ผู้ถูกหัก)
const COLOR_COPY_ORANGE: [number, number, number] = [234, 88, 12]; // ฉบับที่ 3 (ฝ่ายบัญชี)
const COLOR_COPY_PINK: [number, number, number] = [219, 39, 119]; // ฉบับที่ 4 (ฝ่ายการเงิน)

// 2026-08-13: เปลี่ยนจาก legendMode 2 ค่า ('payee'/'payer' วาดข้อความเดียวกันทั้งซ้าย-ขวา) มาเป็น 4 ตัวแปรแยก
// ต่อฝั่งซ้าย/ขวาชัดเจน ตามคำขอผู้ใช้: ฝั่งผู้ถูกหักซ้าย=เฉพาะฉบับที่ 1 (สีน้ำเงิน) ขวา=เฉพาะฉบับที่ 2 (สีเขียว)
// ฝั่งผู้มีหน้าที่หักซ้าย="ฉบับที่ 3 สำหรับฝ่ายบัญชี" (สีส้ม) ขวา="ฉบับที่ 4 สำหรับฝ่ายการเงิน" (สีชมพู)
// restColor ทุกตัวแปรเป็นสีดำปกติ (COLOR_TEXT) เหมือนกันหมด — ไฮไลสีเฉพาะคำว่า "ฉบับที่ N" (boldColor, ตัวหนา)
// เท่านั้น ส่วนคำอธิบายต่อท้าย ("สำหรับผู้ถูกหักภาษี...", "สำหรับฝ่ายบัญชี" ฯลฯ) เป็นตัวหนังสือดำธรรมดา (ยืนยันกับ
// ผู้ใช้แล้ว 2026-08-13)
type CopyVariant = 'payee_copy1' | 'payee_copy2' | 'payer_copy3' | 'payer_copy4';

const COPY_VARIANT_CONFIG: Record<
  CopyVariant,
  { boldText: string; restText: string; boldColor: [number, number, number]; restColor: [number, number, number] }
> = {
  payee_copy1: {
    boldText: 'ฉบับที่ 1',
    restText: '  (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย ใช้แนบพร้อมกับแบบแสดงรายการภาษี)',
    boldColor: COLOR_COPY_BLUE,
    restColor: COLOR_TEXT,
  },
  payee_copy2: {
    boldText: 'ฉบับที่ 2',
    restText: '  (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย เก็บไว้เป็นหลักฐาน)',
    boldColor: COLOR_COPY_GREEN,
    restColor: COLOR_TEXT,
  },
  payer_copy3: {
    boldText: 'ฉบับที่ 3',
    restText: ' สำหรับฝ่ายบัญชี',
    boldColor: COLOR_COPY_ORANGE,
    restColor: COLOR_TEXT,
  },
  payer_copy4: {
    boldText: 'ฉบับที่ 4',
    restText: ' สำหรับฝ่ายการเงิน',
    boldColor: COLOR_COPY_PINK,
    restColor: COLOR_TEXT,
  },
};

// 2026-08-13: ผู้ใช้รายงานว่าที่อยู่ในใบหัก ณ ที่จ่ายดูเหมือนตกคำว่า "ตำบล"/"อำเภอ"/"จังหวัด" ไป — ตรวจสอบแล้ว
// พบว่าฟอร์มกรอกที่อยู่ในระบบ (CompanySettingsPage.tsx สำหรับผู้จ่ายเงิน, ContactForm.tsx สำหรับผู้ถูกหักภาษี)
// ให้ผู้ใช้กรอกช่องตำบล/อำเภอ/จังหวัดเป็น "ชื่อล้วน" เท่านั้น (เช่น "บางใหญ่" ไม่ใช่ "ตำบลบางใหญ่") ไม่มีการเติม
// คำนำหน้าที่จุดไหนในระบบเลยตั้งแต่ต้นทาง (buildPayerSnapshot/buildPayeeSnapshot ใน whtCertificateLogic.ts ก็
// pass-through ตรงๆ) จึงต้องเติมคำนำหน้าตรงจุดที่ประกอบเป็นข้อความที่อยู่นี้เอง — กรุงเทพมหานครใช้ แขวง/เขต แทน
// ตำบล/อำเภอ ตามธรรมเนียมที่อยู่ไทย และไม่เติม "จังหวัด" นำหน้ากรุงเทพมหานครเอง (เขียนแค่ "กรุงเทพมหานคร" เฉยๆ)
// เช็ค startsWith กันเติมซ้ำเผื่อบางรายการเก่าผู้ใช้เคยพิมพ์คำนำหน้ามาเองแล้ว
function formatThaiAddressParts(subdistrict: string | null, district: string | null, province: string | null): string {
  const provinceTrimmed = (province ?? '').trim();
  const isBangkok = provinceTrimmed === 'กรุงเทพมหานคร';
  const subPrefix = isBangkok ? 'แขวง' : 'ตำบล';
  const distPrefix = isBangkok ? 'เขต' : 'อำเภอ';

  const withPrefix = (value: string | null, prefix: string): string => {
    const trimmed = (value ?? '').trim();
    if (!trimmed) return '';
    return trimmed.startsWith(prefix) ? trimmed : `${prefix}${trimmed}`;
  };

  const provinceText = !provinceTrimmed
    ? ''
    : isBangkok || provinceTrimmed.startsWith('จังหวัด')
      ? provinceTrimmed
      : `จังหวัด${provinceTrimmed}`;

  return [withPrefix(subdistrict, subPrefix), withPrefix(district, distPrefix), provinceText].filter((v) => v).join(' ');
}

/** วันที่แบบ วว/ดด/ปป (ปี พ.ศ. 2 หลักท้าย) ตรงกับรูปแบบวันที่บนฟอร์มตัวอย่างจริง เช่น "06/04/69" */
function shortBuddhistDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const buddhistYear2 = (y + 543) % 100;
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${String(buddhistYear2).padStart(2, '0')}`;
}

// เนื้อหาแต่ละหมวดในตาราง — ยืนยันตรงตามข้อความเต็มจากไฟล์ตัวอย่างจริงที่กรอกข้อมูลแล้ว (คงไว้จากเวอร์ชันก่อน
// ไม่เปลี่ยน แม้เปลี่ยนโครงหน้าใหม่ทั้งหมด)
const FORM_INCOME_TYPE_CONTENT: Record<'1' | '2' | '3' | '4' | '5' | '6', string[]> = {
  '1': ['1. เงินเดือน ค่าจ้าง เบี้ยเลี้ยง โบนัส ฯลฯ ตาม ม.40(1)'],
  '2': ['2. ค่าธรรมเนียม ค่านายหน้า ฯลฯ ตามมาตรา 40(2)'],
  '3': ['3. ค่าแห่งลิขสิทธิ์ ฯลฯ ตามมาตรา 40(3)'],
  '4': [
    '4. (ก) ค่าดอกเบี้ย ฯลฯ ตามมาตรา 40(4)(ก)',
    '(ข) เงินปันผลเงินส่วนแบ่งกำไร ฯลฯ ตาม ม.40(4)(ข)',
    '  (1) กรณีผู้ได้รับเงินปันผลได้รับเครดิตภาษี โดยจ่ายจากกำไรสุทธิของกิจการที่ต้องเสียภาษีเงินได้นิติบุคคลในอัตราดังนี้',
    '      [ ] (1.1) อัตราร้อยละ 30 ของกำไรสุทธิ',
    '      [ ] (1.2) อัตราร้อยละ 25 ของกำไรสุทธิ',
    '      [ ] (1.3) อัตราร้อยละ 20 ของกำไรสุทธิ',
    '      [ ] (1.4) อัตราอื่นๆ(ระบุ)........... ของกำไรสุทธิ',
    '  (2) กรณีผู้ได้รับเงินปันผลไม่ได้รับเครดิตภาษีเนื่องจากจ่ายจาก',
    '      (2.1) กำไรสุทธิของกิจการที่ได้รับยกเว้นภาษี',
    '      (2.2) เงินปันผลหรือเงินส่วนแบ่งของกำไรที่ได้รับยกเว้น ไม่ต้องนำมารวมคำนวณเป็นรายได้เพื่อเสียภาษีเงินได้นิติบุคคล',
    '      (2.3) กำไรสุทธิส่วนที่ได้หักผลขาดทุนสุทธิยกมาไม่เกิน 5 ปี ก่อนรอบระยะเวลาบัญชีปีปัจจุบัน',
    '      (2.4) กำไรที่รับรู้ทางบัญชีโดยวิธีส่วนได้เสีย (equity method)',
    '      (2.5) อื่นๆ (ระบุ)........',
  ],
  '5': [
    '5. การจ่ายเงินได้ที่ต้องหักภาษี ณ ที่จ่ายตามคำสั่งกรมสรรพากรที่ออกตามมาตรา 3 เตรส (ระบุ)............',
    '(เช่น รางวัล ส่วนลดหรือประโยชน์ใดๆ เนื่องจากการส่งเสริมการขาย รางวัลในการประกวด การแข่งขันการชิงโชค ค่าแสดงของนักแสดงสาธารณะ ค่าขนส่ง ค่าบริการ ค่าเบี้ยประกันวินาศภัย ฯลฯ)',
  ],
  '6': ['6. อื่นๆ(ระบุ)...........'],
};

// ช่องติ๊ก "ผู้จ่ายเงิน" — เลขกำกับ (1)-(4) และคำเป๊ะๆ ตามต้นฉบับราชการ (ต่างจากเวอร์ชันก่อนที่ไม่มีเลขกำกับ
// และใช้คำว่า "หักภาษี ณ ที่จ่าย"/"ออกภาษีให้ครั้งเดียว")
const DEDUCTION_CHECKBOX_LABELS: { key: WhtCertificate['deduction_type']; label: string }[] = [
  { key: 'withholding', label: '(1) หัก ณ ที่จ่าย' },
  { key: 'pay_forever', label: '(2) ออกให้ตลอดไป' },
  { key: 'pay_once', label: '(3) ออกให้ครั้งเดียว' },
  { key: 'other', label: '(4) อื่นๆ(ระบุ)' },
];

// ช่องติ๊กเลือกแบบยื่นภาษีทั้ง 7 แบบ ตามต้นฉบับ — จัด 2 แถว (4 + 3) เหมือนต้นฉบับเป๊ะๆ ระบบนี้เลือกได้แค่
// ภ.ง.ด.3 (formType '03') กับ ภ.ง.ด.53 (formType '53') เท่านั้น ช่องอื่นแสดงไว้แต่ติ๊กไม่ได้
const FORM_TYPE_CHECKBOX_ROWS: { label: string; matchesFormType: WhtCertificate['form_type'] | null }[][] = [
  [
    { label: '(1) ภ.ง.ด.1ก', matchesFormType: null },
    { label: '(2) ภ.ง.ด.1ก พิเศษ', matchesFormType: null },
    { label: '(3) ภ.ง.ด.2', matchesFormType: null },
    { label: '(4) ภ.ง.ด.3', matchesFormType: '03' },
  ],
  [
    { label: '(5) ภ.ง.ด.2ก', matchesFormType: null },
    { label: '(6) ภ.ง.ด.3ก', matchesFormType: null },
    { label: '(7) ภ.ง.ด.53', matchesFormType: '53' },
  ],
];

// กลุ่มหลักเลขประจำตัว 13 หลัก แบบ 1-4-5-2-1 ตามบัตรประชาชนไทย — ใช้ทั้งช่อง "เลขประจำตัวประชาชน" และ
// "เลขประจำตัวผู้เสียภาษีอากร" เพราะข้อมูลจริงในระบบ (payer_tax_id/payee_tax_id) เป็นเลข 13 หลักทั้งคู่
// (เลขผู้เสียภาษีนิติบุคคลไทยรวมเป็นชุดเดียวกับเลขทะเบียนนิติบุคคล 13 หลักมานานแล้ว)
const ID_BOX_GROUPS = [1, 4, 5, 2, 1];
const ID_BOX_W = 3.15;
const ID_BOX_H = 4;
const ID_BOX_GAP = 0.3;
const ID_BOX_GROUP_GAP = 1.3;

function idBoxesWidth(groups: number[]): number {
  const boxesTotal = groups.reduce((sum, size) => sum + size * ID_BOX_W + (size - 1) * ID_BOX_GAP, 0);
  return boxesTotal + (groups.length - 1) * ID_BOX_GROUP_GAP;
}

function getLastAutoTableFinalY(doc: jsPDF, fallback: number): number {
  const docWithTable = doc as unknown as { lastAutoTable?: { finalY?: number } };
  return docWithTable.lastAutoTable?.finalY ?? fallback;
}

/** วาดกล่องสี่เหลี่ยมเล็กๆ (checkbox จริง ไม่ใช่ข้อความ) — เหลี่ยมคม ทึบดำถ้าเลือก กรอบเปล่าถ้าไม่เลือก
 * คืนค่า x ถัดจากกล่อง (สำหรับวางข้อความกำกับต่อ) */
function drawCheckbox(doc: jsPDF, x: number, baselineY: number, checked: boolean): number {
  const size = 2.6;
  const boxY = baselineY - size + 0.5;
  doc.setDrawColor(...COLOR_TEXT);
  doc.setLineWidth(0.2);
  doc.rect(x, boxY, size, size, 'S');
  if (checked) {
    doc.setFillColor(...COLOR_TEXT);
    doc.rect(x + 0.5, boxY + 0.5, size - 1, size - 1, 'F');
  }
  return x + size;
}

/** วาดชุดกล่องตัวเลข (comb box) เรียงตามกลุ่ม groups เช่น [1,4,5,2,1] — เติมตัวเลขจาก value ทีละหลัก
 * (ตัดเฉพาะตัวเลขจริง เผื่อ value มีขีดคั่นปน) ช่องที่เกินจำนวนหลักจริงเว้นว่างไว้ คืนค่า x ถัดจากกล่องสุดท้าย */
function drawIdBoxes(doc: jsPDF, x: number, baselineY: number, value: string | null, groups: number[]): number {
  const digits = (value ?? '').replace(/\D/g, '');
  let di = 0;
  let cx = x;
  doc.setDrawColor(...COLOR_TEXT);
  doc.setLineWidth(0.18);
  doc.setFont(THAI_FONT_NAME, 'normal');
  doc.setFontSize(6.2);
  doc.setTextColor(...COLOR_TEXT);
  groups.forEach((size, gi) => {
    for (let i = 0; i < size; i++) {
      doc.rect(cx, baselineY - ID_BOX_H + 0.9, ID_BOX_W, ID_BOX_H, 'S');
      const d = digits[di] ?? '';
      if (d) doc.text(d, cx + ID_BOX_W / 2, baselineY, { align: 'center' });
      di++;
      cx += ID_BOX_W + (i < size - 1 ? ID_BOX_GAP : 0);
    }
    if (gi < groups.length - 1) cx += ID_BOX_GROUP_GAP;
  });
  return cx;
}

/** วาดกล่องข้อมูลฝ่ายหนึ่ง (ผู้จ่ายเงิน หรือ ผู้ถูกหักภาษี) ตามโครงต้นฉบับราชการ: หัวข้อ+เลขบัตรประชาชน,
 * ชื่อ+เลขผู้เสียภาษีอากร (พร้อมหมายเหตุอิตาลิกอธิบายทั้งคู่), ที่อยู่ (พร้อมหมายเหตุอิตาลิก), และบรรทัด
 * สำนักงานใหญ่/สาขาเพิ่มเติม (ข้อมูลจริงที่มีประโยชน์ ต้นฉบับเปล่าไม่มีช่องนี้แต่คงไว้แบบไม่เด่น) คืนค่า Y
 * ถัดจากกล่องที่วาดเสร็จ */
function drawPartyBox(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  heading: string,
  name: string,
  nationalId: string | null,
  taxId: string | null,
  address: string,
  branchLabel: string
): number {
  const boxHeight = 27;
  doc.setDrawColor(...COLOR_TEXT);
  doc.setLineWidth(0.25);
  doc.roundedRect(x, y, width, boxHeight, 1.8, 1.8, 'S');

  const padX = x + 2;
  const rightX = x + width - 2;
  let ty = y + 4.4;

  // แถว 1: หัวข้อฝ่าย (ซ้าย) + เลขประจำตัวประชาชน (ขวา)
  doc.setFont(THAI_FONT_NAME, 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...COLOR_TEXT);
  drawThaiText(doc, `${heading} : -`, padX, ty);

  doc.setFont(THAI_FONT_NAME, 'normal');
  doc.setFontSize(6.3);
  const natLabel = 'เลขประจำตัวประชาชน';
  const natBoxesX = rightX - idBoxesWidth(ID_BOX_GROUPS);
  drawThaiText(doc, natLabel, natBoxesX - 1.5, ty, { align: 'right' });
  drawIdBoxes(doc, natBoxesX, ty, nationalId, ID_BOX_GROUPS);

  // แถว 2: ชื่อ (ซ้าย) + เลขประจำตัวผู้เสียภาษีอากร (ขวา)
  ty += 5.3;
  doc.setFont(THAI_FONT_NAME, 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLOR_TEXT);
  const nameLine = doc.splitTextToSize(`ชื่อ ${name}`, width * 0.52)[0] ?? `ชื่อ ${name}`;
  drawThaiText(doc, nameLine, padX, ty);

  doc.setFontSize(6.3);
  const taxLabel = 'เลขประจำตัวผู้เสียภาษีอากร';
  const taxBoxesX = rightX - idBoxesWidth(ID_BOX_GROUPS);
  drawThaiText(doc, taxLabel, taxBoxesX - 1.5, ty, { align: 'right' });
  drawIdBoxes(doc, taxBoxesX, ty, taxId, ID_BOX_GROUPS);

  // แถวหมายเหตุอิตาลิกเล็กๆ อธิบายทั้งชื่อและเลขผู้เสียภาษีอากร ตามต้นฉบับ
  ty += 3.4;
  doc.setFontSize(5.6);
  doc.setTextColor(...COLOR_MUTED);
  drawThaiText(doc, '(ให้ระบุว่าเป็น บุคคล นิติบุคคล บริษัท สมาคม หรือคณะบุคคล)', padX, ty);
  drawThaiText(doc, '(ให้กรอกเฉพาะผู้ไม่มีเลขประจำตัวประชาชน)', rightX, ty, { align: 'right' });

  // แถว 3: ที่อยู่
  ty += 4.6;
  doc.setFont(THAI_FONT_NAME, 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLOR_TEXT);
  const addressLine = doc.splitTextToSize(`ที่อยู่ ${address || '-'}`, width - 3)[0] ?? `ที่อยู่ ${address || '-'}`;
  drawThaiText(doc, addressLine, padX, ty);

  ty += 3.4;
  doc.setFontSize(5.6);
  doc.setTextColor(...COLOR_MUTED);
  drawThaiText(doc, '(ให้ระบุ ชื่ออาคาร/หมู่บ้าน ห้องเลขที่ ชั้นที่ เลขที่ ตรอก/ซอย หมู่ที่ ถนน ตำบล/แขวง อำเภอ/เขต จังหวัด)', padX, ty);

  // บรรทัดสำนักงานใหญ่/สาขา — ข้อมูลจริงที่มีประโยชน์ คงไว้จากเวอร์ชันก่อน วางเล็กๆ มุมขวาไม่เด่นเกินไป
  doc.setFont(THAI_FONT_NAME, 'normal');
  doc.setFontSize(6.3);
  doc.setTextColor(...COLOR_TEXT);
  const branchLabelWidth = getTextWidthMm(doc, branchLabel);
  const branchCheckboxSize = 2.2;
  const branchBlockX = rightX - branchLabelWidth - 1 - branchCheckboxSize;
  drawCheckbox(doc, branchBlockX, ty, true);
  drawThaiText(doc, branchLabel, branchBlockX + branchCheckboxSize + 1, ty);

  return y + boxHeight;
}

/** วาดใบหัก ณ ที่จ่าย 1 ฉบับ (ขนาดเป็น "หน้ากระดาษเสมือน" A4 แนวตั้ง 210x297 เดิม — ตัวเรียกจริงจะย่อขนาดด้วย
 * jsPDF transformation matrix ให้พอดีครึ่งหน้า A4 แนวนอน ดู renderTwoUpSheet ด้านล่าง ฟังก์ชันนี้เองไม่รู้เรื่อง
 * การย่อ/จัดวางเลย วาดเหมือนเดิมทุกจุด) — copyVariant ควบคุมข้อความ+สีไฮไลต์มุมซ้ายบน ดู COPY_VARIANT_CONFIG
 * ด้านบน (payee_copy1/2 = ฉบับที่ 1/2 ตามกฎหมายที่ต้องมอบให้ผู้ถูกหักภาษี, payer_copy3/4 = สำเนาฝ่ายบัญชี/
 * การเงินเก็บเข้าแฟ้มของบริษัทผู้จ่ายเงินเอง — ยืนยันข้อความ/สีกับผู้ใช้แล้ว) */
function drawCertificateCopy(
  doc: jsPDF,
  cert: WhtCertificate,
  invoices: PendingTaxInvoice[],
  copyVariant: CopyVariant
): void {
  const outerX = MARGIN;
  const outerWidth = CONTENT_WIDTH;
  // x/width ทั้งฟังก์ชันนี้คือ "พื้นที่ด้านในกรอบนอก" (เว้น FRAME_INSET จากกรอบนอกทุกด้าน) — กรอบนอกเองวาด
  // ทีหลังสุดของฟังก์ชัน (ต้องรู้ตำแหน่ง Y ล่างสุดของเนื้อหาก่อน) ดูคอมเมนต์ท้ายฟังก์ชัน
  const x = MARGIN + FRAME_INSET;
  const width = CONTENT_WIDTH - FRAME_INSET * 2;
  const centerX = x + width / 2;
  const rightX = x + width;
  let y = 16;

  doc.setTextColor(...COLOR_TEXT);

  // มุมซ้ายบน (นอกกรอบนอก): ข้อความ+สีไฮไลต์เฉพาะของสำเนานี้ (ดู COPY_VARIANT_CONFIG) — วางบรรทัดเดียว
  // กึ่งกลางแนวตั้งของพื้นที่เดิม (ระหว่าง y-3.5 ถึง y) เพื่อให้ frameTopY ด้านล่างยังคำนวณจากตำแหน่งเดียวกัน
  // ทุก copyVariant (เดิมฉบับที่ 1/2 เคยพิมพ์ 2 บรรทัดพร้อมกัน แต่ผู้ใช้ขอให้แยกแสดงแค่บรรทัดของฉบับตัวเองต่อ
  // ฝั่งซ้าย/ขวา 2026-08-13)
  doc.setFontSize(7.2);
  const variantCfg = COPY_VARIANT_CONFIG[copyVariant];
  const legendY = y - 1.75;
  doc.setFont(THAI_FONT_NAME, 'bold');
  doc.setTextColor(...variantCfg.boldColor);
  drawThaiText(doc, variantCfg.boldText, outerX, legendY);
  doc.setFont(THAI_FONT_NAME, 'normal');
  doc.setTextColor(...variantCfg.restColor);
  drawThaiText(doc, variantCfg.restText, outerX + getTextWidthMm(doc, variantCfg.boldText), legendY);
  doc.setTextColor(...COLOR_TEXT);

  // กรอบนอกเหลี่ยมคมเริ่มตรงนี้ (ใต้ข้อความฉบับที่ N) — บันทึกตำแหน่งไว้วาดทีหลังสุด
  const frameTopY = y + 3.5;

  // มุมขวาบน (ในกรอบนอก): เลขที่ (ตัวจริง) / มุมซ้ายบน (ในกรอบนอก แถวเดียวกัน): เล่มที่ (เว้นว่างเสมอ ระบบไม่ได้
  // เก็บเลขเล่ม — ย้ายมาไว้มุมซ้ายแทนที่จะซ้อนอยู่เหนือเลขที่มุมขวา ตามคำขอผู้ใช้ 2026-08-13)
  y = frameTopY + 6.5;
  doc.setFont(THAI_FONT_NAME, 'normal');
  doc.setFontSize(8);
  drawThaiText(doc, 'เล่มที่ ..........................', x, y);
  doc.setFont(THAI_FONT_NAME, 'bold');
  drawThaiText(doc, `เลขที่ ${cert.cert_number}`, rightX, y, { align: 'right' });
  doc.setFont(THAI_FONT_NAME, 'normal');

  // หัวเรื่อง
  y += 9;
  doc.setFont(THAI_FONT_NAME, 'bold');
  doc.setFontSize(15);
  drawThaiText(doc, 'หนังสือรับรองการหักภาษี ณ ที่จ่าย', centerX, y, { align: 'center' });
  doc.setFont(THAI_FONT_NAME, 'normal');
  doc.setFontSize(9.5);
  drawThaiText(doc, 'ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร', centerX, y + 5, { align: 'center' });

  // กล่องผู้มีหน้าที่หักภาษี ณ ที่จ่าย (ผู้จ่ายเงิน) — ถือเป็นนิติบุคคลเสมอ ใส่เลขในช่องผู้เสียภาษีอากรเท่านั้น
  y += 12;
  y = drawPartyBox(
    doc,
    x,
    y,
    width,
    'ผู้มีหน้าที่หักภาษี ณ ที่จ่าย',
    cert.payer_name,
    null,
    cert.payer_tax_id,
    [
      cert.payer_address,
      formatThaiAddressParts(cert.payer_subdistrict, cert.payer_district, cert.payer_province),
      cert.payer_postal_code,
    ]
      .filter((v) => v && v.trim())
      .join(' '),
    formatBranchLabel({ branch_type: cert.payer_branch_type, branch_number: cert.payer_branch_number })
  );

  // กล่องผู้ถูกหักภาษี ณ ที่จ่าย — จัดเลขเข้าช่องตาม payee_entity_type (ยืนยันกับผู้ใช้แล้ว)
  y += 2.5;
  const payeeIsIndividual = cert.payee_entity_type === 'individual';
  y = drawPartyBox(
    doc,
    x,
    y,
    width,
    'ผู้ถูกหักภาษี ณ ที่จ่าย',
    cert.payee_name,
    payeeIsIndividual ? cert.payee_tax_id : null,
    payeeIsIndividual ? null : cert.payee_tax_id,
    [
      cert.payee_address,
      formatThaiAddressParts(cert.payee_subdistrict, cert.payee_district, cert.payee_province),
      cert.payee_postal_code,
    ]
      .filter((v) => v && v.trim())
      .join(' '),
    formatBranchLabel({ branch_type: cert.payee_branch_type, branch_number: cert.payee_branch_number })
  );

  // แถวลำดับที่ + ช่องติ๊กเลือกแบบยื่นภาษี 7 แบบ (2 แถว 4+3 ตามต้นฉบับ)
  y += 5;
  doc.setFont(THAI_FONT_NAME, 'normal');
  doc.setFontSize(7.5);
  drawThaiText(doc, 'ลำดับที่', x, y);
  const seqLabelWidth = getTextWidthMm(doc, 'ลำดับที่');
  doc.setDrawColor(...COLOR_TEXT);
  doc.setLineWidth(0.2);
  doc.rect(x + seqLabelWidth + 1.5, y - 3.6, 16, 4.4, 'S');
  drawThaiText(doc, 'ในแบบ', x + seqLabelWidth + 1.5 + 16 + 2, y);

  let checkboxRowY = y + 5.5;
  for (const row of FORM_TYPE_CHECKBOX_ROWS) {
    let cx = x;
    for (const opt of row) {
      cx = drawCheckbox(doc, cx, checkboxRowY, opt.matchesFormType === cert.form_type);
      cx += 1.2;
      doc.setFont(THAI_FONT_NAME, 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...COLOR_TEXT);
      drawThaiText(doc, opt.label, cx, checkboxRowY);
      cx += getTextWidthMm(doc, opt.label) + 6;
    }
    checkboxRowY += 4.6;
  }

  // หมายเหตุอิตาลิกเล็กๆ เกี่ยวกับลำดับที่ — ตรงตำแหน่งในต้นฉบับ (ใต้แถวช่องติ๊กแบบยื่นภาษี)
  doc.setFontSize(5.6);
  doc.setTextColor(...COLOR_MUTED);
  drawThaiText(doc, 
    '(ให้สามารถอ้างอิงหรือสอบยันกันได้ระหว่างลำดับที่ตามหนังสือรับรองฯ กับแบบยื่นรายการภาษีหัก ณ ที่จ่าย)',
    x,
    checkboxRowY - 0.5
  );

  y = checkboxRowY + 3;

  // ตารางประเภทเงินได้พึงประเมินที่จ่าย
  const paidDateText = invoices.length === 1 ? shortBuddhistDate(invoices[0].transaction_date) : 'หลายรายการ';

  const rows = (['1', '2', '3', '4', '5', '6'] as const).map((code) => {
    const isSelected = code === cert.income_type_code;
    const lines = [...FORM_INCOME_TYPE_CONTENT[code]];
    if (isSelected && cert.income_type_label) {
      lines[0] = `${lines[0]} ${cert.income_type_label}`;
    }
    return [
      code,
      lines.join('\n'),
      isSelected ? paidDateText : '',
      isSelected ? THB.format(cert.total_amount) : '',
      isSelected ? THB.format(cert.total_wht_amount) : '',
    ];
  });

  const totalRow = [
    { content: 'รวมเงินที่จ่ายและภาษีที่หักนำส่ง', colSpan: 3, styles: { halign: 'right' as const, fontStyle: 'bold' as const } },
    { content: THB.format(cert.total_amount), styles: { fontStyle: 'bold' as const, fillColor: COLOR_FILL_TOTAL } },
    { content: THB.format(cert.total_wht_amount), styles: { fontStyle: 'bold' as const, fillColor: COLOR_FILL_TOTAL } },
  ];

  autoTable(doc, {
    startY: y,
    margin: { left: x, right: PAGE_WIDTH - rightX },
    tableWidth: width,
    head: [['ลำดับ\nที่', 'ประเภทเงินได้พึงประเมินที่จ่าย', 'วัน เดือน\nหรือปีภาษี ที่จ่าย', 'จำนวนเงิน\nที่จ่าย', 'ภาษีที่หัก\nและนำส่งไว้']],
    body: [...rows, totalRow],
    theme: 'grid',
    // 2026-08-12: บังคับห้าม autoTable ขึ้นหน้าใหม่เอง (pageBreak: 'avoid') — จำเป็นเฉพาะตอนวาดใน
    // renderTwoUpSheet() ที่ห่อฟังก์ชันนี้ด้วย jsPDF transformation matrix ย่อขนาดลงครึ่งหน้า A4 แนวนอน เพราะ
    // autoTable คำนวณพื้นที่เหลือจาก doc.internal.pageSize.getHeight() ของหน้าจริง (210mm แนวนอน) ไม่รู้ว่า
    // ระบบพิกัดที่ฟังก์ชันนี้วาดอยู่เป็นพิกัดเสมือนหน้า A4 แนวตั้ง 297mm ที่จะถูกย่อลงทีหลัง จึงเข้าใจผิดว่าล้น
    // หน้าแล้วเรียก doc.addPage() เอง ทำให้ saveGraphicsState/restoreGraphicsState ของ renderTwoUpSheet ไม่จับคู่
    // กัน (บันทึกไว้หน้าหนึ่ง คืนค่าที่อีกหน้า) พังทั้งไฟล์ — เนื้อหาจริงพอดี 1 หน้าเสมออยู่แล้ว (ออกแบบมาแบบนั้น
    // ตั้งแต่แรก) จึงปิดการขึ้นหน้าอัตโนมัติได้อย่างปลอดภัย ไม่กระทบภาพที่ออกมาเลย
    pageBreak: 'avoid',
    styles: {
      font: THAI_FONT_NAME,
      fontStyle: 'normal',
      fontSize: 7,
      cellPadding: 1,
      valign: 'top',
      lineColor: COLOR_TEXT,
      lineWidth: 0.2,
      textColor: COLOR_TEXT,
    },
    headStyles: {
      font: THAI_FONT_NAME,
      fontStyle: 'bold',
      fillColor: [255, 255, 255],
      textColor: COLOR_TEXT,
      halign: 'center',
      fontSize: 7.3,
      valign: 'middle',
    },
    bodyStyles: { valign: 'top' },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center', valign: 'middle' },
      1: { cellWidth: 94 },
      2: { cellWidth: 24, halign: 'center', valign: 'middle' },
      3: { cellWidth: 25, halign: 'right', valign: 'middle' },
      4: { cellWidth: 25, halign: 'right', valign: 'middle' },
    },
    // autoTable วาดข้อความในเซลเองภายใน (ไม่ผ่าน drawThaiText ของเรา) จึงต้องแก้บั๊ก "วรรณยุกต์ลอยเหนือ
    // สระบนหายไป" (ดูคอมเมนต์ยาวใน lib/pdfThaiFont.ts) แยกต่างหากตรงนี้ด้วย didDrawCell
    didDrawCell: (data) => fixAutoTableCellThaiText(doc, data),
  });

  y = getLastAutoTableFinalY(doc, y) + 4;

  doc.setFont(THAI_FONT_NAME, 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLOR_TEXT);
  drawThaiText(doc, `รวมเงินภาษีที่หักนำส่ง (ตัวอักษร) ${thaiBahtText(cert.total_wht_amount)}`, x, y);
  y += 5;

  // บรรทัดกองทุนรวมเดียว ตามต้นฉบับ (เดิมแยก 2 บรรทัดและไม่มี กบข./กสจ./กองทุนสงเคราะห์ครูฯ) — เว้นว่างเสมอ
  // เพราะระบบไม่ได้เก็บข้อมูล 3 รายการนี้
  doc.setFontSize(6.8);
  drawThaiText(doc, 
    'เงินที่จ่ายเข้า กบข./กสจ./กองทุนสงเคราะห์ครูโรงเรียนเอกชน.................บาท กองทุนประกันสังคม.................บาท กองทุนสำรองเลี้ยงชีพ.................บาท',
    x,
    y
  );
  y += 6;

  // แถวช่องติ๊กผู้จ่ายเงิน (มีเลขกำกับตามต้นฉบับ)
  doc.setFontSize(7.5);
  let cx = x;
  drawThaiText(doc, 'ผู้จ่ายเงิน', cx, y);
  cx += getTextWidthMm(doc, 'ผู้จ่ายเงิน') + 2.5;
  for (const opt of DEDUCTION_CHECKBOX_LABELS) {
    cx = drawCheckbox(doc, cx, y, cert.deduction_type === opt.key);
    cx += 1.2;
    const label =
      opt.key === 'other' && cert.deduction_type === 'other' && cert.deduction_type_note
        ? `${opt.label} ${cert.deduction_type_note}`
        : opt.label;
    drawThaiText(doc, label, cx, y);
    cx += getTextWidthMm(doc, label) + 4;
  }

  // แถวล่างสุด: คำเตือน (ซ้าย) + ข้อความรับรอง/ลงชื่อ/วงกลมประทับตรา (ขวา)
  y += 10;
  const bottomTop = y;
  const leftColWidth = width * 0.5;
  const rightColX = x + leftColWidth + 6;
  const rightColWidth = width - leftColWidth - 6;

  doc.setFont(THAI_FONT_NAME, 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...COLOR_TEXT);
  drawThaiText(doc, 'คำเตือน', x, y);
  doc.setFont(THAI_FONT_NAME, 'normal');
  doc.setFontSize(6.3);
  doc.setTextColor(...COLOR_MUTED);
  const warnLines = doc.splitTextToSize(
    'ผู้มีหน้าที่ออกหนังสือรับรองการหักภาษี ณ ที่จ่าย ฝ่าฝืนไม่ปฏิบัติตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร ต้องรับโทษทางอาญาตามมาตรา 35 แห่งประมวลรัษฎากร',
    leftColWidth - 2
  );
  drawThaiText(doc, warnLines, x, y + 3.6);

  // ฝั่งขวา: ข้อความรับรอง + เส้นลงชื่อว่าง (เซ็นเองด้วยมือ) + วงกลมประทับตรานิติบุคคล
  let ry = bottomTop;
  doc.setFont(THAI_FONT_NAME, 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...COLOR_TEXT);
  const certifyLines = doc.splitTextToSize('ขอรับรองว่าข้อความและตัวเลขดังกล่าวข้างต้นถูกต้องตรงกับความจริงทุกประการ', rightColWidth - 2);
  drawThaiText(doc, certifyLines, rightColX, ry);
  ry += 3.6 * certifyLines.length + 4;

  const sealRadius = 8;
  const sealCenterX = rightColX + rightColWidth - sealRadius - 1;
  drawThaiText(doc, 'ลงชื่อ.....................................................ผู้จ่ายเงิน', rightColX, ry);
  ry += 6;
  drawThaiText(doc, '............... / ............... / ...............', rightColX + 8, ry);
  doc.setFontSize(6.3);
  doc.setTextColor(...COLOR_MUTED);
  ry += 3.4;
  drawThaiText(doc, '(วัน เดือน ปี ที่ออกหนังสือรับรองฯ)', rightColX + 8, ry);

  // วงกลมประทับตรานิติบุคคล — เส้นประ ตามต้นฉบับ
  const sealCenterY = bottomTop + 8;
  doc.setDrawColor(...COLOR_MUTED);
  doc.setLineDashPattern([0.6, 0.6], 0);
  doc.setLineWidth(0.2);
  doc.circle(sealCenterX, sealCenterY, sealRadius, 'S');
  doc.setLineDashPattern([], 0);
  doc.setFontSize(5.6);
  drawThaiText(doc, 'ประทับตรา', sealCenterX, sealCenterY - 1, { align: 'center' });
  drawThaiText(doc, 'นิติบุคคล (ถ้ามี)', sealCenterX, sealCenterY + 2.5, { align: 'center' });

  // กรอบนอกเหลี่ยมคมล้อมทั้งฟอร์ม (ตั้งแต่ใต้ข้อความฉบับที่ 1/2 ลงมาถึงใต้บล็อกคำเตือน/ลงชื่อ) + เส้นแบ่ง
  // แนวตั้งคั่นกล่องคำเตือน (ซ้าย) กับกล่องรับรอง/ลงชื่อ (ขวา) — วาดทีหลังสุดเมื่อรู้ตำแหน่ง Y ล่างสุดแล้ว
  // ตรงตามโครงต้นฉบับราชการ (ยืนยันจากการซูมไฟล์ต้นฉบับจริงทีละจุด)
  const frameBottomY = Math.max(ry + 2, sealCenterY + sealRadius + 2);
  doc.setDrawColor(...COLOR_TEXT);
  doc.setLineWidth(0.3);
  doc.rect(outerX, frameTopY, outerWidth, frameBottomY - frameTopY, 'S');
  const dividerX = x + leftColWidth + 3;
  doc.line(dividerX, bottomTop - 3, dividerX, frameBottomY);

  doc.setTextColor(...COLOR_TEXT);
}

/** ตารางรายละเอียดรายการจ่ายเงินที่ประกอบเป็นใบนี้ — แนบเป็นหน้าเพิ่มท้ายไฟล์เฉพาะตอนรวมมากกว่า 1 รายการ
 * เท่านั้น ไม่ใช่ส่วนหนึ่งของแบบฟอร์มราชการ แต่เป็นหลักฐานประกอบเพื่อความโปร่งใสตรวจสอบย้อนกลับได้ */
function appendInvoiceBreakdownPage(doc: jsPDF, cert: WhtCertificate, invoices: PendingTaxInvoice[]): void {
  doc.addPage('a4', 'portrait');
  const marginX = 15;
  doc.setTextColor(...COLOR_TEXT);
  doc.setFont(THAI_FONT_NAME, 'bold');
  doc.setFontSize(11);
  drawThaiText(doc, `รายละเอียดรายการที่ประกอบเป็นใบหัก ณ ที่จ่ายเลขที่ ${cert.cert_number}`, marginX, 15);
  doc.setFont(THAI_FONT_NAME, 'normal');
  doc.setFontSize(9);
  drawThaiText(doc, `ผู้ถูกหักภาษี: ${cert.payee_name}`, marginX, 22);

  autoTable(doc, {
    startY: 27,
    margin: { left: marginX, right: marginX },
    head: [['วันที่ทำรายการ', 'รายละเอียด', 'เลขที่อ้างอิง', 'ยอดรวม', 'หัก ณ ที่จ่าย']],
    body: invoices.map((inv) => [
      shortBuddhistDate(inv.transaction_date),
      inv.description ?? '-',
      inv.reference_no ?? '-',
      THB.format(inv.total_amount),
      THB.format(inv.wht_amount),
    ]),
    theme: 'grid',
    styles: { font: THAI_FONT_NAME, fontStyle: 'normal', fontSize: 8.5, cellPadding: 1.5, textColor: COLOR_TEXT, lineColor: COLOR_TEXT },
    headStyles: { font: THAI_FONT_NAME, fontStyle: 'bold', fillColor: [255, 255, 255], textColor: COLOR_TEXT },
    columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' } },
    didDrawCell: (data) => fixAutoTableCellThaiText(doc, data),
  });

  const finalY = getLastAutoTableFinalY(doc, 27);
  doc.setFont(THAI_FONT_NAME, 'bold');
  doc.setFontSize(9);
  drawThaiText(doc, 
    `รวม ${invoices.length} รายการ · ยอดรวม ${THB.format(cert.total_amount)} บาท · หัก ณ ที่จ่ายรวม ${THB.format(cert.total_wht_amount)} บาท`,
    marginX,
    finalY + 6
  );
}

// 2026-08-12: เปลี่ยนจาก A4 แนวตั้งเต็มหน้าต่อ 1 ฉบับ (2 หน้าต่อชุด) มาเป็น A4 แนวนอน 1 หน้า วางฉบับซ้าย-ขวา
// ตามคำขอผู้ใช้ ("ตอนนี้ทำเป็น size A4 2แผ่น ช่วยปรับให้เป็นแผ่นเดียวกันให้หน่อย" → เลือก "แนวนอน แบ่งซ้าย-ขวา")
// แทนที่จะเขียน drawCertificateCopy ใหม่ทั้งหมดให้รู้จักพิกัดครึ่งหน้า (เสี่ยงกระทบทุกจุดในฟังก์ชัน 250+ บรรทัด)
// ใช้ jsPDF transformation matrix (saveGraphicsState/setCurrentTransformationMatrix/restoreGraphicsState) ย่อ
// อัตราส่วนทั้งฟังก์ชันแทน — drawCertificateCopy ยังวาดในระบบพิกัดเดิม (เสมือนหน้า A4 แนวตั้ง 210x297) ไม่รู้ตัว
// เลยว่ากำลังถูกย่อ/แปะลงครึ่งหน้าแนวนอน วิธีนี้ปลอดภัยกว่าการไล่แก้พิกัดทุกจุดในฟังก์ชันเดิม
//
// ค่าพิกัด/สเกลด้านล่างวัดจากการเรนเดอร์จริงแล้วซูมดู (เนื้อหาจริงของ 1 ฉบับกินพื้นที่ประมาณ x:14-196mm,
// y:9.6-266mm บนระบบพิกัดเดิม) บวก buffer กันเนื้อหายาวกว่าปกติ (เช่น ที่อยู่ยาวมากต้อง wrap หลายบรรทัด) ล้น
const SHEET_CONTENT_LEFT = 12; // ขอบซ้ายสุดของเนื้อหาจริง (มี buffer จาก MARGIN=14)
const SHEET_CONTENT_TOP = 8; // ขอบบนสุดของเนื้อหาจริง (มี buffer)
const SHEET_CONTENT_WIDTH = 186; // 198(ขวาสุด+buffer) - 12
const SHEET_CONTENT_HEIGHT = 264; // 272(ล่างสุด+buffer) - 8
const SHEET_PAGE_MARGIN = 8; // ขอบกระดาษ A4 แนวนอนแต่ละด้าน
const SHEET_GAP = 8; // ช่องไฟระหว่างฉบับซ้าย-ขวา
const LANDSCAPE_PAGE_WIDTH = 297;
const LANDSCAPE_PAGE_HEIGHT = 210;
// คำนวณสเกลจากทั้งข้อจำกัดความกว้าง (พื้นที่ที่เหลือหลังหักขอบซ้าย-ขวา/ช่องไฟ หารสอง สำหรับ 1 ฉบับ) และความสูง
// (พื้นที่ที่เหลือหลังหักขอบบน-ล่าง) แล้วใช้ค่าน้อยกว่า (คูณ 0.99 กันเนื้อหาชนขอบพอดีเป๊ะ) — วัดจากการเรนเดอร์
// จริงแล้วพบว่าทั้งสองข้อจำกัดใกล้เคียงกันมาก (~0.75) เพราะสัดส่วนเนื้อหา 1 ฉบับ (186x264mm) ใกล้เคียงสัดส่วน
// ครึ่งหน้า A4 แนวนอนพอดี
const SHEET_SCALE =
  Math.min(
    (LANDSCAPE_PAGE_WIDTH - SHEET_PAGE_MARGIN * 2 - SHEET_GAP) / 2 / SHEET_CONTENT_WIDTH,
    (LANDSCAPE_PAGE_HEIGHT - SHEET_PAGE_MARGIN * 2) / SHEET_CONTENT_HEIGHT
  ) * 0.99;

/** วาด 1 หน้า A4 แนวนอน แบ่ง 2 ฉบับซ้าย-ขวา — ฝั่งซ้าย/ขวาแสดงข้อความ+สีไฮไลต์ต่างกันตาม variants[0]/[1]
 * ตามลำดับ (ดู COPY_VARIANT_CONFIG) เนื้อหาหลักในตาราง/กล่องข้อมูลเหมือนกันทั้งคู่ ต่างแค่ป้ายมุมซ้ายบน —
 * ต้องเรียกตอน doc อยู่ที่หน้าที่ต้องการวาดพอดีแล้ว (เพจแรกไม่ต้อง addPage, เพจถัดไปต้อง
 * addPage('a4','landscape') ก่อนเรียก) */
function renderTwoUpSheet(
  doc: jsPDF,
  cert: WhtCertificate,
  invoices: PendingTaxInvoice[],
  variants: [CopyVariant, CopyVariant]
): void {
  const ty = SHEET_PAGE_MARGIN - SHEET_CONTENT_TOP * SHEET_SCALE;
  const txLeft = SHEET_PAGE_MARGIN - SHEET_CONTENT_LEFT * SHEET_SCALE;
  const leftOccupiedRight = SHEET_PAGE_MARGIN + SHEET_CONTENT_WIDTH * SHEET_SCALE;
  const txRight = leftOccupiedRight + SHEET_GAP - SHEET_CONTENT_LEFT * SHEET_SCALE;

  // autoTable คำนวณพื้นที่เหลือของหน้าจาก doc.internal.pageSize.getHeight()/getWidth() ของหน้าจริง (297x210mm
  // แนวนอน) ไม่รู้ว่าระบบพิกัดที่ drawCertificateCopy วาดอยู่เป็นพิกัดเสมือนหน้า A4 แนวตั้ง 210x297 ที่จะถูกย่อ
  // ด้วย matrix ทีหลัง จึงเข้าใจผิดว่าล้นหน้าแล้วเรียก doc.addPage() เอง (ทำให้ saveGraphicsState/
  // restoreGraphicsState ด้านล่างไม่จับคู่กันข้ามหน้า พังทั้งไฟล์ — ยืนยันด้วยการทดสอบจริงแล้ว) แก้ด้วยการหลอก
  // ค่าที่ autoTable อ่านชั่วคราวให้ตรงกับระบบพิกัดเสมือนก่อนวาด แล้วคืนค่าจริงกลับหลังวาดเสร็จ — ทดสอบแล้วว่า
  // setWidth/setHeight มีผลแค่กับค่าที่ jsPDF ใช้คำนวณภายใน (เช่น autoTable) เท่านั้น ไม่กระทบขนาดหน้าจริงใน
  // ไฟล์ PDF ที่ออกมา (/MediaBox ยังเป็น A4 แนวนอนเหมือนเดิมทุกประการ)
  const realWidth = doc.internal.pageSize.getWidth();
  const realHeight = doc.internal.pageSize.getHeight();
  // setWidth/setHeight มีอยู่จริงตอน runtime แต่ @types/jspdf ไม่ได้ประกาศไว้ในชนิด PageSize จึงต้อง cast
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ดูคอมเมนต์บรรทัดบน
  const pageSize = doc.internal.pageSize as any;

  [txLeft, txRight].forEach((tx, i) => {
    // ต้องใช้ doc.advancedAPI() ห่อทุกจุดที่ตั้ง CTM เอง (setCurrentTransformationMatrix) — ทดสอบแล้วว่าถ้า
    // เรียก saveGraphicsState/setCurrentTransformationMatrix/restoreGraphicsState ตรงๆ โดยไม่ผ่าน
    // advancedAPI() พิกัด/ขนาดที่วาด (doc.rect/roundedRect/text ฯลฯ) จะเพี้ยน (แคบ/กว้างผิดสัดส่วน ต่างกันไป
    // ตามลำดับที่วาดก่อน-หลัง) เพราะ jsPDF ใน "compat" mode (ค่าเริ่มต้น) ยังคงคูณ scaleFactor (mm→pt) และ
    // กลับแกน Y เองอยู่ดี (โดยอิง getPageHeight() ของหน้าจริง ไม่ใช่พิกัดเสมือน) ซ้อนทับกับที่ CTM ทำให้อีกที
    // — ต้องสลับเป็น "advanced" mode ก่อน (ปิดการคำนวณซ้ำสองชั้นนี้) ซึ่ง doc.advancedAPI(callback) จัดการให้
    // อัตโนมัติ (สลับโหมด + saveGraphicsState ก่อนเรียก callback แล้ว restoreGraphicsState + สลับกลับให้เอง)
    doc.advancedAPI(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsPDF Matrix ไม่ได้ export type ใน d.ts
      const matrix = new (doc as any).Matrix(SHEET_SCALE, 0, 0, SHEET_SCALE, tx, ty);
      doc.setCurrentTransformationMatrix(matrix);
      pageSize.setWidth(PAGE_WIDTH);
      pageSize.setHeight(297);
      drawCertificateCopy(doc, cert, invoices, variants[i]);
      pageSize.setWidth(realWidth);
      pageSize.setHeight(realHeight);
    });
  });
}

/** สร้างไฟล์ PDF ใบหัก ณ ที่จ่ายฉบับสมบูรณ์ (ไว้ดาวน์โหลด/พิมพ์) — A4 แนวนอน หน้าที่ 1 = ฉบับที่ 1 (ซ้าย ไฮไล
 * น้ำเงิน) + ฉบับที่ 2 (ขวา ไฮไลเขียว) สำหรับผู้ถูกหักภาษี ตามกฎหมาย, หน้าที่ 2 = ฉบับที่ 3 สำหรับฝ่ายบัญชี (ซ้าย
 * ไฮไลส้ม) + ฉบับที่ 4 สำหรับฝ่ายการเงิน (ขวา ไฮไลชมพู) เก็บเข้าแฟ้มของบริษัทผู้จ่ายเงินเอง + หน้าแนบรายละเอียด
 * ถ้ารวมหลายรายการ คืนค่าเป็น Blob พร้อมดาวน์โหลด/แสดงผลผ่าน lib/reportExport.ts downloadBlob() — ใช้ทั้งปุ่ม
 * "ดาวน์โหลด PDF" ตรงๆ */
export function buildWhtCertificatePdf(cert: WhtCertificate, invoices: PendingTaxInvoice[]): Blob {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  registerThaiFont(doc);

  renderTwoUpSheet(doc, cert, invoices, ['payee_copy1', 'payee_copy2']);
  doc.addPage('a4', 'landscape');
  renderTwoUpSheet(doc, cert, invoices, ['payer_copy3', 'payer_copy4']);

  if (invoices.length > 1) {
    appendInvoiceBreakdownPage(doc, cert, invoices);
  }

  return doc.output('blob');
}

/** สร้างไฟล์ PDF สำหรับแนบอีเมลส่งผู้ถูกหักภาษีโดยเฉพาะ — มีแค่หน้าเดียว (ฉบับที่ 1 ซ้าย + ฉบับที่ 2 ขวา สำหรับ
 * ผู้ถูกหักภาษี) ไม่มีหน้าสำเนาสำหรับผู้มีหน้าที่หัก (เก็บไว้ที่บริษัทเองไม่ต้องส่งให้ผู้ถูกหักภาษี) และไม่มีหน้า
 * แนบรายละเอียดรายการ (เอกสารภายในของบริษัทเอง ไม่ใช่ส่วนหนึ่งของแบบฟอร์มราชการที่ต้องส่งให้ผู้ถูกหักภาษี) ตาม
 * คำขอผู้ใช้ */
export function buildWhtCertificatePdfForEmail(cert: WhtCertificate, invoices: PendingTaxInvoice[]): Blob {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  registerThaiFont(doc);

  renderTwoUpSheet(doc, cert, invoices, ['payee_copy1', 'payee_copy2']);

  return doc.output('blob');
}

/** วันที่แบบ วว.ดด.ปปปป (ปี ค.ศ. เต็ม 4 หลัก ต่างจาก shortBuddhistDate ที่ใช้ในตัวเอกสารซึ่งเป็น พ.ศ. 2 หลัก) —
 * ใช้เฉพาะในชื่อไฟล์ PDF เท่านั้น เช่น "11.08.2026" */
function fileNameDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** ชื่อไฟล์มาตรฐานตอนดาวน์โหลด/แนบอีเมล — รูปแบบ "{เลขที่ใบ}_{วันที่ออกใบ วว.ดด.ปปปป}_{ชื่อผู้ถูกหักภาษี}.pdf"
 * เช่น "03-6908001_11.08.2026_นายศักรินทร์ บุญช่วย.pdf" (ตามคำขอผู้ใช้ 2026-08-13 — เดิมใช้แค่ "wht-cert-เลขที่
 * ใบ.pdf") ตัดอักขระที่ใช้ในชื่อไฟล์ไม่ได้ (/ \ : * ? " < > |) ออกจากชื่อผู้ถูกหักภาษีก่อนเสมอ กันชื่อไฟล์พังถ้ามี
 * อักขระแปลกปลอมปนมา (เช่น พิมพ์ชื่อบริษัทมีเครื่องหมาย "/" ปนมาโดยไม่ตั้งใจ) */
export function whtCertificateFilename(cert: WhtCertificate): string {
  const datePart = fileNameDate(cert.issued_date);
  const safePayeeName = cert.payee_name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `${[cert.cert_number, datePart, safePayeeName].filter((p) => p).join('_')}.pdf`;
}
