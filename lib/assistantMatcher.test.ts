import { describe, expect, it } from 'vitest';
import { matchKnowledge } from './assistantMatcher';
import type { AssistantKnowledgeEntry } from '@/types/assistant';

function entry(id: string, keywords: string[], pageScope?: string): AssistantKnowledgeEntry {
  return { id, keywords, answer: `answer for ${id}`, pageScope };
}

describe('matchKnowledge', () => {
  it('คำถามว่างไม่ throw และคืนค่าไม่มั่นใจ', () => {
    const result = matchKnowledge('', [entry('a', ['test'])], { activeId: null });
    expect(result.entry).toBeNull();
    expect(result.score).toBe(0);
    expect(result.confident).toBe(false);
  });

  it('ไม่มีคำสำคัญตรงเลย → ไม่มั่นใจ', () => {
    const result = matchKnowledge('xyzxyzxyz', [entry('a', ['bank reconcile'])], { activeId: null });
    expect(result.entry).toBeNull();
    expect(result.score).toBe(0);
    expect(result.confident).toBe(false);
  });

  it('คำสำคัญตรง (ไม่สนตัวพิมพ์เล็ก/ใหญ่) → มั่นใจ', () => {
    const result = matchKnowledge('BANK RECONCILE คืออะไร', [entry('bank', ['bank reconcile'])], {
      activeId: null,
    });
    expect(result.entry?.id).toBe('bank');
    expect(result.confident).toBe(true);
  });

  it('สองหัวข้อคะแนนต่างกัน → เลือกหัวข้อคะแนนสูงกว่าเสมอ', () => {
    const entries = [
      entry('short', ['gl']),
      entry('long', ['bank reconcile workflow']),
    ];
    const result = matchKnowledge('bank reconcile workflow กับ gl', entries, { activeId: null });
    expect(result.entry?.id).toBe('long');
  });

  it('คะแนนเท่ากันเป๊ะ → เลือกหัวข้อแรกในอาร์เรย์เสมอ (tie-break ตายตัว)', () => {
    const entries = [entry('first', ['same length']), entry('second', ['same length'])];
    const result = matchKnowledge('same length', entries, { activeId: null });
    expect(result.entry?.id).toBe('first');
  });

  it('โบนัสหน้าปัจจุบันพลิกผลลัพธ์ได้ เมื่อคะแนนพื้นฐานเท่ากันเป๊ะระหว่างสองหัวข้อ', () => {
    const entries = [
      entry('other-page', ['reconcile']), // มาก่อนในอาร์เรย์ + คะแนนพื้นฐานเท่ากับอีกหัวข้อเป๊ะ แต่คนละหน้า
      entry('this-page', ['reconcile'], 'bank-reconcile'), // มาทีหลัง แต่ตรงหน้าปัจจุบันพอดี ต้องได้โบนัส
    ];
    const result = matchKnowledge('reconcile', entries, { activeId: 'bank-reconcile' });
    expect(result.entry?.id).toBe('this-page');
  });

  it('ไม่มี context หน้าปัจจุบัน (activeId null) → ไม่มีโบนัสใดๆ เลย', () => {
    const entries = [entry('a', ['reconcile'], 'bank-reconcile')];
    const withContext = matchKnowledge('reconcile', entries, { activeId: 'bank-reconcile' });
    const withoutContext = matchKnowledge('reconcile', entries, { activeId: null });
    expect(withContext.score).toBeGreaterThan(withoutContext.score);
  });

  it('อยู่คนละหน้ากับ pageScope ของหัวข้อ → ไม่ได้โบนัส', () => {
    const entries = [entry('a', ['reconcile'], 'bank-reconcile')];
    const result = matchKnowledge('reconcile', entries, { activeId: 'record-expense' });
    expect(result.score).toBe(Math.ceil('reconcile'.length / 4));
  });
});
