import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  EXCEL_HEADERS,
  EXCEL_HEADER_ORDER,
  buildTemplateBlob,
  excelRowToWriteInput,
  findDuplicateRowNumbers,
  parseExcelDateCell,
  parseExcelRow,
  parseExcelRows,
  parseVatCell,
  readSheetRows,
  readWorkbookRows,
} from './excelImport';
import type { PendingTaxInvoice } from '@/types/invoice';

// หมายเหตุ: vat_amount default เป็น 70 (ไม่ใช่ค่าว่าง) โดยตั้งใจ — ตั้งแต่ฟีเจอร์ตรวจจับ VAT
// อัตโนมัติ (2026-07-15) ค่าว่างมีความหมายพิเศษ (= "ไม่มี VAT" โดยตรง ไม่ใช่แค่ "ลืมกรอก" อีกต่อไป)
// เทสต์ที่ต้องการทดสอบกรณี VAT ว่าง/0/"-" โดยเฉพาะจะ override ค่านี้เอง (ดู describe จำแนกประเภทภาษี)
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    [EXCEL_HEADERS.vendor_name]: 'บริษัท ทดสอบ จำกัด',
    [EXCEL_HEADERS.transaction_date]: '2026-07-01',
    [EXCEL_HEADERS.description]: 'ค่าสินค้า',
    [EXCEL_HEADERS.amount_excl_vat]: 1000,
    [EXCEL_HEADERS.vat_amount]: 70,
    [EXCEL_HEADERS.reference_no]: 'PO-001',
    [EXCEL_HEADERS.expected_date]: '',
    [EXCEL_HEADERS.notes]: '',
    ...overrides,
  };
}

describe('parseExcelDateCell', () => {
  it('รับ Date object และแปลงเป็น ISO', () => {
    expect(parseExcelDateCell(new Date(2026, 6, 13))).toBe('2026-07-13');
  });

  it('รับ string แบบ YYYY-MM-DD', () => {
    expect(parseExcelDateCell('2026-07-13')).toBe('2026-07-13');
  });

  it('รับ string แบบ DD/MM/YYYY ที่ปีดูเหมือน ค.ศ. (< 2200) — เก็บตรงๆ ไม่แปลง', () => {
    expect(parseExcelDateCell('13/7/2026')).toBe('2026-07-13');
  });

  it('รับ string แบบ DD/MM/YYYY ที่ปีเป็น พ.ศ. (>= 2200) — แปลงเป็น ค.ศ. จริงโดยลบ 543 (เดิมเป็นบั๊ก เก็บปีตามที่พิมพ์ตรงๆ ทำให้ transaction_date เพี้ยนไป 543 ปี แก้ไข 2026-09-02)', () => {
    expect(parseExcelDateCell('13/7/2569')).toBe('2026-07-13');
    expect(parseExcelDateCell('30/07/2569')).toBe('2026-07-30');
    expect(parseExcelDateCell('01/01/2570')).toBe('2027-01-01');
  });

  it('ปี พ.ศ. ที่แปลงแล้วต้องยังเป็นวันที่จริง (เช่น 29 ก.พ. ปีอธิกสุรทิน ค.ศ. เท่านั้น)', () => {
    // พ.ศ. 2571 = ค.ศ. 2028 (อธิกสุรทิน มี 29 ก.พ.) — ผ่าน
    expect(parseExcelDateCell('29/2/2571')).toBe('2028-02-29');
    // พ.ศ. 2570 = ค.ศ. 2027 (ไม่ใช่อธิกสุรทิน ไม่มี 29 ก.พ.) — ไม่ผ่าน
    expect(parseExcelDateCell('29/2/2570')).toBeNull();
  });

  it('รับเลข serial ของ Excel', () => {
    // 46216 = 2026-07-13 ใน Excel serial date
    expect(parseExcelDateCell(46216)).toBe('2026-07-13');
  });

  // บั๊กที่ผู้ใช้แจ้ง 2026-09-22: กรอกเดือนกันยายนในเทมเพลต แต่ระบบบันทึกเป็นสิงหาคม
  // ต้นเหตุคือการแปลงวันที่ขึ้นกับโซนเวลาของเครื่อง เทสต์ชุดนี้ต้องผ่านในทุกโซนเวลา
  // (รันตรวจจริงมาแล้วที่ UTC, Asia/Bangkok, America/New_York, Pacific/Kiritimati)
  it('เลข serial ต้องให้วันที่เดิมเสมอ ไม่ว่าเครื่องจะตั้งโซนเวลาอะไร', () => {
    expect(parseExcelDateCell(46266)).toBe('2026-09-01'); // เคสของผู้ใช้: 1 ก.ย. 2026
    expect(parseExcelDateCell(46265)).toBe('2026-08-31');
    expect(parseExcelDateCell(45658)).toBe('2025-01-01'); // ขึ้นปีใหม่ — จุดที่เลื่อน 1 วันแล้วข้ามปี
    expect(parseExcelDateCell(46022)).toBe('2025-12-31');
  });

  it('serial ที่มีเศษทศนิยมติดมา (บางเครื่องมือเขียนแบบนี้) ต้องได้วันที่ถูกต้อง', () => {
    // 46265.9997 คือ "1 ก.ย. ลบไปเสี้ยววินาที" — ถ้าปัดลงตรงๆ จะกลายเป็น 31 ส.ค. แบบเงียบๆ
    expect(parseExcelDateCell(46265.999768518515)).toBe('2026-09-01');
    expect(parseExcelDateCell(46266.0000462963)).toBe('2026-09-01');
  });

  it('เซลล์วันที่ที่มี "เวลา" ติดมาด้วย (statement ธนาคาร) ต้องคงวันเดิม ไม่ปัดขึ้นวันถัดไป', () => {
    expect(parseExcelDateCell(46266.25)).toBe('2026-09-01'); // 06:00
    expect(parseExcelDateCell(46266.5)).toBe('2026-09-01'); // 12:00 — จุดที่การปัดแบบ round จะพัง
    expect(parseExcelDateCell(46266.625)).toBe('2026-09-01'); // 15:00
    expect(parseExcelDateCell(46266.99)).toBe('2026-09-01'); // 23:45
  });

  it('ข้อจำกัดที่ยอมรับไว้: เวลาในช่วง 23:58-23:59 จะถูกนับเป็นวันถัดไป', () => {
    // เป็นผลจากการเผื่อ 2 นาทีให้ความคลาดเคลื่อนของ serial (ดูคอมเมนต์ใน excelSerialToDate)
    // เลขตัวเดียวถูกใช้แทนทั้ง "เศษความคลาดเคลื่อน" และ "เวลาจริงในวัน" จึงแยกสองอย่างนี้ใกล้เที่ยงคืนไม่ได้
    // เขียนเป็นเทสต์ไว้ให้เป็นพฤติกรรมที่ตั้งใจและตรวจสอบได้ ไม่ใช่ผลข้างเคียงที่ไม่มีใครรู้
    expect(parseExcelDateCell(46266 + 1437 / 1440)).toBe('2026-09-01'); // 23:57 — ยังเป็นวันเดิม
    expect(parseExcelDateCell(46266 + 1438 / 1440)).toBe('2026-09-02'); // 23:58 — ขยับเป็นวันถัดไป
  });

  // ผู้ใช้แจ้ง 2026-09-15: นำเข้าไฟล์เทมเพลตที่วันที่เป็น พ.ศ. แล้วได้ปี 3112 บนหน้าจอ (= 2569 + 543 ตอน
  // แสดงผล แปลว่าฐานข้อมูลเก็บ 2569 ไว้ตรงๆ) — รอบแก้ 2026-09-02 ครอบคลุมเฉพาะเส้นทางข้อความ วว/ดด/ปปปป
  // อีก 3 เส้นทางยังหลุด เทสต์ชุดนี้ปิดช่องที่เหลือทั้งหมด
  it('ปี พ.ศ. ที่มาทางอื่นนอกจาก วว/ดด/ปปปป ก็ต้องถูกแปลงเป็น ค.ศ. เหมือนกัน', () => {
    // เส้นทางที่ 1: ข้อความ ISO ที่ปีเป็น พ.ศ. (ไฟล์บางระบบ export ออกมาแบบนี้)
    expect(parseExcelDateCell('2569-08-30')).toBe('2026-08-30');
    // เส้นทางที่ 2: Date object ที่ตัวปีเป็น พ.ศ. (Excel ที่ตีความปี 2569 เป็นปีปฏิทินตรงๆ)
    expect(parseExcelDateCell(new Date(2569, 7, 30))).toBe('2026-08-30');
  });

  it('ปี ค.ศ. ปกติต้องไม่ถูกลบ 543 ซ้ำ (กันแปลงเกิน)', () => {
    expect(parseExcelDateCell('2026-08-30')).toBe('2026-08-30');
    expect(parseExcelDateCell('30/08/2569')).toBe('2026-08-30');
    expect(parseExcelDateCell(new Date(2026, 7, 30))).toBe('2026-08-30');
  });

  // ปิดช่องโหว่ "ค่าผิดแบบเงียบ" (2026-09-22): เลขลอยๆ ที่ผู้ใช้เผลอพิมพ์ลงช่องวันที่ เคยถูกตีความเป็น
  // serial date ของ Excel แล้วได้วันที่ปี 1900 กลับมาโดยไม่มี error — รายการจะหายจากรายงานภาษีแบบเงียบๆ
  it('ปีที่หลุดช่วงเอกสารจริง (พ.ศ. 2500-2700) ต้องคืน null ไม่ใช่รับค่าผิดเข้าระบบ', () => {
    expect(parseExcelDateCell(9)).toBeNull(); // เลขเดือนที่พิมพ์ผิดช่อง → 1900-01-08
    expect(parseExcelDateCell(2569)).toBeNull(); // เลขปีที่พิมพ์ผิดช่อง → 1907
    expect(parseExcelDateCell(0)).toBeNull();
    expect(parseExcelDateCell(new Date(1900, 0, 8))).toBeNull();
    expect(parseExcelDateCell('1900-01-08')).toBeNull();
  });

  it('ขอบเขตช่วงปีที่ยอมรับ — พ.ศ. 2500 ถึง 2700 พอดี', () => {
    expect(parseExcelDateCell('01/01/2500')).toBe('1957-01-01');
    expect(parseExcelDateCell('31/12/2700')).toBe('2157-12-31');
    expect(parseExcelDateCell('31/12/2499')).toBeNull();
    expect(parseExcelDateCell('01/01/2701')).toBeNull();
  });

  it('วันที่ทำบัญชีจริงในช่วงปกติต้องไม่ถูกปฏิเสธ', () => {
    for (const year of [2560, 2569, 2580, 2600]) {
      expect(parseExcelDateCell(`15/06/${year}`), `พ.ศ. ${year} ต้องผ่าน`).toBe(`${year - 543}-06-15`);
    }
  });

  it('คืนค่า null สำหรับค่าว่าง/ไม่ถูกต้อง', () => {
    expect(parseExcelDateCell('')).toBeNull();
    expect(parseExcelDateCell(null)).toBeNull();
    expect(parseExcelDateCell(undefined)).toBeNull();
    expect(parseExcelDateCell('ไม่ใช่วันที่')).toBeNull();
    expect(parseExcelDateCell('2026-13-99')).toBeNull();
    expect(parseExcelDateCell('35/13/2026')).toBeNull();
    expect(parseExcelDateCell('30/2/2026')).toBeNull(); // กุมภาพันธ์ไม่มีวันที่ 30
  });
});

