import { describe, expect, it } from 'vitest';
import {
  createSuggestedMatchGroup,
  dropSuggestionsUsingRows,
  findCombinationSuggestions,
  MIN_COMBINATION_MEMBER_AMOUNT,
  DEFAULT_COMBINATION_STEP_BUDGET,
} from './bankReconcileCombinationMatch';
import type { BankTransaction, GLTransaction } from '@/types/bankReconcile';

function bank(id: string, date: string, type: 'receive' | 'payment', amount: number): BankTransaction {
  return { id, date, type, amount };
}

function gl(id: string, documentNo: string, date: string, type: 'receive' | 'payment', amount: number): GLTransaction {
  return { id, documentNo, date, type, amount };
}

/** ย่อการอ่านผลลัพธ์ในเทสต์ให้เหลือแค่ "ฝั่งไหนเป็นแถวเดี่ยว + id ของแถวทั้งสองฝั่ง" */
function shape(result: ReturnType<typeof findCombinationSuggestions>) {
  return result.suggestions.map((item) => ({
    anchorSide: item.anchorSide,
    bank: item.bankRows.map((row) => row.id),
    gl: item.glRows.map((row) => row.id),
    amount: item.amount,
  }));
}

describe('findCombinationSuggestions — กติกาหลักตามที่ผู้ใช้ระบุ', () => {
  it('Bank 1,500 ↔ GL 1,000 + 500 — เคสตัวอย่างที่ผู้ใช้ยกมาเองตรงๆ ต้องเสนอให้', () => {
    const result = findCombinationSuggestions(
      [bank('b1', '2026-07-10', 'receive', 1500)],
      [gl('g1', 'DOC-001', '2026-07-10', 'receive', 1000), gl('g2', 'DOC-002', '2026-07-10', 'receive', 500)],
      1
    );
    expect(shape(result)).toEqual([{ anchorSide: 'bank', bank: ['b1'], gl: ['g1', 'g2'], amount: 1500 }]);
    expect(result.suggestions[0].dateSpread).toBe(0);
    expect(result.budgetExhausted).toBe(false);
  });

  it('ไม่เสนอ 1,450 + 50 = 1,500 เพราะ 50 ต่ำกว่า 100 — เคสที่ผู้ใช้ห้ามไว้ชัดเจน', () => {
    const result = findCombinationSuggestions(
      [bank('b1', '2026-07-10', 'receive', 1500)],
      [gl('g1', 'DOC-001', '2026-07-10', 'receive', 1450), gl('g2', 'DOC-002', '2026-07-10', 'receive', 50)],
      1
    );
    expect(result.suggestions).toEqual([]);
  });

  it('100.00 พอดียังใช้ได้ (เพดานเป็น ">= 100" ไม่ใช่ "> 100") แต่ 99.99 ใช้ไม่ได้', () => {
    const ok = findCombinationSuggestions(
      [bank('b1', '2026-07-10', 'payment', 1100)],
      [gl('g1', 'DOC-001', '2026-07-10', 'payment', 1000), gl('g2', 'DOC-002', '2026-07-10', 'payment', 100)],
      1
    );
    expect(shape(ok)).toEqual([{ anchorSide: 'bank', bank: ['b1'], gl: ['g1', 'g2'], amount: 1100 }]);

    const notOk = findCombinationSuggestions(
      [bank('b1', '2026-07-10', 'payment', 1099.99)],
      [gl('g1', 'DOC-001', '2026-07-10', 'payment', 1000), gl('g2', 'DOC-002', '2026-07-10', 'payment', 99.99)],
      1
    );
    expect(notOk.suggestions).toEqual([]);
    expect(MIN_COMBINATION_MEMBER_AMOUNT).toBe(100);
  });

  it('ทิศทางที่สอง: GL 1 แถว ↔ Bank หลายแถว', () => {
    const result = findCombinationSuggestions(
      [bank('b1', '2026-07-10', 'receive', 1000), bank('b2', '2026-07-11', 'receive', 500)],
      [gl('g1', 'DOC-001', '2026-07-10', 'receive', 1500)],
      1
    );
    expect(shape(result)).toEqual([{ anchorSide: 'gl', bank: ['b1', 'b2'], gl: ['g1'], amount: 1500 }]);
    expect(result.suggestions[0].dateSpread).toBe(1);
  });

  it('รวมได้มากกว่า 2 แถว ไม่มีเพดานจำนวนแถวคงที่ (เคสนี้ต้องใช้ 4 แถวจึงจะพอดี)', () => {
    const result = findCombinationSuggestions(
      [bank('b1', '2026-07-10', 'payment', 1000)],
      [
        gl('g1', 'DOC-001', '2026-07-10', 'payment', 400),
        gl('g2', 'DOC-002', '2026-07-10', 'payment', 250),
        gl('g3', 'DOC-003', '2026-07-10', 'payment', 200),
        gl('g4', 'DOC-004', '2026-07-10', 'payment', 150),
      ],
      1
    );
    expect(shape(result)).toEqual([
      { anchorSide: 'bank', bank: ['b1'], gl: ['g1', 'g2', 'g3', 'g4'], amount: 1000 },
    ]);
  });

  it('เลือกชุดที่ใช้แถวน้อยที่สุดก่อนเสมอ (1,500 = 1,000+500 ได้ และ = 600+500+400 ก็ได้ → ต้องได้ 2 แถว)', () => {
    const result = findCombinationSuggestions(
      [bank('b1', '2026-07-10', 'receive', 1500)],
      [
        gl('g1', 'DOC-001', '2026-07-10', 'receive', 1000),
        gl('g2', 'DOC-002', '2026-07-10', 'receive', 500),
        gl('g3', 'DOC-003', '2026-07-10', 'receive', 600),
        gl('g4', 'DOC-004', '2026-07-10', 'receive', 400),
      ],
      1
    );
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].glRows.map((row) => row.id)).toEqual(['g1', 'g2']);
  });

  it('ไม่เสนอคู่ 1:1 (ต้องมีสมาชิกอย่างน้อย 2 แถวเสมอ — คู่ 1:1 เป็นหน้าที่ของ reconcileTransactions)', () => {
    const result = findCombinationSuggestions(
      [bank('b1', '2026-07-10', 'receive', 1000)],
      [gl('g1', 'DOC-001', '2026-07-10', 'receive', 1000)],
      1
    );
    expect(result.suggestions).toEqual([]);
  });

  it('รับกับจ่ายห้ามปนกัน แม้ยอดจะพอดีก็ไม่เสนอ', () => {
    const result = findCombinationSuggestions(
      [bank('b1', '2026-07-10', 'receive', 1500)],
      [gl('g1', 'DOC-001', '2026-07-10', 'receive', 1000), gl('g2', 'DOC-002', '2026-07-10', 'payment', 500)],
      1
    );
    expect(result.suggestions).toEqual([]);
  });
});

