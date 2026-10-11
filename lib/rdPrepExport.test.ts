import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildPnd53Line,
  buildRdPrepAddress,
  buildRdPrepFile,
  buildRdPrepIncomeType,
  encodeTis620,
  findRdPrepIssues,
  padAmountField,
  padDigitsField,
  padTextField,
  rdPrepFilename,
  selectCertsForRdPrep,
  splitPayeeName,
} from './rdPrepExport';
import type { WhtCertificate } from '@/types/whtCertificate';

/** ไฟล์ตัวอย่างที่ผู้ใช้ยืนยันว่า RD Prep ของสรรพากรรับจริง — เทสต์ชุดนี้เทียบ "ทุกไบต์" กับไฟล์เหล่านี้
 * ถ้าแก้โค้ดแล้วเทสต์พัง แปลว่าไฟล์ที่ระบบสร้างจะไม่ตรงกับที่สรรพากรรับ ห้ามแก้เทสต์ให้ผ่าน ให้แก้โค้ด */
const FIXTURE_DIR = path.resolve(__dirname, '__fixtures__/rdPrep');

function readFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(FIXTURE_DIR, name)));
}

function makeCert(overrides: Partial<WhtCertificate> = {}): WhtCertificate {
  return {
    id: 'cert-1',
    company_id: 'company-1',
    cert_number: '53-6909001',
    form_type: '53',
    period_year: 2569,
    period_month: 9,
    sequence_number: 1,
    business_partner_id: 'partner-1',
    income_type_code: '6',
    income_type_label: 'ค่าบริการ',
    deduction_type: 'withholding',
    deduction_type_note: null,
    signer_name: 'SAKKARIN',
    issued_date: '2026-09-30',
    payment_date: '2026-09-30',
    total_amount: 74897.43,
    total_amount_excl_vat: 69997.6,
    total_wht_amount: 2099.93,
    payer_name: 'บริษัท แอซ เท็ก จำกัด',
    payer_tax_id: '0125566036499',
    payer_branch_type: 'head_office',
    payer_branch_number: null,
    payer_address: 'เลขที่ 98/402 หมู่ 4',
    payer_subdistrict: 'บางใหญ่',
    payer_district: 'บางใหญ่',
    payer_province: 'นนทบุรี',
    payer_postal_code: '11140',
    payee_entity_type: 'company',
    payee_name: 'บริษัท บลู กรีน โซลูชั่น จำกัด',
    payee_tax_id: '0125562010886',
    payee_branch_type: 'head_office',
    payee_branch_number: null,
    payee_address: '408/46 ถนนพหลโยธิน',
    payee_subdistrict: 'สามเสนใน',
    payee_district: 'พญาไท',
    payee_province: 'กรุงเทพมหานครฯ',
    payee_postal_code: '10400',
    status: 'issued',
    voided_at: null,
    email_sent_at: null,
    email_sent_to: null,
    void_reason: null,
    created_by: null,
    created_by_email: 'pitoon1410@gmail.com',
    created_at: '2026-09-30T00:00:00Z',
    updated_at: '2026-09-30T00:00:00Z',
    ...overrides,
  };
}

/** ใบตามบรรทัดเดียวในไฟล์ตัวอย่าง PND3.TXT (บุคคลธรรมดา) */
function makePnd3Cert(overrides: Partial<WhtCertificate> = {}): WhtCertificate {
  return makeCert({
    cert_number: '03-6909001',
    form_type: '03',
    payee_entity_type: 'individual',
    payee_name: 'นายวทัญญู สุวรรณาพิสิทธิ์',
    payee_tax_id: '1100800709303',
    payee_address: '55 ถนนบำรุงรัฐ',
    payee_subdistrict: 'สัมพันธวงศ์',
    payee_district: 'สัมพันธวงศ์',
    payee_province: 'กรุงเทพมหานคร',
    payee_postal_code: '10100',
    income_type_label: 'ค่าจ้าง',
    total_amount_excl_vat: 35000,
    total_wht_amount: 1050,
    total_amount: 37450,
    ...overrides,
  });
}

/* ========================================================================================
   เทียบกับไฟล์จริงที่ RD Prep รับแล้ว — เทสต์ที่สำคัญที่สุดในไฟล์นี้
   ======================================================================================== */