/* ---- คอลัมน์รับใบกำกับภาษีในเทมเพลต (เพิ่ม 2026-09-21) ----
 * ผู้ใช้ระบุว่า "บางทีฉันจ่ายเงินออกไปก็ได้รับใบกำกับภาษีเลย ฉันจะได้ไม่ต้องไปนั่งกรอกรับใบกำกับภาษีทีละใบ"
 * ชุดเทสต์นี้ยึดกติกา 4 ข้อที่ตกลงกันไว้ (ดู resolveTaxInvoiceReceipt ใน lib/excelImport.ts) */
describe('การรับใบกำกับภาษีจากไฟล์ Excel', () => {
  /** แถวดิบที่ผ่านตรวจสอบพื้นฐานแน่นอน (มี VAT) — ทับค่าเฉพาะคอลัมน์ที่เทสต์แต่ละเคสสนใจ */
  function rawRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      [EXCEL_HEADERS.vendor_name]: 'บริษัท ทดสอบ จำกัด',
      [EXCEL_HEADERS.transaction_date]: '21/09/2569',
      [EXCEL_HEADERS.amount_excl_vat]: 1000,
      [EXCEL_HEADERS.vat_amount]: 70,
      ...overrides,
    };
  }

  it('เว้น 4 ช่องท้ายว่าง = พฤติกรรมเดิมทุกประการ (รอรับใบกำกับภาษี)', () => {
    const row = parseExcelRow(rawRow(), 2)!;
    expect(row.errors).toEqual([]);
    expect(row.tax_invoice_number).toBe('');
    expect(row.received_date).toBe('');
    expect(row.vat_claim_month).toBe('');
    expect(excelRowToWriteInput(row).status).toBe('pending');
  });

  it('กรอกเลขที่ + วันที่ใบกำกับภาษี → บันทึกเป็น "ได้รับแล้ว" ทันที', () => {
    const row = parseExcelRow(
      rawRow({
        [EXCEL_HEADERS.tax_invoice_number]: 'INV-0001',
        [EXCEL_HEADERS.tax_invoice_date]: '21/09/2569',
      }),
      2
    )!;
    expect(row.errors).toEqual([]);
    const input = excelRowToWriteInput(row);
    expect(input.status).toBe('received');
    expect(input.tax_invoice_number).toBe('INV-0001');
    expect(input.tax_invoice_date).toBe('2026-09-21');
  });

  it('เว้นวันที่ได้รับว่างไว้ → ใช้วันที่ใบกำกับภาษีแทน', () => {
    const row = parseExcelRow(
      rawRow({
        [EXCEL_HEADERS.tax_invoice_number]: 'INV-0001',
        [EXCEL_HEADERS.tax_invoice_date]: '21/09/2569',
      }),
      2
    )!;
    expect(row.received_date).toBe('2026-09-21');
  });

  it('เว้นเดือน/ปีที่ใช้เครดิต VAT ว่างไว้ → เดาจากวันที่ได้รับ และต้องเป็นปี พ.ศ.', () => {
    const row = parseExcelRow(
      rawRow({
        [EXCEL_HEADERS.tax_invoice_number]: 'INV-0001',
        [EXCEL_HEADERS.tax_invoice_date]: '21/09/2569',
        [EXCEL_HEADERS.received_date]: '05/10/2569',
      }),
      2
    )!;
    expect(row.received_date).toBe('2026-10-05');
    expect(row.vat_claim_month).toBe(10);
    // ต้องเป็น 2569 (พ.ศ.) ไม่ใช่ 2026 — vat_claim_year เก็บเป็น พ.ศ. ตาม migration_002
    expect(row.vat_claim_year).toBe(2569);
  });

  it('กรอกเดือน/ปีที่ใช้เครดิตเองได้ (กรณีเลื่อนไปใช้เดือนถัดไป)', () => {
    const row = parseExcelRow(
      rawRow({
        [EXCEL_HEADERS.tax_invoice_number]: 'INV-0001',
        [EXCEL_HEADERS.tax_invoice_date]: '21/09/2569',
        [EXCEL_HEADERS.vat_claim_period]: '10/2569',
      }),
      2
    )!;
    expect(row.vat_claim_month).toBe(10);
    expect(row.vat_claim_year).toBe(2569);
  });

  it('กรอกเลขที่แต่ไม่กรอกวันที่ใบกำกับภาษี → error (รายงานภาษีซื้อใช้วันที่นี้)', () => {
    const row = parseExcelRow(rawRow({ [EXCEL_HEADERS.tax_invoice_number]: 'INV-0001' }), 2)!;
    expect(row.errors.join(' ')).toContain('วันที่ใบกำกับภาษี');
  });

  it('กรอกวันที่ใบกำกับภาษีมาแต่ลืมเลขที่ → error บอกให้เว้นว่างทั้ง 4 ช่องถ้ายังไม่ได้รับ', () => {
    const row = parseExcelRow(rawRow({ [EXCEL_HEADERS.tax_invoice_date]: '21/09/2569' }), 2)!;
    expect(row.errors.join(' ')).toContain('เลขที่ใบกำกับภาษี');
    expect(row.tax_invoice_date).toBe('');
  });

  // ผู้ใช้แจ้ง 2026-09-22: พิมพ์ 09/2569 แล้วกด Enter — Excel แปลงเป็นเซลล์วันที่ให้เอง แสดงเป็น "ก.ย.-69"
  // ทำให้นำเข้าไม่ผ่านทั้งที่กรอกถูก ตัวอ่านต้องรับเซลล์วันที่ได้ด้วย ไม่ใช่รับแค่ข้อความ ดด/ปปปป
  it('Excel แปลงช่องเดือน/ปีเป็นวันที่ให้เอง → ต้องอ่านเดือน/ปีออกได้ ไม่ขึ้น error', () => {
    const base = {
      [EXCEL_HEADERS.tax_invoice_number]: 'INV-0001',
      [EXCEL_HEADERS.tax_invoice_date]: '21/09/2569',
    };

    // กรณีที่ Excel เก็บเป็นวันที่ ค.ศ. (1 ก.ย. 2026) — เครื่องที่ใช้ปฏิทินสากล
    const gregorian = parseExcelRow(
      rawRow({ ...base, [EXCEL_HEADERS.vat_claim_period]: new Date(2026, 8, 1) }),
      2
    )!;
    expect(gregorian.errors).toEqual([]);
    expect(gregorian.vat_claim_month).toBe(9);
    expect(gregorian.vat_claim_year).toBe(2569);

    // กรณีที่ Excel เก็บปีเป็น 2569 ตรงๆ — เครื่องที่ตั้งปฏิทินพุทธ (ต้องไม่กลายเป็น 3112)
    const buddhist = parseExcelRow(
      rawRow({ ...base, [EXCEL_HEADERS.vat_claim_period]: new Date(2569, 8, 1) }),
      2
    )!;
    expect(buddhist.errors).toEqual([]);
    expect(buddhist.vat_claim_month).toBe(9);
    expect(buddhist.vat_claim_year).toBe(2569);
  });

  it('อ่านจากไฟล์ .xlsx จริงที่เซลล์เป็นวันที่ (เลข serial) ต้องได้เดือนตรง ไม่เลื่อนไปเดือนก่อนหน้า', () => {
    // จำลองไฟล์ที่ Excel บันทึกจริง: เซลล์วันที่เก็บเป็น "เลข serial" ไม่ใช่ข้อความ
    // 46266 = 1 ก.ย. 2026 (ตรงกับที่ผู้ใช้พิมพ์ 09/2569 แล้ว Excel แปลงเป็น "ก.ย.-69")
    const sheet = XLSX.utils.aoa_to_sheet([
      [...EXCEL_HEADER_ORDER],
      ['21/09/2569', 'บริษัท ทดสอบ จำกัด', '', '', '', 1000, 70, '', '', '', '', 'INV-0001', 46266, '', 46266],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'รายการ');
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;

    const rows = parseExcelRows(readWorkbookRows(buffer));
    expect(rows).toHaveLength(1);
    expect(rows[0].errors).toEqual([]);
    expect(rows[0].tax_invoice_date).toBe('2026-09-01');
    expect(rows[0].vat_claim_month).toBe(9); // ต้องเป็นกันยายน ไม่ใช่สิงหาคม
    expect(rows[0].vat_claim_year).toBe(2569);
  });

  it('พิมพ์เป็นข้อความ ดด/ปปปป ตามปกติก็ยังต้องได้ผลเหมือนกันเป๊ะ', () => {
    const row = parseExcelRow(
      rawRow({
        [EXCEL_HEADERS.tax_invoice_number]: 'INV-0001',
        [EXCEL_HEADERS.tax_invoice_date]: '21/09/2569',
        [EXCEL_HEADERS.vat_claim_period]: '09/2569',
      }),
      2
    )!;
    expect(row.errors).toEqual([]);
    expect(row.vat_claim_month).toBe(9);
    expect(row.vat_claim_year).toBe(2569);
  });

  it('พิมพ์เลขลอยๆ ลงช่องเดือน/ปี (เช่น 9 หรือ 2569) ต้องขึ้น error ไม่ใช่รับไปเงียบๆ', () => {
    // Excel มองตัวเลขทุกตัวเป็น serial date ได้หมด ถ้าไม่คุมช่วงปี "9" จะกลายเป็นปี 2443 แล้วผ่านฉลุย
    // ทำให้รายการหายจากรายงาน ภ.พ.30 โดยไม่มีอะไรเตือน
    for (const bad of [9, 2569, 42, 0, 99999]) {
      const row = parseExcelRow(
        rawRow({
          [EXCEL_HEADERS.tax_invoice_number]: 'INV-0001',
          [EXCEL_HEADERS.tax_invoice_date]: '21/09/2569',
          [EXCEL_HEADERS.vat_claim_period]: bad,
        }),
        2
      )!;
      expect(row.errors.join(' '), `ค่า ${bad} ควรถูกปฏิเสธ`).toContain('เดือน/ปีที่ใช้เครดิต VAT');
    }
  });

  it('เดือนที่ใช้เครดิตนอกช่วง 1-12 หรือรูปแบบผิด → error', () => {
    const bad = parseExcelRow(
      rawRow({
        [EXCEL_HEADERS.tax_invoice_number]: 'INV-0001',
        [EXCEL_HEADERS.tax_invoice_date]: '21/09/2569',
        [EXCEL_HEADERS.vat_claim_period]: '13/2569',
      }),
      2
    )!;
    expect(bad.errors.join(' ')).toContain('เดือน/ปีที่ใช้เครดิต VAT');
  });

  it('รายการไม่มี VAT ที่เผลอกรอกข้อมูลใบกำกับภาษีมา → เตือนแล้วมองข้าม ไม่บล็อกการนำเข้า', () => {
    const row = parseExcelRow(
      rawRow({
        [EXCEL_HEADERS.vat_amount]: '',
        [EXCEL_HEADERS.tax_invoice_number]: 'INV-0001',
        [EXCEL_HEADERS.tax_invoice_date]: '21/09/2569',
      }),
      2
    )!;
    expect(row.tax_type).toBe('no_vat');
    expect(row.errors).toEqual([]);
    expect(row.warnings.join(' ')).toContain('ไม่มี VAT');
    expect(row.tax_invoice_number).toBe('');
  });

  it('ได้รับใบกำกับภาษีแล้ว จะไม่เก็บ "วันที่คาดว่าจะได้รับ" ไว้อีก (ไม่เหลืออะไรให้รอ)', () => {
    const row = parseExcelRow(
      rawRow({
        [EXCEL_HEADERS.expected_date]: '30/09/2569',
        [EXCEL_HEADERS.tax_invoice_number]: 'INV-0001',
        [EXCEL_HEADERS.tax_invoice_date]: '21/09/2569',
      }),
      2
    )!;
    expect(row.expected_date).toBe('');
    expect(excelRowToWriteInput(row).expected_date).toBeNull();
  });

  it('ไฟล์เทมเพลตเก่าที่ไม่มี 4 คอลัมน์นี้เลย ต้องยังนำเข้าได้ปกติ', () => {
    // จำลองไฟล์เก่า: ไม่มี key ของคอลัมน์ใหม่อยู่ใน object เลย (ไม่ใช่แค่ค่าว่าง)
    const row = parseExcelRow(rawRow(), 2)!;
    expect(row.errors).toEqual([]);
    expect(excelRowToWriteInput(row).status).toBe('pending');
  });
});

