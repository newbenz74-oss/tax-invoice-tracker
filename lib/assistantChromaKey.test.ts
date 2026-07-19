import { describe, expect, it } from 'vitest';
import { applyChromaKey, chromaKeyDistance, DEFAULT_CHROMA_KEY_OPTIONS } from './assistantChromaKey';

/** สร้างบัฟเฟอร์ RGBA พิกเซลเดียว (Uint8ClampedArray ยาว 4 ช่อง) สำหรับเทสต์ */
function pixel(r: number, g: number, b: number, a: number): Uint8ClampedArray {
  return new Uint8ClampedArray([r, g, b, a]);
}

const GREEN_KEY = { r: 0, g: 203, b: 8 };

describe('chromaKeyDistance', () => {
  it('ระยะห่างจากสีตัวเองเท่ากับ 0 เสมอ', () => {
    expect(chromaKeyDistance(0, 203, 8, GREEN_KEY)).toBe(0);
  });

  it('พิกเซลเขียวเข้ม (ถูกบีบอัดจนมืดลง) ต้องยังถือว่าใกล้พื้นหลังมากกว่าพิกเซลสีน้ำตาล/ผิวที่ระยะห่างจากคีย์ (Euclidean) เท่ากันโดยบังเอิญ — ' +
      'นี่คือบั๊กจริงที่พบจากพิกเซลจริงในวิดีโอ: RGB(25,107,4) (ยังมองว่าเขียวชัดเจนด้วยตา) เคยถูกจัดเป็น "เนื้อภาพจริง" เพราะฟังก์ชันเวอร์ชันเก่าวัด' +
      'ระยะแบบ Euclidean จากคีย์สีตรงๆ (ช่อง G ต่างจาก 203 เยอะ) ทำให้เกิดขอบเขียวสว่างรอบภาพ — เวอร์ชันนี้วัดจาก channel excess แทนจึงไม่เกิดปัญหานี้', () => {
      const darkenedGreenEdge = chromaKeyDistance(25, 107, 4, GREEN_KEY); // พิกเซลขอบจริงจากวิดีโอ (ยังเขียวอยู่)
      const brownHair = chromaKeyDistance(89, 61, 44, GREEN_KEY); // พิกเซลผมสีน้ำตาลจริงจากวิดีโอ (ไม่เขียวเลย)
      expect(darkenedGreenEdge).toBeLessThan(brownHair);
    });

  it('excess เป็นบวกมากขึ้นเรื่อยๆ เมื่อช่องเด่นของคีย์เด่นน้อยลงเรื่อยๆ เทียบกับอีกสองช่อง (ระยะห่างเพิ่มขึ้นเป็นเส้นตรงตามสัดส่วน ไม่ใช่ตามความสว่าง)', () => {
    const distanceAt10 = chromaKeyDistance(100, 110, 100, GREEN_KEY); // excess = 10
    const distanceAt50 = chromaKeyDistance(100, 150, 100, GREEN_KEY); // excess = 50 (เขียวเด่นกว่า ใกล้คีย์กว่า)
    expect(distanceAt50).toBeLessThan(distanceAt10);
  });
});