describe('เทียบไบต์ต่อไบต์กับไฟล์ตัวอย่างที่ RD Prep รับจริง', () => {
  /** ==================== ข้อแตกต่างที่ "ตั้งใจ" จากไฟล์ตัวอย่าง ภ.ง.ด.3 ====================
   * ในไฟล์ตัวอย่าง PND3.TXT ช่องที่ 5 (ชื่อ) ใส่ 'วทัญญู สุวรรณาพิสิทธิ์' มาทั้งก้อน และช่องที่ 6 (นามสกุล)
   * เว้นว่างไว้ทั้งช่อง — คนที่ทำไฟล์นั้นไม่ได้แยกนามสกุลออกมา
   *
   * ระบบนี้แยกให้ (ชื่อ='วทัญญู', นามสกุล='สุวรรณาพิสิทธิ์') เพราะช่องที่ 6 มีอยู่เพื่อการนี้โดยเฉพาะ และ
   * แบบ ภ.ง.ด.3 ที่พิมพ์ออกมามีคอลัมน์ชื่อ/นามสกุลแยกกันจริง ความกว้างทุกช่องยังเท่าเดิมทุกไบต์ จึงไม่กระทบ
   * การอ่านไฟล์ของ RD Prep (ต่างกันแค่ข้อมูลไปอยู่ช่องที่ถูกต้องกว่า)
   *
   * เทสต์นี้จึงเทียบ "ทุกช่องยกเว้นชื่อ/นามสกุล" กับไฟล์จริง แล้วตรวจสองช่องนั้นแยก */
  it('ภ.ง.ด.3 — ตรงกับ PND3.TXT ทุกช่อง ยกเว้นชื่อ/นามสกุลที่ระบบนี้แยกให้', () => {
    const file = buildRdPrepFile([makePnd3Cert()], '03', 2026, 9);
    const got = new TextDecoder('windows-874').decode(file.bytes).split('\r\n')[0].split('|');
    const want = new TextDecoder('windows-874').decode(readFixture('PND3.TXT')).split('\r\n')[0].split('|');

    expect(got).toHaveLength(want.length);
    const NAME_FIELDS = [5, 6];
    for (let i = 0; i < want.length; i++) {
      if (NAME_FIELDS.includes(i)) continue;
      expect(got[i], `ช่องที่ ${i}`).toBe(want[i]);
    }
    expect(got[5]).toBe('วทัญญู'.padEnd(60, ' '));
    expect(got[6]).toBe('สุวรรณาพิสิทธิ์'.padEnd(60, ' '));
    // ความยาวไฟล์ต้องเท่าเดิมเป๊ะ แม้ข้อมูลจะย้ายช่อง
    expect(file.bytes.length).toBe(readFixture('PND3.TXT').length);
  });

  it('ภ.ง.ด.53 — สร้างไฟล์ได้ตรงกับ PND53.TXT ทุกไบต์ (3 บรรทัด ผู้รับคนเดียวกัน)', () => {
    const certs = [
      makeCert({ cert_number: '53-6909001', total_amount_excl_vat: 69997.6, total_wht_amount: 2099.93 }),
      makeCert({ cert_number: '53-6909002', total_amount_excl_vat: 50000, total_wht_amount: 1500 }),
      makeCert({ cert_number: '53-6909003', total_amount_excl_vat: 85241, total_wht_amount: 2557.23 }),
    ];
    const file = buildRdPrepFile(certs, '53', 2026, 9);
    expect(file.bytes).toEqual(readFixture('PND53.TXT'));
  });

  it('ขนาดบรรทัดคงที่ตามสเปก — ภ.ง.ด.3 = 416 ไบต์ / ภ.ง.ด.53 = 355 ไบต์ ต่อบรรทัด', () => {
    expect(buildRdPrepFile([makePnd3Cert()], '03', 2026, 9).bytes.length).toBe(416);
    expect(buildRdPrepFile([makeCert()], '53', 2026, 9).bytes.length).toBe(355);
  });

  it('บรรทัดสุดท้ายก็ปิดด้วย CRLF (ไม่ใช่ตัดจบเฉยๆ)', () => {
    const bytes = buildRdPrepFile([makeCert()], '53', 2026, 9).bytes;
    expect([bytes[bytes.length - 2], bytes[bytes.length - 1]]).toEqual([0x0d, 0x0a]);
  });

  it('ไม่มี BOM นำหน้าไฟล์', () => {
    const bytes = buildRdPrepFile([makeCert()], '53', 2026, 9).bytes;
    expect(bytes[0]).toBe(0x7c); // '|'
  });
});

