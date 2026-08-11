import { adminJson, requireAdminUser } from '@/lib/auth/admin';
import {
  MAX_PROMPT_BODY_BYTES,
  MAX_PROMPT_CHANGE_NOTE_LENGTH,
  PromptRevisionConflictError,
  getManagedPrompt,
  listManagedPrompts,
  listPromptHistory,
  resetPromptOverride,
  rollbackPromptOverride,
  savePromptVersionCas,
} from '@/lib/ai-prompts/repository';
import { getPromptDefinition } from '@/lib/ai-prompts/catalog';
import { installRuntimePromptOverride } from '@/lib/ai-prompts/runtime';
import { promptByteLength, validatePromptTemplate } from '@/lib/ai-prompts/template';

const MAX_REQUEST_BYTES = 96 * 1024;
const MAX_BULK_ITEMS = 200;
const MAX_BULK_BYTES = 2 * 1024 * 1024;

type AdminPromptAction = 'base' | 'history' | 'bulk' | 'rollback' | 'import' | 'export';

const getClientIp = (req: Request): string | null =>
  req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

const readBody = async (req: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> => {
  const pathname = new URL(req.url).pathname;
  const maxBytes = /\/ai-prompts\/(?:bulk|import)$/.test(pathname) ? MAX_BULK_BYTES : MAX_REQUEST_BYTES;
  const tooLarge = () => ({
    ok: false as const,
    response: adminJson({ error: `请求体不能超过 ${Math.floor(maxBytes / 1024)} KiB` }, 413),
  });
  const contentLength = req.headers.get('content-length');
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) return tooLarge();
  }
  try {
    if (!req.body) return { ok: false, response: adminJson({ error: '请求体不是合法 JSON' }, 400) };
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return tooLarge();
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const raw = new TextDecoder().decode(bytes);
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, response: adminJson({ error: '请求体不是合法 JSON' }, 400) };
  }
};

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

const normalizePromptId = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const normalizeRevision = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error('expectedRevision 必须是字符串或 null');
  const revision = value.trim();
  if (!revision || revision.length > 128) throw new Error('expectedRevision 无效');
  return revision;
};

const decodeHistoryCursor = (value: string | null): { createdAt: string; id: string } | null => {
  if (!value) return null;
  if (value.length > 256) throw new Error('历史游标无效');
  const separator = value.lastIndexOf('|');
  if (separator <= 0 || separator === value.length - 1) throw new Error('历史游标无效');
  const createdAt = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (createdAt.length > 64 || !Number.isFinite(Date.parse(createdAt)) || id.length > 128) {
    throw new Error('历史游标无效');
  }
  return { createdAt, id };
};

const normalizeChangeNote = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('每次变更都必须填写简短变更说明');
  const note = value.trim();
  if (!note) throw new Error('每次变更都必须填写简短变更说明');
  if (note.length > MAX_PROMPT_CHANGE_NOTE_LENGTH) throw new Error(`变更说明不能超过 ${MAX_PROMPT_CHANGE_NOTE_LENGTH} 个字符`);
  return note;
};

const responsePrompt = (prompt: Awaited<ReturnType<typeof getManagedPrompt>>) => ({
  id: prompt.id,
  kind: prompt.kind,
  category: prompt.category,
  name: prompt.name,
  description: prompt.description,
  active: prompt.active,
  managementMode: prompt.managementMode ?? (prompt.active ? 'replace' : 'inventory'),
  source: prompt.source,
  defaultBody: prompt.defaultBody,
  effectiveBody: prompt.body,
  variables: prompt.slots,
  revision: prompt.revision,
  previousRevision: prompt.previousRevision,
  action: prompt.action,
  isOverridden: prompt.isOverridden,
  isDefault: prompt.isDefault,
  updatedAt: prompt.updatedAt,
  defaultChanged: prompt.defaultBody !== prompt.body && !prompt.isDefault,
  invalidOverride: prompt.invalidOverride,
});

const mutationAudit = (req: Request) => ({
  ip: getClientIp(req),
  userAgent: req.headers.get('user-agent'),
});

const validateBodyForPrompt = (promptId: string, body: unknown): { ok: true; body: string } | { ok: false; response: Response } => {
  const definition = getPromptDefinition(promptId);
  if (!definition) return { ok: false, response: adminJson({ error: '未知的提示词 ID' }, 400) };
  if (typeof body !== 'string') return { ok: false, response: adminJson({ error: 'template 必须是字符串' }, 400) };
  if (promptByteLength(body) > MAX_PROMPT_BODY_BYTES) return { ok: false, response: adminJson({ error: '提示词正文不能超过 64 KiB' }, 413) };
  const validation = validatePromptTemplate({ template: body, slots: definition.slots });
  if (!validation.ok) return { ok: false, response: adminJson({ error: validation.error.message, code: validation.error.code }, 400) };
  return { ok: true, body };
};