describe('parseVatCell', () => {
  it('ตัวเลขปกติ เช่น 7 → ok amount 7', () => {
    expect(parseVatCell(7)).toEqual({ kind: 'ok', amount: 7 });
    expect(parseVatCell(70)).toEqual({ kind: 'ok', amount: 70 });
    expect(parseVatCell(140)).toEqual({ kind: 'ok', amount: 140 });
  });

  it('0 หรือ "0.00" → ok amount 0', () => {
    expect(parseVatCell(0)).toEqual({ kind: 'ok', amount: 0 });
    expect(parseVatCell('0.00')).toEqual({ kind: 'ok', amount: 0 });
  });

  it('ค่าว่าง/ไม่มีค่า/ข้อความมีแต่ช่องว่าง → ok amount 0 (ไม่ error)', () => {
    expect(parseVatCell('')).toEqual({ kind: 'ok', amount: 0 });
    expect(parseVatCell(undefined)).toEqual({ kind: 'ok', amount: 0 });
    expect(parseVatCell(null)).toEqual({ kind: 'ok', amount: 0 });
    expect(parseVatCell('   ')).toEqual({ kind: 'ok', amount: 0 });
  });

  it('เครื่องหมาย "-" → ok amount 0', () => {
    expect(parseVatCell('-')).toEqual({ kind: 'ok', amount: 0 });
  });

  it('ตัวเลขที่มี comma คั่นหลักพัน เช่น "1,400.00" → อ่านเป็น 1400', () => {
    expect(parseVatCell('1,400.00')).toEqual({ kind: 'ok', amount: 1400 });
    expect(parseVatCell('1,400')).toEqual({ kind: 'ok', amount: 1400 });
  });

  it('ข้อความที่ไม่ใช่ตัวเลขเลย เช่น "abc" → invalid', () => {
    expect(parseVatCell('abc')).toEqual({ kind: 'invalid', raw: 'abc' });
  });

  it('ตัวเลขปนตัวอักษร เช่น "12abc" → invalid (ไม่ปัดเป็น 12 เงียบๆ)', () => {
    expect(parseVatCell('12abc')).toEqual({ kind: 'invalid', raw: '12abc' });
  });

  it('ตัวเลขติดลบ → invalid (VAT ติดลบไม่สมเหตุสมผล)', () => {
    expect(parseVatCell(-5)).toEqual({ kind: 'invalid', raw: '-5' });
    expect(parseVatCell('-5')).toEqual({ kind: 'invalid', raw: '-5' });
  });

  it('ไม่มีทางคืนค่า NaN ไม่ว่าอินพุตจะเป็นอะไร', () => {
    const values: unknown[] = [7, 0, '', '-', '1,400.00', 'abc', null, undefined, -5, '   ', 'NaN'];
    for (const v of values) {
      const result = parseVatCell(v);
      if (result.kind === 'ok') expect(Number.isNaN(result.amount)).toBe(false);
    }
  });
});

