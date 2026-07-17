import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseBankFile, parseBankRows, parseGLFile, parseGLRows } from './bankReconcileParse';

// ---------- Test helpers ----------

function makeExcelFile(rows: unknown[][], fileName = 'test.xlsx'): File {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  const arrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new File([arrayBuffer], fileName, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function makeCsvFile(csvText: string, fileName = 'test.csv'): File {
  return new File([csvText], fileName, { type: 'text/csv' });
}

/** ถอดรหัส hex string ให้เป็น bytes ดิบ — ใช้สร้างไฟล์ CSV ทดสอบที่เข้ารหัสแบบ Windows-874 (TIS-620) โดยตรง
 * bytes ด้านล่างสร้างไว้ล่วงหน้าด้วย Python (`text.encode('cp874')`) เพราะ TextEncoder ของ JS/เบราว์เซอร์
 * เข้ารหัสได้แค่ UTF-8 เท่านั้นตามสเปก (https://encoding.spec.whatwg.org/#interface-textencoder) ไม่มีทาง
 * สร้าง Windows-874 bytes จาก string ตรงๆ ในโค้ด JS ได้เลย ต้องเตรียม bytes มาล่วงหน้าแบบนี้ */
function hexToBytes(hex: string) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

function makeBytesFile(hex: string, fileName: string): File {
  return new File([hexToBytes(hex)], fileName, { type: 'text/csv' });
}

// ไฟล์ Bank Statement ขั้นต่ำ เข้ารหัสแบบ Windows-874 (TIS-620): "วันที่,รับ,จ่าย" + 2 แถว — สร้างจาก
// 'วันที่,รับ,จ่าย\r\n01/07/2569,1000,\r\n02/07/2569,,500\r\n'.encode('cp874') จำลองไฟล์ CSV จริงจาก
// โปรแกรมบัญชีไทยที่ไม่ได้เข้ารหัสแบบ UTF-8 (ดูคอมเมนต์ decodeCsvBuffer ใน bankReconcileParse.ts)
const BANK_CP874_HEX =
  'c7d1b9b7d5e82cc3d1ba2ca8e8d2c20d0a30312f30372f323536392c313030302c0d0a30322f30372f323536392c2c3530300d0a';

// ไฟล์ GL ตัวอย่างที่จำลองโครงสร้างไฟล์ "รายงานแยกประเภททั่วไป" จริงจากโปรแกรมบัญชีไทยที่ผู้ใช้อัปโหลดมา
// เมื่อ 2026-07-17 (ข้อมูล/ชื่อบริษัทเป็นข้อมูลสมมติ แต่โครงสร้างเลียนแบบไฟล์จริงทุกจุดที่เคยทำให้ parse
// พัง): มีแถวหัวรายงาน/ชื่อบริษัท/ช่วงวันที่ 4 แถวก่อนแถวหัวคอลัมน์จริง (index 0-3), แถวหัวคอลัมน์อยู่ที่
// index 4 และใช้ชื่อคอลัมน์ "เดบิต"/"เครดิต" กับ "ใบสำคัญ" (ไม่ใช่ "รับ"/"จ่าย"/"เลขที่เอกสาร" ตรงๆ), แถว
// ยอดยกมา (index 5 — คอลัมน์วันที่มีค่า "1113-01" ซึ่งเป็นเลขที่บัญชีไม่ใช่วันที่จริง), แถวรวม/แถวรวม
// ทั้งสิ้น/แถวว่างท้ายไฟล์ (ต้องถูกข้ามทั้งหมด) และมีคู่แถวที่วันที่+เลขที่เอกสารซ้ำกันแต่คนละประเภท
// (ดอกเบี้ยรับ 2970.43 กับภาษีหัก ณ ที่จ่าย 29.70 ที่หักจากดอกเบี้ยตัวเดียวกัน) เข้ารหัสแบบ Windows-874
// เหมือนไฟล์จริง (สร้างจาก Python `text.encode('cp874')`)
const GL_CP874_HEX =
  '22222c22bac3d4c9d1b720b7b4cacdba20a8d3a1d1b42020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020cbb9e9d2203a202020202020202031220d0a22222c22c3d2c2a7d2b9e1c2a1bbc3d0e0c0b7b7d1e8c7e4bb220d0a22222c22c7d1b9b7d5e8a8d2a120202020222c223120c1d42ec22e2032353639202020222c222020b6d6a720222c2220333020c1d42ec22e2032353639202020202020202020202020202020202020202020c7d1b9b7d5e8203a2031372f30372f32353639220d0a22222c22e0c5a2b7d5e8bad1adaad52020222c22313131332d30312020202020202020222c2220b6d6a72020222c2220313131332d303120202020202020202020202020202020202020202020202020202020e0c5d7cda1e1bcb9a120202a220d0a22222c22c7d1b9b7d5e8222c22cac1d8b4222c22e3bacad3a4d1ad222c22a4d3cdb8d4bad2c2222c22222c22e0b4bad4b5222c22e0a4c3b4d4b5222c22cab6d2b9d0222c22c2cdb4a4a7e0cbc5d7cd220d0a22222c22313131332d3031222c22222c22b8b9d2a4d2c3b7b4cacdba20233030302d3030303030302d30222c22222c22222c22222c22222c22222c3530303030302e30300d0a22222c30312f30362f323536392c22a2d2c2222c224853363930363031303031222c22b5d1c7cdc2e8d2a7c3d2c2e4b4e92031222c22222c3131313430302e30302c2c22222c3631313430302e30300d0a22222c30322f30362f323536392c22a8e8d2c2222c225056363930363032303031222c22b5d1c7cdc2e8d2a7c3d2c2a8e8d2c22031222c22222c2c33313430332e31322c22222c3537393939362e38380d0a22222c32352f30362f323536392c22c3d1ba222c225256363930363235303031222c22b5d1c7cdc2e8d2a7b4cda1e0bad5e9c2c3d1ba222c22222c323937302e34332c2c22222c3538323936372e33310d0a22222c32352f30362f323536392c22c3d1ba222c225256363930363235303031222c22b5d1c7cdc2e8d2a7cbd1a120b320b7d5e8a8e8d2c2222c22222c2c32392e37302c22222c3538323933372e36310d0a22222c22c3c7c1222c22222c22222c22222c22222c3131343337302e34332c33313433322e38320d0a22222c22220d0a22222c22c3c7c1b7d1e9a7cad4e9b9222c342c22c3d2c2a1d2c3222c312c22bad1adaad5222c3131343337302e34332c33313433322e38320d0a';

describe('parseBankRows — การหาคอลัมน์อัตโนมัติ (array-of-arrays)', () => {
  it('รู้จักหัวคอลัมน์ภาษาไทย (วันที่ / รับ / จ่าย)', () => {
    const result = parseBankRows([
      ['วันที่', 'รับ', 'จ่าย'],
      ['01/07/2026', 1000, ''],
    ]);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ date: '2026-07-01', type: 'receive', amount: 1000 });
  });

  it('รู้จักหัวคอลัมน์ภาษาอังกฤษ (Date / Receive / Payment)', () => {
    const result = parseBankRows([
      ['Date', 'Receive', 'Payment'],
      ['2026-07-02', '', 500],
    ]);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({ date: '2026-07-02', type: 'payment', amount: 500 });
  });

  it('ทนต่อความแตกต่างของช่องว่าง/ตัวพิมพ์เล็กใหญ่/เครื่องหมายจุดในหัวคอลัมน์', () => {
    const result = parseBankRows([
      [' transaction date ', ' Deposit ', 'Withdraw'],
      ['2026-07-03', 200, ''],
    ]);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({ date: '2026-07-03', type: 'receive', amount: 200 });
  });

  it('คืนค่า error ระดับไฟล์เมื่อหาคอลัมน์ที่จำเป็นไม่เจอ', () => {
    const result = parseBankRows([
      ['Foo', 'Baz'],
      ['bar', 123],
    ]);
    expect(result.rows).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('วันที่');
  });

  it('คืนค่า error เมื่อไฟล์ไม่มีแถวข้อมูลเลย', () => {
    const result = parseBankRows([]);
    expect(result.rows).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('ข้ามแถวที่มีทั้งรับและจ่ายพร้อมกัน พร้อม warning', () => {
    const result = parseBankRows([
      ['วันที่', 'รับ', 'จ่าย'],
      ['2026-07-01', 100, 200],
    ]);
    expect(result.rows).toHaveLength(0);
    expect(result.warnings.length).toBe(1);
  });

  it('ข้ามแถวที่วันที่ไม่ถูกต้อง พร้อม warning', () => {
    const result = parseBankRows([
      ['วันที่', 'รับ', 'จ่าย'],
      ['ไม่ใช่วันที่', 100, ''],
    ]);
    expect(result.rows).toHaveLength(0);
    expect(result.warnings.length).toBe(1);
  });

  it('ข้ามแถวว่างทั้งแถวแบบเงียบๆ ไม่มี warning', () => {
    const result = parseBankRows([
      ['วันที่', 'รับ', 'จ่าย'],
      ['2026-07-01', 100, ''],
      ['', '', ''],
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.warnings).toHaveLength(0);
  });

  it('ข้ามแถวที่ไม่มีทั้งรับและจ่าย (ทั้งคู่ว่างหรือ 0) แบบเงียบๆ', () => {
    const result = parseBankRows([
      ['วันที่', 'รับ', 'จ่าย'],
      ['2026-07-01', 0, 0],
    ]);
    expect(result.rows).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('รองรับรูปแบบวันที่ DD/MM/YYYY', () => {
    const result = parseBankRows([
      ['วันที่', 'รับ', 'จ่าย'],
      ['15/07/2026', 500, ''],
    ]);
    expect(result.rows[0].date).toBe('2026-07-15');
  });

  it('รองรับจำนวนเงินที่มี comma คั่นหลักพัน', () => {
    const result = parseBankRows([
      ['วันที่', 'รับ', 'จ่าย'],
      ['2026-07-01', '1,234.56', ''],
    ]);
    expect(result.rows[0].amount).toBe(1234.56);
  });

  it('หาแถวหัวตารางเจอแม้ไม่ได้อยู่แถวแรก (มีแถวหัวรายงาน/พรีแอมเบิลนำหน้าหลายแถว)', () => {
    const result = parseBankRows([
      ['รายงานเดินบัญชีธนาคาร'],
      ['บริษัท ทดสอบ จำกัด'],
      ['ช่วงวันที่ 1/6/2569 - 30/6/2569'],
      ['วันที่', 'รับ', 'จ่าย'],
      ['01/06/2026', 1000, ''],
    ]);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ date: '2026-06-01', type: 'receive', amount: 1000 });
  });

  it('แปลงปี พ.ศ. เป็น ค.ศ. อัตโนมัติ (เช่น 01/06/2569 → 2026-06-01)', () => {
    const result = parseBankRows([
      ['วันที่', 'รับ', 'จ่าย'],
      ['01/06/2569', 1000, ''],
    ]);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0].date).toBe('2026-06-01');
  });

  it('รู้จักหัวคอลัมน์ "เดบิต"/"เครดิต" ของบัญชีธนาคาร (เดบิต=รับ, เครดิต=จ่าย ตามหลักบัญชีคู่)', () => {
    const result = parseBankRows([
      ['วันที่', 'เดบิต', 'เครดิต'],
      ['01/06/2569', 1000, ''],
      ['02/06/2569', '', 500],
    ]);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ type: 'receive', amount: 1000 });
    expect(result.rows[1]).toMatchObject({ type: 'payment', amount: 500 });
  });
});

