import { describe, expect, it } from 'vitest';
import { splitThaiToneMarks } from './pdfThaiFont';

describe('splitThaiToneMarks', () => {
  it('ข้อความที่ไม่มีคู่ "สระบน+วรรณยุกต์" คืนค่าเดิมทั้งดุ้น ไม่มีอะไรถูกถอด', () => {
    for (const line of ['', 'Purchase Tax Report 2569', 'ค่าจ้าง', 'ข้อความ', 'กรกฎาคม']) {
      expect(splitThaiToneMarks(line)).toEqual({ text: line, marks: [] });
    }
  });

  it('วรรณยุกต์ที่ซ้อนบน "พยัญชนะเปล่า" ไม่ถูกถอด — jsPDF วาดตำแหน่งนั้นถูกอยู่แล้ว (เช่น ค่า, ข้อ, ก๊, เก๋)', () => {
    expect(splitThaiToneMarks('ค่าจ้าง ก๊าซ เก๋ง').marks).toEqual([]);
  });

  it('ถอดไม้เอกที่ซ้อนบนสระอี พร้อมบอกสระบนและข้อความส่วนหน้าที่ใช้หาตำแหน่ง x', () => {
    expect(splitThaiToneMarks('ที่จ่าย')).toEqual({
      text: 'ทีจ่าย',
      marks: [{ char: '่', prefix: 'ที', vowel: 'ี' }],
    });
  });

  it('รองรับวรรณยุกต์ครบทั้ง 4 ตัว (ไม่ใช่แค่ไม้เอกแบบโค้ดเวอร์ชันก่อน)', () => {
    expect(splitThaiToneMarks('บี่ บี้ บี๊ บี๋').marks.map((m) => m.char)).toEqual(['่', '้', '๊', '๋']);
  });

  it('รองรับสระบนครบทั้ง 6 ตัว', () => {
    const marks = splitThaiToneMarks('บั่ บิ่ บี่ บึ่ บื่ บ็่').marks;
    expect(marks.map((m) => m.vowel)).toEqual(['ั', 'ิ', 'ี', 'ึ', 'ื', '็']);
  });

  it('หลายคู่ในบรรทัดเดียว — prefix ของแต่ละตัวเป็นข้อความ "หลังถอดแล้ว" สะสมไปเรื่อยๆ ไม่ใช่ข้อความต้นฉบับ', () => {
    const { text, marks } = splitThaiToneMarks('เบี้ยเลี้ยง');
    expect(text).toBe('เบียเลียง');
    expect(marks).toEqual([
      { char: '้', prefix: 'เบี', vowel: 'ี' },
      { char: '้', prefix: 'เบียเลี', vowel: 'ี' },
    ]);
  });

  it('ต่อข้อความที่ถอดแล้วกลับเข้ากับวรรณยุกต์ตามลำดับ prefix ต้องได้ต้นฉบับเป๊ะ (กันตัวอักษรตกหล่น/สลับ)', () => {
    for (const line of [
      'เบี้ยเลี้ยง',
      'อัตราอื่นๆ(ระบุ)........... ของกำไรสุทธิ',
      'หนังสือรับรองการหักภาษี ณ ที่จ่าย',
      'รายงานภาษีซื้อ (Purchase Tax Report)',
      'ผู้มีหน้าที่หักภาษี ณ ที่จ่าย : -',
    ]) {
      const { text, marks } = splitThaiToneMarks(line);
      let rebuilt = '';
      let drawn = '';
      for (const mark of marks) {
        rebuilt += mark.prefix.slice(drawn.length) + mark.char;
        drawn = mark.prefix;
      }
      rebuilt += text.slice(drawn.length);
      expect(rebuilt).toBe(line);
    }
  });

  it('ข้อความที่ถอดแล้วต้องไม่มีวรรณยุกต์ที่เป็นปัญหาเหลืออยู่เลย', () => {
    const { text } = splitThaiToneMarks('เบี้ยเลี้ยง ที่นี่ ผู้ที่ได้รับ ซื้อ หนึ่ง');
    expect(/[ัิีึื็][่้๊๋]/.test(text)).toBe(false);
  });

  it('วรรณยุกต์ซ้อนกันเองผิดรูป (สระบน+วรรณยุกต์+วรรณยุกต์) ถอดออกทั้งสองตัว โดยตัวที่สองยังอ้างสระบนตัวเดิม', () => {
    const { text, marks } = splitThaiToneMarks('บี่้น');
    expect(text).toBe('บีน');
    expect(marks).toEqual([
      { char: '่', prefix: 'บี', vowel: 'ี' },
      { char: '้', prefix: 'บี', vowel: 'ี' },
    ]);
  });
});