/* ========================================================================================
   การเข้ารหัส TIS-620
   ======================================================================================== */

describe('encodeTis620', () => {
  it('ภาษาไทย 1 ตัวอักษร = 1 ไบต์ (ไม่ใช่ 3 ไบต์แบบ UTF-8)', () => {
    // ก=0xA1 ข=0xA2 ค=0xA4 — ข้ามไป 0xA3 เพราะ ฃ (ขวด) คั่นอยู่ ตรงตามลำดับ Unicode U+0E01..
    expect(encodeTis620('กขค')).toEqual(new Uint8Array([0xa1, 0xa2, 0xa4]));
  });

  it('สระและวรรณยุกต์นับเป็นตัวอักษรแยก 1 ไบต์เช่นกัน', () => {
    // 'ที่' = ท + ี + ่ → 3 ไบต์
    expect(encodeTis620('ที่').length).toBe(3);
    expect(encodeTis620('ที่')).toEqual(new Uint8Array([0xb7, 0xd5, 0xe8]));
  });

  it('ASCII คงค่าเดิม', () => {
    expect(encodeTis620('|30/09/2569|')).toEqual(
      new Uint8Array([0x7c, 0x33, 0x30, 0x2f, 0x30, 0x39, 0x2f, 0x32, 0x35, 0x36, 0x39, 0x7c])
    );
  });

  it('อักขระที่แปลงไม่ได้กลายเป็น ? ไม่ throw ทั้งไฟล์', () => {
    expect(encodeTis620('ก😀ข')).toEqual(new Uint8Array([0xa1, 0x3f, 0x3f, 0xa2]));
  });

  it('ตัวอักษรไทยท้ายบล็อก (๛ U+0E5B) ยังแปลงได้', () => {
    expect(encodeTis620('๛')).toEqual(new Uint8Array([0xfb]));
  });
});

/* ========================================================================================
   การจัดช่อง
   ======================================================================================== */

describe('การจัดช่องตามความกว้างคงที่', () => {
  it('ช่องข้อความเติมช่องว่างท้าย', () => {
    expect(padTextField('นาย', 15)).toBe('นาย            ');
  });

  it('ช่องข้อความยาวเกินถูกตัด — ความกว้างต้องคงที่เสมอ ไม่งั้นช่องถัดไปเลื่อนทั้งบรรทัด', () => {
    expect(padTextField('ก'.repeat(70), 60)).toHaveLength(60);
  });

  it('ไพพ์และตัวขึ้นบรรทัดในข้อมูลถูกแทนด้วยช่องว่าง — ถ้าหลุดไปจะทำให้ไฟล์เพี้ยนทั้งบรรทัด', () => {
    expect(padTextField('บริษัท|เอ\nบี', 15)).toBe('บริษัท เอ บี   ');
  });

  it('ช่องเงินเติมศูนย์หน้า ทศนิยม 2 ตำแหน่งเสมอ', () => {
    expect(padAmountField(35000, 14)).toBe('00000035000.00');
    expect(padAmountField(1050, 13)).toBe('0000001050.00');
    expect(padAmountField(2099.93, 13)).toBe('0000002099.93');
  });

  it('ช่องเงินที่ล้นความกว้าง throw ทันที — ยอมพังตอน export ดีกว่าส่งไฟล์เพี้ยนให้สรรพากร', () => {
    expect(() => padAmountField(99_999_999_999_999, 14)).toThrow(/ยาวเกินช่อง/);
  });

  it('ช่องตัวเลขล้วนตัดอักขระที่ไม่ใช่ตัวเลขออกก่อนเติมศูนย์ (เลขผู้เสียภาษีที่พิมพ์มีขีด)', () => {
    expect(padDigitsField('1-1008-00709-30-3', 13)).toBe('1100800709303');
    expect(padDigitsField('5', 5)).toBe('00005');
  });
});

/* ========================================================================================
   แยกคำนำหน้าชื่อ
   ======================================================================================== */