describe('parseGLRows — เพิ่มเติมเรื่องเลขที่เอกสาร', () => {
  it('อ่านเลขที่เอกสารได้เมื่อมีคอลัมน์ที่ตรงกับ alias', () => {
    const result = parseGLRows([
      ['เลขที่เอกสาร', 'วันที่', 'รับ', 'จ่าย'],
      ['DOC-001', '2026-07-01', 1000, ''],
    ]);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({ documentNo: 'DOC-001', type: 'receive', amount: 1000 });
  });

  it('คืนค่า error เมื่อไม่พบคอลัมน์เลขที่เอกสาร (บังคับสำหรับ GL เท่านั้น)', () => {
    const result = parseGLRows([
      ['วันที่', 'รับ', 'จ่าย'],
      ['2026-07-01', 1000, ''],
    ]);
    expect(result.rows).toHaveLength(0);
    expect(result.errors[0]).toContain('เลขที่เอกสาร');
  });

  it('รู้จัก "ใบสำคัญ" เป็น alias ของเลขที่เอกสาร (คำที่โปรแกรมบัญชีไทยหลายตัวใช้แทน "เลขที่เอกสาร")', () => {
    const result = parseGLRows([
      ['วันที่', 'ใบสำคัญ', 'เดบิต', 'เครดิต'],
      ['01/06/2569', 'PV690601001', '', 5000],
    ]);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({ documentNo: 'PV690601001', type: 'payment', amount: 5000 });
  });

  it('แถววันที่+เลขที่เอกสารซ้ำกันแต่คนละประเภท (รับ/จ่าย) ถูกแปลงเป็น 2 รายการอิสระ', () => {
    const result = parseGLRows([
      ['วันที่', 'ใบสำคัญ', 'เดบิต', 'เครดิต'],
      ['25/06/2569', 'RV001', 2970.43, ''],
      ['25/06/2569', 'RV001', '', 29.7],
    ]);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ documentNo: 'RV001', type: 'receive', amount: 2970.43 });
    expect(result.rows[1]).toMatchObject({ documentNo: 'RV001', type: 'payment', amount: 29.7 });
  });
});

