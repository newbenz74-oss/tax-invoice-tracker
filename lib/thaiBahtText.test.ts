import { describe, expect, it } from 'vitest';
import { numberToThaiText, thaiBahtText } from './thaiBahtText';

describe('numberToThaiText', () => {
  it('ศูนย์', () => {
    expect(numberToThaiText(0)).toBe('ศูนย์');
  });

  it('เลขหลักเดียว 1 -> หนึ่ง (ไม่ใช่เอ็ด เพราะเป็นเลขโดดๆ)', () => {
    expect(numberToThaiText(1)).toBe('หนึ่ง');
  });

  it('11 -> สิบเอ็ด', () => {
    expect(numberToThaiText(11)).toBe('สิบเอ็ด');
  });

  it('10 -> สิบ (ไม่ใช่หนึ่งสิบ)', () => {
    expect(numberToThaiText(10)).toBe('สิบ');
  });

  it('21 -> ยี่สิบเอ็ด', () => {
    expect(numberToThaiText(21)).toBe('ยี่สิบเอ็ด');
  });

  it('20 -> ยี่สิบ (ไม่ใช่สองสิบ)', () => {
    expect(numberToThaiText(20)).toBe('ยี่สิบ');
  });

  it('100 -> หนึ่งร้อย', () => {
    expect(numberToThaiText(100)).toBe('หนึ่งร้อย');
  });

  it('101 -> หนึ่งร้อยเอ็ด', () => {
    expect(numberToThaiText(101)).toBe('หนึ่งร้อยเอ็ด');
  });

  it('42800 -> สี่หมื่นสองพันแปดร้อย', () => {
    expect(numberToThaiText(42800)).toBe('สี่หมื่นสองพันแปดร้อย');
  });

  it('1302 -> หนึ่งพันสามร้อยสอง', () => {
    expect(numberToThaiText(1302)).toBe('หนึ่งพันสามร้อยสอง');
  });

  it('1000000 -> หนึ่งล้าน', () => {
    expect(numberToThaiText(1000000)).toBe('หนึ่งล้าน');
  });

  it('1000001 -> หนึ่งล้านเอ็ด', () => {
    expect(numberToThaiText(1000001)).toBe('หนึ่งล้านเอ็ด');
  });

  it('2500000 -> สองล้านห้าแสน', () => {
    expect(numberToThaiText(2500000)).toBe('สองล้านห้าแสน');
  });

  it('จำนวนติดลบ -> throw', () => {
    expect(() => numberToThaiText(-5)).toThrow();
  });

  it('จำนวนไม่ใช่เลขเต็ม -> throw', () => {
    expect(() => numberToThaiText(1.5)).toThrow();
  });
});

describe('thaiBahtText', () => {
  it('0 -> ศูนย์บาทถ้วน', () => {
    expect(thaiBahtText(0)).toBe('ศูนย์บาทถ้วน');
  });

  it('42800.00 -> สี่หมื่นสองพันแปดร้อยบาทถ้วน (ไม่มีเศษสตางค์)', () => {
    expect(thaiBahtText(42800)).toBe('สี่หมื่นสองพันแปดร้อยบาทถ้วน');
  });

  it('1302.00 -> หนึ่งพันสามร้อยสองบาทถ้วน (ยอดหัก ณ ที่จ่ายจริงจากตัวอย่างผู้ใช้)', () => {
    expect(thaiBahtText(1302)).toBe('หนึ่งพันสามร้อยสองบาทถ้วน');
  });

  it('มีเศษสตางค์ -> ...บาท...สตางค์', () => {
    expect(thaiBahtText(1250.75)).toBe('หนึ่งพันสองร้อยห้าสิบบาทเจ็ดสิบห้าสตางค์');
  });

  it('สตางค์เดียว -> หนึ่งสตางค์ (ไม่ใช่เอ็ดสตางค์ เพราะเลขสตางค์โดดๆ)', () => {
    expect(thaiBahtText(10.01)).toBe('สิบบาทหนึ่งสตางค์');
  });

  it('สตางค์ 11 -> สิบเอ็ดสตางค์', () => {
    expect(thaiBahtText(5.11)).toBe('ห้าบาทสิบเอ็ดสตางค์');
  });

  it('ปัดเศษ floating point error (0.1 บาท ในไบนารีจริงคือ 0.0999...) ยังได้ 10 สตางค์ถูกต้อง', () => {
    expect(thaiBahtText(0.1)).toBe('ศูนย์บาทสิบสตางค์');
  });

  it('จำนวนติดลบ -> ขึ้นต้นด้วยลบ', () => {
    expect(thaiBahtText(-100)).toBe('ลบหนึ่งร้อยบาทถ้วน');
  });

  it('หนึ่งล้านบาทถ้วน', () => {
    expect(thaiBahtText(1000000)).toBe('หนึ่งล้านบาทถ้วน');
  });
});
