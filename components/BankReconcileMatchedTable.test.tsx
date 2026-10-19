import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import BankReconcileMatchedTable from './BankReconcileMatchedTable';
import type { MatchGroup } from '@/types/bankReconcileMatch';

const groups: MatchGroup[] = [
  { groupId: 'g1', matchType: 'auto', type: 'payment',
    bankRows: [{ id: 'b1', date: '2026-09-30', type: 'payment', amount: 60000, description: 'โอนไป SCB x5355 บริษัท ไอ วาน่า จำกัด' }],
    glRows: [{ id: 'x1', documentNo: 'PV690930025', date: '2026-09-30', type: 'payment', amount: 60000 }] },
  { groupId: 'g2', matchType: 'manual', type: 'payment',
    bankRows: [{ id: 'b2', date: '2026-09-30', type: 'payment', amount: 1000 }, { id: 'b3', date: '2026-09-30', type: 'payment', amount: 500 }],
    glRows: [{ id: 'x2', documentNo: 'PV001', date: '2026-09-30', type: 'payment', amount: 1500 }] },
];

/** นับจำนวนคอลัมน์จริงของแต่ละแถว โดยคิด colspan และ rowspan ด้วย (เซลล์ rowspan=2 ในแถวก่อนหน้ากินที่
 * ในแถวถัดไปอีกหนึ่งช่องเสมอ — ถ้าไม่คิดตรงนี้แถวหัวตารางบรรทัดที่สองจะดูเหมือนขาดคอลัมน์ทั้งที่ถูกต้อง) */
function cellCounts(html: string): number[] {
  const rows = html.split('<tr').slice(1);
  const counts: number[] = [];
  let carry = 0;
  for (const r of rows) {
    let n = carry;
    for (const m of r.matchAll(/<t[dh][ >]/g)) { void m; n++; }
    for (const m of r.matchAll(/colspan="(\d+)"/gi)) n += Number(m[1]) - 1;
    counts.push(n);
    carry = [...r.matchAll(/rowspan="(\d+)"/gi)].length;
  }
  return counts;
}

/* ตารางนี้มีหัวตาราง 2 ชั้น (colspan/rowspan) + แถวสรุปอีก 2 บรรทัด ทำให้ "เพิ่มคอลัมน์หนึ่งช่อง" ต้องไล่แก้
   ถึง 5 จุดพร้อมกัน พลาดจุดเดียวตารางจะเหลื่อมทั้งตารางโดย TypeScript จับไม่ได้เลย เทสต์ชุดนี้จึงเรนเดอร์จริง
   แล้วนับจำนวนคอลัมน์ของทุกแถวให้ตรงกันหมด (เพิ่มตอนเพิ่มคอลัมน์คำอธิบาย + ปุ่มยกเลิกจับคู่ 2026-10-19) */
describe('โครงสร้างตารางกระทบยอดสำเร็จ', () => {
  it('ทุกแถวมีจำนวนคอลัมน์เท่ากันเมื่อมีปุ่มยกเลิกจับคู่', () => {
    const html = renderToStaticMarkup(<BankReconcileMatchedTable groups={groups} onUnmatch={() => {}} />);
    const counts = cellCounts(html);
    expect(counts, `จำนวนคอลัมน์แต่ละแถว: ${counts.join(',')}`).toEqual(counts.map(() => 12));
  });

  it('ทุกแถวมีจำนวนคอลัมน์เท่ากันเมื่อไม่มีปุ่ม', () => {
    const html = renderToStaticMarkup(<BankReconcileMatchedTable groups={groups} />);
    const counts = cellCounts(html);
    expect(counts, `จำนวนคอลัมน์แต่ละแถว: ${counts.join(',')}`).toEqual(counts.map(() => 11));
  });

  it('แสดงคำอธิบายฝั่ง Bank และมีปุ่มยกเลิกจับคู่ครบทุกกลุ่ม', () => {
    const html = renderToStaticMarkup(<BankReconcileMatchedTable groups={groups} onUnmatch={() => {}} />);
    expect(html).toContain('คำอธิบาย');
    expect(html).toContain('ไอ วาน่า');
    expect(html).toContain('matched-row-unmatch-g1');
    expect(html).toContain('matched-row-unmatch-g2');
  });
});

/* เคสจริง 2026-10-19: Bank จ่าย 233,500.00 + รับคืน 839.10 คู่กับ GL จ่าย 232,660.90 รายการเดียว
   ตารางต้องแสดง "ยอดสุทธิ" ไม่ใช่ผลรวมดิบ 234,339.10 ซึ่งไม่ตรงกับฝั่ง GL และไม่ตรงกับเงินที่จ่ายจริง */
describe('แถวจับคู่แบบยอดสุทธิ', () => {
  const netGroup: MatchGroup[] = [
    {
      groupId: 'net-1',
      matchType: 'manual',
      type: 'payment',
      bankRows: [
        { id: 'b1', date: '2026-09-29', type: 'payment', amount: 233500, description: 'โอนไป SCB x3726' },
        { id: 'b2', date: '2026-09-29', type: 'receive', amount: 839.1, description: 'รับโอนจาก SCB x3726' },
      ],
      glRows: [{ id: 'x1', documentNo: 'PV690929001', date: '2026-09-29', type: 'payment', amount: 232660.9 }],
    },
  ];

  it('แสดงยอดสุทธิ 232,660.90 ไม่ใช่ผลรวมดิบ 234,339.10', () => {
    const html = renderToStaticMarkup(<BankReconcileMatchedTable groups={netGroup} onUnmatch={() => {}} />);
    expect(html).toContain('232,660.90');
    expect(html).not.toContain('234,339.10');
  });

  it('ขึ้นป้าย "สุทธิ" ให้เห็นว่าเป็นยอดหลังหักกลบ', () => {
    const html = renderToStaticMarkup(<BankReconcileMatchedTable groups={netGroup} onUnmatch={() => {}} />);
    expect(html).toContain('matched-row-net-net-1');
  });

  it('กลุ่มปกติไม่ขึ้นป้าย "สุทธิ" และยังแสดงผลรวมดิบเหมือนเดิม', () => {
    const html = renderToStaticMarkup(<BankReconcileMatchedTable groups={groups} onUnmatch={() => {}} />);
    expect(html).not.toContain('matched-row-net-');
    expect(html).toContain('60,000.00');
  });

  it('จำนวนคอลัมน์ยังเท่ากันทุกแถว', () => {
    const html = renderToStaticMarkup(<BankReconcileMatchedTable groups={netGroup} onUnmatch={() => {}} />);
    const counts = cellCounts(html);
    expect(counts, `จำนวนคอลัมน์แต่ละแถว: ${counts.join(',')}`).toEqual(counts.map(() => 12));
  });
});