describe('parseBankFile / parseGLFile — อ่านไฟล์จริง (Excel / CSV)', () => {
  it('อ่านไฟล์ .xlsx ได้ถูกต้อง', async () => {
    const file = makeExcelFile([
      ['วันที่', 'รับ', 'จ่าย'],
      ['2026-07-01', 1000, ''],
      ['2026-07-02', '', 200],
    ]);
    const result = await parseBankFile(file);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(2);
  });

  it('อ่านไฟล์ .xlsx ที่มีแถวหัวรายงานนำหน้าแถวหัวตารางได้ถูกต้อง', async () => {
    const file = makeExcelFile([
      ['รายงานเดินบัญชี'],
      ['บริษัท ทดสอบ จำกัด'],
      ['วันที่', 'รับ', 'จ่าย'],
      ['01/06/2026', 1500, ''],
    ]);
    const result = await parseBankFile(file);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ date: '2026-06-01', type: 'receive', amount: 1500 });
  });

  it('อ่านไฟล์ .csv ได้ถูกต้อง (UTF-8)', async () => {
    const csv = 'วันที่,รับ,จ่าย\n2026-07-01,1000,\n2026-07-02,,200\n';
    const file = makeCsvFile(csv);
    const result = await parseBankFile(file);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ date: '2026-07-01', type: 'receive', amount: 1000 });
  });

  it('อ่านไฟล์ GL แบบ .csv พร้อมเลขที่เอกสารได้ถูกต้อง (UTF-8)', async () => {
    const csv = 'Document No,Date,Receive,Payment\nDOC-100,2026-07-01,1000,\nDOC-101,2026-07-02,,200\n';
    const file = makeCsvFile(csv, 'gl.csv');
    const result = await parseGLFile(file);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].documentNo).toBe('DOC-100');
  });

  it('อ่านไฟล์ .csv ที่เข้ารหัสแบบ Windows-874 (TIS-620) ได้ถูกต้อง (โปรแกรมบัญชีไทยหลายตัวส่งออก CSV ด้วย encoding นี้ ไม่ใช่ UTF-8)', async () => {
    const file = makeBytesFile(BANK_CP874_HEX, 'bank-cp874.csv');
    const result = await parseBankFile(file);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ date: '2026-07-01', type: 'receive', amount: 1000 });
    expect(result.rows[1]).toMatchObject({ date: '2026-07-02', type: 'payment', amount: 500 });
  });

  it('คืนค่า error แบบ graceful เมื่อไฟล์เสียหาย/อ่านไม่ออก ไม่ throw ออกไปนอกฟังก์ชัน', async () => {
    const file = new File(['not a real excel file at all'], 'broken.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const result = await parseBankFile(file);
    expect(result.rows).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('parseGLFile — ไฟล์ GL จำลองโครงสร้างไฟล์จริงจากโปรแกรมบัญชีไทย (บั๊กที่พบ 2026-07-17)', () => {
  it('อ่านไฟล์ GL ที่มีครบทุกจุดที่เคยทำให้พัง: พรีแอมเบิลนำหน้า + เข้ารหัส Windows-874 + คอลัมน์เดบิต/เครดิต + ปี พ.ศ. ได้ถูกต้องทั้งหมด', async () => {
    const file = makeBytesFile(GL_CP874_HEX, 'gl-sample.csv');
    const result = await parseGLFile(file);

    expect(result.errors).toHaveLength(0);
    // 4 รายการจริง: แถวยอดยกมา + แถวรวม + แถวรวมทั้งสิ้น (วันที่ไม่ถูกต้องทั้ง 3 แถว) + แถวว่าง 1 แถว
    // ต้องถูกข้ามทั้งหมด ไม่ถูกนับเป็นรายการ
    expect(result.rows).toHaveLength(4);
    // แถวยอดยกมา/แถวรวม/แถวรวมทั้งสิ้น มีเนื้อหาอยู่ (ไม่ใช่แถวว่าง) แต่วันที่ไม่ถูกต้อง → ควรมี warning
    // แถวละ 1 (รวม 3) ส่วนแถวว่างจริงๆ ข้ามแบบเงียบไม่มี warning
    expect(result.warnings).toHaveLength(3);

    expect(result.rows[0]).toMatchObject({
      documentNo: 'HS690601001',
      date: '2026-06-01',
      type: 'receive',
      amount: 111400,
    });
    expect(result.rows[1]).toMatchObject({
      documentNo: 'PV690602001',
      date: '2026-06-02',
      type: 'payment',
      amount: 31403.12,
    });
    // คู่แถวที่วันที่ + เลขที่เอกสารซ้ำกัน (ดอกเบี้ยรับ กับ ภาษีหัก ณ ที่จ่ายที่หักจากดอกเบี้ยตัวเดียวกัน)
    // ต้องกลายเป็น 2 รายการอิสระ ไม่ถูกรวมหรือข้ามเพราะเลขที่เอกสารซ้ำ
    expect(result.rows[2]).toMatchObject({
      documentNo: 'RV690625001',
      date: '2026-06-25',
      type: 'receive',
      amount: 2970.43,
    });
    expect(result.rows[3]).toMatchObject({
      documentNo: 'RV690625001',
      date: '2026-06-25',
      type: 'payment',
      amount: 29.7,
    });
  });
});
