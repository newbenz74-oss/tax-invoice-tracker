/**
 * ตรรกะล้วนๆ (pure logic) สำหรับลบพื้นหลังสีขาวออกจากรูปโลโก้บริษัทที่ผู้ใช้อัปโหลด — แยกไฟล์ออกจาก
 * component ที่จัดการ <canvas>/<input type="file"> จริง (components/CompanySettingsPage.tsx) ตามธรรมเนียม
 * เดิมของโปรเจกต์นี้ (ตรรกะล้วนๆ + component ที่เรียกใช้ แยกไฟล์กันเสมอ เช่น lib/assistantChromaKey.ts คู่กับ
 * components/ChromaKeyAvatar.tsx) เพื่อให้เทสต์ได้ด้วย Uint8ClampedArray ปลอมๆ โดยไม่ต้องพึ่ง canvas จริงใน
 * เบราว์เซอร์เลย
 *
 * ต่างจาก lib/assistantChromaKey.ts ตรงที่ไฟล์นั้นลบพื้นหลังสีเขียวตายตัว (คีย์สีเดียว วัด "channel excess")
 * แต่ไฟล์นี้ต้องรองรับ "สีขาว" ซึ่งไม่มีช่องสีไหนเด่นกว่าช่องอื่นเลย (r=g=b สูงเท่ากันหมด) — ใช้ตัวชี้วัดคนละแบบ
 * แทน: "ระยะห่างจากสีขาว" = 255 - min(r,g,b) กล่าวคือพิกเซลจะถือว่าใกล้ขาวก็ต่อเมื่อ "ทุกช่องสี" สว่างใกล้ 255
 * พร้อมกัน (แค่ช่องเดียวมืดลงก็ทำให้ระยะห่างเพิ่มขึ้นทันที) วิธีนี้ทนทานต่อโลโก้ที่พื้นหลังไม่ใช่ขาวบริสุทธิ์
 * เป๊ะๆ (เช่น ขาวอมเหลือง 250,248,240 จากการสแกน/ถ่ายรูป) ได้ดีกว่าการเทียบระยะ Euclidean จาก (255,255,255)
 * ตรงๆ เพราะพิกเซลสีเทาอ่อนก็ยังถูกจัดว่า "ใกล้ขาว" ได้ตามสัดส่วนที่ควรจะเป็น
 */

export interface WhiteRemovalOptions {
  /** ระยะห่างจากขาว (ดู whiteDistance) ที่พิกเซลใกล้กว่านี้ถือเป็นพื้นหลังเต็มที่ (โปร่งใสสนิท, alpha = 0) */
  innerTolerance: number;
  /** ระยะที่เริ่มถือว่าเป็นเนื้อโลโก้จริง (ทึบแสงเต็มที่ ไม่แตะเลย) — ระหว่าง innerTolerance กับค่านี้คือ "โซน
   * ขอบ" ที่ alpha ไล่ระดับเชิงเส้นแทนการตัดเป็นขั้นบันได ช่วยลดรอยหยัก (aliasing) รอบขอบโลโก้ที่ผ่านการบีบอัด
   * แบบ JPEG หรือ anti-alias มาจากโปรแกรมออกแบบต้นทาง ต้องมากกว่า innerTolerance เสมอ */
  outerTolerance: number;
}

/** ค่าเริ่มต้น — ปรับจูนจากการทดสอบกับโลโก้ตัวอย่างจริงที่พื้นหลังขาวเกือบบริสุทธิ์ (สแกน/ส่งออกจากโปรแกรม
 * กราฟิก มักมีพื้นหลัง 250-255 ทุกช่อง) innerTolerance ต่ำพอที่จะไม่กินสีขาว/เทาอ่อนมากๆ ที่อาจเป็นส่วนหนึ่งของ
 * ตัวโลโก้เอง (เช่น โลโก้ที่มีตัวอักษรสีเทาอ่อน) แต่สูงพอจะกินพื้นหลังขาวอมเหลือง/อมฟ้าเล็กน้อยจากการสแกนได้ */
export const DEFAULT_WHITE_REMOVAL_OPTIONS: WhiteRemovalOptions = {
  innerTolerance: 14,
  outerTolerance: 70,
};

/** ระยะห่างจากสีขาวของพิกเซลหนึ่ง — 0 เมื่อทุกช่องสีเท่ากับ 255 (ขาวบริสุทธิ์) ค่ามากขึ้นเรื่อยๆ ตามช่องสีที่มืด
 * ที่สุดในพิกเซลนั้น (ไม่ใช่ค่าเฉลี่ย) เพราะแค่ช่องเดียวมืดลงชัดเจนก็เพียงพอจะบอกว่าพิกเซลนี้ "ไม่ใช่ขาวแล้ว" */
export function whiteDistance(r: number, g: number, b: number): number {
  return 255 - Math.min(r, g, b);
}

/**
 * ลบพื้นหลังสีขาวออกจากบัฟเฟอร์พิกเซล RGBA แบบแก้ไขในที่ (in-place) — เรียกครั้งเดียวตอนผู้ใช้เลือกไฟล์โลโก้
 * ใหม่เท่านั้น (ไม่ใช่ทุกเฟรมเหมือน applyChromaKey) จึงไม่ต้องกังวลเรื่อง allocation ซ้ำๆ มากนัก แต่ยังคงแก้ไข
 * ในที่เพื่อความสอดคล้องกับ pattern เดิมของไฟล์พี่น้อง (lib/assistantChromaKey.ts)
 *
 * คืนค่าจำนวนพิกเซลที่ถูกทำให้โปร่งใสอย่างน้อยบางส่วน (alpha ลดลงจากเดิม) — มีไว้ช่วยเทสต์/debug เท่านั้น ไม่ได้
 * ใช้ค่านี้จริงใน production
 */
export function removeWhiteBackground(
  pixels: Uint8ClampedArray,
  options: WhiteRemovalOptions = DEFAULT_WHITE_REMOVAL_OPTIONS
): number {
  const { innerTolerance, outerTolerance } = options;
  const range = Math.max(outerTolerance - innerTolerance, 1);
  let affected = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];

    const distance = whiteDistance(r, g, b);

    if (distance <= innerTolerance) {
      // เต็มพื้นหลังขาว — โปร่งใสสนิท
      if (pixels[i + 3] !== 0) affected++;
      pixels[i + 3] = 0;
      continue;
    }

    if (distance < outerTolerance) {
      // โซนขอบ — ไล่ระดับความโปร่งใสเชิงเส้นแทนการตัดเป็นขั้น (ลดรอยหยักรอบขอบโลโก้) ใช้ Math.min กับ alpha
      // เดิมเสมอ เพื่อไม่ให้ค่านี้ "เพิ่ม" ความทึบของพิกเซลที่โปร่งใสอยู่แล้ว (เช่น ไฟล์ต้นฉบับที่มี alpha
      // channel โปร่งใสบางส่วนอยู่แล้วก่อนประมวลผล)
      const edgeAlpha = Math.round(((distance - innerTolerance) / range) * 255);
      const nextAlpha = Math.min(pixels[i + 3], edgeAlpha);
      if (nextAlpha !== pixels[i + 3]) affected++;
      pixels[i + 3] = nextAlpha;
    }
    // distance >= outerTolerance: เนื้อโลโก้จริง ไม่แตะเลยทั้ง alpha และสี
  }

  return affected;
}
