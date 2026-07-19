import { describe, expect, it } from 'vitest';
import { parseNavigationCommand, resolveNavTarget } from './assistantNavResolver';

describe('resolveNavTarget', () => {
  it('resolve id ที่มีจริงและ implemented แล้ว', () => {
    const result = resolveNavTarget('bank-reconcile');
    expect(result).not.toBeNull();
    expect(result?.implemented).toBe(true);
    expect(result?.label).toBe('Bank Reconcile');
  });

  it('คืนค่า null สำหรับ id ที่ไม่มีจริงในระบบ', () => {
    expect(resolveNavTarget('this-id-does-not-exist')).toBeNull();
  });

  it('resolve id ที่ hidden:true ได้ตามปกติ (ไม่อยู่ใน Sidebar แต่ยังเปิดใช้งานได้จริง)', () => {
    const result = resolveNavTarget('overdue-purchase-tax');
    expect(result).not.toBeNull();
    expect(result?.implemented).toBe(true);
  });

  it('resolve id ที่ implemented:false ได้เช่นกัน (implemented ต้องเป็น false ให้ผู้เรียกกำกับข้อความถูกต้อง)', () => {
    const result = resolveNavTarget('sales-tax-report');
    expect(result).not.toBeNull();
    expect(result?.implemented).toBe(false);
  });

  it('id ของหมวด (section, ไม่ใช่หน้าเนื้อหา) ไม่ resolve เป็นเป้าหมายนำทางได้', () => {
    expect(resolveNavTarget('accounting')).toBeNull();
    expect(resolveNavTarget('master-data')).toBeNull();
  });
});

describe('parseNavigationCommand', () => {
  it('จับคู่คำสั่งนำทางที่คัดสรรไว้ได้ถูกต้อง', () => {
    const result = parseNavigationCommand('ช่วยไปหน้า bank reconcile ให้หน่อย');
    expect(result?.id).toBe('bank-reconcile');
  });

  it('ข้อความคำถามธรรมดาที่ไม่ใช่คำสั่งนำทาง ต้องไม่ false-positive', () => {
    expect(parseNavigationCommand('บันทึกการจ่ายเงินทำงานยังไง')).toBeNull();
  });

  it('ข้อความว่างไม่ throw และคืนค่า null', () => {
    expect(parseNavigationCommand('')).toBeNull();
  });

  it('จับคู่คำสั่งไปหน้าที่ hidden:true ได้เช่นกัน', () => {
    const result = parseNavigationCommand('เปิดภาษีซื้อที่ยังไม่ได้รับ');
    expect(result?.id).toBe('overdue-purchase-tax');
  });
});
