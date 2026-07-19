import { beforeEach, describe, expect, it, vi } from 'vitest';

// mock ต้องอยู่ก่อน import อื่นๆ ในไฟล์ (vi.mock ถูก hoist ขึ้นบนสุดโดย vitest เองอยู่แล้ว แต่ vi.hoisted
// จำเป็นเพื่อให้ factory ข้างล่างอ้างอิงตัวแปร mock function ได้โดยไม่ throw "Cannot access before
// initialization") คง AssistantProviderNotConfiguredError ไว้เป็น class จริงเสมอ เพราะ route.ts เช็คด้วย
// instanceof กับ class นี้ — mock เฉพาะสองฟังก์ชันที่ยิง network/อ่าน env จริงเท่านั้น
const mocks = vi.hoisted(() => ({
  isAssistantProviderConfigured: vi.fn(),
  callAssistantProvider: vi.fn(),
}));

vi.mock('@/lib/assistantProviders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/assistantProviders')>();
  return {
    ...actual,
    isAssistantProviderConfigured: mocks.isAssistantProviderConfigured,
    callAssistantProvider: mocks.callAssistantProvider,
  };
});

const { POST } = await import('./route');
const { AssistantProviderNotConfiguredError } = await import('@/lib/assistantProviders');

function makeRequest(body: unknown, rawBody?: string): Request {
  return new Request('http://localhost/api/assistant/chat', {
    method: 'POST',
    body: rawBody ?? JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.isAssistantProviderConfigured.mockReset();
  mocks.callAssistantProvider.mockReset();
});

describe('POST /api/assistant/chat', () => {
  it('คืน 503 ทันทีถ้ายังไม่ได้ตั้งค่า provider เลย (เช็คตั้งแต่ต้นก่อน parse body ด้วยซ้ำ)', async () => {
    mocks.isAssistantProviderConfigured.mockReturnValue(false);
    const response = await POST(makeRequest({ query: 'สวัสดี' }));
    expect(response.status).toBe(503);
    const data = await response.json();
    expect(data.error).toBe('not_configured');
    expect(mocks.callAssistantProvider).not.toHaveBeenCalled();
  });

  it('คืน 400 ถ้า body ไม่ใช่ JSON ที่ถูกต้อง', async () => {
    mocks.isAssistantProviderConfigured.mockReturnValue(true);
    const response = await POST(makeRequest(undefined, 'not json{{{'));
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('invalid_json');
  });

  it('คืน 400 ถ้า query ว่างเปล่าหรือมีแต่ช่องว่าง', async () => {
    mocks.isAssistantProviderConfigured.mockReturnValue(true);
    const response = await POST(makeRequest({ query: '   ' }));
    expect(response.status).toBe(400);
    expect(mocks.callAssistantProvider).not.toHaveBeenCalled();
  });

  it('คืน 400 ถ้า query ยาวเกิน 2000 ตัวอักษร', async () => {
    mocks.isAssistantProviderConfigured.mockReturnValue(true);
    const response = await POST(makeRequest({ query: 'a'.repeat(2001) }));
    expect(response.status).toBe(400);
  });

  it('คืน 400 ถ้า history มีรูปแบบไม่ถูกต้อง (role ที่ไม่รู้จัก)', async () => {
    mocks.isAssistantProviderConfigured.mockReturnValue(true);
    const response = await POST(makeRequest({ query: 'สวัสดี', history: [{ role: 'bot', text: 'x' }] }));
    expect(response.status).toBe(400);
    expect(mocks.callAssistantProvider).not.toHaveBeenCalled();
  });

  it('คืน 200 พร้อมข้อความตอบกลับเมื่อสำเร็จ', async () => {
    mocks.isAssistantProviderConfigured.mockReturnValue(true);
    mocks.callAssistantProvider.mockResolvedValue('คำตอบจาก AI');
    const response = await POST(makeRequest({ query: 'บันทึกการจ่ายเงินทำงานยังไง' }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.text).toBe('คำตอบจาก AI');
  });

  it('คืน 502 เมื่อ provider throw error ทั่วไป (เช่น network/API error)', async () => {
    mocks.isAssistantProviderConfigured.mockReturnValue(true);
    mocks.callAssistantProvider.mockRejectedValue(new Error('network down'));
    const response = await POST(makeRequest({ query: 'สวัสดี' }));
    expect(response.status).toBe(502);
    const data = await response.json();
    expect(data.error).toBe('provider_error');
  });

  it('คืน 503 ถ้า provider throw AssistantProviderNotConfiguredError ตอนเรียกจริง (race condition ระหว่างเช็คตอนต้นกับตอนเรียกจริง)', async () => {
    mocks.isAssistantProviderConfigured.mockReturnValue(true);
    mocks.callAssistantProvider.mockRejectedValue(new AssistantProviderNotConfiguredError());
    const response = await POST(makeRequest({ query: 'สวัสดี' }));
    expect(response.status).toBe(503);
    const data = await response.json();
    expect(data.error).toBe('not_configured');
  });

  it('ตัด history ให้เหลือแค่ 10 รายการล่าสุดก่อนส่งต่อให้ provider', async () => {
    mocks.isAssistantProviderConfigured.mockReturnValue(true);
    mocks.callAssistantProvider.mockResolvedValue('ok');
    const history = Array.from({ length: 15 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      text: `turn-${i}`,
    }));
    await POST(makeRequest({ query: 'สวัสดี', history }));
    expect(mocks.callAssistantProvider).toHaveBeenCalledTimes(1);
    const passedHistory = mocks.callAssistantProvider.mock.calls[0][1];
    expect(passedHistory).toHaveLength(10);
    expect(passedHistory[0].text).toBe('turn-5');
    expect(passedHistory[9].text).toBe('turn-14');
  });
});
