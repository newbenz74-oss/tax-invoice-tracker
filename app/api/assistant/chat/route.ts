import {
  AssistantProviderNotConfiguredError,
  callAssistantProvider,
  isAssistantProviderConfigured,
  type AssistantChatTurn,
} from '@/lib/assistantProviders';

/**
 * Route Handler แรกและตัวเดียวในแอปนี้ ณ ตอนนี้ (ทั้งแอปเดิมเป็น client-only ผ่าน Supabase browser client
 * ล้วนๆ) — ยืนยันแล้วว่ารูปแบบ `export async function POST(request: Request)` + `Response.json()` เป็น API
 * ปกติของ App Router เวอร์ชันนี้ ไม่ใช่จุดที่มี breaking change (เทียบกับ node_modules/next/dist/docs/01-app/
 * 03-api-reference/03-file-conventions/route.md ที่มีตัวอย่าง LLM proxy คล้ายกันนี้เป๊ะ) เป็น server-only —
 * ตัวแปร ANTHROPIC_API_KEY/OPENAI_API_KEY ที่ lib/assistantProviders.ts อ่านไม่มี prefix NEXT_PUBLIC_ จึงไม่
 * เคยถูกส่งไปฝั่ง client เด็ดขาด
 *
 * เรียกจาก lib/assistantService.ts เท่านั้น และเรียกก็ต่อเมื่อ (1) จับคู่ local knowledge base ไม่มั่นใจพอ
 * และ (2) NEXT_PUBLIC_ASSISTANT_REMOTE_ENABLED === 'true' ถูกตั้งไว้อย่างชัดเจน — ดีฟอลต์ทั้งสองเงื่อนไขนี้
 * ไม่ถูกเรียกเลย (Local Mode ตามที่ผู้ใช้เลือก)
 */

const MAX_QUERY_LENGTH = 2000;
const MAX_HISTORY_TURNS = 10;

interface ChatRequestBody {
  query?: unknown;
  history?: unknown;
}

function isValidHistory(value: unknown): value is AssistantChatTurn[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (turn) =>
      typeof turn === 'object' &&
      turn !== null &&
      (('role' in turn && (turn as { role: unknown }).role === 'user') ||
        (turn as { role: unknown }).role === 'assistant') &&
      typeof (turn as { text: unknown }).text === 'string'
  );
}

export async function POST(request: Request): Promise<Response> {
  if (!isAssistantProviderConfigured()) {
    return Response.json({ error: 'not_configured' }, { status: 503 });
  }

  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query || query.length > MAX_QUERY_LENGTH) {
    return Response.json({ error: 'invalid_query' }, { status: 400 });
  }

  const rawHistory = body.history ?? [];
  if (!isValidHistory(rawHistory)) {
    return Response.json({ error: 'invalid_history' }, { status: 400 });
  }
  const history = rawHistory.slice(-MAX_HISTORY_TURNS);

  try {
    const text = await callAssistantProvider(query, history);
    return Response.json({ text });
  } catch (error) {
    if (error instanceof AssistantProviderNotConfiguredError) {
      return Response.json({ error: 'not_configured' }, { status: 503 });
    }
    return Response.json({ error: 'provider_error' }, { status: 502 });
  }
}
