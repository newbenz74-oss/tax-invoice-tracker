import { describe, expect, it } from 'vitest';
import {
  amountsEqual,
  createManualMatchGroup,
  sumAmounts,
  validateManualMatch,
  wrapAutoMatchesAsGroups,
} from './bankReconcileManualMatch';
import type { BankTransaction, GLTransaction, MatchedPair } from '@/types/bankReconcile';

function bank(id: string, date: string, type: 'receive' | 'payment', amount: number): BankTransaction {
  return { id, date, type, amount };
}

function gl(id: string, documentNo: string, date: string, type: 'receive' | 'payment', amount: number): GLTransaction {
  return { id, documentNo, date, type, amount };
}

describe('sumAmounts', () => {
  it('รวมจำนวนเงินและปัดเศษ 2 ตำแหน่ง แก้ปัญหา floating point คลาดเคลื่อน', () => {
    expect(sumAmounts([{ amount: 0.1 }, { amount: 0.2 }])).toBe(0.3);
    expect(sumAmounts([{ amount: 100.1 }, { amount: 199.9 }])).toBe(300);
    expect(sumAmounts([])).toBe(0);
  });
});

describe('amountsEqual', () => {
  it('เทียบจำนวนเงินแบบ integer-cents ไม่ใช่ float === ตรงๆ', () => {
    expect(amountsEqual(0.1 + 0.2, 0.3)).toBe(true);
    expect(amountsEqual(300, 100.1 + 199.9)).toBe(true);
    expect(amountsEqual(100, 100.01)).toBe(false);
  });
});

describe('validateManualMatch', () => {
  it('canConfirm=false และ reason=empty-bank เมื่อยังไม่ติ๊กฝั่ง Bank เลย', () => {
    const result = validateManualMatch({ bankRows: [], glRows: [gl('g1', 'DOC-001', '2026-07-01', 'receive', 1000)] });
    expect(result.canConfirm).toBe(false);
    expect(result.reason).toBe('empty-bank');
    expect(result.glTotal).toBe(1000);
  });

  it('canConfirm=false และ reason=empty-gl เมื่อยังไม่ติ๊กฝั่ง GL เลย', () => {
    const result = validateManualMatch({ bankRows: [bank('b1', '2026-07-01', 'receive', 1000)], glRows: [] });
    expect(result.canConfirm).toBe(false);
    expect(result.reason).toBe('empty-gl');
    expect(result.bankTotal).toBe(1000);
  });

  it('canConfirm=false และ reason=type-mismatch เมื่อผสมรับกับจ่ายในกลุ่มเดียวกัน แม้ยอดรวมจะเท่ากัน', () => {
    const result = validateManualMatch({
      bankRows: [bank('b1', '2026-07-01', 'receive', 1000)],
      glRows: [gl('g1', 'DOC-001', '2026-07-01', 'payment', 1000)],
    });
    expect(result.canConfirm).toBe(false);
    expect(result.reason).toBe('type-mismatch');
  });

  it('canConfirm=false และ reason=amount-mismatch เมื่อยอดรวมสองฝั่งไม่เท่ากัน', () => {
    const result = validateManualMatch({
      bankRows: [bank('b1', '2026-07-01', 'receive', 1000)],
      glRows: [gl('g1', 'DOC-001', '2026-07-01', 'receive', 900)],
    });
    expect(result.canConfirm).toBe(false);
    expect(result.reason).toBe('amount-mismatch');
    expect(result.difference).toBe(100);
  });

  it('canConfirm=true เมื่อยอดรวมเท่ากันแบบ 1 ต่อ 1 ธรรมดา', () => {
    const result = validateManualMatch({
      bankRows: [bank('b1', '2026-07-01', 'receive', 1000)],
      glRows: [gl('g1', 'DOC-001', '2026-07-01', 'receive', 1000)],
    });
    expect(result.canConfirm).toBe(true);
    expect(result.reason).toBe('ok');
    expect(result.difference).toBe(0);
  });

  it('canConfirm=true แบบ N:1 — โอนออกจาก Bank หลายรายการ บันทึกใน GL ครั้งเดียว', () => {
    const result = validateManualMatch({
      bankRows: [bank('b1', '2026-07-01', 'payment', 300), bank('b2', '2026-07-02', 'payment', 200)],
      glRows: [gl('g1', 'DOC-001', '2026-07-03', 'payment', 500)],
    });
    expect(result.canConfirm).toBe(true);
    expect(result.bankTotal).toBe(500);
  });

  it('canConfirm=true แบบ 1:N — โอนออกจาก Bank ครั้งเดียว แต่บันทึกใน GL หลายรายการ', () => {
    const result = validateManualMatch({
      bankRows: [bank('b1', '2026-07-01', 'receive', 1500)],
      glRows: [
        gl('g1', 'DOC-001', '2026-07-01', 'receive', 1000),
        gl('g2', 'DOC-002', '2026-07-01', 'receive', 500),
      ],
    });
    expect(result.canConfirm).toBe(true);
  });

  it('canConfirm=true แบบ N:M — หลายรายการทั้งสองฝั่ง ตราบใดที่ผลรวมเท่ากัน', () => {
    const result = validateManualMatch({
      bankRows: [bank('b1', '2026-07-01', 'payment', 300), bank('b2', '2026-07-02', 'payment', 400)],
      glRows: [
        gl('g1', 'DOC-001', '2026-07-01', 'payment', 250),
        gl('g2', 'DOC-002', '2026-07-02', 'payment', 250),
        gl('g3', 'DOC-003', '2026-07-03', 'payment', 200),
      ],
    });
    expect(result.canConfirm).toBe(true);
    expect(result.bankTotal).toBe(700);
    expect(result.glTotal).toBe(700);
  });

  it('canConfirm=true เมื่อยอดรวมเท่ากันได้ก็ต่อเมื่อปัดเศษ floating point แล้วเท่านั้น (100.10 + 199.90)', () => {
    const result = validateManualMatch({
      bankRows: [bank('b1', '2026-07-01', 'receive', 100.1), bank('b2', '2026-07-02', 'receive', 199.9)],
      glRows: [gl('g1', 'DOC-001', '2026-07-01', 'receive', 300)],
    });
    expect(result.canConfirm).toBe(true);
    expect(result.reason).toBe('ok');
  });
});