describe('applyChromaKey', () => {
  it('พิกเซลที่ตรงสีพื้นหลังเป๊ะ ต้องโปร่งใสสนิท (alpha = 0)', () => {
    const px = pixel(0, 203, 8, 255);
    const affected = applyChromaKey(px);
    expect(px[3]).toBe(0);
    expect(affected).toBe(1);
  });

  it('พิกเซลสีผิว/เนื้อภาพจริงที่ห่างจากพื้นหลังมาก ต้องไม่ถูกแตะเลยแม้แต่น้อย', () => {
    const px = pixel(240, 200, 170, 255); // โทนสีผิวจากวิดีโอจริง
    const affected = applyChromaKey(px);
    expect(px[0]).toBe(240);
    expect(px[1]).toBe(200);
    expect(px[2]).toBe(170);
    expect(px[3]).toBe(255);
    expect(affected).toBe(0);
  });

  it('พิกเซลโซนขอบ (ระหว่าง inner/outer tolerance) ต้องโปร่งใสบางส่วน และลดคราบเขียวลง โดยไม่แตะช่องแดง/น้ำเงิน', () => {
    // เลือกสีที่คำนวณแล้วตกอยู่ในโซนขอบพอดีสำหรับค่าเริ่มต้น (inner 20 / outer 195)
    const px = pixel(30, 150, 50, 255);
    applyChromaKey(px);
    expect(px[3]).toBeGreaterThan(0);
    expect(px[3]).toBeLessThan(255);
    expect(px[1]).toBeLessThan(150); // ช่องเขียวถูกลดคราบ (spill suppression)
    expect(px[0]).toBe(30); // ช่องแดงไม่ถูกแตะ
    expect(px[2]).toBe(50); // ช่องน้ำเงินไม่ถูกแตะ
  });

  it('พิกเซลขอบจริงจากวิดีโอที่เคยหลุดเป็นขอบเขียวสว่าง (regression) ต้องไม่เขียวเด่นกว่าอีกสองช่องอีกต่อไปหลัง key — ' +
    'RGB(64,146,43) และ RGB(25,107,4) (พิกเซลขอบเส้นผมจริงจาก ai-assistant.mp4) เคยถูกปล่อยผ่านแบบทึบเต็มที่และไม่ลดคราบเลย ' +
    'เพราะไกลเกิน outerTolerance เดิม (120) ทั้งที่ช่อง G ยังเด่นกว่า R/B ชัดเจน ทำให้เห็นเป็นขอบเขียวรอบภาพ', () => {
    const edgePixels: Array<[number, number, number]> = [
      [64, 146, 43],
      [25, 107, 4],
    ];
    for (const [r, g, b] of edgePixels) {
      const px = pixel(r, g, b, 255);
      applyChromaKey(px);
      const otherMax = Math.max(px[0], px[2]);
      expect(px[1]).toBeLessThanOrEqual(otherMax);
    }
  });

  it('พิกเซลโซนขอบที่ alpha เดิมต่ำกว่าค่าที่คำนวณได้ ต้องไม่ถูกเพิ่มความทึบขึ้น (กันไม่ให้พิกเซลที่โปร่งใสอยู่แล้วทึบขึ้นโดยไม่ตั้งใจ)', () => {
    const edgeColor: [number, number, number] = [30, 150, 50];

    const fullAlphaPixel = pixel(...edgeColor, 255);
    applyChromaKey(fullAlphaPixel);
    const computedEdgeAlpha = fullAlphaPixel[3];
    expect(computedEdgeAlpha).toBeGreaterThan(0);
    expect(computedEdgeAlpha).toBeLessThan(255);

    const startingAlpha = Math.max(0, computedEdgeAlpha - 20);
    const lowAlphaPixel = pixel(...edgeColor, startingAlpha);
    applyChromaKey(lowAlphaPixel);
    expect(lowAlphaPixel[3]).toBe(startingAlpha);
  });

  it('พิกเซลที่ไกลเกิน outer tolerance (เนื้อภาพจริง) นับเป็น affected = 0 แม้จะอยู่ในบัฟเฟอร์เดียวกับพิกเซลพื้นหลัง', () => {
    // บัฟเฟอร์ 2 พิกเซล: พื้นหลังเป๊ะ + เนื้อภาพจริง
    const px = new Uint8ClampedArray([
      0, 203, 8, 255, // พิกเซลที่ 1 — พื้นหลังเป๊ะ ต้องถูกนับ
      240, 200, 170, 255, // พิกเซลที่ 2 — เนื้อภาพจริง ต้องไม่ถูกนับ
    ]);
    const affected = applyChromaKey(px);
    expect(affected).toBe(1);
    expect(px[3]).toBe(0); // พิกเซลที่ 1
    expect(px[7]).toBe(255); // พิกเซลที่ 2 ไม่ถูกแตะ
  });

  it('รองรับ options กำหนดเอง (คีย์สีอื่นที่ไม่ใช่เขียว) — ไม่ได้ผูกกับสีเขียวตายตัวภายในฟังก์ชัน', () => {
    const blueScreenOptions = {
      ...DEFAULT_CHROMA_KEY_OPTIONS,
      keyColor: { r: 0, g: 0, b: 255 },
    };
    const px = pixel(0, 0, 255, 255);
    applyChromaKey(px, blueScreenOptions);
    expect(px[3]).toBe(0);
  });

  it('ค่า default options มีคีย์สีตรงกับพื้นหลังจริงที่ตรวจสอบจากไฟล์วิดีโอ (RGB 0,203,8)', () => {
    expect(DEFAULT_CHROMA_KEY_OPTIONS.keyColor).toEqual({ r: 0, g: 203, b: 8 });
  });
});