const handleSave = async (req: Request, auth: Extract<Awaited<ReturnType<typeof requireAdminUser>>, { user: unknown }>, body: Record<string, unknown>, action: 'save' | 'reset' | 'import') => {
  const promptId = normalizePromptId(body.promptId);
  const expectedRevision = normalizeRevision(body.expectedRevision);
  const changeNote = normalizeChangeNote(body.changeNote);
  const template = body.template ?? body.effectiveBody ?? body.body;
  if (action === 'reset' || body.template === null) {
    const saved = await resetPromptOverride(auth.db, {
      promptId,
      expectedRevision,
      userId: auth.user.id,
      changeNote,
      audit: mutationAudit(req),
    });
    installRuntimePromptOverride(saved);
    return adminJson({ success: true, prompt: responsePrompt(await getManagedPrompt(auth.db, promptId)) }, 200);
  }
  const validated = validateBodyForPrompt(promptId, template);
  if (!validated.ok) return validated.response;
  const saved = await savePromptVersionCas(auth.db, {
    promptId,
    body: validated.body,
    expectedRevision,
    userId: auth.user.id,
    changeNote,
    action,
    isDefault: false,
    audit: mutationAudit(req),
  });
  installRuntimePromptOverride(saved);
  return adminJson({ success: true, prompt: responsePrompt(await getManagedPrompt(auth.db, promptId)) }, 200);
};

const handleBulk = async (req: Request, auth: Extract<Awaited<ReturnType<typeof requireAdminUser>>, { user: unknown }>, payload: Record<string, unknown>, action: 'save' | 'import') => {
  const promptsObject = asObject(payload.prompts);
  const rawItems = Array.isArray(payload.items)
    ? payload.items
    : Array.isArray(payload.prompts)
      ? payload.prompts
    : promptsObject
      ? Object.entries(promptsObject).map(([promptId, value]) => typeof value === 'string'
        ? { promptId, template: value }
        : { promptId, ...(asObject(value) ?? {}) })
      : [];
  if (rawItems.length === 0 || rawItems.length > MAX_BULK_ITEMS) return adminJson({ error: `批量项目数量必须为 1-${MAX_BULK_ITEMS}` }, 400);
  if (promptByteLength(JSON.stringify(payload)) > MAX_BULK_BYTES) return adminJson({ error: '批量导入内容过大' }, 413);
  const globalNote = normalizeChangeNote(payload.changeNote);
  const seenIds = new Set<string>();
  const preparedItems: Array<Record<string, unknown> & { promptId: string; expectedRevision: string | null | undefined; changeNote: string; template: string | null }> = [];
  for (const rawItem of rawItems) {
    const item = asObject(rawItem);
    if (!item) return adminJson({ error: '批量项目格式无效' }, 400);
    const promptId = normalizePromptId(item.promptId ?? item.id);
    const definition = getPromptDefinition(promptId);
    if (!definition) return adminJson({ error: `未知的提示词 ID：${promptId || '(空)'}` }, 400);
    if (seenIds.has(promptId)) return adminJson({ error: `批量项目包含重复的提示词 ID：${promptId}` }, 400);
    seenIds.add(promptId);
    const itemNote = item.changeNote === undefined ? globalNote : normalizeChangeNote(item.changeNote);
    const expectedRevision = action === 'import' && item.expectedRevision === undefined
      ? undefined
      : normalizeRevision(item.expectedRevision);
    const importedTemplate = item.isDefault === true ? null : item.template ?? item.effectiveBody ?? item.body;
    let template: string | null = null;
    if (importedTemplate !== null) {
      const validated = validateBodyForPrompt(promptId, importedTemplate);
      if (!validated.ok) return validated.response;
      template = validated.body;
    }
    preparedItems.push({ ...item, promptId, expectedRevision, changeNote: itemNote, template });
  }

  // Finish all format/template checks and compare every revision before the
  // first write. Races can still happen after this point, so execution returns
  // explicit per-item results instead of concealing a partial application.
  const currentPrompts = await listManagedPrompts(auth.db, preparedItems.map((item) => item.promptId));
  const currentById = new Map(currentPrompts.map((prompt) => [prompt.id, prompt]));
  for (const item of preparedItems) {
    if (item.expectedRevision === undefined) item.expectedRevision = currentById.get(item.promptId)!.revision;
  }
  const conflicts = preparedItems.flatMap((item) => {
    const current = currentById.get(item.promptId)!;
    return current.revision === item.expectedRevision ? [] : [{
      promptId: item.promptId,
      expectedRevision: item.expectedRevision,
      current: responsePrompt(current),
    }];
  });
  if (conflicts.length > 0) {
    return adminJson({ error: '批量项目包含过期 revision，未执行任何写入', code: 'bulk_revision_conflict', conflicts }, 409);
  }

  const results: Array<Record<string, unknown>> = [];
  for (const item of preparedItems) {
    try {
      const response = await handleSave(req, auth, item, action);
      const data = await response.json() as Record<string, unknown>;
      if (response.ok) results.push({ promptId: item.promptId, success: true, prompt: data.prompt });
      else results.push({ promptId: item.promptId, success: false, status: response.status, error: data.error ?? '提示词保存失败' });
    } catch (error) {
      if (error instanceof PromptRevisionConflictError) {
        results.push({
          promptId: item.promptId,
          success: false,
          status: 409,
          code: 'revision_conflict',
          error: error.message,
          current: error.current ? responsePrompt(error.current) : null,
        });
      } else {
        results.push({
          promptId: item.promptId,
          success: false,
          status: 503,
          error: error instanceof Error ? error.message : '提示词保存失败',
        });
      }
    }
  }
  const appliedCount = results.filter((result) => result.success === true).length;
  const failedCount = results.length - appliedCount;
  const failureStatuses = results
    .filter((result) => result.success !== true)
    .map((result) => typeof result.status === 'number' ? result.status : 400);
  const status = failedCount === 0
    ? 200
    : appliedCount > 0
      ? 207
      : failureStatuses.some((failureStatus) => failureStatus >= 500)
        ? 503
        : failureStatuses.every((failureStatus) => failureStatus === 409)
          ? 409
          : 400;
  return adminJson({
    success: failedCount === 0,
    partial: appliedCount > 0 && failedCount > 0,
    ...(failedCount > 0 ? {
      error: appliedCount > 0 ? '部分提示词未能保存' : '提示词批量操作失败',
      code: appliedCount > 0 ? 'bulk_partial_failure' : status === 503 ? 'bulk_service_failure' : 'bulk_failure',
    } : {}),
    appliedCount,
    failedCount,
    results,
  }, status);
};