describe('findCombinationSuggestions — ช่วงวันที่ที่ยอมรับได้', () => {
  it('สมาชิกที่อยู่นอกช่วง ±1 วัน ถูกตัดออก ทำให้ไม่เหลือชุดที่พอดี', () => {
    const rows: GLTransaction[] = [
      gl('g1', 'DOC-001', '2026-07-10', 'receive', 1000),
      gl('g2', 'DOC-002', '2026-07-14', 'receive', 500), // ห่าง 4 วัน — นอกช่วงทั้ง ±1 และ ±3
    ];
    const result = findCombinationSuggestions([bank('b1', '2026-07-10', 'receive', 1500)], rows, 1);
    expect(result.suggestions).toEqual([]);
  });

  it('เคสเดียวกันแต่สมาชิกห่าง 3 วัน: ±1 ไม่เสนอ / ±3 เสนอ (ใช้ช่วงวันที่เดียวกับที่ผู้ใช้เลือกไว้จริง)', () => {
    const bankRows = [bank('b1', '2026-07-10', 'receive', 1500)];
    const glRows = [
      gl('g1', 'DOC-001', '2026-07-10', 'receive', 1000),
      gl('g2', 'DOC-002', '2026-07-13', 'receive', 500),
    ];
    expect(findCombinationSuggestions(bankRows, glRows, 1).suggestions).toEqual([]);
    const wide = findCombinationSuggestions(bankRows, glRows, 3);
    expect(shape(wide)).toEqual([{ anchorSide: 'bank', bank: ['b1'], gl: ['g1', 'g2'], amount: 1500 }]);
    expect(wide.suggestions[0].dateSpread).toBe(3);
  });

  it('วัดระยะวันที่เทียบกับ "แถวเดี่ยว" เท่านั้น — สมาชิกสองตัวห่างกันเองเกินช่วงได้ ถ้าแต่ละตัวอยู่ในช่วงของแถวเดี่ยว', () => {
    // g1 อยู่ก่อน 1 วัน, g2 อยู่หลัง 1 วัน → ห่างกันเอง 2 วัน (เกิน ±1) แต่ทั้งคู่ห่างจาก b1 แค่ 1 วัน
    const result = findCombinationSuggestions(
      [bank('b1', '2026-07-10', 'payment', 1500)],
      [gl('g1', 'DOC-001', '2026-07-09', 'payment', 1000), gl('g2', 'DOC-002', '2026-07-11', 'payment', 500)],
      1
    );
    expect(shape(result)).toEqual([{ anchorSide: 'bank', bank: ['b1'], gl: ['g1', 'g2'], amount: 1500 }]);
    expect(result.suggestions[0].dateSpread).toBe(1);
  });
});

