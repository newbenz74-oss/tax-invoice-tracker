'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { AlertTriangle, CheckCircle2, Mail, Paperclip, XCircle } from 'lucide-react';
import { fetchWhtSendLogs, SEND_ERROR_MESSAGES, WHT_SEND_LOGS_SWR_KEY } from '@/lib/whtCertificateApi';
import { buildWhtCertificateEmailContent } from '@/lib/whtCertificateEmailContent';
import type { WhtCertificate, WhtSendLog } from '@/types/whtCertificate';

/**
 * หน้าต่างยืนยันก่อนส่งอีเมลใบหัก ณ ที่จ่าย + ประวัติการส่งของใบนั้น (เพิ่มเข้ามา 2026-09-23 ตามที่ผู้ใช้ขอ)
 *
 * ที่มา: เดิมปุ่ม "ส่งอีเมล" ในหน้าประวัติใบหัก ณ ที่จ่ายคลิกเดียวส่งออกทันที ไม่มีจุดทบทวน — ต่างจากปุ่ม
 * "ลบ"/"แก้ไข" ข้างๆ กันที่มี dialog ยืนยันทั้งคู่ ทั้งที่การส่งอีเมลผิดคนย้อนกลับไม่ได้พอๆ กัน (เอกสารภาษี
 * ของผู้เสียภาษีรายหนึ่งหลุดไปถึงอีกราย) หน้าต่างนี้จึงแสดง "อีเมลจริงที่จะถูกส่ง" ให้อ่านก่อนกดยืนยัน
 *
 * รวมประวัติการส่งไว้ในหน้าต่างเดียวกันโดยตั้งใจ ไม่แยกเป็นอีกปุ่ม/อีกหน้าจอ — เพราะสองอย่างนี้ตอบคำถาม
 * เดียวกันของผู้ใช้ตอนมือลังเลอยู่บนปุ่ม ("เคยส่งไปแล้วหรือยัง ส่งไปที่ไหน ครั้งก่อนสำเร็จไหม") การต้องปิด
 * หน้าต่างนี้ไปเปิดอีกที่เพื่อดูแล้วค่อยกลับมากดส่ง ทำให้ข้อมูลไม่ได้ช่วยตัดสินใจจริง และแถวในตารางหน้าหลัก
 * ก็แน่นอยู่แล้ว (มีปุ่ม 4 ปุ่มต่อแถว) การเพิ่มปุ่มที่ 5 แลกกับข้อมูลที่ควรอยู่ตรงนี้อยู่แล้วไม่คุ้ม
 *
 * ข้อความ preview มาจาก buildWhtCertificateEmailContent() ตัวเดียวกับที่ route ฝั่ง server ใช้ส่งจริง
 * (lib/whtCertificateEmailContent.ts) ห้ามเขียนข้อความซ้ำอีกชุดที่นี่เด็ดขาด ไม่งั้นวันหนึ่งจะแก้ที่เดียว
 * แล้วอีกที่ไม่ตาม ผู้ใช้จะเห็นตัวอย่างที่ไม่ตรงกับของจริง ซึ่งแย่กว่าไม่มี preview เสียอีก
 */

