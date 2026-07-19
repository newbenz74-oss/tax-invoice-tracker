/**
 * ตรรกะล้วนๆ (pure logic) สำหรับลบพื้นหลังสีเขียวออกจากวิดีโอผู้ช่วย AI แบบ real-time — แยกออกมาจาก
 * components/ChromaKeyAvatar.tsx (ที่จัดการ <video>/<canvas>/loop จริง) ตามธรรมเนียมเดิมของโปรเจกต์นี้
 * (ตรรกะล้วนๆ + component ที่เรียกใช้ แยกไฟล์กันเสมอ เช่น lib/bankReconcileManualMatch.ts) เพื่อให้เทสต์ได้
 * ด้วย Uint8ClampedArray ปลอมๆ โดยไม่ต้องพึ่ง canvas จริงในเบราว์เซอร์เลย
 *
 * ค่าสีพื้นหลังจริงที่ยืนยันแล้วจากไฟล์ ai-assistant.mp4 (สุ่มตรวจพิกเซลทุกมุมภาพหลายเฟรม): RGB(0, 203, 8)
 * สม่ำเสมอมาก — ใช้เป็นค่าเริ่มต้นด้านล่าง
 *
 * หมายเหตุสำคัญเรื่องการออกแบบ — เวอร์ชันแรกของไฟล์นี้วัด "ระยะห่างสี" แบบ Euclidean distance ตรงๆ จากสี
 * พื้นหลัง (ถ่วงน้ำหนักช่อง G ×1.5) แต่พอเอาไปทดสอบกับพิกเซลจริงจากวิดีโอ (สร้าง public/videos/
 * ai-assistant-poster.png) พบว่าเกิดขอบสีเขียวสว่างล้อมรอบภาพอย่างชัดเจน สาเหตุคือ H.264 chroma subsampling
 * ทำให้พิกเซลตรงขอบภาพ (บริเวณรอยต่อพื้นหลัง/เนื้อภาพ) มีความสว่างของสีเขียวลดลงมาก (เช่น RGB(25,107,4) ซึ่ง
 * ตายังมองว่าเขียวชัดเจน) แต่ Euclidean distance จากคีย์สี (0,203,8) กลับไกลเกิน outerTolerance เพราะช่อง G
 * ต่างจาก 203 เยอะมาก — พิกเซลเขียวเข้มแบบนี้เลยถูกจัดเป็น "เนื้อภาพจริง" ทั้งที่ยังเป็นคราบเขียวอยู่ ทำให้เกิด
 * fringe ที่มองเห็นได้รอบเส้นผม
 *
 * เวอร์ชันนี้แก้โดยเปลี่ยนไปวัด "channel excess" แทน — ดูว่าช่องสีที่เด่นที่สุดของคีย์ (เช่น G สำหรับพื้นหลัง
 * เขียว) เด่นกว่าอีกสองช่องแค่ไหน (g - max(r,b)) ค่านี้ไม่ขึ้นกับความสว่างโดยรวมของพิกเซล พิกเซลเขียวเข้มกับ
 * เขียวสว่างจะมี excess ใกล้เคียงกันถ้าสัดส่วนความเด่นของสีเขียวเทียบกับช่องอื่นใกล้เคียงกัน — แก้ปัญหาพิกเซล
 * ขอบที่ถูกบีบอัดจนมืดลงแต่ยังเขียวอยู่ได้ตรงจุด ไม่ผูกกับสีเขียวตายตัว (รองรับคีย์สีอื่น เช่น blue screen ได้
 * ด้วยการหาช่องเด่นจาก keyColor เอง ไม่ hardcode ช่อง g)
 */

export interface ChromaKeyColor {
  r: number;
  g: number;
  b: number;
}