describe('findCombinationSuggestions — จำนวนเงินต้องตรงเป๊ะระดับสตางค์', () => {
  it('999.99 + 500.01 = 1,500.00 พอดี — ต้องเสนอ (พิสูจน์ว่าเทียบแบบ integer สตางค์ ไม่ใช่ float)', () => {
    const result = findCombinationSuggestions(
      [bank('b1', '2026-07-10', 'receive', 1500)],
      [gl('g1', 'DOC-001', '2026-07-10', 'receive', 999.99), gl('g2', 'DOC-002', '2026-07-10', 'receive', 500.01)],
      1
    );
    expect(shape(result)).toEqual([{ anchorSide: 'bank', bank: ['b1'], gl: ['g1', 'g2'], amount: 1500 }]);
  });

  it('0.1 + 0.2 แบบที่ทำให้ float เพี้ยน: 1,000.10 + 499.90 = 1,500.00 ต้องเสนอ', () => {
    const result = findCombinationSuggestions(
      [bank('b1', '2026-07-10', 'receive', 1500)],
      [gl('g1', 'DOC-001', '2026-07-10', 'receive', 1000.1), gl('g2', 'DOC-002', '2026-07-10', 'receive', 499.9)],
      1
    );
    expect(result.suggestions).toHaveLength(1);
  });

  it('ต่างกัน 1 สตางค์ก็ไม่เสนอ (ไม่มี tolerance ของจำนวนเงินเลย)', () => {
    const result = findCombinationSuggestions(
      [bank('b1', '2026-07-10', 'receive', 1500)],
      [gl('g1', 'DOC-001', '2026-07-10', 'receive', 1000.01), gl('g2', 'DOC-002', '2026-07-10', 'receive', 500)],
      1
    );
    expect(result.suggestions).toEqual([]);
  });
});

describe('findCombinationSuggestions — 1 แถวอยู่ได้ในข้อเสนอเดียวเท่านั้น', () => {
  it('ข้อเสนอที่แย่ง GL แถวเดียวกันสองใบ ต้องเหลือใบเดียว', () => {
    // b1 (1,500) และ b2 (1,500) ต่างก็พอดีกับ g1+g2 ได้ทั้งคู่ แต่ g1/g2 ใช้ซ้ำไม่ได้
    const result = findCombinationSuggestions(
      [bank('b1', '2026-07-10', 'receive', 1500), bank('b2', '2026-07-10', 'receive', 1500)],
      [gl('g1', 'DOC-001', '2026-07-10', 'receive', 1000), gl('g2', 'DOC-002', '2026-07-10', 'receive', 500)],
      1
    );
    expect(shape(result)).toEqual([{ anchorSide: 'bank', bank: ['b1'], gl: ['g1', 'g2'], amount: 1500 }]);
  });

  it('ทุกแถวในผลลัพธ์ทั้งชุดไม่ซ้ำกันเลย แม้มีข้อเสนอหลายใบ', () => {
    const result = findCombinationSuggestions(
      [
        bank('b1', '2026-07-10', 'receive', 1500),
        bank('b2', '2026-07-10', 'payment', 900),
      ],
      [
        gl('g1', 'DOC-001', '2026-07-10', 'receive', 1000),
        gl('g2', 'DOC-002', '2026-07-10', 'receive', 500),
        gl('g3', 'DOC-003', '2026-07-10', 'payment', 600),
        gl('g4', 'DOC-004', '2026-07-10', 'payment', 300),
      ],
      1
    );
    expect(result.suggestions).toHaveLength(2);
    const bankIds = result.suggestions.flatMap((item) => item.bankRows.map((row) => row.id));
    const glIds = result.suggestions.flatMap((item) => item.glRows.map((row) => row.id));
    expect(new Set(bankIds).size).toBe(bankIds.length);
    expect(new Set(glIds).size).toBe(glIds.length);
  });
});