describe('parseExcelRow', () => {
  it('แถวข้อมูลถูกต้องครบ ไม่มี error', () => {
    const result = parseExcelRow(row(), 2);
    expect(result).not.toBeNull();
    expect(result!.errors).toEqual([]);
    expect(result!.vendor_name).toBe('บริษัท ทดสอบ จำกัด');
    expect(result!.transaction_date).toBe('2026-07-01');
    expect(result!.amount_excl_vat).toBe('1000');
    expect(result!.rowNumber).toBe(2);
  });

  it('อ่านค่า VAT ที่กรอกมาตรงๆ ได้ถูกต้อง', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.vat_amount]: 50 }), 2);
    expect(result!.vat_amount).toBe('50');
    expect(result!.errors).toEqual([]);
  });

  it('ไม่กรอกผู้ขาย — error', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.vendor_name]: '' }), 2);
    expect(result!.errors).toContain('ไม่ได้กรอกผู้ขาย');
  });

  it('วันที่ทำรายการว่าง — error', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.transaction_date]: '' }), 2);
    expect(result!.errors).toContain('วันที่ทำรายการไม่ถูกต้องหรือไม่ได้กรอก');
  });

  it('วันที่ทำรายการรูปแบบผิด — error', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.transaction_date]: 'สิบสามกรกฎา' }), 2);
    expect(result!.errors).toContain('วันที่ทำรายการไม่ถูกต้องหรือไม่ได้กรอก');
  });

  it('ยอดก่อน VAT ว่าง — error', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.amount_excl_vat]: '' }), 2);
    expect(result!.errors).toContain('ยอดก่อน VAT ต้องเป็นตัวเลขมากกว่า 0');
  });

  it('ยอดก่อน VAT เป็น 0 หรือติดลบ — error', () => {
    expect(parseExcelRow(row({ [EXCEL_HEADERS.amount_excl_vat]: 0 }), 2)!.errors).toContain(
      'ยอดก่อน VAT ต้องเป็นตัวเลขมากกว่า 0'
    );
    expect(parseExcelRow(row({ [EXCEL_HEADERS.amount_excl_vat]: -5 }), 2)!.errors).toContain(
      'ยอดก่อน VAT ต้องเป็นตัวเลขมากกว่า 0'
    );
  });

  it('ยอดก่อน VAT เป็นตัวหนังสือ — error', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.amount_excl_vat]: 'พันบาท' }), 2);
    expect(result!.errors).toContain('ยอดก่อน VAT ต้องเป็นตัวเลขมากกว่า 0');
  });

  it('ยอดก่อน VAT มี comma คั่นหลักพันก็อ่านได้ (เช่น "1,000")', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.amount_excl_vat]: '1,000' }), 2);
    expect(result!.amount_excl_vat).toBe('1000');
    expect(result!.errors).toEqual([]);
  });

  it('VAT ติดลบ — error', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.vat_amount]: -1 }), 2);
    expect(result!.errors.some((e) => e.includes('VAT ไม่ถูกต้อง'))).toBe(true);
  });

  it('วันที่คาดว่าจะได้รับก่อนวันที่ทำรายการ — error (แถวนี้มี VAT จึงมีขั้นตอนรอ/มีความหมายของวันที่นี้)', () => {
    const result = parseExcelRow(
      row({
        [EXCEL_HEADERS.transaction_date]: '2026-07-10',
        [EXCEL_HEADERS.expected_date]: '2026-07-01',
      }),
      2
    );
    expect(result!.errors).toContain('วันที่คาดว่าจะได้รับต้องไม่ก่อนวันที่ทำรายการ');
  });

  it('วันที่คาดว่าจะได้รับไม่ได้กรอก — ไม่ error (เป็น optional)', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.expected_date]: '' }), 2);
    expect(result!.errors).toEqual([]);
    expect(result!.expected_date).toBe('');
  });

  it('แถวว่างทั้งแถวคืนค่า null (ข้ามได้)', () => {
    const result = parseExcelRow(
      row({
        [EXCEL_HEADERS.vendor_name]: '',
        [EXCEL_HEADERS.transaction_date]: '',
        [EXCEL_HEADERS.description]: '',
        [EXCEL_HEADERS.amount_excl_vat]: '',
        [EXCEL_HEADERS.vat_amount]: '',
        [EXCEL_HEADERS.reference_no]: '',
        [EXCEL_HEADERS.expected_date]: '',
        [EXCEL_HEADERS.notes]: '',
      }),
      5
    );
    expect(result).toBeNull();
  });

  it('มีหลาย error พร้อมกันได้ในแถวเดียว', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.vendor_name]: '', [EXCEL_HEADERS.amount_excl_vat]: '' }), 2);
    expect(result!.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('เลขประจำตัวผู้เสียภาษีไม่ครบ 13 หลัก — error', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.vendor_tax_id]: '123' }), 2)!;
    expect(result.errors).toContain('เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก');
  });
});

