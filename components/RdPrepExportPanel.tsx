'use client';

import { useMemo, useState } from 'react';
import { Download, FileWarning } from 'lucide-react';
import {
  buildRdPrepFile,
  findRdPrepIssues,
  selectCertsForRdPrep,
  type RdPrepIssue,
} from '@/lib/rdPrepExport';
import { downloadBlob } from '@/lib/reportExport';
import { thaiMonthName } from '@/lib/thaiDate';
import type { WhtCertificate, WhtFormType } from '@/types/whtCertificate';

/* ==============================================================================================
 * แผง "ไฟล์ยื่นสรรพากร (RD Prep)" ในหน้าประวัติใบหัก ณ ที่จ่าย
 *
 * ผู้ใช้ขอ 2026-10-11: "ใบหัก ณ ที่จ่าย เมื่อฉันออกเอกสารครบแล้ว ฉันต้องการไฟล์เพื่อไปใส่ใน RD prep"
 *
 * ========================= เรื่องสำคัญที่ต่างจากตารางด้านล่าง =========================
 * ตารางประวัติกรองด้วย period_month/period_year = "เดือนที่ออกใบ" (เดือนของชุดเลขที่ใบ)
 * แต่ไฟล์นี้กรองด้วย **เดือนของวันที่จ่ายเงิน (payment_date)** เพราะ ภ.ง.ด.3/53 ยื่นตามเดือนที่จ่ายเงินจริง
 * ตามประมวลรัษฎากร ไม่ใช่เดือนที่พิมพ์ใบ
 *
 * ปกติสองค่านี้ตรงกัน (ออกใบตอนจ่ายเงิน) แต่ถ้าไม่ตรงจำนวนฉบับจะต่างจากตาราง — แผงนี้จึงแสดงจำนวนฉบับที่จะ
 * เข้าไฟล์ให้เห็นชัดๆ และขึ้นหมายเหตุเตือนเมื่อไม่เท่ากับจำนวนในตาราง เพื่อไม่ให้ผู้ใช้ยื่นขาด/ยื่นเกินโดย
 * ไม่รู้ตัว
 * ============================================================================================ */

const FORM_LABELS: Record<WhtFormType, string> = {
  '03': 'ภ.ง.ด.3 (บุคคลธรรมดา)',
  '53': 'ภ.ง.ด.53 (นิติบุคคล)',
};

interface Props {
  /** ใบทั้งหมดของบริษัทที่เลือก (ยังไม่กรองเดือน/สถานะ — แผงนี้กรองเอง) */
  certificates: WhtCertificate[];
  /** ปี พ.ศ. และเดือนที่ผู้ใช้เลือกไว้ด้านบน */
  periodYearBuddhist: number;
  periodMonth: number;
  /** จำนวนฉบับที่ตารางด้านล่างกำลังแสดง — ใช้เทียบเพื่อเตือนเมื่อไม่ตรงกับไฟล์ */
  tableRowCount: number;
  /** แบบที่ผู้ใช้เลือกอยู่ — ใช้แค่ไฮไลต์การ์ดที่ตรงกัน ไฟล์ยังสร้างได้ทั้งสองแบบเสมอ */
  selectedFormType: WhtFormType;
}

const BUDDHIST_YEAR_OFFSET = 543;

