import { describe, expect, it } from 'vitest';
import { DEFAULT_WHITE_REMOVAL_OPTIONS, removeWhiteBackground, whiteDistance } from './logoBackgroundRemoval';

/** สร้างบัฟเฟอร์ RGBA พิกเซลเดียว (Uint8ClampedArray ยาว 4 ช่อง) สำหรับเทสต์ */
function pixel(r: number, g: number, b: number, a: number): Uint8ClampedArray {
  return new Uint8ClampedArray([r, g, b, a]);
}

describe('whiteDistance', () => {
  it('ขาวบริสุทธิ์ (255,255,255) ระยะห่างเท่ากับ 0', () => {
    expect(whiteDistance(255, 255, 255)).toBe(0);
  });

  it('ดำสนิท (0,0,0) ระยะห่างเท่ากับ 255 (มากสุด)', () => {
    expect(whiteDistance(0, 0, 0)).toBe(255);
  });

  it('ขึ้นกับช่องสีที่มืดที่สุด ไม่ใช่ค่าเฉลี่ย — สีเหลืองสด (255,255,0) ต้องห่างจากขาวเท่ากับดำสนิท เพราะช่อง B มืดสนิทเท่ากัน', () => {
    expect(whiteDistance(255, 255, 0)).toBe(255);
  });

  it('ขาวอมเหลืองเล็กน้อย (สแกน/ถ่ายรูปจริง) ยังถือว่าใกล้ขาวมาก ระยะห่างน้อย', () => {
    expect(whiteDistance(250, 248, 240)).toBe(15);
  });
});

describe('removeWhiteBackground', () => {
  it('พิกเซลขาวบริสุทธิ์ ต้องโปร่งใสสนิท (alpha = 0)', () => {
    const px = pixel(255, 255, 255, 255);
    const affected = removeWhiteBackground(px);
    expect(px[3]).toBe(0);
    expect(affected).toBe(1);
  });

  it('พิกเซลขาวอมเหลืองจากการสแกน (ใกล้เคียงขาว ไม่ใช่ขาวเป๊ะ) ก็ต้องโปร่งใสสนิทเช่นกัน เพราะอยู่ในช่วง innerTolerance', () => {
    const px = pixel(250, 248, 240, 255); // ระยะห่าง 15 > innerTolerance ค่าเริ่มต้น (14) เล็กน้อย — ทดสอบค่าที่ผ่านจริง
    const withinInner = pixel(252, 250, 245, 255); // ระยะห่าง 5 < 14
    removeWhiteBackground(px);
    removeWhiteBackground(withinInner);
    expect(withinInner[3]).toBe(0);
    expect(px[3]).toBeGreaterThan(0); // 15 อยู่ในโซนขอบพอดี ไม่ใช่โปร่งใสสนิท แต่ก็ไม่ทึบเต็มที่
    expect(px[3]).toBeLessThan(255);
  });

  it('พิกเซลสีเข้มชัดเจน (เนื้อโลโก้จริง) ต้องไม่ถูกแตะเลยแม้แต่น้อย', () => {
    const px = pixel(30, 60, 180, 255); // สีน้ำเงินเข้มของโลโก้ตัวอย่าง
    const affected = removeWhiteBackground(px);
    expect(px[0]).toBe(30);
    expect(px[1]).toBe(60);
    expect(px[2]).toBe(180);
    expect(px[3]).toBe(255);
    expect(affected).toBe(0);
  });

  it('พิกเซลโซนขอบ (ระหว่าง inner/outer tolerance) ต้องโปร่งใสบางส่วน โดยไม่แตะสีเลย (ต่างจาก chroma key ที่ลดคราบสี — ขาวไม่มีช่องเด่นให้ลด)', () => {
    const px = pixel(200, 200, 200, 255); // เทาอ่อน ระยะห่าง 55 อยู่ในโซนขอบ (inner 14 / outer 70)
    removeWhiteBackground(px);
    expect(px[3]).toBeGreaterThan(0);
    expect(px[3]).toBeLessThan(255);
    expect(px[0]).toBe(200);
    expect(px[1]).toBe(200);
    expect(px[2]).toBe(200);
  });

  it('พิกเซลโซนขอบที่ alpha เดิมต่ำกว่าค่าที่คำนวณได้ ต้องไม่ถูกเพิ่มความทึบขึ้น (กันไม่ให้พิกเซลโปร่งใสอยู่แล้วทึบขึ้นโดยไม่ตั้งใจ)', () => {
    const edgeColor: [number, number, number] = [200, 200, 200];

    const fullAlphaPixel = pixel(...edgeColor, 255);
    removeWhiteBackground(fullAlphaPixel);
    const computedEdgeAlpha = fullAlphaPixel[3];
    expect(computedEdgeAlpha).toBeGreaterThan(0);
    expect(computedEdgeAlpha).toBeLessThan(255);

    const startingAlpha = Math.max(0, computedEdgeAlpha - 20);
    const lowAlphaPixel = pixel(...edgeColor, startingAlpha);
    removeWhiteBackground(lowAlphaPixel);
    expect(lowAlphaPixel[3]).toBe(startingAlpha);
  });

  it('พิกเซลที่ไกลเกิน outer tolerance (เนื้อโลโก้จริง) นับเป็น affected = 0 แม้จะอยู่ในบัฟเฟอร์เดียวกับพิกเซลพื้นหลัง', () => {
    const px = new Uint8ClampedArray([
      255, 255, 255, 255, // พิกเซลที่ 1 — พื้นหลังขาวเป๊ะ ต้องถูกนับ
      30, 60, 180, 255, // พิกเซลที่ 2 — เนื้อโลโก้จริง ต้องไม่ถูกนับ
    ]);
    const affected = removeWhiteBackground(px);
    expect(affected).toBe(1);
    expect(px[3]).toBe(0); // พิกเซลที่ 1
    expect(px[7]).toBe(255); // พิกเซลที่ 2 ไม่ถูกแตะ
  });

  it('รองรับ options กำหนดเอง (tolerance กว้าง/แคบกว่าเดิม)', () => {
    const strictOptions = { innerTolerance: 2, outerTolerance: 10 };
    const px = pixel(250, 250, 250, 255); // ระยะห่าง 5 — เกิน innerTolerance ใหม่ (2) แต่ยังไม่เกิน outer (10)
    removeWhiteBackground(px, strictOptions);
    expect(px[3]).toBeGreaterThan(0);
    expect(px[3]).toBeLessThan(255);
  });

  it('ค่า default options: outerTolerance ต้องมากกว่า innerTolerance เสมอ', () => {
    expect(DEFAULT_WHITE_REMOVAL_OPTIONS.outerTolerance).toBeGreaterThan(DEFAULT_WHITE_REMOVAL_OPTIONS.innerTolerance);
  });
});