export interface ChromaKeyOptions {
  keyColor: ChromaKeyColor;
  /** ระยะ "channel excess" (ดู chromaKeyDistance) ที่พิกเซลใกล้กว่านี้ถือเป็นพื้นหลังเต็มที่ (โปร่งใสสนิท,
   * alpha = 0) */
  innerTolerance: number;
  /** ระยะที่เริ่มถือว่าเป็นเนื้อภาพจริง (ทึบแสงเต็มที่ ไม่แตะเลย) — ระหว่าง innerTolerance กับค่านี้คือ "โซน
   * ขอบ" ที่ alpha ไล่ระดับเชิงเส้นแทนการตัดเป็นขั้นบันได ช่วยลดรอยหยัก (aliasing) ตรงขอบเส้นผมหยักๆ ต้อง
   * มากกว่า innerTolerance เสมอ ค่าเริ่มต้น (195) เท่ากับ "channel excess" ของคีย์สีเป๊ะ — ความหมายคือพิกเซล
   * จะทึบเต็มที่ก็ต่อเมื่อไม่มีคราบสีเด่นของคีย์เหลืออยู่เลย */
  outerTolerance: number;
  /** สัดส่วนการลด "คราบสี" (spill) ของช่องเด่น (เช่นช่อง G สำหรับพื้นหลังเขียว) บนพิกเซลโซนขอบ ลงมาเท่าค่า
   * มากสุดของอีกสองช่อง — 0 = ปิด, 1 = ลดเต็มที่ (ช่องเด่นเท่ากับ max ของอีกสองช่องพอดี ไม่เด่นกว่าเลย)
   * ค่าเริ่มต้นคือ 1 (ลดเต็มที่) — ยืนยันจากการตรวจพิกเซลจริงแล้วว่าลดแค่บางส่วนตามระยะห่างจาก inner/outer
   * (แบบที่เคยลองก่อนหน้านี้) ไม่พอจะทำให้ขอบเขียวหายสนิท ต้องลดเต็มที่ทุกพิกเซลที่ยังมีช่องเด่นเกินช่องอื่นอยู่
   * ถึงจะไม่เหลือคราบให้เห็นเลย */
  spillSuppression: number;
}

export const DEFAULT_CHROMA_KEY_OPTIONS: ChromaKeyOptions = {
  keyColor: { r: 0, g: 203, b: 8 },
  innerTolerance: 20,
  outerTolerance: 195,
  spillSuppression: 1,
};

type DominantChannel = 'r' | 'g' | 'b';

/** หาว่าช่องสีไหนเด่นที่สุดในคีย์สี (มากกว่าหรือเท่ากับอีกสองช่อง) — พื้นหลังเขียวปกติ (0,203,8) จะได้ 'g'
 * แต่รองรับคีย์สีอื่น เช่น blue screen (0,0,255) จะได้ 'b' โดยอัตโนมัติ ไม่ hardcode ช่อง g ไว้ตายตัว */
function pickDominantChannel(key: ChromaKeyColor): DominantChannel {
  if (key.g >= key.r && key.g >= key.b) return 'g';
  if (key.b >= key.r && key.b >= key.g) return 'b';
  return 'r';
}

/** ช่องเด่น "เกิน" อีกสองช่องอยู่เท่าไหร่ — ค่าบวกมากแปลว่าพิกเซลนี้มีสีเด่นแบบเดียวกับคีย์ชัดเจน (ใกล้พื้นหลัง)
 * ค่าติดลบแปลว่าช่องเด่นไม่ได้เด่นเลย (ใกล้เนื้อภาพจริง) ไม่ขึ้นกับความสว่างโดยรวม — จุดสำคัญที่แก้ปัญหาพิกเซล
 * ขอบที่ถูกบีบอัดจนมืดลง (ดู docblock บนสุดของไฟล์) */
function channelExcess(r: number, g: number, b: number, dominant: DominantChannel): number {
  if (dominant === 'g') return g - Math.max(r, b);
  if (dominant === 'b') return b - Math.max(r, g);
  return r - Math.max(g, b);
}

/** "ระยะห่างจากพื้นหลัง" ของพิกเซลหนึ่ง — 0 เมื่อพิกเซลมี channel excess เท่ากับหรือมากกว่าคีย์สี (ใกล้/เขียว
 * เข้มกว่าคีย์เองก็ยังนับเป็นพื้นหลังเต็มที่) ค่ามากขึ้นเรื่อยๆ เมื่อ excess ลดลง (ช่องเด่นเด่นน้อยลงเรื่อยๆ
 * เทียบกับอีกสองช่อง) */