describe('findCombinationSuggestions — ผลลัพธ์ต้องเหมือนกันทุกครั้ง (deterministic)', () => {
  it('input เดียวกัน เรียก 3 ครั้ง ได้ผลเท่ากันทุกตัวอักษร รวมถึง suggestionId', () => {
    const bankRows = [
      bank('b1', '2026-07-10', 'receive', 1500),
      bank('b2', '2026-07-11', 'receive', 1500),
      bank('b3', '2026-07-12', 'payment', 2000),
    ];
    const glRows = [
      gl('g1', 'DOC-001', '2026-07-10', 'receive', 1000),
      gl('g2', 'DOC-002', '2026-07-10', 'receive', 500),
      gl('g3', 'DOC-003', '2026-07-11', 'receive', 750),
      gl('g4', 'DOC-004', '2026-07-11', 'receive', 750),
      gl('g5', 'DOC-005', '2026-07-12', 'payment', 1200),
      gl('g6', 'DOC-006', '2026-07-12', 'payment', 800),
    ];
    const first = findCombinationSuggestions(bankRows, glRows, 1);
    const second = findCombinationSuggestions(bankRows, glRows, 1);
    const third = findCombinationSuggestions(bankRows, glRows, 1);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(JSON.stringify(third)).toBe(JSON.stringify(first));
    expect(first.suggestions.length).toBeGreaterThan(0);
  });

  it('suggestionId สร้างจาก id ของแถวจริง จึงคงที่และไม่ซ้ำกันข้ามข้อเสนอ', () => {
    const result = findCombinationSuggestions(
      [bank('b1', '2026-07-10', 'receive', 1500)],
      [gl('g1', 'DOC-001', '2026-07-10', 'receive', 1000), gl('g2', 'DOC-002', '2026-07-10', 'receive', 500)],
      1
    );
    expect(result.suggestions[0].suggestionId).toBe('bank:b1=>g1+g2');
  });
});

