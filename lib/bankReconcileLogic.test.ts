import { describe, expect, it } from 'vitest';
import { reconcileTransactions, round2 } from './bankReconcileLogic';
import type { BankTransaction, GLTransaction } from '@/types/bankReconcile';

function bank(id: string, date: string, type: 'receive' | 'payment', amount: number): BankTransaction {
  return { id, date, type, amount };
}

function gl(id: string, documentNo: string, date: string, type: 'receive' | 'payment', amount: number): GLTransaction {
  return { id, documentNo, date, type, amount };
}

describe('round2', () => {
  it('ปัดเศษทศนิยม 2 ตำแหน่ง และแก้ปัญหา floating point คลาดเคลื่อน', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(100.005)).toBeCloseTo(100.01, 2);
    expect(round2(1000)).toBe(1000);
  });
});

describe('reconcileTransactions — กติกาพื้นฐาน', () => {
  it('จับคู่ได้เมื่อวันที่ตรงกัน ประเภทตรงกัน จำนวนเงินเท่ากันเป๊ะ', () => {
    const bankRows = [bank('b1', '2026-07-01', 'receive', 1000)];
    const glRows = [gl('g1', 'DOC-001', '2026-07-01', 'receive', 1000)];
    const result = reconcileTransactions(bankRows, glRows, 1);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].bank.id).toBe('b1');
    expect(result.matched[0].gl.id).toBe('g1');
    expect(result.bankUnmatched).toHaveLength(0);
    expect(result.glUnmatched).toHaveLength(0);
    expect(result.summary).toEqual({
      bankCount: 1,
      glCount: 1,
      matchedCount: 1,
      bankUnmatchedCount: 0,
      glUnmatchedCount: 0,
    });
  });

  it('ไม่จับคู่ receive กับ payment แม้วันที่และจำนวนเงินจะตรงกันเป๊ะ', () => {
    const bankRows = [bank('b1', '2026-07-01', 'receive', 1000)];
    const glRows = [gl('g1', 'DOC-001', '2026-07-01', 'payment', 1000)];
    const result = reconcileTransactions(bankRows, glRows, 3);
    expect(result.matched).toHaveLength(0);
    expect(result.bankUnmatched).toHaveLength(1);
    expect(result.glUnmatched).toHaveLength(1);
  });

  it('ไม่จับคู่เมื่อจำนวนเงินไม่เท่ากัน แม้จะใกล้เคียงกันมาก', () => {
    const bankRows = [bank('b1', '2026-07-01', 'receive', 1000)];
    const glRows = [gl('g1', 'DOC-001', '2026-07-01', 'receive', 1000.01)];
    const result = reconcileTransactions(bankRows, glRows, 3);
    expect(result.matched).toHaveLength(0);
  });

  it('จับคู่ payment กับ payment ได้ปกติเช่นเดียวกับ receive', () => {
    const bankRows = [bank('b1', '2026-07-05', 'payment', 500)];
    const glRows = [gl('g1', 'DOC-002', '2026-07-05', 'payment', 500)];
    const result = reconcileTransactions(bankRows, glRows, 1);
    expect(result.matched).toHaveLength(1);
  });
});

describe('reconcileTransactions — ช่วงวันที่ที่ยอมรับได้ (tolerance)', () => {
  it('tolerance = 1: จับคู่ได้เมื่อห่างกัน 1 วัน', () => {
    const bankRows = [bank('b1', '2026-07-01', 'receive', 1000)];
    const glRows = [gl('g1', 'DOC-001', '2026-07-02', 'receive', 1000)];
    const result = reconcileTransactions(bankRows, glRows, 1);
    expect(result.matched).toHaveLength(1);
  });

  it('tolerance = 1: ไม่จับคู่เมื่อห่างกัน 2 วัน', () => {
    const bankRows = [bank('b1', '2026-07-01', 'receive', 1000)];
    const glRows = [gl('g1', 'DOC-001', '2026-07-03', 'receive', 1000)];
    const result = reconcileTransactions(bankRows, glRows, 1);
    expect(result.matched).toHaveLength(0);
  });

  it('tolerance = 3: จับคู่ได้เมื่อห่างกัน 3 วันพอดี (ขอบเขตรวม)', () => {
    const bankRows = [bank('b1', '2026-07-01', 'receive', 1000)];
    const glRows = [gl('g1', 'DOC-001', '2026-07-04', 'receive', 1000)];
    const result = reconcileTransactions(bankRows, glRows, 3);
    expect(result.matched).toHaveLength(1);
  });

  it('tolerance = 3: ไม่จับคู่เมื่อห่างกัน 4 วัน', () => {
    const bankRows = [bank('b1', '2026-07-01', 'receive', 1000)];
    const glRows = [gl('g1', 'DOC-001', '2026-07-05', 'receive', 1000)];
    const result = reconcileTransactions(bankRows, glRows, 3);
    expect(result.matched).toHaveLength(0);
  });

  it('รองรับ GL ที่วันที่มาก่อน Bank ด้วย (ค่าสัมบูรณ์ ไม่ใช่แค่ทิศทางเดียว)', () => {
    const bankRows = [bank('b1', '2026-07-05', 'receive', 1000)];
    const glRows = [gl('g1', 'DOC-001', '2026-07-04', 'receive', 1000)];
    const result = reconcileTransactions(bankRows, glRows, 1);
    expect(result.matched).toHaveLength(1);
  });
});