export function chromaKeyDistance(r: number, g: number, b: number, key: ChromaKeyColor): number {
  const dominant = pickDominantChannel(key);
  const keyExcess = channelExcess(key.r, key.g, key.b, dominant);
  const pixelExcess = channelExcess(r, g, b, dominant);
  return Math.max(keyExcess - pixelExcess, 0);
}

/**
 * ลบพื้นหลังสีเขียวออกจากบัฟเฟอร์พิกเซล RGBA แบบแก้ไขในที่ (in-place) — ตรงกับวิธีใช้งานจริงใน
 * ChromaKeyAvatar.tsx ที่เรียก ctx.getImageData() มาแก้ไขแล้ว ctx.putImageData() กลับทันทีโดยไม่ copy
 * บัฟเฟอร์ใหม่ (ประหยัด allocation ทุกเฟรม สำคัญเพราะฟังก์ชันนี้ถูกเรียกซ้ำตลอดเวลาที่วิดีโอเล่นอยู่)
 *
 * คืนค่าจำนวนพิกเซลที่ถูกทำให้โปร่งใสอย่างน้อยบางส่วน (alpha ลดลงจากเดิม) — มีไว้ช่วยเทสต์/debug เท่านั้น
 * ไม่ได้ใช้ค่านี้จริงใน production
 */
export function applyChromaKey(
  pixels: Uint8ClampedArray,
  options: ChromaKeyOptions = DEFAULT_CHROMA_KEY_OPTIONS
): number {
  const { keyColor, innerTolerance, outerTolerance, spillSuppression } = options;
  const dominant = pickDominantChannel(keyColor);
  const range = Math.max(outerTolerance - innerTolerance, 1);
  let affected = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];

    const distance = chromaKeyDistance(r, g, b, keyColor);

    if (distance <= innerTolerance) {
      // เต็มพื้นหลัง — โปร่งใสสนิท
      if (pixels[i + 3] !== 0) affected++;
      pixels[i + 3] = 0;
      continue;
    }

    if (distance < outerTolerance) {
      // โซนขอบ — ไล่ระดับความโปร่งใสเชิงเส้นแทนการตัดเป็นขั้น (ลดรอยหยักที่ขอบเส้นผม) ใช้ Math.min กับ
      // alpha เดิมเสมอ เพื่อไม่ให้ค่านี้ "เพิ่ม" ความทึบของพิกเซลที่โปร่งใสอยู่แล้วจากรอบก่อนหน้าโดยไม่ตั้งใจ
      const edgeAlpha = Math.round(((distance - innerTolerance) / range) * 255);
      const nextAlpha = Math.min(pixels[i + 3], edgeAlpha);
      if (nextAlpha !== pixels[i + 3]) affected++;
      pixels[i + 3] = nextAlpha;

      // ลดคราบสี (spill) ของช่องเด่นเท่านั้น ดึงลงมาเท่า max ของอีกสองช่อง ตามสัดส่วน spillSuppression —
      // ใช้เงื่อนไข currentValue > otherMax กันไว้ (ไม่ได้ใช้ innerTolerance/outerTolerance ที่ตั้งค่าจาก
      // options ตรงๆ) เพื่อไม่ให้พิกเซลที่ช่องเด่นไม่ได้เด่นอยู่แล้วถูกแก้ไขสีทั้งที่ไม่มีคราบให้ลด (กรณีนี้
      // เกิดได้ถ้า outerTolerance ถูกตั้งค่าเองให้มากกว่า channel excess ของคีย์สี)
      const currentValue = dominant === 'g' ? g : dominant === 'b' ? b : r;
      const otherMax = dominant === 'g' ? Math.max(r, b) : dominant === 'b' ? Math.max(r, g) : Math.max(g, b);
      if (currentValue > otherMax) {
        const despilled = Math.round(currentValue - (currentValue - otherMax) * spillSuppression);
        if (dominant === 'g') pixels[i + 1] = despilled;
        else if (dominant === 'b') pixels[i + 2] = despilled;
        else pixels[i] = despilled;
      }
    }
    // distance >= outerTolerance: เนื้อภาพจริง ไม่แตะเลยทั้ง alpha และสี
  }

  return affected;
}
