/**
 * Adapter สำหรับเรียก LLM จริง (Claude หรือ OpenAI) ผ่าน fetch() ธรรมดา — ตั้งใจไม่เพิ่ม npm dependency ใหม่
 * (ไม่มี @anthropic-ai/sdk หรือ openai อยู่แล้วในโปรเจกต์นี้ และ route ที่เรียกไฟล์นี้ก็ inert โดย default
 * อยู่แล้วถ้ายังไม่ตั้งค่า key จริง — ไม่คุ้มที่จะเพิ่ม dependency ใหม่เพื่อ path ที่ยังไม่มีใครใช้งานจริง)
 * เรียกจาก app/api/assistant/chat/route.ts เท่านั้น (ฝั่ง server — ตัวแปร process.env ที่ใช้ในไฟล์นี้ไม่มี
 * prefix NEXT_PUBLIC_ เลยสักตัว จึงไม่ถูกส่งไปที่ฝั่ง client เด็ดขาดตามกฎของ Next.js เอง)
 */

export type AssistantProvider = 'anthropic' | 'openai';

export interface AssistantChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export class AssistantProviderNotConfiguredError extends Error {
  constructor(message = 'ยังไม่ได้ตั้งค่า AI provider จริง (ASSISTANT_PROVIDER + API key ที่เกี่ยวข้อง)') {
    super(message);
    this.name = 'AssistantProviderNotConfiguredError';
  }
}

/** จำกัดขอบเขตของโมเดลให้ตอบแค่เรื่องการใช้งานแอปนี้เท่านั้น และห้ามอ้างว่าทำ action แทนผู้ใช้ได้เด็ดขาด —
 * สอดคล้องกับกฎ "Smart Action" ในสเปกเดิม (ห้าม save/delete/approve/submit แทนผู้ใช้) ผู้ช่วยเวอร์ชัน local
 * (lib/assistantMatcher.ts) เป็นคนสร้างปุ่มนำทาง/ไฮไลต์ที่กดได้จริงเอง — โมเดลฝั่ง remote นี้ไม่เคยส่งคำสั่ง
 * นำทาง/ไฮไลต์กลับมาเลย ตอบเป็นข้อความล้วนๆ เท่านั้น (ดูเหตุผลเรื่องความปลอดภัยเต็มๆ ในแผนงาน — การตรวจสอบ
 * output ของโมเดลที่ไม่ deterministic ให้ปลอดภัยพอจะสั่งนำทางในแอปได้จริงเป็นงานแยกต่างหาก) */
const ASSISTANT_SYSTEM_PROMPT = `คุณคือ ACC Reconcile AI Copilot ผู้ช่วยประจำเว็บแอประบบบัญชี "ACC Reconcile"
(ติดตามใบกำกับภาษี บันทึกค่าใช้จ่าย กระทบยอดธนาคาร และสมุดรายชื่อผู้ติดต่อ) หน้าที่ของคุณคือตอบคำถามเกี่ยวกับ
วิธีใช้งานแอปนี้เท่านั้น พูดสุภาพ เป็นมิตร กระชับ ลงท้ายด้วย "ค่ะ" เสมอ

กฎสำคัญที่ห้ามฝ่าฝืนเด็ดขาด: คุณไม่มีความสามารถบันทึก/แก้ไข/ลบ/อนุมัติ/นำทาง/ไฮไลต์สิ่งใดในระบบได้จริง —
ห้ามอ้างว่าคุณ "กำลังทำ" หรือ "ทำให้แล้ว" การกระทำใดๆ ในระบบเด็ดขาด บอกผู้ใช้แค่ขั้นตอนที่ตัวเขาเองต้องทำเอง
เท่านั้น ถ้าคำถามอยู่นอกเหนือเรื่องการใช้งานแอปนี้ ให้บอกตรงๆ ว่าคุณช่วยได้แค่เรื่องการใช้งานแอปนี้เท่านั้น`;

interface ProviderConfig {
  provider: AssistantProvider;
  apiKey: string;
}

function resolveProviderConfig(): ProviderConfig | null {
  const provider = (process.env.ASSISTANT_PROVIDER ?? '').toLowerCase();
  if (provider === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    return apiKey ? { provider: 'anthropic', apiKey } : null;
  }
  if (provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    return apiKey ? { provider: 'openai', apiKey } : null;
  }
  return null;
}

/** ใช้ตรวจสอบก่อนเรียกจริงใน route handler เพื่อคืนค่า 503 ที่สื่อความหมายชัดเจนตั้งแต่ต้น แทนที่จะปล่อยให้
 * ไปเจอ error ลึกๆ ข้างในการเรียก provider */
export function isAssistantProviderConfigured(): boolean {
  return resolveProviderConfig() !== null;
}

async function callAnthropic(apiKey: string, query: string, history: AssistantChatTurn[]): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 512,
      system: ASSISTANT_SYSTEM_PROMPT,
      messages: [...history.map((turn) => ({ role: turn.role, content: turn.text })), { role: 'user', content: query }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const data = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = data.content?.find((block) => block.type === 'text')?.text;
  if (!text) throw new Error('Anthropic API ไม่ได้ส่งข้อความตอบกลับมา');
  return text;
}

async function callOpenAI(apiKey: string, query: string, history: AssistantChatTurn[]): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 512,
      messages: [
        { role: 'system', content: ASSISTANT_SYSTEM_PROMPT },
        ...history.map((turn) => ({ role: turn.role, content: turn.text })),
        { role: 'user', content: query },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenAI API ไม่ได้ส่งข้อความตอบกลับมา');
  return text;
}

/** เรียก LLM จริงตาม provider ที่ตั้งค่าไว้ — throw ปกติเสมอ (เป็น layer ล่าง ไม่ใช่จุดที่ควร swallow error
 * — ดู lib/assistantService.ts สำหรับจุดเดียวที่ catch error จากฟังก์ชันนี้แล้ว fallback กลับ local mode) */
export async function callAssistantProvider(query: string, history: AssistantChatTurn[]): Promise<string> {
  const config = resolveProviderConfig();
  if (!config) {
    throw new AssistantProviderNotConfiguredError();
  }
  if (config.provider === 'anthropic') {
    return callAnthropic(config.apiKey, query, history);
  }
  return callOpenAI(config.apiKey, query, history);
}