// เทสต์ตาม checklist 10 ข้อที่ผู้ใช้ระบุไว้ (ครอบคลุมข้อ 1-4, 6-8 โดยตรง — ข้อ 5 อยู่ใน describe
// parseVatCell ด้านบน ข้อ 9 อยู่ใน lib/vatReportLogic.test.ts ข้อ 10 ตรวจใน e2e)
describe('parseExcelRow — จำแนกประเภทภาษีจากยอด VAT อัตโนมัติ (ไม่มีคอลัมน์ "ประเภทภาษี" ให้กรอก/เลือกเองอีกต่อไป)', () => {
  it('1. VAT = 7 (มากกว่า 0) → ตรวจพบเป็น "มี VAT" (claimable_vat)', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.vat_amount]: 7 }), 2)!;
    expect(result.tax_type).toBe('claimable_vat');
    expect(result.vat_amount).toBe('7');
    expect(result.errors).toEqual([]);
  });

  it('2. VAT = 0 → ตรวจพบเป็น "ไม่มี VAT" (no_vat)', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.vat_amount]: 0 }), 2)!;
    expect(result.tax_type).toBe('no_vat');
    expect(result.vat_amount).toBe('0');
    expect(result.errors).toEqual([]);
  });

  it('3. VAT ว่าง → ตรวจพบเป็น "ไม่มี VAT" (ก่อนหน้านี้จะเสนอ 7% อัตโนมัติให้ — เปลี่ยนพฤติกรรมตามที่ระบุ)', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.vat_amount]: '' }), 2)!;
    expect(result.tax_type).toBe('no_vat');
    expect(result.vat_amount).toBe('0');
    expect(result.errors).toEqual([]);
  });

  it('4. VAT = "-" → ตรวจพบเป็น "ไม่มี VAT"', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.vat_amount]: '-' }), 2)!;
    expect(result.tax_type).toBe('no_vat');
    expect(result.vat_amount).toBe('0');
    expect(result.errors).toEqual([]);
  });

  it('6. VAT เป็นข้อความผิด เช่น "abc" → error ห้าม import แถวนั้นจนกว่าจะแก้ไข', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.vat_amount]: 'abc' }), 2)!;
    expect(result.errors.some((e) => e.includes('VAT ไม่ถูกต้อง'))).toBe(true);
    expect(result.tax_type).toBe(''); // ยังจำแนกไม่ได้ — สอดคล้องกับ error ที่ยังค้างอยู่
  });

  it('7. รายการไม่มี VAT ต้องไม่มีขั้นตอนรอใบกำกับภาษี — ล้างวันที่คาดว่าจะได้รับแม้จะกรอกมาในไฟล์', () => {
    const result = parseExcelRow(
      row({ [EXCEL_HEADERS.vat_amount]: '', [EXCEL_HEADERS.expected_date]: '2026-08-01' }),
      2
    )!;
    expect(result.tax_type).toBe('no_vat');
    expect(result.expected_date).toBe('');
  });

  it('8. รายการมี VAT ต้องเข้าขั้นตอนรอใบกำกับภาษีได้ตามปกติ (ไม่ล้างวันที่คาดว่าจะได้รับ)', () => {
    const result = parseExcelRow(
      row({ [EXCEL_HEADERS.vat_amount]: 70, [EXCEL_HEADERS.expected_date]: '2026-08-01' }),
      2
    )!;
    expect(result.tax_type).toBe('claimable_vat');
    expect(result.expected_date).toBe('2026-08-01');
  });

  it('เศษสตางค์ก็จำแนกเป็น "มี VAT" ได้ถูกต้อง (VAT น้อยแค่ไหนก็ยังถือว่า > 0)', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.vat_amount]: 0.01 }), 2)!;
    expect(result.tax_type).toBe('claimable_vat');
  });
});

describe('parseExcelRow — หัก ณ ที่จ่าย (ไม่บังคับกรอก, ใช้ตรรกะแปลงค่าเดียวกับ VAT)', () => {
  it('ไม่กรอกคอลัมน์หัก ณ ที่จ่าย → ถือเป็น 0 ไม่มี error', () => {
    const result = parseExcelRow(row(), 2)!;
    expect(result.wht_amount).toBe('0');
    expect(result.errors).toEqual([]);
  });

  it('กรอกยอดหัก ณ ที่จ่ายมาปกติ → อ่านค่าได้ถูกต้อง', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.wht_amount]: 30 }), 2)!;
    expect(result.wht_amount).toBe('30');
    expect(result.errors).toEqual([]);
  });

  it('"-" หรือค่าว่าง → ถือเป็น 0 เหมือนคอลัมน์ VAT', () => {
    expect(parseExcelRow(row({ [EXCEL_HEADERS.wht_amount]: '-' }), 2)!.wht_amount).toBe('0');
    expect(parseExcelRow(row({ [EXCEL_HEADERS.wht_amount]: '' }), 2)!.wht_amount).toBe('0');
  });

  it('ข้อความที่ไม่ใช่ตัวเลข → error', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.wht_amount]: 'abc' }), 2)!;
    expect(result.errors.some((e) => e.includes('หัก ณ ที่จ่ายไม่ถูกต้อง'))).toBe(true);
  });

  it('ยอดหัก ณ ที่จ่ายเกินยอดรวม (ยอดก่อน VAT + VAT) → error', () => {
    const result = parseExcelRow(
      row({ [EXCEL_HEADERS.amount_excl_vat]: 1000, [EXCEL_HEADERS.vat_amount]: 70, [EXCEL_HEADERS.wht_amount]: 2000 }),
      2
    )!;
    expect(result.errors.some((e) => e.includes('หัก ณ ที่จ่ายต้องไม่เกินยอดรวม'))).toBe(true);
  });
});

