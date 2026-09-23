/**
 * เนื้อหาอีเมลใบหัก ณ ที่จ่าย — pure function ล้วน ไม่ import nodemailer และไม่แตะ network/env เลย
 *
 * ทำไมต้องแยกไฟล์ออกมาจาก lib/whtCertificateEmail.ts (2026-09-23): หน้าต่างยืนยันก่อนส่งต้องแสดงหัวเรื่อง
 * และเนื้อหาอีเมลจริงให้ผู้ใช้อ่านก่อนกดยืนยัน ซึ่งเป็นโค้ดฝั่ง browser — ถ้า import จากไฟล์เดิมจะลาก
 * nodemailer (โมดูลฝั่ง Node ล้วน ใช้ net/tls/dns) เข้า bundle ของ client ไปด้วยแล้ว build ไม่ผ่าน
 *
 * กติกา: ข้อความที่ผู้ใช้เห็นในหน้าต่างยืนยัน ต้องมาจากฟังก์ชันตัวเดียวกันกับที่ server ใช้ส่งจริงเสมอ
 * ห้ามเขียนข้อความซ้ำอีกชุดที่ฝั่ง UI เด็ดขาด ไม่งั้นวันหนึ่งจะแก้ที่เดียวแล้วอีกที่ไม่ตาม ผู้ใช้จะเห็น
 * ตัวอย่างที่ไม่ตรงกับอีเมลที่ส่งออกไปจริง ซึ่งแย่กว่าไม่มี preview เสียอีก
 */

export interface WhtCertificateEmailContent {
  subject: string;
  text: string;
}

/** ประกอบหัวเรื่อง/เนื้อหาอีเมลภาษาไทย — ใช้ร่วมกันทั้งฝั่ง server (ตอนส่งจริง) และฝั่ง client (ตอน preview) */
export function buildWhtCertificateEmailContent(
  certNumber: string,
  payeeName: string,
  companyName: string
): WhtCertificateEmailContent {
  const subject = `หนังสือรับรองการหักภาษี ณ ที่จ่าย เลขที่ ${certNumber}`;
  const text = [
    `เรียน ${payeeName}`,
    '',
    `${companyName} ขอส่งหนังสือรับรองการหักภาษี ณ ที่จ่าย เลขที่ ${certNumber} ตามไฟล์แนบ (PDF)`,
    '',
    'อีเมลนี้ส่งโดยระบบอัตโนมัติ หากมีข้อสงสัยกรุณาติดต่อกลับโดยตรง',
  ].join('\n');
  return { subject, text };
}
