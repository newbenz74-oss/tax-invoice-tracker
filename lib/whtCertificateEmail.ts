import nodemailer from 'nodemailer';

/**
 * ฟีเจอร์ "ส่งอีเมล" ใบหัก ณ ที่จ่าย (เพิ่มเข้ามา 2026-08-11 ตามที่ผู้ใช้ขอ — "มีอีเมลของผู้รับแล้ว อยากให้มี
 * ปุ่มส่งเมลไปเลย") ผู้ใช้ยืนยันว่าต้องการให้ระบบส่งอีเมลเองอัตโนมัติ (แนบ PDF) ไม่ใช่แค่เปิดโปรแกรมอีเมลเฉยๆ
 * — แต่ผู้ใช้ยังไม่มีโดเมนเว็บของตัวเอง (จำเป็นสำหรับผู้ให้บริการอีเมลอย่าง Resend ถ้าจะส่งหาผู้รับปลายทาง
 * จริง ไม่ใช่แค่ที่อยู่ของตัวเองตอนทดสอบ) จึงเลือกส่งผ่าน Gmail SMTP ของผู้ใช้เอง (newbenz74@gmail.com) แทน
 * — ไม่ต้องมีโดเมน ไม่ต้องสมัครบริการเพิ่ม ใช้ App Password ของ Gmail (ไม่ใช่รหัสผ่านจริง สร้าง/เพิกถอนแยกได้
 * ที่ https://myaccount.google.com/apppasswords ต้องเปิดยืนยันตัวตน 2 ขั้นตอนก่อน) เก็บไว้ที่ env var
 * GMAIL_APP_PASSWORD (ไม่มี prefix NEXT_PUBLIC_ จึงไม่ถูกส่งไปฝั่ง client เด็ดขาด — ใช้ได้เฉพาะใน
 * app/api/wht-certificate/send/route.ts ซึ่งรันฝั่ง server เท่านั้น)
 *
 * ไฟล์นี้แยกออกจาก route.ts เพื่อให้ทดสอบส่วน "ประกอบเนื้อหาอีเมล" (buildWhtCertificateEmailContent) และ
 * "เช็คว่าตั้งค่าครบไหม" (isEmailSendConfigured) แบบ pure function ได้โดยไม่ต้องยิง SMTP จริงในเทส
 */

export function isEmailSendConfigured(): boolean {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

/** ตรวจใบรับรอง TLS ของ smtp.gmail.com หรือไม่ — ค่าเริ่มต้นคือ "ตรวจ" เสมอ
 *
 * ที่มา: เครื่องของผู้ใช้บางเครื่องมีโปรแกรมความปลอดภัย (แอนติไวรัส/ไฟร์วอลล์องค์กร) ที่แทรกกลางการเชื่อมต่อ
 * TLS แล้วสลับใบรับรองเป็นใบที่ออกเอง (self-signed) ทำให้ Node.js ปฏิเสธการเชื่อมต่อด้วย error
 * "self-signed certificate in certificate chain" (พบจริงกับผู้ใช้เมื่อ 2026-08-11) เดิมแก้ด้วยการตั้ง
 * rejectUnauthorized: false ตายตัว
 *
 * ปัญหาของวิธีเดิม: โค้ดชุดเดียวกันนี้รันบน Vercel ด้วย การปิดการตรวจใบรับรองบนเซิร์ฟเวอร์จริงแปลว่ายอมรับ
 * ใบรับรองปลอมจากใครก็ได้ที่แทรกกลางเส้นทางอินเทอร์เน็ตได้ — ซึ่งหมายถึงรหัส App Password ของ Gmail หลุด
 * ไปกับการเชื่อมต่อนั้นได้เลย บนเครื่อง dev ของผู้ใช้เองความเสี่ยงต่ำ (ตัวที่แทรกกลางคือซอฟต์แวร์ที่ติดตั้ง
 * บนเครื่องเดียวกัน) แต่บน production ไม่มีเหตุผลรองรับ
 *
 * จึงเปลี่ยนเป็น opt-in: ต้องตั้ง SMTP_ALLOW_SELF_SIGNED=true ที่ .env.local เองเท่านั้นถึงจะปิดการตรวจ และ
 * ถึงตั้งไว้ก็ยังไม่มีผลเมื่อ NODE_ENV = 'production' (กันการเผลอเอาไปใส่ที่ Vercel แล้วลืม) */
export function shouldVerifyTlsCertificate(): boolean {
  if (process.env.NODE_ENV === 'production') return true;
  return process.env.SMTP_ALLOW_SELF_SIGNED !== 'true';
}

// ตัวประกอบเนื้อหาอีเมลย้ายไปอยู่ lib/whtCertificateEmailContent.ts แล้ว (2026-09-23) เพื่อให้หน้าต่าง
// ยืนยันก่อนส่งฝั่ง browser เรียกใช้ได้โดยไม่ลาก nodemailer เข้า bundle — re-export ไว้ตรงนี้ให้โค้ดเดิม
// (route.ts, เทสต์) import จากที่เดิมต่อได้เหมือนไม่มีอะไรเปลี่ยน
export { buildWhtCertificateEmailContent } from './whtCertificateEmailContent';
export type { WhtCertificateEmailContent } from './whtCertificateEmailContent';

export interface SendWhtCertificateEmailInput {
  to: string;
  subject: string;
  text: string;
  filename: string;
  pdfBuffer: Buffer;
}

/** ส่งอีเมลจริงผ่าน Gmail SMTP — สร้าง transporter ใหม่ทุกครั้งที่เรียก (ไม่ cache ไว้ระดับโมดูล) เพราะรันใน
 * serverless function ที่อาจถูกสร้าง instance ใหม่บ่อยอยู่แล้ว ไม่ได้ช่วยเรื่องประสิทธิภาพมากนัก แต่ทำให้อ่าน
 * ค่า env ใหม่ทุกครั้งแน่นอน (เผื่อกรณีทดสอบ/สลับค่า) โยน error ตรงๆ ถ้าส่งไม่สำเร็จ ให้ผู้เรียก (route.ts)
 * จัดการแปลงเป็น response เอง */
export async function sendWhtCertificateEmail(input: SendWhtCertificateEmailInput): Promise<void> {
  const gmailUser = process.env.GMAIL_USER;
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailAppPassword) {
    throw new Error('ยังไม่ได้ตั้งค่าการส่งอีเมล (GMAIL_USER/GMAIL_APP_PASSWORD)');
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: gmailUser, pass: gmailAppPassword },
    tls: { rejectUnauthorized: shouldVerifyTlsCertificate() },
  });

  await transporter.sendMail({
    from: gmailUser,
    to: input.to,
    subject: input.subject,
    text: input.text,
    attachments: [{ filename: input.filename, content: input.pdfBuffer, contentType: 'application/pdf' }],
  });
}