describe('parseExcelRow — ตรวจสอบยอดรวมเทียบกับที่คำนวณได้ (เตือนเท่านั้น ไม่เขียนทับ/ไม่ error)', () => {
  it('ยอดรวมในไฟล์ตรงกับที่คำนวณได้ (ยอดก่อน VAT + VAT) — ไม่มีคำเตือน', () => {
    const result = parseExcelRow(
      row({ [EXCEL_HEADERS.amount_excl_vat]: 1000, [EXCEL_HEADERS.vat_amount]: 70, [EXCEL_HEADERS.total_amount]: 1070 }),
      2
    )!;
    expect(result.warnings).toEqual([]);
  });

  it('ยอดรวมในไฟล์ไม่ตรงกับที่คำนวณได้ — เตือน แต่ไม่ error และไม่บล็อกการนำเข้า', () => {
    const result = parseExcelRow(
      row({ [EXCEL_HEADERS.amount_excl_vat]: 1000, [EXCEL_HEADERS.vat_amount]: 70, [EXCEL_HEADERS.total_amount]: 9999 }),
      2
    )!;
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.includes('ยอดรวม'))).toBe(true);
  });

  it('ไม่กรอกยอดรวมมาเลย — ไม่มีคำเตือน (ไม่บังคับกรอก เพราะเป็นคอลัมน์คำนวณอัตโนมัติอยู่แล้ว)', () => {
    const result = parseExcelRow(
      row({ [EXCEL_HEADERS.amount_excl_vat]: 1000, [EXCEL_HEADERS.vat_amount]: 70, [EXCEL_HEADERS.total_amount]: '' }),
      2
    )!;
    expect(result.warnings).toEqual([]);
  });

  it('ไม่เตือนถ้ายอดก่อน VAT หรือ VAT เองมี error อยู่แล้ว (ผลรวมที่จะเทียบไม่น่าเชื่อถืออยู่ดี)', () => {
    const result = parseExcelRow(
      row({ [EXCEL_HEADERS.amount_excl_vat]: '', [EXCEL_HEADERS.vat_amount]: 70, [EXCEL_HEADERS.total_amount]: 9999 }),
      2
    )!;
    expect(result.warnings).toEqual([]);
  });
});

describe('parseExcelRow — เตือนถ้าปีที่พิมพ์ในเซลล์วันที่ (วว/ดด/ปปปป) ดูเหมือนเป็น ค.ศ.', () => {
  it('วันที่ทำรายการพิมพ์เป็นข้อความ วว/ดด/ปปปป ปี ค.ศ. (ต่ำกว่า 2200) → เตือน', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.transaction_date]: '17/08/2026' }), 2)!;
    expect(result.warnings.some((w) => w.includes('วันที่ทำรายการ') && w.includes('ค.ศ.'))).toBe(true);
    // ยังคง parse เป็น ISO ตามที่พิมพ์ตรงๆ (แค่เตือน ไม่บล็อก/ไม่แปลงให้เอง)
    expect(result.transaction_date).toBe('2026-08-17');
  });

  it('วันที่คาดว่าจะได้รับพิมพ์เป็นข้อความ วว/ดด/ปปปป ปี ค.ศ. → เตือน', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.expected_date]: '20/08/2026' }), 2)!;
    expect(result.warnings.some((w) => w.includes('วันที่คาดว่าจะได้รับ') && w.includes('ค.ศ.'))).toBe(true);
  });

  it('วันที่ทำรายการพิมพ์เป็นข้อความ วว/ดด/ปปปป ปี พ.ศ. จริง (>= 2200) → ไม่เตือน', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.transaction_date]: '17/08/2569' }), 2)!;
    expect(result.warnings.some((w) => w.includes('ค.ศ.'))).toBe(false);
  });

  it('วันที่ทำรายการรูปแบบ YYYY-MM-DD (ISO) → ไม่เตือน แม้ปีจะเป็น ค.ศ. (รูปแบบนี้เป็น ค.ศ. โดยสากลอยู่แล้ว)', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.transaction_date]: '2026-08-17' }), 2)!;
    expect(result.warnings.some((w) => w.includes('ค.ศ.'))).toBe(false);
  });

  it('วันที่ทำรายการเป็น Date object (จากเซลล์รูปแบบวันที่จริงของ Excel) → ไม่เตือน', () => {
    const result = parseExcelRow(row({ [EXCEL_HEADERS.transaction_date]: new Date(2026, 7, 17) }), 2)!;
    expect(result.warnings.some((w) => w.includes('ค.ศ.'))).toBe(false);
  });
});

describe('parseExcelRows', () => {
  it('ข้ามแถวว่างไปอัตโนมัติ และเลขแถวตรงกับตำแหน่งจริงในไฟล์ (แถว 1 = header)', () => {
    const emptyRow = Object.fromEntries(Object.values(EXCEL_HEADERS).map((h) => [h, '']));
    const rows = parseExcelRows([row(), emptyRow, row({ [EXCEL_HEADERS.vendor_name]: 'ผู้ขาย 2' })]);
    expect(rows).toHaveLength(2);
    expect(rows[0].rowNumber).toBe(2);
    expect(rows[1].rowNumber).toBe(4); // แถวที่ 3 (idx 1) เป็นแถวว่างถูกข้าม แถวถัดไปคือแถวที่ 4
    expect(rows[1].vendor_name).toBe('ผู้ขาย 2');
  });

  it('ไฟล์ไม่มีแถวข้อมูลเลย คืน array ว่าง', () => {
    expect(parseExcelRows([])).toEqual([]);
  });
});

