import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAssistantReply } from './assistantService';

describe('getAssistantReply', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('จับคู่ฐานความรู้ในเครื่องได้มั่นใจ → ตอบจาก local ทันที ไม่ยิง fetch เลย', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const reply = await getAssistantReply('bank reconcile ทำงานยังไง', { activeId: 'bank-reconcile' });
    expect(reply.source).toBe('local');
    expect(reply.text).toContain('Bank Reconcile');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('จับคู่ไม่มั่นใจ + ปิด remote ไว้ (ดีฟอลต์) → ตอบข้อความสำรอง ไม่ยิง fetch เลย', async () => {
    vi.stubEnv('NEXT_PUBLIC_ASSISTANT_REMOTE_ENABLED', 'false');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const reply = await getAssistantReply('อากาศวันนี้เป็นยังไงบ้าง', { activeId: null });
    expect(reply.source).toBe('local');
    expect(reply.text).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('จับคู่ไม่มั่นใจ + เปิด remote ไว้ + fetch สำเร็จ → ตอบจาก remote', async () => {
    vi.stubEnv('NEXT_PUBLIC_ASSISTANT_REMOTE_ENABLED', 'true');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ text: 'คำตอบจาก AI จริง' }), { status: 200 })
    );
    const reply = await getAssistantReply('อากาศวันนี้เป็นยังไงบ้าง', { activeId: null });
    expect(reply.source).toBe('remote');
    expect(reply.text).toBe('คำตอบจาก AI จริง');
  });

  it('จับคู่ไม่มั่นใจ + เปิด remote ไว้ + fetch reject (เครือข่ายพัง) → fallback กลับ local เสมอ ไม่ throw ออกไป', async () => {
    vi.stubEnv('NEXT_PUBLIC_ASSISTANT_REMOTE_ENABLED', 'true');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    const reply = await getAssistantReply('อากาศวันนี้เป็นยังไงบ้าง', { activeId: null });
    expect(reply.source).toBe('local');
    expect(reply.text).toBeTruthy();
  });

  it('จับคู่ไม่มั่นใจ + เปิด remote ไว้ + response ไม่ใช่ 2xx → fallback กลับ local เสมอ', async () => {
    vi.stubEnv('NEXT_PUBLIC_ASSISTANT_REMOTE_ENABLED', 'true');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'not_configured' }), { status: 503 })
    );
    const reply = await getAssistantReply('อากาศวันนี้เป็นยังไงบ้าง', { activeId: null });
    expect(reply.source).toBe('local');
  });

  it('คำสั่งนำทางไปหน้าที่มีจริงและ implemented แล้ว → คืน suggestion นำทางที่ถูกต้อง ไม่ผ่าน knowledge base เลย', async () => {
    const reply = await getAssistantReply('ไปหน้า bank reconcile ให้หน่อย', { activeId: null });
    expect(reply.suggestions).toHaveLength(1);
    expect(reply.suggestions[0]).toMatchObject({ kind: 'navigate', navigateTo: 'bank-reconcile' });
    expect(reply.source).toBe('local');
  });

  it('query ว่างเปล่าไม่ throw และยังคืนคำตอบสำรองมาให้เสมอ', async () => {
    await expect(getAssistantReply('', { activeId: null })).resolves.toMatchObject({ source: 'local' });
  });
});