export default function RdPrepExportPanel({
  certificates,
  periodYearBuddhist,
  periodMonth,
  tableRowCount,
  selectedFormType,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  // ตัวกรองในระบบเก็บปีเป็น พ.ศ. แต่ payment_date ในฐานข้อมูลเป็น ISO ค.ศ. — แปลงที่จุดเดียวตรงนี้
  const gregorianYear = periodYearBuddhist - BUDDHIST_YEAR_OFFSET;

  const groups = useMemo(() => {
    return (['03', '53'] as WhtFormType[]).map((formType) => {
      const certs = selectCertsForRdPrep(certificates, formType, gregorianYear, periodMonth);
      return { formType, certs, issues: findRdPrepIssues(certs) };
    });
  }, [certificates, gregorianYear, periodMonth]);

  const totalRows = groups.reduce((sum, g) => sum + g.certs.length, 0);
  const allIssues = groups.flatMap((g) => g.issues);
  const blockingIssues = allIssues.filter((i) => !i.warningOnly);

  function handleDownload(formType: WhtFormType, certs: WhtCertificate[]) {
    setError(null);
    try {
      const file = buildRdPrepFile(certs, formType, gregorianYear, periodMonth);
      // ต้องเป็น application/octet-stream — ถ้าใส่ text/plain เบราว์เซอร์บางตัวจะเดา charset แล้วแก้ไบต์ให้
      // ซึ่งจะทำลายการเข้ารหัส TIS-620 ที่ RD Prep ต้องอ่านได้
      downloadBlob(new Blob([file.bytes as BlobPart], { type: 'application/octet-stream' }), file.filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'สร้างไฟล์ไม่สำเร็จ');
    }
  }

  return (
    <section className="card-surface mb-6 rounded-2xl p-5" data-testid="rdprep-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-text">ไฟล์ยื่นสรรพากร (RD Prep)</h2>
          <p className="mt-1 text-sm text-text-sub">
            ไฟล์ .TXT สำหรับนำเข้าโปรแกรม RD Prep — แยกตามแบบ นับจาก{' '}
            <span className="font-medium text-text">วันที่จ่ายเงิน</span> ในเดือน {thaiMonthName(periodMonth)}{' '}
            {periodYearBuddhist} และใช้ยอดก่อน VAT เป็นฐานภาษี
          </p>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-[10px] border border-danger/20 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {groups.map(({ formType, certs, issues }) => {
          const blocking = issues.filter((i) => !i.warningOnly).length;
          const isSelected = formType === selectedFormType;
          return (
            <div
              key={formType}
              className={`rounded-xl border p-3.5 ${isSelected ? 'border-primary/40 bg-primary/5' : 'border-border bg-page-bg/40'}`}
            >
              <p className="text-sm font-medium text-text">{FORM_LABELS[formType]}</p>
              <p className="font-numeric mt-0.5 text-sm text-text-sub">{certs.length} ฉบับ</p>
              <button
                type="button"
                disabled={certs.length === 0}
                onClick={() => handleDownload(formType, certs)}
                className="btn-press mt-2.5 inline-flex items-center gap-1.5 rounded-[10px] border border-border px-3 py-2 text-xs font-medium text-text-sub hover:bg-card-bg disabled:cursor-not-allowed disabled:opacity-40"
                data-testid={`rdprep-download-${formType}`}
              >
                <Download size={14} aria-hidden="true" />
                {certs.length === 0 ? 'ไม่มีใบในเดือนนี้' : 'ดาวน์โหลดไฟล์'}
              </button>
              {blocking > 0 && (
                <p className="mt-2 text-xs text-danger">ข้อมูลไม่ครบ {blocking} รายการ (ดูด้านล่าง)</p>
              )}
            </div>
          );
        })}
      </div>

      {/* เตือนเมื่อจำนวนในไฟล์ไม่เท่ากับจำนวนในตาราง — เกิดได้เมื่อเดือนที่ออกใบ ≠ เดือนที่จ่ายเงิน
          ไม่ได้ปิดกั้นการดาวน์โหลด เพราะไฟล์ที่ยึดวันจ่ายเงินคือไฟล์ที่ถูกต้องตามกฎหมาย */}
      {totalRows !== tableRowCount && (
        <p className="mt-3 rounded-[10px] border border-warning/25 bg-warning/10 px-3.5 py-2.5 text-xs text-text-sub">
          จำนวนในไฟล์ ({totalRows} ฉบับ) ไม่เท่ากับในตารางด้านล่าง ({tableRowCount} ฉบับ) เพราะไฟล์นับตาม
          “วันที่จ่ายเงิน” ส่วนตารางนับตาม “เดือนที่ออกใบ” — ถ้าตัวเลขควรตรงกัน ให้ตรวจวันที่จ่ายเงินของใบในเดือนนี้
        </p>
      )}

      {allIssues.length > 0 && (
        <div className="mt-4" data-testid="rdprep-issues">
          <p className="flex items-center gap-1.5 text-sm font-medium text-text">
            <FileWarning size={15} aria-hidden="true" />
            ตรวจพบข้อมูลที่ควรแก้ก่อนยื่น ({allIssues.length})
          </p>
          {blockingIssues.length > 0 && (
            <p className="mt-1 text-xs text-danger">
              {blockingIssues.length} รายการร้ายแรงพอที่สรรพากรจะไม่รับ — ควรแก้ก่อนยื่น
            </p>
          )}
          <ul className="mt-2 space-y-1.5">
            {allIssues.map((issue, index) => (
              <IssueRow key={`${issue.certNumber}-${index}`} issue={issue} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function IssueRow({ issue }: { issue: RdPrepIssue }) {
  return (
    <li
      className={`rounded-[10px] border px-3 py-2 text-xs ${
        issue.warningOnly ? 'border-warning/25 bg-warning/10 text-text-sub' : 'border-danger/20 bg-danger/10 text-danger'
      }`}
    >
      <span className="font-numeric font-medium">{issue.certNumber}</span>
      <span className="mx-1.5 text-text-sub">·</span>
      <span>{issue.payeeName}</span>
      <span className="mx-1.5 text-text-sub">—</span>
      <span>{issue.problem}</span>
    </li>
  );
}