describe('readSheetRows (หาแถวหัวคอลัมน์จริงให้เอง)', () => {
  // เรียงตาม EXCEL_HEADER_ORDER: วันที่ทำรายการ, ผู้ขาย, เลขผู้เสียภาษี, เลขที่อ้างอิง, รายละเอียด,
  // ยอดก่อน VAT, VAT
  const dataRow = ['21/09/2569', 'บริษัท ก จำกัด', '', '', '', 1000, 70];

  it('ไฟล์แบบเดิมที่หัวคอลัมน์อยู่แถวแรก ยังอ่านได้เหมือนเดิม', () => {
    const sheet = XLSX.utils.aoa_to_sheet([[...EXCEL_HEADER_ORDER], dataRow]);
    const rows = readSheetRows(sheet);
    expect(rows).toHaveLength(1);
    expect(rows[0][EXCEL_HEADERS.vendor_name]).toBe('บริษัท ก จำกัด');
  });

  it('เทมเพลตใหม่ที่มีแถวหัวข้อกลุ่มคร่อมอยู่ ต้องข้ามแถวนั้นไปหาหัวคอลัมน์จริง', () => {
    const groupRow = ['① ฝั่งบันทึกการจ่ายเงิน', '', '', '', '', '', '', '', '', '', '', '② ฝั่งบันทึกใบกำกับภาษี'];
    const sheet = XLSX.utils.aoa_to_sheet([groupRow, [...EXCEL_HEADER_ORDER], dataRow]);
    const rows = readSheetRows(sheet);
    expect(rows).toHaveLength(1);
    expect(rows[0][EXCEL_HEADERS.vendor_name]).toBe('บริษัท ก จำกัด');
  });

  it('ไฟล์ที่ผู้ใช้แทรกแถวชื่อรายงานของตัวเองไว้ด้านบน ก็นำเข้าได้ (เดิมทำไม่ได้เลย)', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['รายงานค่าใช้จ่ายประจำเดือน กันยายน 2569'],
      ['บริษัท แอซ เท็ก จำกัด'],
      [],
      [...EXCEL_HEADER_ORDER],
      dataRow,
    ]);
    expect(readSheetRows(sheet)).toHaveLength(1);
  });

  it('ชีทที่ !ref ไม่ได้เริ่มที่ A1 (Excel บันทึกแถวว่างนำหน้าไว้จริง) ต้องยังอ่านถูกแถว', () => {
    // จำลองไฟล์ที่ Excel เขียน dimension ref="A3:P4" — แถวจริงของหัวคอลัมน์คือแถวที่ 3 ของชีท แต่เป็น
    // aoa[0] เมื่ออ่านแบบ header:1 ถ้าไม่แปลงระบบนับแถวให้ตรงกันก่อน จะอ่านหัวคอลัมน์ผิดแถวจนได้ 0 รายการ
    //
    // ต้องทำสองอย่างคู่กันถึงจะจำลองได้จริง:
    //   1. วางเซลล์ไว้ที่ A3 จริงๆ ด้วย sheet_add_aoa({origin:'A3'})
    //   2. เขียนทับ !ref เอง เพราะตัวช่วยของไลบรารีปรับ !ref กลับมาเริ่มที่ A1 เสมอ
    // ขาดข้อใดข้อหนึ่งเทสต์จะไม่มีความหมาย — ถ้าตั้งแต่ !ref อย่างเดียวโดยเซลล์ยังอยู่ A1 จะได้ชีทที่
    // ขัดแย้งในตัวเอง (dimension ชี้ไปยังแถวที่ไม่มีเซลล์) ซึ่งไม่มีทางเกิดจากไฟล์ Excel จริง แล้วผลลัพธ์
    // จะกลับข้างจนเทสต์ "ผ่านเมื่อโค้ดผิด" แทน
    const sheet = XLSX.utils.sheet_add_aoa({}, [[...EXCEL_HEADER_ORDER], dataRow], { origin: 'A3' });
    sheet['!ref'] = 'A3:O4'; // 15 คอลัมน์ = A..O
    // ยืนยันว่าจำลองสถานการณ์ได้จริงก่อน ทั้งตำแหน่งเซลล์และ dimension
    expect(XLSX.utils.decode_range(sheet['!ref']!).s.r).toBe(2);
    expect(sheet['A3']?.v).toBe(EXCEL_HEADERS.transaction_date);

    const rows = readSheetRows(sheet);
    expect(rows).toHaveLength(1);
    expect(rows[0][EXCEL_HEADERS.vendor_name]).toBe('บริษัท ก จำกัด');
  });

  it('หาหัวคอลัมน์ไม่เจอเลย คืนพฤติกรรมเดิม (ใช้แถวแรกเป็นหัว) ไม่ throw', () => {
    const sheet = XLSX.utils.aoa_to_sheet([['ก', 'ข'], [1, 2]]);
    expect(() => readSheetRows(sheet)).not.toThrow();
  });
});

describe('excelRowToWriteInput', () => {
  it('แถวมี VAT แปลงเป็น payload พร้อมบันทึก — สถานะ pending (รอรับใบกำกับภาษี) ตามขั้นตอนเดิม', () => {
    const parsed = parseExcelRow(row(), 2)!; // row() default VAT=70 > 0 → มี VAT
    const input = excelRowToWriteInput(parsed);
    expect(input).toEqual({
      vendor_name: 'บริษัท ทดสอบ จำกัด',
      transaction_date: '2026-07-01',
      description: 'ค่าสินค้า',
      amount_excl_vat: 1000,
      vat_amount: 70,
      wht_amount: 0,
      reference_no: 'PO-001',
      contact_person: null,
      expected_date: null,
      notes: null,
      vendor_tax_id: null,
      tax_type: 'claimable_vat',
      status: 'pending',
      // 5 ฟิลด์ที่เพิ่มมาพร้อมคอลัมน์รับใบกำกับภาษีในเทมเพลต (2026-09-21) — แถวนี้ไม่ได้กรอกมา จึงเป็น
      // null ทั้งหมด ต้องระบุใน toEqual ด้วยเพราะ toEqual ไม่มองข้าม null (ต่างจาก undefined)
      tax_invoice_number: null,
      tax_invoice_date: null,
      received_date: null,
      vat_claim_month: null,
      vat_claim_year: null,
    });
  });

  it('แถวไม่มี VAT (VAT ว่าง) แปลงเป็น payload สถานะ received ทันที ไม่มีขั้นตอนรอ', () => {
    const parsed = parseExcelRow(row({ [EXCEL_HEADERS.vat_amount]: '' }), 2)!;
    const input = excelRowToWriteInput(parsed);
    expect(input.tax_type).toBe('no_vat');
    expect(input.vat_amount).toBe(0);
    expect(input.expected_date).toBeNull();
    expect(input.status).toBe('received');
  });

  it('ฟิลด์ optional ที่เป็นค่าว่างแปลงเป็น null', () => {
    const parsed = parseExcelRow(
      row({ [EXCEL_HEADERS.description]: '', [EXCEL_HEADERS.reference_no]: '', [EXCEL_HEADERS.notes]: '' }),
      2
    )!;
    const input = excelRowToWriteInput(parsed);
    expect(input.description).toBeNull();
    expect(input.reference_no).toBeNull();
    expect(input.notes).toBeNull();
    expect(input.contact_person).toBeNull();
  });
});

