import type jsPDF from 'jspdf';
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