/** เวลาแบบเต็ม (วัน/เดือน/ปี พ.ศ. + นาที) — ใช้ชุดเดียวกับ formatDateTime ในหน้าประวัติใบหัก ณ ที่จ่าย */
function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear() + 543;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hh}:${mm}`;
}

/** แปลงเหตุผลที่ส่งไม่สำเร็จเป็นภาษาไทย — ใช้พจนานุกรมชุดเดียวกับที่ผู้ใช้เห็นตอนกดส่งแล้วพลาด
 * (SEND_ERROR_MESSAGES) ถ้าเจอรหัสที่ยังไม่มีในพจนานุกรม แสดงรหัสดิบไปก่อนดีกว่าเขียนว่า "ไม่ทราบสาเหตุ"
 * เพราะรหัสดิบยังพอเอาไปค้นต่อได้ */
function describeFailure(log: WhtSendLog): string {
  if (!log.error_code) return 'ส่งไม่สำเร็จ';
  return SEND_ERROR_MESSAGES[log.error_code] ?? `ส่งไม่สำเร็จ (${log.error_code})`;
}

export interface SendWhtCertificateEmailModalProps {
  cert: WhtCertificate;
  /** อีเมลผู้รับจากสมุดรายชื่อ — ผู้เรียกต้องกรองมาแล้วว่าไม่ว่าง (ปุ่มถูกปิดไว้ถ้าไม่มี) */
  recipientEmail: string;
  /** ชื่อบริษัทผู้จ่ายเงิน ใช้ประกอบเนื้อหาอีเมลให้ตรงกับที่ server จะส่งจริง */
  companyName: string;
  /** ชื่อไฟล์แนบที่จะถูกส่งไปจริง (whtCertificateFilename ของใบนี้) */
  filename: string;
  sending: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

export default function SendWhtCertificateEmailModal({
  cert,
  recipientEmail,
  companyName,
  filename,
  sending,
  error,
  onConfirm,
  onClose,
}: SendWhtCertificateEmailModalProps) {
  const { subject, text } = buildWhtCertificateEmailContent(cert.cert_number, cert.payee_name, companyName);

  // ซ่อนประวัติไว้ก่อนโดยดีฟอลต์ — คนส่วนใหญ่เปิดหน้าต่างนี้มาเพื่อกดยืนยัน ไม่ใช่มาอ่านประวัติ ถ้ากางไว้
  // ตลอดปุ่มยืนยันจะถูกดันลงไปพ้นจอบนหน้าจอเตี้ยๆ ยกเว้นใบที่เคยส่งแล้ว ซึ่งเป็นกรณีที่ประวัติสำคัญจริง
  const [showLogs, setShowLogs] = useState(Boolean(cert.email_sent_at));

  const {
    data: logs = [],
    error: logsErrorObj,
    isLoading: logsLoading,
  } = useSWR<WhtSendLog[]>(showLogs ? [WHT_SEND_LOGS_SWR_KEY, cert.id] : null, () => fetchWhtSendLogs(cert.id));
  const logsError = logsErrorObj ? 'โหลดประวัติการส่งไม่สำเร็จ' : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => (sending ? null : onClose())}
      role="dialog"
      aria-modal="true"
      aria-label="ยืนยันส่งอีเมลใบหัก ณ ที่จ่าย"
      data-testid="wht-cert-send-confirm-dialog"
    >
      <div
        className="card-surface card-surface-modal max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-card-bg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="flex items-center gap-2 text-base font-bold text-text">
          <Mail size={18} aria-hidden="true" />
          ยืนยันส่งอีเมลใบหัก ณ ที่จ่าย
        </h3>
        <p className="mt-1 text-sm text-text-sub">ตรวจทานก่อนกดยืนยัน — อีเมลที่ส่งออกไปแล้วเรียกคืนไม่ได้</p>

        {/* เคยส่งไปแล้ว: เตือนแต่ไม่ห้าม การส่งซ้ำเป็นเรื่องปกติ (ผู้รับทำไฟล์หาย/แจ้งว่าไม่ได้รับ) แค่ต้องไม่
            เผลอกดซ้ำโดยไม่รู้ตัวว่าเคยส่งไปแล้ว */}
        {cert.email_sent_at && (
          <p
            className="mt-4 flex items-start gap-2 rounded-[10px] border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-text"
            data-testid="wht-cert-send-already-sent-warning"
          >
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              ใบนี้เคยส่งไปแล้วเมื่อ {formatDateTime(cert.email_sent_at)}
              {cert.email_sent_to ? ` ถึง ${cert.email_sent_to}` : ''} — กดยืนยันจะเป็นการส่งซ้ำอีกครั้ง
            </span>
          </p>
        )}

        <dl className="mt-4 space-y-3 rounded-[10px] border border-border bg-page-bg/40 p-4 text-sm">
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 font-medium text-text-sub">ผู้รับ</dt>
            <dd className="min-w-0 break-words text-text" data-testid="wht-cert-send-recipient">
              {recipientEmail}
              <span className="block text-xs text-text-sub">{cert.payee_name}</span>
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 font-medium text-text-sub">หัวข้อ</dt>
            <dd className="min-w-0 break-words text-text">{subject}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 font-medium text-text-sub">เนื้อหา</dt>
            {/* whitespace-pre-line ให้ขึ้นบรรทัดตามข้อความจริงที่ประกอบไว้ ไม่ใช่ย่อหน้าเดียวยาวๆ */}
            <dd className="min-w-0 whitespace-pre-line break-words text-text-sub">{text}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 font-medium text-text-sub">ไฟล์แนบ</dt>
            <dd className="flex min-w-0 items-start gap-1.5 break-all text-text-sub">
              <Paperclip size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              {filename}
            </dd>
          </div>
        </dl>

        {/* ประวัติการส่ง — โหลดเฉพาะตอนกางออกดูจริง (SWR key เป็น null ตอนพับอยู่) */}
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowLogs((v) => !v)}
            className="btn-press text-sm font-medium text-text-sub underline-offset-2 hover:underline"
            data-testid="wht-cert-send-logs-toggle"
            aria-expanded={showLogs}
          >
            {showLogs ? 'ซ่อนประวัติการส่ง' : 'ดูประวัติการส่งของใบนี้'}
          </button>

          {showLogs && (
            <div className="mt-2 rounded-[10px] border border-border" data-testid="wht-cert-send-logs">
              {logsError ? (
                <p className="px-3 py-3 text-sm text-danger">{logsError}</p>
              ) : logsLoading ? (
                <p className="px-3 py-3 text-sm text-text-sub">กำลังโหลดประวัติ...</p>
              ) : logs.length === 0 ? (
                <p className="px-3 py-3 text-sm text-text-sub">ยังไม่เคยกดส่งใบนี้</p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {logs.map((log) => (
                    <li key={log.id} className="px-3 py-2.5 text-sm" data-testid={`wht-cert-send-log-${log.id}`}>
                      <div className="flex items-start gap-2">
                        {log.status === 'success' ? (
                          <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-green-600" aria-hidden="true" />
                        ) : (
                          <XCircle size={15} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
                        )}
                        <div className="min-w-0">
                          <p className="text-text">
                            {log.status === 'success' ? 'ส่งสำเร็จ' : describeFailure(log)}
                            {log.sent_to ? <span className="text-text-sub"> → {log.sent_to}</span> : null}
                          </p>
                          <p className="text-xs text-text-sub">
                            {formatDateTime(log.created_at)}
                            {log.actor_email ? ` · ${log.actor_email}` : ''}
                          </p>
                          {/* ข้อความดิบจาก SMTP — ซ่อนไว้ใน details เพราะเป็นภาษาอังกฤษเชิงเทคนิค ผู้ใช้ทั่วไป
                              ไม่ต้องอ่าน แต่ผู้ดูแลระบบต้องใช้ไล่ปัญหาโดยไม่ต้องเข้าไปดู log ที่เซิร์ฟเวอร์ */}
                          {log.error_message && (
                            <details className="mt-1">
                              <summary className="cursor-pointer text-xs text-text-sub/70">รายละเอียดทางเทคนิค</summary>
                              <p className="mt-1 break-words font-mono text-xs text-text-sub">{log.error_message}</p>
                            </details>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-[10px] border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2.5">
          <button
            type="button"
            disabled={sending}
            onClick={onClose}
            className="btn-press rounded-[10px] border border-border bg-card-bg px-4 py-2.5 text-sm font-medium text-text-sub hover:bg-page-bg disabled:opacity-60"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={sending}
            onClick={onConfirm}
            className="btn-press rounded-[10px] bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary shadow-sm hover:bg-primary/90 disabled:opacity-60"
            data-testid="confirm-wht-cert-send"
          >
            {sending ? 'กำลังส่ง...' : cert.email_sent_at ? 'ยืนยันส่งซ้ำ' : 'ยืนยันส่งอีเมล'}
          </button>
        </div>
      </div>
    </div>
  );
}