describe('buildTemplateBlob + readWorkbookRows (round-trip)', () => {
  // ปรับใหม่ 2026-09-21: เทมเพลตแยกเป็น 3 ชีทแล้ว (รายการ = ว่างเปล่ามีแต่หัวคอลัมน์ / ตัวอย่าง / วิธีใช้)
  // เดิมตัวอย่างอยู่ปนในชีทเดียวกับข้อมูลจริง ซึ่งผู้ใช้ลืมลบแล้วหลุดเข้าระบบเป็นประจำ
  it('ชีทแรก (รายการ) ต้องว่างเปล่า — ป้องกันตัวอย่างหลุดเข้าระบบโดยไม่ตั้งใจ', async () => {
    const blob = buildTemplateBlob();
    expect(blob.size).toBeGreaterThan(0);
    const arrayBuffer = await blob.arrayBuffer();
    // readWorkbookRows อ่านชีทแรกเสมอ ซึ่งตอนนี้คือชีท "รายการ" ที่ไม่มีแถวข้อมูลเลย
    expect(readWorkbookRows(arrayBuffer)).toHaveLength(0);
  });

  it('แถวแรกเป็นหัวข้อกลุ่ม 2 ฝั่ง และรวมเซลล์คลุมช่วงคอลัมน์ถูกต้อง', async () => {
    const blob = buildTemplateBlob();
    const arrayBuffer = await blob.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
    const sheet = workbook.Sheets['รายการ'];

    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: true });
    expect(String(aoa[0][0])).toContain('บันทึกการจ่ายเงิน');
    expect(String(aoa[0][11])).toContain('บันทึกใบกำกับภาษี');
    // แถวที่ 2 ต้องเป็นหัวคอลัมน์จริงครบทุกคอลัมน์
    expect(aoa[1]).toEqual(EXCEL_HEADER_ORDER);

    // หัวข้อกลุ่มต้องรวมเซลล์คลุม 11 คอลัมน์แรก (ฝั่งจ่ายเงิน) และ 4 คอลัมน์ที่เหลือ (ฝั่งใบกำกับภาษี)
    expect(sheet['!merges']).toEqual([
      { s: { r: 0, c: 0 }, e: { r: 0, c: 10 } },
      { s: { r: 0, c: 11 }, e: { r: 0, c: 14 } },
    ]);
  });

  it('ลำดับคอลัมน์ต้องตรงกับที่ผู้ใช้ระบุ และไม่มีช่อง "วันที่คาดว่าจะได้รับใบกำกับภาษี" แล้ว', () => {
    expect(EXCEL_HEADER_ORDER).toEqual([
      'วันที่ทำรายการ',
      'ผู้ขาย',
      'เลขประจำตัวผู้เสียภาษี',
      'เลขที่อ้างอิง',
      'รายละเอียด',
      'ยอดก่อน VAT',
      'VAT',
      'หัก ณ ที่จ่าย',
      'ยอดรวม',
      'ผู้ติดต่อ',
      'หมายเหตุ',
      'เลขที่ใบกำกับภาษี',
      'วันที่ใบกำกับภาษี',
      'วันที่ได้รับใบกำกับภาษี',
      'เดือน/ปีที่ใช้เครดิต VAT',
    ]);
    expect(EXCEL_HEADER_ORDER).not.toContain(EXCEL_HEADERS.expected_date);
  });

  it('ไฟล์เก่าที่ยังมีคอลัมน์ "วันที่คาดว่าจะได้รับใบกำกับภาษี" ต้องยังอ่านค่านั้นเข้ามาได้ ไม่ทิ้งเงียบๆ', () => {
    const row = parseExcelRow(
      {
        [EXCEL_HEADERS.vendor_name]: 'บริษัท ทดสอบ จำกัด',
        [EXCEL_HEADERS.transaction_date]: '21/09/2569',
        [EXCEL_HEADERS.amount_excl_vat]: 1000,
        [EXCEL_HEADERS.vat_amount]: 70,
        [EXCEL_HEADERS.expected_date]: '30/09/2569',
      },
      2
    )!;
    expect(row.errors).toEqual([]);
    expect(row.expected_date).toBe('2026-09-30');
  });

  it('ชีท "ตัวอย่าง" มี 3 แถวที่ผ่านการตรวจสอบครบ ครอบคลุมทั้ง 3 กรณีที่ผู้ใช้เจอจริง', async () => {
    const blob = buildTemplateBlob();
    const arrayBuffer = await blob.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
    expect(workbook.SheetNames).toEqual(['รายการ', 'ตัวอย่าง', 'วิธีใช้']);

    // ใช้ readSheetRows ไม่ใช่ sheet_to_json ตรงๆ เพราะทั้งสองชีทมีแถว "หัวข้อกลุ่ม" คร่อมอยู่เหนือ
    // แถวหัวคอลัมน์ (2026-09-21) — readSheetRows หาแถวหัวคอลัมน์จริงให้เอง
    const parsed = parseExcelRows(readSheetRows(workbook.Sheets['ตัวอย่าง']));
    expect(parsed).toHaveLength(3);
    expect(parsed.every((r) => r.errors.length === 0)).toBe(true);

    // แถว 1: มี VAT + ได้รับใบกำกับภาษีมาแล้ว (สาธิตคอลัมน์ใหม่)
    expect(parsed[0].tax_type).toBe('claimable_vat');
    expect(parsed[0].tax_invoice_number).toBe('INV-0001');
    expect(excelRowToWriteInput(parsed[0]).status).toBe('received');

    // แถว 2: มี VAT แต่ยังไม่ได้รับใบกำกับภาษี
    expect(parsed[1].tax_type).toBe('claimable_vat');
    expect(parsed[1].tax_invoice_number).toBe('');
    expect(excelRowToWriteInput(parsed[1]).status).toBe('pending');

    // แถว 3: ไม่มี VAT
    expect(parsed[2].tax_type).toBe('no_vat');
  });
});

describe('findDuplicateRowNumbers', () => {
  function makeExistingInvoice(overrides: Partial<PendingTaxInvoice> = {}): PendingTaxInvoice {
    return {
      id: overrides.id ?? Math.random().toString(36).slice(2),
      company_id: overrides.company_id ?? 'test-company-id',
      vendor_name: 'บริษัท ทดสอบ จำกัด',
      transaction_date: '2026-07-01',
      description: null,
      amount_excl_vat: 1000,
      vat_amount: 70,
      total_amount: 1070,
      wht_amount: 0,
      wht_certificate_id: null,
      reference_no: 'PO-001',
      contact_person: null,
      expected_date: null,
      status: 'pending',
      received_date: null,
      tax_invoice_number: null,
      notes: null,
      created_by: null,
      created_by_email: null,
      created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-07-01T00:00:00Z',
      vendor_tax_id: null,
      tax_invoice_date: null,
      vat_claim_month: null,
      vat_claim_year: null,
      tax_type: 'claimable_vat',
      ...overrides,
    };
  }

  it('ตรวจพบรายการซ้ำเมื่อผู้ขาย/วันที่/เลขที่อ้างอิง/ยอดรวมตรงกันทั้งหมด', () => {
    const existing = [makeExistingInvoice()];
    const parsedRow = parseExcelRow(row(), 2)!; // vendor_name/transaction_date/reference_no ตรงกับ existing, VAT=70 (row() default) → total 1070 ตรงกัน
    const duplicates = findDuplicateRowNumbers([parsedRow], existing);
    expect(duplicates.has(2)).toBe(true);
  });

  it('ไม่ตรวจพบซ้ำถ้ายอดรวมต่างกัน', () => {
    const existing = [makeExistingInvoice()];
    const parsedRow = parseExcelRow(row({ [EXCEL_HEADERS.amount_excl_vat]: 2000 }), 2)!;
    const duplicates = findDuplicateRowNumbers([parsedRow], existing);
    expect(duplicates.has(2)).toBe(false);
  });

  it('ไม่ตรวจพบซ้ำถ้าเลขที่อ้างอิงต่างกัน', () => {
    const existing = [makeExistingInvoice()];
    const parsedRow = parseExcelRow(row({ [EXCEL_HEADERS.reference_no]: 'PO-999' }), 2)!;
    const duplicates = findDuplicateRowNumbers([parsedRow], existing);
    expect(duplicates.has(2)).toBe(false);
  });

  it('ข้ามแถวที่มี error อยู่แล้ว ไม่ตรวจสอบซ้ำ', () => {
    const existing = [makeExistingInvoice()];
    const parsedRow = parseExcelRow(row({ [EXCEL_HEADERS.vendor_name]: '' }), 2)!; // error: ไม่ได้กรอกผู้ขาย
    const duplicates = findDuplicateRowNumbers([parsedRow], existing);
    expect(duplicates.has(2)).toBe(false);
  });

  it('ไม่มีรายการเดิมในระบบเลย — ไม่มีอะไรถูกตีว่าซ้ำ', () => {
    const parsedRow = parseExcelRow(row(), 2)!;
    expect(findDuplicateRowNumbers([parsedRow], [])).toEqual(new Set());
  });
});