describe('reconcileTransactions — priority เมื่อมีหลายผู้สมัคร', () => {
  it('เลือกวันที่ตรงกันเป๊ะก่อนเสมอ แม้ผู้สมัครที่ห่าง 1 วันจะอยู่ในลิสต์ก่อนก็ตาม', () => {
    const bankRows = [bank('b1', '2026-07-05', 'receive', 1000)];
    const glRows = [
      gl('g1', 'DOC-NEAR', '2026-07-04', 'receive', 1000), // ห่าง 1 วัน อยู่ก่อนในไฟล์
      gl('g2', 'DOC-EXACT', '2026-07-05', 'receive', 1000), // ตรงเป๊ะ อยู่หลังในไฟล์
    ];
    const result = reconcileTransactions(bankRows, glRows, 3);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].gl.id).toBe('g2');
    expect(result.glUnmatched.map((g) => g.id)).toEqual(['g1']);
  });

  it('เลือกวันที่ใกล้ที่สุดเมื่อไม่มีวันที่ตรงเป๊ะ', () => {
    const bankRows = [bank('b1', '2026-07-05', 'receive', 1000)];
    const glRows = [
      gl('g1', 'DOC-FAR', '2026-07-08', 'receive', 1000), // ห่าง 3 วัน
      gl('g2', 'DOC-NEAR', '2026-07-06', 'receive', 1000), // ห่าง 1 วัน — ควรถูกเลือก
    ];
    const result = reconcileTransactions(bankRows, glRows, 3);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].gl.id).toBe('g2');
  });

  it('เมื่อระยะห่างวันที่เท่ากัน เลือกแถวที่ยังไม่ถูกใช้ตัวแรกสุดตามลำดับเดิมในไฟล์ GL', () => {
    const bankRows = [bank('b1', '2026-07-05', 'receive', 1000)];
    const glRows = [
      gl('g1', 'DOC-FIRST', '2026-07-06', 'receive', 1000), // ห่าง 1 วัน มาก่อนในไฟล์
      gl('g2', 'DOC-SECOND', '2026-07-04', 'receive', 1000), // ห่าง 1 วัน มาทีหลังในไฟล์
    ];
    const result = reconcileTransactions(bankRows, glRows, 3);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].gl.id).toBe('g1');
  });

  it('แถว GL แต่ละแถวถูกใช้ได้แค่ครั้งเดียว — Bank แถวที่สองที่แข่งกันแย่ง GL ตัวเดียวกันจะไม่ได้คู่', () => {
    const bankRows = [bank('b1', '2026-07-01', 'receive', 1000), bank('b2', '2026-07-01', 'receive', 1000)];
    const glRows = [gl('g1', 'DOC-001', '2026-07-01', 'receive', 1000)];
    const result = reconcileTransactions(bankRows, glRows, 1);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].bank.id).toBe('b1'); // ประมวลผลตามลำดับเดิมในไฟล์ Bank — แถวแรกได้คู่ก่อน
    expect(result.bankUnmatched.map((b) => b.id)).toEqual(['b2']);
  });

  it('ไม่รองรับ 1 Bank จับคู่กับหลาย GL (strictly 1:1) — GL ที่เหลือไปอยู่ใน glUnmatched', () => {
    const bankRows = [bank('b1', '2026-07-01', 'receive', 1000)];
    const glRows = [
      gl('g1', 'DOC-001', '2026-07-01', 'receive', 1000),
      gl('g2', 'DOC-002', '2026-07-01', 'receive', 1000),
    ];
    const result = reconcileTransactions(bankRows, glRows, 1);
    expect(result.matched).toHaveLength(1);
    expect(result.glUnmatched).toHaveLength(1);
  });
});

describe('reconcileTransactions — summary และ edge cases', () => {
  it('คืนค่า summary ที่ถูกต้องเมื่อมีทั้งจับคู่สำเร็จและไม่สำเร็จปนกัน', () => {
    const bankRows = [
      bank('b1', '2026-07-01', 'receive', 1000), // จับคู่กับ g1
      bank('b2', '2026-07-02', 'payment', 200), // ไม่พบคู่
    ];
    const glRows = [
      gl('g1', 'DOC-001', '2026-07-01', 'receive', 1000),
      gl('g2', 'DOC-002', '2026-07-10', 'payment', 999), // ไม่พบคู่ (วันที่/จำนวนเงินไม่ตรงอะไรเลย)
    ];
    const result = reconcileTransactions(bankRows, glRows, 3);
    expect(result.summary).toEqual({
      bankCount: 2,
      glCount: 2,
      matchedCount: 1,
      bankUnmatchedCount: 1,
      glUnmatchedCount: 1,
    });
  });

  it('รองรับ array ว่างทั้งสองฝั่งโดยไม่ error', () => {
    const result = reconcileTransactions([], [], 1);
    expect(result.matched).toHaveLength(0);
    expect(result.summary).toEqual({
      bankCount: 0,
      glCount: 0,
      matchedCount: 0,
      bankUnmatchedCount: 0,
      glUnmatchedCount: 0,
    });
  });

  it('Bank มีรายการแต่ GL ว่าง — ทุกแถว Bank ไปอยู่ bankUnmatched ทั้งหมด', () => {
    const bankRows = [bank('b1', '2026-07-01', 'receive', 1000)];
    const result = reconcileTransactions(bankRows, [], 1);
    expect(result.bankUnmatched).toHaveLength(1);
    expect(result.matched).toHaveLength(0);
  });

  it('GL มีรายการแต่ Bank ว่าง — ทุกแถว GL ไปอยู่ glUnmatched ทั้งหมด', () => {
    const glRows = [gl('g1', 'DOC-001', '2026-07-01', 'receive', 1000)];
    const result = reconcileTransactions([], glRows, 1);
    expect(result.glUnmatched).toHaveLength(1);
    expect(result.matched).toHaveLength(0);
  });
});