describe('createManualMatchGroup', () => {
  it('สร้าง MatchGroup แบบ manual พร้อม groupId และ type ที่ถูกต้องเมื่อเงื่อนไขผ่านครบ', () => {
    const group = createManualMatchGroup({
      bankRows: [bank('b1', '2026-07-01', 'payment', 300), bank('b2', '2026-07-02', 'payment', 200)],
      glRows: [gl('g1', 'DOC-001', '2026-07-03', 'payment', 500)],
    });
    expect(group.matchType).toBe('manual');
    expect(group.type).toBe('payment');
    expect(group.bankRows).toHaveLength(2);
    expect(group.glRows).toHaveLength(1);
    expect(typeof group.groupId).toBe('string');
    expect(group.groupId.length).toBeGreaterThan(0);
  });

  it('สร้าง groupId ที่ไม่ซ้ำกันทุกครั้งที่เรียก', () => {
    const selection = {
      bankRows: [bank('b1', '2026-07-01', 'receive', 1000)],
      glRows: [gl('g1', 'DOC-001', '2026-07-01', 'receive', 1000)],
    };
    const first = createManualMatchGroup(selection);
    const second = createManualMatchGroup(selection);
    expect(first.groupId).not.toBe(second.groupId);
  });

  it('throw เมื่อเงื่อนไขยังไม่ผ่าน (กันกรณี UI เรียกผิดจังหวะ ไม่ใช่พึ่งพา disabled อย่างเดียว)', () => {
    expect(() =>
      createManualMatchGroup({
        bankRows: [bank('b1', '2026-07-01', 'receive', 1000)],
        glRows: [gl('g1', 'DOC-001', '2026-07-01', 'receive', 900)],
      })
    ).toThrow();
  });
});

describe('wrapAutoMatchesAsGroups', () => {
  it('แปลง MatchedPair[] เป็น MatchGroup[] แบบ 1:1 พร้อม matchType=auto', () => {
    const pairs: MatchedPair[] = [
      { bank: bank('b1', '2026-07-01', 'receive', 1000), gl: gl('g1', 'DOC-001', '2026-07-01', 'receive', 1000) },
      { bank: bank('b2', '2026-07-05', 'payment', 500), gl: gl('g2', 'DOC-002', '2026-07-05', 'payment', 500) },
    ];
    const groups = wrapAutoMatchesAsGroups(pairs);
    expect(groups).toHaveLength(2);
    expect(groups[0].matchType).toBe('auto');
    expect(groups[0].type).toBe('receive');
    expect(groups[0].bankRows).toEqual([pairs[0].bank]);
    expect(groups[0].glRows).toEqual([pairs[0].gl]);
    expect(groups[1].type).toBe('payment');
    // groupId ต้องไม่ซ้ำกันระหว่างสอง group
    expect(groups[0].groupId).not.toBe(groups[1].groupId);
  });

  it('คืน array ว่างเมื่อไม่มีคู่ที่จับคู่สำเร็จเลย', () => {
    expect(wrapAutoMatchesAsGroups([])).toEqual([]);
  });
});