export const createAdminAiPromptsHandler = (action: AdminPromptAction = 'base') => async (req: Request): Promise<Response> => {
  const mutation = req.method !== 'GET';
  const auth = await requireAdminUser(req, { requireSameOrigin: mutation });
  if ('response' in auth) return auth.response;

  try {
    if (action === 'export' || (action === 'base' && req.method === 'GET' && new URL(req.url).searchParams.get('action') === 'export')) {
      const prompts = await listManagedPrompts(auth.db);
      return adminJson({ version: 1, exportedAt: new Date().toISOString(), prompts: prompts.map(responsePrompt) }, 200);
    }
    if (action === 'history') {
      const query = new URL(req.url).searchParams;
      const promptId = normalizePromptId(query.get('promptId'));
      if (!promptId) return adminJson({ error: '缺少 promptId' }, 400);
      const rawLimit = Number(query.get('limit') ?? 50);
      if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100) return adminJson({ error: 'limit 必须是 1-100 的整数' }, 400);
      const cursor = decodeHistoryCursor(query.get('cursor'));
      const rows = await listPromptHistory(auth.db, { promptId, limit: rawLimit + 1, cursor });
      const hasMore = rows.length > rawLimit;
      const history = rows.slice(0, rawLimit);
      const last = history.at(-1);
      const nextCursor = hasMore && last?.updatedAt ? `${last.updatedAt}|${last.id}` : null;
      return adminJson({ promptId, history, hasMore, nextCursor }, 200);
    }
    if (req.method === 'GET') {
      const prompts = await listManagedPrompts(auth.db);
      return adminJson({ prompts: prompts.map(responsePrompt), limits: { maxTemplateBytes: MAX_PROMPT_BODY_BYTES, maxRequestBytes: MAX_REQUEST_BYTES, maxBulkItems: MAX_BULK_ITEMS } }, 200);
    }
    const parsed = await readBody(req);
    if (!parsed.ok) return parsed.response;
    const payload = asObject(parsed.value);
    if (!payload) return adminJson({ error: '请求体必须是 JSON 对象' }, 400);
    if ((action === 'import' || payload.action === 'import') && payload.version !== undefined && payload.version !== 1) {
      return adminJson({ error: '不支持的提示词导入版本' }, 400);
    }
    if (action === 'bulk' || action === 'import' || payload.action === 'bulk' || payload.action === 'import') {
      return await handleBulk(req, auth, payload, action === 'import' || payload.action === 'import' ? 'import' : 'save');
    }
    if (action === 'rollback' || payload.action === 'rollback') {
      const promptId = normalizePromptId(payload.promptId);
      const changeNote = normalizeChangeNote(payload.changeNote);
      const saved = await rollbackPromptOverride(auth.db, {
        promptId,
        historyId: payload.historyId as string,
        expectedRevision: normalizeRevision(payload.expectedRevision),
        userId: auth.user.id,
        changeNote,
        audit: mutationAudit(req),
      });
      installRuntimePromptOverride(saved);
      return adminJson({ success: true, prompt: responsePrompt(await getManagedPrompt(auth.db, promptId)) }, 200);
    }
    return await handleSave(req, auth, payload, payload.template === null ? 'reset' : 'save');
  } catch (error) {
    if (error instanceof PromptRevisionConflictError) {
      return adminJson({ error: error.message, code: 'revision_conflict', promptId: error.promptId, expectedRevision: error.expectedRevision, current: error.current ? responsePrompt(error.current) : null }, 409);
    }
    const message = error instanceof Error ? error.message : '提示词操作失败';
    return adminJson({ error: message }, message.includes('数据库') || message.includes('D1') ? 503 : 400);
  }
};

export const GET = createAdminAiPromptsHandler('base');
export const PATCH = createAdminAiPromptsHandler('base');
export const POST = createAdminAiPromptsHandler('base');
