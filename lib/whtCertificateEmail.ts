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

export interface WhtCertificateEmailContent {
  subject: string;
  text: string;
}

/** ประกอบหัวเรื่อง/เนื้อหาอีเมลภาษาไทย — pure function ไม่แตะ network เลย ใช้เทสได้ตรงๆ */
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
    // เครื่องผู้ใช้บางเครื่องมีโปรแกรมความปลอดภัย (แอนติไวรัส/ไฟร์วอลล์องค์กร) ที่แทรกกลางการเชื่อมต่อ
    // TLS ไปยัง smtp.gmail.com แล้วสลับใบรับรองเป็นใบที่ออกเองแทน (self-signed) — Node.js ไม่เชื่อถือใบ
    // รับรองนั้นโดยดีฟอลต์ ทำให้เชื่อมต่อไม่ได้เลย (error "self-signed certificate in certificate chain",
    // พบและยืนยันจริงกับผู้ใช้แล้วเมื่อ 2026-08-11) ปิด rejectUnauthorized ตรงนี้เพื่อยอมรับใบรับรองที่ถูก
    // สลับดังกล่าว — ยอมรับความเสี่ยงนี้ได้เพราะเป็นแค่การส่งอีเมลออกจากเครื่อง dev ของผู้ใช้เองไปหา Gmail
    // ของผู้ใช้เอง (ไม่ใช่ endpoint สาธารณะที่รับข้อมูลจากคนอื่น) และตัวที่แทรกกลางเป็นซอฟต์แวร์ความปลอดภัย
    // ที่ติดตั้งบนเครื่องเดียวกันอยู่แล้ว ไม่ใช่บุคคลภายนอก
    tls: { rejectUnauthorized: false },
  });

  await transporter.sendMail({
    from: gmailUser,
    to: input.to,
    subject: input.subject,
    text: input.text,
    attachments: [{ filename: input.filename, content: input.pdfBuffer, contentType: 'application/pdf' }],
  });
}