describe('splitPayeeName', () => {
  it('คำนำหน้าติดกับชื่อไม่เว้นวรรค (รูปแบบที่ผู้ใช้พิมพ์จริงในระบบ)', () => {
    expect(splitPayeeName('นายวทัญญู สุวรรณาพิสิทธิ์', 'individual')).toEqual({
      prefix: 'นาย',
      firstName: 'วทัญญู',
      lastName: 'สุวรรณาพิสิทธิ์',
    });
  });

  it('"นางสาว" ต้องชนะ "นาง" — ไม่ใช่แยกเป็น นาง + สาวสมใจ', () => {
    expect(splitPayeeName('นางสาวสมใจ ใจดี', 'individual')).toEqual({
      prefix: 'นางสาว',
      firstName: 'สมใจ',
      lastName: 'ใจดี',
    });
  });

  it('นิติบุคคล: ตัดแค่คำนำหน้า เก็บ "จำกัด" ท้ายชื่อไว้ตามไฟล์ตัวอย่าง', () => {
    expect(splitPayeeName('บริษัท บลู กรีน โซลูชั่น จำกัด', 'company')).toEqual({
      prefix: 'บริษัท',
      firstName: 'บลู กรีน โซลูชั่น จำกัด',
      lastName: '',
    });
  });

  it('"ห้างหุ้นส่วนจำกัด" ต้องไม่ถูกตัดแค่บางส่วน', () => {
    expect(splitPayeeName('ห้างหุ้นส่วนจำกัด สมชายการช่าง', 'company').prefix).toBe('ห้างหุ้นส่วนจำกัด');
  });

  it('ไม่มีคำนำหน้าที่รู้จัก → prefix ว่าง ไม่เดาให้เอง', () => {
    expect(splitPayeeName('วทัญญู สุวรรณาพิสิทธิ์', 'individual')).toEqual({
      prefix: '',
      firstName: 'วทัญญู',
      lastName: 'สุวรรณาพิสิทธิ์',
    });
  });

  it('นามสกุลที่มีช่องว่างในตัวไม่ถูกตัดทิ้ง', () => {
    expect(splitPayeeName('นายสม ชาย ใจ ดี', 'individual').lastName).toBe('ชาย ใจ ดี');
  });

  it('มีแต่ชื่อไม่มีนามสกุล คืนนามสกุลว่าง ไม่พัง', () => {
    expect(splitPayeeName('นายสมชาย', 'individual')).toEqual({
      prefix: 'นาย',
      firstName: 'สมชาย',
      lastName: '',
    });
  });
});

/* ========================================================================================
   ที่อยู่
   ======================================================================================== */

describe('buildRdPrepAddress', () => {
  it('กรุงเทพฯ ใช้ แขวง/เขต และคั่นรหัสไปรษณีย์ด้วยช่องว่าง 2 ตัว (ตรงตามไฟล์ตัวอย่าง)', () => {
    expect(
      buildRdPrepAddress({
        address: '55 ถนนบำรุงรัฐ',
        subdistrict: 'สัมพันธวงศ์',
        district: 'สัมพันธวงศ์',
        province: 'กรุงเทพมหานคร',
        postal_code: '10100',
      })
    ).toBe('55 ถนนบำรุงรัฐ แขวงสัมพันธวงศ์ เขตสัมพันธวงศ์ กรุงเทพมหานคร  10100');
  });

  it('ต่างจังหวัดใช้ ตำบล/อำเภอ', () => {
    expect(
      buildRdPrepAddress({
        address: '163/92',
        subdistrict: 'พิมลราช',
        district: 'บางบัวทอง',
        province: 'นนทบุรี',
        postal_code: '11110',
      })
    ).toBe('163/92 ตำบลพิมลราช อำเภอบางบัวทอง นนทบุรี  11110');
  });

  it('ยาวเกิน 100 ตัวอักษร — ตัดชื่อถนน/อาคาร เก็บตำบล/อำเภอ/จังหวัด/รหัสไปรษณีย์ไว้ครบ', () => {
    const result = buildRdPrepAddress({
      address: `8 อาคารทีวัน ${'ชั้นสิบเอ็ดยูนิตสามสี่ '.repeat(6)}ซอยสุขุมวิท 40`,
      subdistrict: 'พระโขนง',
      district: 'คลองเตย',
      province: 'กรุงเทพมหานคร',
      postal_code: '10110',
    });
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result).toContain('แขวงพระโขนง');
    expect(result).toContain('เขตคลองเตย');
    expect(result.endsWith('10110')).toBe(true);
  });

  it('ช่องที่อยู่ที่ว่างไม่ทำให้เหลือช่องว่างคู่หรือคำว่า "แขวง" ลอยๆ', () => {
    expect(
      buildRdPrepAddress({
        address: '163/92',
        subdistrict: null,
        district: null,
        province: 'นนทบุรี',
        postal_code: '11110',
      })
    ).toBe('163/92 นนทบุรี  11110');
  });
});

