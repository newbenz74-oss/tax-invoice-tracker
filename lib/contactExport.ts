import * as XLSX from 'xlsx';
import type { BusinessPartner } from '@/types/contact';
import {
  CONTACT_STATUS_LABELS,
  ENTITY_TYPE_LABELS,
  PARTNER_TYPE_LABELS,
  formatBranchLabel,
  getContactDisplayName,
} from './contactLogic';

const EXPORT_HEADERS = [
  'รหัส',
  'ประเภท',
  'ประเภทบุคคล',
  'ชื่อ/ชื่อบริษัท',
  'เลขประจำตัวผู้เสียภาษี',
  'สาขา',
  'ที่อยู่',
  'ตำบล/แขวง',
  'อำเภอ/เขต',
  'จังหวัด',
  'รหัสไปรษณีย์',
  'เบอร์โทรศัพท์',
  'Email',
  'ผู้ติดต่อ',
  'หมายเหตุ',
  'สถานะ',
];

/** สร้างไฟล์ Excel ส่งออกจากรายชื่อที่ส่งเข้ามา — ผู้เรียก (ContactsPage.tsx) เป็นผู้กรองตาม
 * Segmented Control + คำค้นหาปัจจุบันไว้ก่อนแล้วเสมอ ฟังก์ชันนี้แค่แปลงเป็นไฟล์ Excel เท่านั้น
 * ไม่รู้จัก/ไม่ยุ่งกับ filter state ใดๆ เอง (ทำให้ทดสอบและนำกลับไปใช้ที่อื่นได้ง่าย) */
export function buildContactExportBlob(contacts: BusinessPartner[]): Blob {
  const aoa: (string | number)[][] = [
    EXPORT_HEADERS,
    ...contacts.map((c) => [
      c.contact_code,
      PARTNER_TYPE_LABELS[c.partner_type],
      ENTITY_TYPE_LABELS[c.entity_type],
      getContactDisplayName(c),
      c.tax_id ?? '',
      formatBranchLabel(c),
      c.address ?? '',
      c.subdistrict ?? '',
      c.district ?? '',
      c.province ?? '',
      c.postal_code ?? '',
      c.phone ?? '',
      c.email ?? '',
      c.contact_person ?? '',
      c.note ?? '',
      CONTACT_STATUS_LABELS[c.status],
    ]),
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  worksheet['!cols'] = EXPORT_HEADERS.map((h) => ({ wch: Math.max(h.length + 2, 16) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'สมุดรายชื่อ');
  const arrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Blob([arrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** สั่งดาวน์โหลด Blob เป็นไฟล์ — สำเนาของ downloadBlob ใน lib/reportExport.ts ตั้งใจทำแยกไว้ต่างหาก
 * เพื่อให้ฟีเจอร์สมุดรายชื่อไม่มีจุดเชื่อมโยง (import) กับไฟล์ของฟีเจอร์อื่นเลยแม้แต่จุดเดียว */
export function downloadContactBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
