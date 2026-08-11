import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { getPromptDefinition } from '@/lib/ai-prompts/catalog';
import { renderManagedPrompt } from '@/lib/ai-prompts/runtime';

const MAX_REQUEST_BYTES = 48 * 1024;
const MAX_VARIABLES = 12;
const ALLOWED_IMAGE_PROMPT_IDS = new Set([
  'image.tachie.character-positive',
  'image.tachie.character-negative',
  'image.tachie.team-remnant',
  'image.creator.compatible',
  'image.arena.illustration',
  'image.tea-party.character',
  'image.tea-party.scene',
]);

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const normalizeVariable = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
};

export const handleTachieSuggestPrompt = async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ error: '不支持的请求方法' }, 405);

  let body: unknown;
  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
      return json({ error: '请求体过大' }, 413);
    }
    body = JSON.parse(raw) as unknown;
  } catch {
    return json({ error: '请求体不是合法 JSON' }, 400);
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: '请求体必须是 JSON 对象' }, 400);
  const record = body as { promptId?: unknown; variables?: unknown };
  const promptId = typeof record.promptId === 'string' ? record.promptId.trim() : '';
  if (!ALLOWED_IMAGE_PROMPT_IDS.has(promptId)) return json({ error: '不允许的图像提示词 ID' }, 400);

  const definition = getPromptDefinition(promptId);
  if (!definition || definition.kind !== 'image') return json({ error: '图像提示词不存在' }, 400);
  const rawVariables = record.variables;
  if (rawVariables !== undefined && (!rawVariables || typeof rawVariables !== 'object' || Array.isArray(rawVariables))) {
    return json({ error: 'variables 必须是 JSON 对象' }, 400);
  }
  const variables: Record<string, string> = {};
  for (const [key, value] of Object.entries((rawVariables ?? {}) as Record<string, unknown>)) {
    if (Object.keys(variables).length >= MAX_VARIABLES) return json({ error: 'variables 数量过多' }, 400);
    if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(key)) return json({ error: 'variables 名称无效' }, 400);
    variables[key] = normalizeVariable(value);
  }

  try {
    const prompt = await renderManagedPrompt(getDrizzleDbFromRuntime(), { id: promptId, variables });
    return json({ prompt, promptId, source: 'managed' });
  } catch {
    // A transient D1 failure must not blank an image suggestion. Render the
    // immutable code default without exposing the failure or any credentials.
    try {
      const prompt = await renderManagedPrompt(null, { id: promptId, variables });
      return json({ prompt, promptId, source: 'default' });
    } catch {
      return json({ error: '图像提示词暂不可用' }, 503);
    }
  }
};

export const POST = handleTachieSuggestPrompt;