/* ========================================================================================
   ประเภทเงินได้
   ======================================================================================== */

describe('buildRdPrepIncomeType', () => {
  it('รหัส 6 ได้รูปแบบตรงกับไฟล์ตัวอย่างทั้งสองแบบ', () => {
    expect(buildRdPrepIncomeType('6', 'ค่าจ้าง')).toBe('6.อื่นๆ(ค่าจ้าง)');
    expect(buildRdPrepIncomeType('6', 'ค่าบริการ')).toBe('6.อื่นๆ(ค่าบริการ)');
  });

  it('ไม่มีรายละเอียดในวงเล็บ → ไม่ขึ้นวงเล็บเปล่า', () => {
    expect(buildRdPrepIncomeType('6', null)).toBe('6.อื่นๆ');
    expect(buildRdPrepIncomeType('6', '   ')).toBe('6.อื่นๆ');
  });

  it('รหัสอื่นใช้ชื่อหมวดตามฟอร์ม ภ.ง.ด.', () => {
    expect(buildRdPrepIncomeType('2', 'ค่านายหน้า')).toBe('2.ค่าธรรมเนียม ค่านายหน้า ฯลฯ(ค่านายหน้า)');
  });
});

/* ========================================================================================
   คัดใบและชื่อไฟล์
   ======================================================================================== */

describe('selectCertsForRdPrep', () => {
  it('คัดตามเดือนของวันที่จ่าย และเฉพาะแบบที่ขอ', () => {
    const certs = [
      makeCert({ cert_number: '53-6909001', payment_date: '2026-09-01' }),
      makeCert({ cert_number: '53-6908001', payment_date: '2026-08-31' }),
      makePnd3Cert({ cert_number: '03-6909001', payment_date: '2026-09-15' }),
    ];
    expect(selectCertsForRdPrep(certs, '53', 2026, 9).map((c) => c.cert_number)).toEqual(['53-6909001']);
    expect(selectCertsForRdPrep(certs, '03', 2026, 9).map((c) => c.cert_number)).toEqual(['03-6909001']);
  });

  it('ไม่เอาใบที่ยกเลิกแล้ว — ใบ voided ไม่ต้องยื่นสรรพากร', () => {
    const certs = [
      makeCert({ cert_number: '53-6909001', payment_date: '2026-09-01' }),
      makeCert({ cert_number: '53-6909002', payment_date: '2026-09-02', status: 'voided' }),
    ];
    expect(selectCertsForRdPrep(certs, '53', 2026, 9)).toHaveLength(1);
  });

  it('เรียงตามวันที่จ่ายแล้วเลขที่ใบ — ยื่นซ้ำได้ลำดับเดิมทุกครั้ง', () => {
    const certs = [
      makeCert({ cert_number: '53-6909003', payment_date: '2026-09-20' }),
      makeCert({ cert_number: '53-6909002', payment_date: '2026-09-05' }),
      makeCert({ cert_number: '53-6909001', payment_date: '2026-09-05' }),
    ];
    expect(selectCertsForRdPrep(certs, '53', 2026, 9).map((c) => c.cert_number)).toEqual([
      '53-6909001',
      '53-6909002',
      '53-6909003',
    ]);
  });

  it('ลำดับที่ในไฟล์รันใหม่ 1,2,3 ตามลำดับในไฟล์ ไม่ใช่เลขที่ใบ', () => {
    const certs = [
      makeCert({ cert_number: '53-6909007' }),
      makeCert({ cert_number: '53-6909008' }),
    ];
    const lines = [buildPnd53Line(certs[0], 1, 3), buildPnd53Line(certs[1], 2, 3)];
    expect(lines[0].slice(1, 6)).toBe('00001');
    expect(lines[1].slice(1, 6)).toBe('00002');
  });
});

describe('rdPrepFilename', () => {
  it('ใส่เดือน/ปี พ.ศ. ไว้ในชื่อไฟล์เพื่อไม่ให้หลายเดือนทับกัน', () => {
    expect(rdPrepFilename('03', 2026, 9)).toBe('PND3_256909.TXT');
    expect(rdPrepFilename('53', 2026, 12)).toBe('PND53_256912.TXT');
  });
});

/* ========================================================================================
   ตรวจความพร้อม
   ======================================================================================== */