describe('findCombinationSuggestions — งบประมาณการค้นหา', () => {
  /** สร้างเคสที่โหดที่สุดเท่าที่นึกออก: ข้างละ 300 แถว วันที่อยู่ในช่วง ±3 วันกันหมด (ทุกแถวเป็นผู้สมัครของ
   * ทุกแถว) จำนวนเงินซ้ำกันเยอะมาก และ "ยอดลงท้ายเศษแปลกๆ" ทำให้หาคู่ที่พอดีไม่ได้เลย — กรณีนี้บังคับให้การ
   * ค้นไล่ความลึกขึ้นไปจนหมดงบในทุกแถว ซึ่งเป็นเพดานเวลาที่แท้จริงของฟังก์ชันนี้ */
  function buildWorstCase(size: number) {
    const bankRows: BankTransaction[] = [];
    const glRows: GLTransaction[] = [];
    for (let i = 0; i < size; i++) {
      const day = 10 + (i % 3); // 2026-07-10..12 → ห่างกันไม่เกิน 2 วัน อยู่ในช่วง ±3 ทั้งหมด
      bankRows.push(bank(`b${i}`, `2026-07-${day}`, 'payment', 50_000 + (i % 7) * 0.37));
      glRows.push(gl(`g${i}`, `DOC-${i}`, `2026-07-${day}`, 'payment', 1_000 + (i % 11) * 100));
    }
    return { bankRows, glRows };
  }

  it('เคสหนัก 300 × 300 แถว: ทำงานจบ ไม่ throw ไม่วนไม่สิ้นสุด และใช้ก้าวไม่เกินงบที่ตั้งไว้', () => {
    const { bankRows, glRows } = buildWorstCase(300);
    const result = findCombinationSuggestions(bankRows, glRows, 3);
    expect(Array.isArray(result.suggestions)).toBe(true);
    expect(result.stepsUsed).toBeLessThanOrEqual(DEFAULT_COMBINATION_STEP_BUDGET);
  });

  it('งบน้อยมาก (100 ก้าว) → คืนผลทันที พร้อมธง budgetExhausted ให้ UI บอกผู้ใช้ได้ว่าค้นไม่ครบ', () => {
    const { bankRows, glRows } = buildWorstCase(120);
    const result = findCombinationSuggestions(bankRows, glRows, 3, { stepBudget: 100, anchorStepBudget: 50 });
    expect(result.budgetExhausted).toBe(true);
    expect(result.skippedAnchorCount).toBeGreaterThan(0);
    expect(result.stepsUsed).toBeLessThanOrEqual(150);
  });

  it('งบหมดแล้วยังไม่ทำให้ข้อเสนอที่หาเจอไปแล้วก่อนหน้านั้นหายไป', () => {
    // แถวแรกเจอคู่ได้ใน 2-3 ก้าว แถวที่เหลือเป็นเคสหนักที่กินงบจนหมด
    const { bankRows, glRows } = buildWorstCase(60);
    const result = findCombinationSuggestions(
      [bank('b-easy', '2026-07-10', 'payment', 1500), ...bankRows],
      [
        gl('g-easy-1', 'DOC-E1', '2026-07-10', 'payment', 1000),
        gl('g-easy-2', 'DOC-E2', '2026-07-10', 'payment', 500),
        ...glRows,
      ],
      3,
      { stepBudget: 4_000, anchorStepBudget: 500 }
    );
    expect(result.suggestions.some((item) => item.bankRows[0].id === 'b-easy')).toBe(true);
    expect(result.budgetExhausted).toBe(true);
  });
});

describe('createSuggestedMatchGroup', () => {
  it('ยอมรับข้อเสนอแล้วได้ MatchGroup ที่ไปโผล่ใน "กระทบยอดสำเร็จ" ได้ทันที (matchType=manual ตามที่อธิบายไว้ใน lib)', () => {
    const result = findCombinationSuggestions(
      [bank('b1', '2026-07-10', 'receive', 1500)],
      [gl('g1', 'DOC-001', '2026-07-10', 'receive', 1000), gl('g2', 'DOC-002', '2026-07-10', 'receive', 500)],
      1
    );
    const group = createSuggestedMatchGroup(result.suggestions[0]);
    expect(group.matchType).toBe('manual');
    expect(group.type).toBe('receive');
    expect(group.bankRows.map((row) => row.id)).toEqual(['b1']);
    expect(group.glRows.map((row) => row.id)).toEqual(['g1', 'g2']);
    expect(group.groupId.length).toBeGreaterThan(0);
  });
});

describe('dropSuggestionsUsingRows', () => {
  it('ทิ้งข้อเสนอที่อ้างถึงแถวซึ่งถูกดึงออกจากตาราง "ไม่สำเร็จ" ไปแล้ว และเก็บใบที่ไม่เกี่ยวไว้', () => {
    const result = findCombinationSuggestions(
      [bank('b1', '2026-07-10', 'receive', 1500), bank('b2', '2026-07-10', 'payment', 900)],
      [
        gl('g1', 'DOC-001', '2026-07-10', 'receive', 1000),
        gl('g2', 'DOC-002', '2026-07-10', 'receive', 500),
        gl('g3', 'DOC-003', '2026-07-10', 'payment', 600),
        gl('g4', 'DOC-004', '2026-07-10', 'payment', 300),
      ],
      1
    );
    expect(result.suggestions).toHaveLength(2);

    const afterGl = dropSuggestionsUsingRows(result.suggestions, new Set(), new Set(['g2']));
    expect(afterGl.map((item) => item.bankRows[0].id)).toEqual(['b2']);

    const afterBank = dropSuggestionsUsingRows(result.suggestions, new Set(['b2']), new Set());
    expect(afterBank.map((item) => item.bankRows[0].id)).toEqual(['b1']);

    expect(dropSuggestionsUsingRows(result.suggestions, new Set(), new Set())).toHaveLength(2);
  });
});