describe('findRdPrepIssues', () => {
  it('ใบที่ข้อมูลครบไม่มีข้อทักท้วง', () => {
    expect(findRdPrepIssues([makeCert()])).toEqual([]);
  });

  it('ไม่มีฐานภาษี (ยอดก่อน VAT) เป็นข้อผิดพลาดร้ายแรง ไม่ใช่คำเตือน', () => {
    const issues = findRdPrepIssues([makeCert({ total_amount_excl_vat: null })]);
    expect(issues).toHaveLength(1);
    expect(issues[0].warningOnly).toBe(false);
    expect(issues[0].problem).toContain('ยอดก่อน VAT');
  });

  it('เลขผู้เสียภาษีไม่ครบ 13 หลักเป็นข้อผิดพลาดร้ายแรง', () => {
    const issues = findRdPrepIssues([makeCert({ payee_tax_id: '01255620108' })]);
    expect(issues[0].warningOnly).toBe(false);
    expect(issues[0].problem).toContain('11 หลัก');
  });

  it('ไม่มีคำนำหน้าชื่อเป็นแค่คำเตือน — ยังสร้างไฟล์ให้ไปแก้ใน RD Prep ได้', () => {
    const issues = findRdPrepIssues([makeCert({ payee_name: 'บลู กรีน โซลูชั่น จำกัด' })]);
    expect(issues).toHaveLength(1);
    expect(issues[0].warningOnly).toBe(true);
    expect(issues[0].problem).toContain('คำนำหน้า');
  });

  it('ระบุว่าเป็นสาขาแต่ไม่มีเลขสาขา ขึ้นคำเตือน', () => {
    const issues = findRdPrepIssues([makeCert({ payee_branch_type: 'branch', payee_branch_number: null })]);
    expect(issues.some((i) => i.problem.includes('เลขสาขา'))).toBe(true);
  });

  it('บอกเลขที่ใบและชื่อผู้รับมาด้วย เพื่อให้ผู้ใช้รู้ว่าต้องไปแก้ใบไหน', () => {
    const issues = findRdPrepIssues([makeCert({ cert_number: '53-6909009', payee_tax_id: null })]);
    expect(issues[0].certNumber).toBe('53-6909009');
    expect(issues[0].payeeName).toBe('บริษัท บลู กรีน โซลูชั่น จำกัด');
  });
});

/* ========================================================================================
   อัตราภาษี
   ======================================================================================== */

describe('อัตราภาษีในไฟล์', () => {
  it('คำนวณจากฐานก่อน VAT ได้ 03.00 แม้ตัวเลขหารไม่ลงตัวพอดี (2099.93/69997.60)', () => {
    const line = buildRdPrepFile([makeCert()], '53', 2026, 9);
    expect(new TextDecoder('windows-874').decode(line.bytes)).toContain('|03.00|');
  });

  it('อัตราอื่นก็ส่งออกได้ ไม่ได้ตรึงไว้ที่ 3%', () => {
    const line = buildPnd53Line(makeCert({ total_amount_excl_vat: 100000, total_wht_amount: 5000 }), 1, 5);
    expect(line).toContain('|05.00|');
  });

  it('อัตราที่เพี้ยนจากมาตรฐานส่งออกตามจริง ไม่ปัดให้สวย — ผู้ใช้ต้องเห็นว่าใบนั้นผิด', () => {
    const line = buildPnd53Line(makeCert({ total_amount_excl_vat: 100000, total_wht_amount: 2800 }), 1, 2.8);
    expect(line).toContain('|02.80|');
  });
});

/* ========================================================================================
   กรณีไม่มีข้อมูล
   ======================================================================================== */

describe('กรณีขอบ', () => {
  it('ไม่มีใบเลย → ไฟล์ว่าง 0 ไบต์ และ rowCount เป็น 0 (ผู้เรียกต้องเช็คก่อนให้ดาวน์โหลด)', () => {
    const file = buildRdPrepFile([], '53', 2026, 9);
    expect(file.rowCount).toBe(0);
    expect(file.bytes.length).toBe(0);
  });

  it('วันที่จ่ายเพี้ยน throw ทันที ไม่เขียนวันที่ผิดลงไฟล์ยื่นภาษี', () => {
    expect(() => buildPnd53Line(makeCert({ payment_date: 'ไม่ใช่วันที่' }), 1, 3)).toThrow(/วันที่จ่าย/);
  });
});
