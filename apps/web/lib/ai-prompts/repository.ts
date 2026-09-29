import { randomUUID } from '@/lib/crypto';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { sha256Hex } from '@/lib/pvp/crypto';
import { getPromptDefinition, listPromptDefinitions, type PromptDefinition } from './catalog';
import { promptByteLength, validatePromptTemplate } from './template';

export const AI_PROMPT_SETTING_PREFIX = 'ai_text_prompt_v1:';
export const AI_PROMPT_VALUE_VERSION = 1;
export const MAX_PROMPT_BODY_BYTES = 64 * 1024;
export const MAX_PROMPT_CHANGE_NOTE_LENGTH = 500;

export type PromptVersionAction = 'save' | 'reset' | 'rollback' | 'import';

export type PromptOverrideRecord = {
  promptId: string;
  body: string;
  revision: string;
  previousRevision: string | null;
  action: PromptVersionAction;
  isDefault: boolean;
  updatedAt: string;
  updatedByUserId: number | null;
};

export type ManagedPrompt = PromptDefinition & {
  body: string;
  revision: string | null;
  previousRevision: string | null;
  action: PromptVersionAction | 'default';
  isOverridden: boolean;
  isDefault: boolean;
  updatedAt: string | null;
  updatedByUserId: number | null;
  invalidOverride: boolean;
};

export type PromptVersionRecord = PromptOverrideRecord & { id: string; changeNote: string };

export class PromptRevisionConflictError extends Error {
  readonly promptId: string;
  readonly expectedRevision: string | null;
  readonly current: ManagedPrompt | null;

  constructor(params: { promptId: string; expectedRevision: string | null; current: ManagedPrompt | null }) {
    super(`提示词 ${params.promptId} 已被其他管理员修改，请刷新后重试`);
    this.name = 'PromptRevisionConflictError';
    this.promptId = params.promptId;
    this.expectedRevision = params.expectedRevision;
    this.current = params.current;
  }
}

type StoredPromptValue = {
  version: number;
  promptId: string;
  body: string;
  revision: string;
  previousRevision?: string | null;
  action?: PromptVersionAction;
  isDefault?: boolean;
};

type D1PreparedStatementLike = {
  bind?: (...params: unknown[]) => D1PreparedStatementLike;
  all: (...params: unknown[]) => Promise<unknown> | unknown;
};

type D1ClientLike = {
  prepare: (sqlText: string) => D1PreparedStatementLike;
  batch?: (statements: unknown[]) => Promise<unknown[]>;
  exec?: (sqlText: string) => unknown;
};

type D1StatementResult = { success?: boolean; results?: unknown; meta?: Record<string, unknown>; error?: unknown };
type AtomicStep = { sqlText: string; params?: unknown[] };
type AtomicResult = { rows: Record<string, unknown>[]; changes: number | null };

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

const toRows = (value: unknown): Record<string, unknown>[] => {
  if (Array.isArray(value)) return value.map(asRecord).filter((row): row is Record<string, unknown> => Boolean(row));
  const parsed = asRecord(value) as D1StatementResult | null;
  if (parsed?.success === false) throw new Error(typeof parsed.error === 'string' ? parsed.error : 'D1 查询失败');
  const rawRows = Array.isArray(parsed?.results) ? parsed.results : [];
  return rawRows.map(asRecord).filter((row): row is Record<string, unknown> => Boolean(row));
};

const toChanges = (value: unknown): number | null => {
  const record = asRecord(value);
  const meta = asRecord(record?.meta);
  const raw = meta?.changes ?? record?.changes;
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : null;
};

const getD1Client = (db: AppDrizzleDb): D1ClientLike => {
  const client = (db as unknown as { $client?: unknown }).$client;
  const candidate = asRecord(client);
  if (typeof candidate?.prepare !== 'function') throw new Error('Drizzle D1 client 不可用：未检测到 prepare 方法');
  return client as D1ClientLike;
};

const bindStatement = (statement: D1PreparedStatementLike, params: unknown[]): D1PreparedStatementLike =>
  typeof statement.bind === 'function' ? statement.bind(...params) : statement;

const executeAtomicSteps = async (db: AppDrizzleDb, steps: readonly AtomicStep[]): Promise<AtomicResult[]> => {
  const client = getD1Client(db);
  if (typeof client.batch === 'function') {
    const rawResults = await client.batch(steps.map((step) => bindStatement(client.prepare(step.sqlText), step.params ?? [])));
    return rawResults.map((raw) => ({ rows: toRows(raw), changes: toChanges(raw) }));
  }
  if (typeof client.exec !== 'function') throw new Error('Drizzle D1 client 不可用：未检测到 batch/exec 方法');
  client.exec('BEGIN IMMEDIATE');
  try {
    const results: AtomicResult[] = [];
    for (const step of steps) {
      const statement = bindStatement(client.prepare(step.sqlText), step.params ?? []);
      const raw = await statement.all();
      results.push({ rows: toRows(raw), changes: toChanges(raw) });
    }
    client.exec('COMMIT');
    return results;
  } catch (error) {
    try { client.exec('ROLLBACK'); } catch { /* preserve original error */ }
    throw error;
  }
};

const queryRows = async (db: AppDrizzleDb, sqlText: string, params: unknown[] = []): Promise<Record<string, unknown>[]> => {
  const client = getD1Client(db);
  const statement = bindStatement(client.prepare(sqlText), params);
  return toRows(await statement.all());
};

const normalizePromptId = (promptId: unknown): string => {
  const value = typeof promptId === 'string' ? promptId.trim() : '';
  if (!value || !getPromptDefinition(value)) throw new Error('未知的提示词 ID');
  return value;
};

const normalizeExpectedRevision = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 128) throw new Error('提示词 revision 无效');
  return value;
};

const normalizeUserId = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return null;
  return value;
};

const normalizeChangeNote = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('每次提示词变更都必须填写变更说明');
  const note = value.trim();
  if (!note) throw new Error('每次提示词变更都必须填写变更说明');
  if (note.length > MAX_PROMPT_CHANGE_NOTE_LENGTH) throw new Error('提示词变更说明过长');
  return note;
};

const parseStoredValue = (promptId: string, raw: unknown): StoredPromptValue | null => {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredPromptValue>;
    if (parsed.version !== AI_PROMPT_VALUE_VERSION || parsed.promptId !== promptId || typeof parsed.body !== 'string' || typeof parsed.revision !== 'string') return null;
    const action: PromptVersionAction = parsed.action === 'reset' || parsed.action === 'rollback' || parsed.action === 'import' ? parsed.action : 'save';
    return {
      version: AI_PROMPT_VALUE_VERSION,
      promptId,
      body: parsed.body,
      revision: parsed.revision,
      previousRevision: typeof parsed.previousRevision === 'string' ? parsed.previousRevision : null,
      action,
      isDefault: parsed.isDefault === true,
    };
  } catch {
    return null;
  }
};

const settingKey = (promptId: string): string => `${AI_PROMPT_SETTING_PREFIX}${promptId}`;

type StoredRow = { rawValue: string; updatedAt: string; updatedByUserId: number | null; stored: StoredPromptValue | null };

const readStoredRow = async (db: AppDrizzleDb, promptId: string): Promise<StoredRow | null> => {
  const rows = await queryRows(db, 'SELECT value, updated_at, updated_by_user_id FROM site_settings WHERE key = ? LIMIT 1', [settingKey(promptId)]);
  const row = rows[0];
  if (!row) return null;
  const rawValue = typeof row.value === 'string' ? row.value : '';
  const stored = parseStoredValue(promptId, rawValue);
  const updatedAt = typeof row.updated_at === 'string' ? row.updated_at : '';
  const userId = typeof row.updated_by_user_id === 'number' ? row.updated_by_user_id : Number(row.updated_by_user_id);
  return { rawValue, updatedAt, updatedByUserId: Number.isSafeInteger(userId) && userId > 0 ? userId : null, stored };
};

const toManagedPrompt = (definition: PromptDefinition, row: Awaited<ReturnType<typeof readStoredRow>>): ManagedPrompt => {
  if (!row) {
    return {
      ...definition,
      body: definition.defaultBody,
      revision: null,
      previousRevision: null,
      action: 'default',
      isOverridden: false,
      isDefault: true,
      updatedAt: null,
      updatedByUserId: null,
      invalidOverride: false,
    };
  }
  if (!row.stored) {
    // Never send malformed administrator data to a provider. Keep the row
    // visible as invalid so an administrator can repair it with CAS.
    return {
      ...definition,
      body: definition.defaultBody,
      revision: null,
      previousRevision: null,
      action: 'default',
      isOverridden: true,
      isDefault: false,
      updatedAt: row.updatedAt || null,
      updatedByUserId: row.updatedByUserId,
      invalidOverride: true,
    };
  }
  const effectiveBody = row.stored.isDefault ? definition.defaultBody : row.stored.body;
  const validation = validatePromptTemplate({ template: effectiveBody, slots: definition.slots });
  return {
    ...definition,
    body: effectiveBody,
    revision: row.stored.revision,
    previousRevision: row.stored.previousRevision ?? null,
    action: row.stored.action ?? 'save',
    isOverridden: !row.stored.isDefault,
    isDefault: row.stored.isDefault === true,
    updatedAt: row.updatedAt || null,
    updatedByUserId: row.updatedByUserId,
    invalidOverride: !validation.ok,
  };
};

export const getPromptOverride = async (db: AppDrizzleDb, promptId: string): Promise<PromptOverrideRecord | null> => {
  const normalizedId = normalizePromptId(promptId);
  const definition = getPromptDefinition(normalizedId)!;
  const row = await readStoredRow(db, normalizedId);
  if (!row || !row.stored) return null;
  return {
    promptId: normalizedId,
    body: row.stored.isDefault ? definition.defaultBody : row.stored.body,
    revision: row.stored.revision,
    previousRevision: row.stored.previousRevision ?? null,
    action: row.stored.action ?? 'save',
    isDefault: row.stored.isDefault === true,
    updatedAt: row.updatedAt,
    updatedByUserId: row.updatedByUserId,
  };
};

export const getManagedPrompt = async (db: AppDrizzleDb | null, promptId: string): Promise<ManagedPrompt> => {
  const normalizedId = normalizePromptId(promptId);
  const definition = getPromptDefinition(normalizedId)!;
  if (!db) return toManagedPrompt(definition, null);
  return toManagedPrompt(definition, await readStoredRow(db, normalizedId));
};
export const getEffectivePrompt = getManagedPrompt;

export const listManagedPrompts = async (db: AppDrizzleDb | null, promptIds?: readonly string[]): Promise<ManagedPrompt[]> => {
  const definitions = (promptIds?.length ? promptIds.map(normalizePromptId).map((id) => getPromptDefinition(id)!) : Array.from(listPromptDefinitions()));
  if (!db) return definitions.map((definition) => toManagedPrompt(definition, null));
  // One prefix query keeps the admin list endpoint bounded even as the
  // catalog grows; individual reads remain available for CAS operations.
  const rows = await queryRows(db, 'SELECT key, value, updated_at, updated_by_user_id FROM site_settings WHERE key LIKE ?', [`${AI_PROMPT_SETTING_PREFIX}%`]);
  const rowMap = new Map<string, StoredRow>();
  for (const row of rows) {
    const key = typeof row.key === 'string' ? row.key : '';
    if (!key.startsWith(AI_PROMPT_SETTING_PREFIX)) continue;
    const id = key.slice(AI_PROMPT_SETTING_PREFIX.length);
    if (!getPromptDefinition(id)) continue;
    const rawValue = typeof row.value === 'string' ? row.value : '';
    const stored = parseStoredValue(id, rawValue);
    const updatedAt = typeof row.updated_at === 'string' ? row.updated_at : '';
    const rawUserId = typeof row.updated_by_user_id === 'number' ? row.updated_by_user_id : Number(row.updated_by_user_id);
    rowMap.set(id, { rawValue, stored, updatedAt, updatedByUserId: Number.isSafeInteger(rawUserId) && rawUserId > 0 ? rawUserId : null });
  }
  return definitions.map((definition) => toManagedPrompt(definition, rowMap.get(definition.id) ?? null));
};
export const listEffectivePrompts = listManagedPrompts;

export type SavePromptVersionInput = {
  promptId: string;
  body: string;
  expectedRevision?: string | null;
  userId?: number | null;
  changeNote: string;
  action?: PromptVersionAction;
  isDefault?: boolean;
  audit?: PromptMutationAuditContext;
};

export type PromptMutationAuditContext = {
  ip?: string | null;
  userAgent?: string | null;
};

const normalizeAuditText = (value: unknown, maxLength: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
};

/**
 * Compare-and-swap current setting and append immutable history in one D1
 * batch. The history insert is conditional on the newly written value, so a
 * failed CAS cannot leave an orphan version.
 */
export const savePromptVersionCas = async (db: AppDrizzleDb, input: SavePromptVersionInput): Promise<PromptOverrideRecord> => {
  const promptId = normalizePromptId(input.promptId);
  const definition = getPromptDefinition(promptId)!;
  const body = typeof input.body === 'string' ? input.body : '';
  if (promptByteLength(body) > MAX_PROMPT_BODY_BYTES) throw new Error('提示词正文超过 64 KiB 限制');
  const validation = validatePromptTemplate({ template: body, slots: definition.slots });
  if (!validation.ok) throw validation.error;
  const expectedRevision = normalizeExpectedRevision(input.expectedRevision);
  const changeNote = normalizeChangeNote(input.changeNote);
  const userId = normalizeUserId(input.userId);
  const action: PromptVersionAction = input.action ?? 'save';
  const previous = await readStoredRow(db, promptId);
  const actualRevision = previous?.stored?.revision ?? null;
  if (actualRevision !== expectedRevision) throw new PromptRevisionConflictError({ promptId, expectedRevision, current: await getManagedPrompt(db, promptId) });

  const revision = randomUUID();
  const now = new Date().toISOString();
  const isDefault = input.isDefault === true;
  const beforeBody = previous?.stored
    ? previous.stored.isDefault ? definition.defaultBody : previous.stored.body
    : definition.defaultBody;
  const effectiveBody = isDefault ? definition.defaultBody : body;
  const newRawValue = JSON.stringify({
    version: AI_PROMPT_VALUE_VERSION,
    promptId,
    body,
    revision,
    previousRevision: actualRevision,
    action,
    isDefault,
  } satisfies StoredPromptValue);
  const versionId = randomUUID();
  const key = settingKey(promptId);
  const firstStep: AtomicStep = previous
    ? {
        sqlText: 'UPDATE site_settings SET value = ?, updated_by_user_id = ?, updated_at = ? WHERE key = ? AND value = ? RETURNING key',
        params: [newRawValue, userId, now, key, previous.rawValue],
      }
    : {
        sqlText: 'INSERT INTO site_settings (key, value, updated_by_user_id, updated_at) SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM site_settings WHERE key = ?) RETURNING key',
        params: [key, newRawValue, userId, now, key],
      };
  const historyStep: AtomicStep = {
    sqlText: 'INSERT INTO ai_prompt_versions (id, prompt_id, revision, body, action, change_note, created_by_user_id, created_at, previous_revision, is_default) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM site_settings WHERE key = ? AND value = ?) RETURNING id',
    params: [versionId, promptId, revision, body, action, changeNote, userId, now, actualRevision, isDefault ? 1 : 0, key, newRawValue],
  };
  const steps: AtomicStep[] = [firstStep, historyStep];
  if (input.audit) {
    const [beforeDigest, afterDigest] = await Promise.all([
      sha256Hex(beforeBody),
      sha256Hex(effectiveBody),
    ]);
    const auditMetadata = JSON.stringify({
      version: 1,
      promptId,
      action,
      beforeDigest: beforeDigest.slice(0, 16),
      afterDigest: afterDigest.slice(0, 16),
      beforeBytes: promptByteLength(beforeBody),
      afterBytes: promptByteLength(effectiveBody),
      revision,
      changeNote: changeNote.slice(0, 160),
    });
    steps.push({
      sqlText: 'INSERT INTO auth_audit_logs (id, business_user_id, event_type, auth_source, ip, user_agent, result_code, metadata_json, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM site_settings WHERE key = ? AND value = ?) RETURNING id',
      params: [
        randomUUID(),
        userId,
        'admin_ai_prompt_update',
        'admin-panel',
        normalizeAuditText(input.audit.ip, 128),
        normalizeAuditText(input.audit.userAgent, 512),
        'success',
        auditMetadata,
        Math.floor(Date.now() / 1000),
        key,
        newRawValue,
      ],
    });
  }
  const results = await executeAtomicSteps(db, steps);
  const firstSucceeded = results[0]?.rows.length ? true : results[0]?.changes === 1;
  if (!firstSucceeded) throw new PromptRevisionConflictError({ promptId, expectedRevision, current: await getManagedPrompt(db, promptId) });
  const historySucceeded = results[1]?.rows.length ? true : results[1]?.changes === 1;
  if (!historySucceeded) throw new Error('提示词历史版本写入失败，当前版本未确认');
  if (input.audit) {
    const auditSucceeded = results[2]?.rows.length ? true : results[2]?.changes === 1;
    if (!auditSucceeded) throw new Error('提示词管理员审计写入失败，当前版本未确认');
  }
  return { promptId, body: effectiveBody, revision, previousRevision: actualRevision, action, isDefault, updatedAt: now, updatedByUserId: userId };
};

export const savePromptOverride = savePromptVersionCas;
export const updatePromptOverride = savePromptVersionCas;
export const savePrompt = savePromptVersionCas;

export const resetPromptOverride = async (
  db: AppDrizzleDb,
  input: { promptId: string; expectedRevision?: string | null; userId?: number | null; changeNote: string; audit?: PromptMutationAuditContext },
): Promise<PromptOverrideRecord> => {
  const definition = getPromptDefinition(normalizePromptId(input.promptId))!;
  return savePromptVersionCas(db, { ...input, body: definition.defaultBody, action: 'reset', isDefault: true });
};
export const resetPromptToDefault = resetPromptOverride;

export type PromptHistoryCursor = { createdAt: string; id: string };

export const listPromptHistory = async (
  db: AppDrizzleDb,
  input: { promptId: string; limit?: number; cursor?: PromptHistoryCursor | null },
): Promise<PromptVersionRecord[]> => {
  const promptId = normalizePromptId(input.promptId);
  const limit = Math.max(1, Math.min(200, Math.trunc(input.limit ?? 50)));
  const cursor = input.cursor;
  const rows = cursor
    ? await queryRows(
        db,
        'SELECT id, prompt_id, revision, body, action, change_note, created_by_user_id, created_at, previous_revision, is_default FROM ai_prompt_versions WHERE prompt_id = ? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?',
        [promptId, cursor.createdAt, cursor.createdAt, cursor.id, limit],
      )
    : await queryRows(
        db,
        'SELECT id, prompt_id, revision, body, action, change_note, created_by_user_id, created_at, previous_revision, is_default FROM ai_prompt_versions WHERE prompt_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
        [promptId, limit],
      );
  return rows.map((row) => ({
    id: typeof row.id === 'string' ? row.id : '',
    promptId,
    body: typeof row.body === 'string' ? row.body : '',
    revision: typeof row.revision === 'string' ? row.revision : '',
    previousRevision: typeof row.previous_revision === 'string' ? row.previous_revision : null,
    action: row.action === 'reset' || row.action === 'rollback' || row.action === 'import' ? row.action : 'save',
    isDefault: row.is_default === true || row.is_default === 1 || row.is_default === '1',
    updatedAt: typeof row.created_at === 'string' ? row.created_at : '',
    updatedByUserId: typeof row.created_by_user_id === 'number' ? row.created_by_user_id : Number.isSafeInteger(Number(row.created_by_user_id)) ? Number(row.created_by_user_id) : null,
    changeNote: typeof row.change_note === 'string' ? row.change_note : '',
  } as PromptVersionRecord));
};
export const getPromptHistory = async (db: AppDrizzleDb, promptId: string, limit?: number): Promise<PromptVersionRecord[]> =>
  listPromptHistory(db, { promptId, limit });
export const listPromptVersions = listPromptHistory;

export const rollbackPromptOverride = async (
  db: AppDrizzleDb,
  input: { promptId: string; historyId: string; expectedRevision?: string | null; userId?: number | null; changeNote: string; audit?: PromptMutationAuditContext },
): Promise<PromptOverrideRecord> => {
  const promptId = normalizePromptId(input.promptId);
  const historyId = typeof input.historyId === 'string' ? input.historyId.trim() : '';
  if (!historyId || historyId.length > 128) throw new Error('历史版本 ID 无效');
  const rows = await queryRows(db, 'SELECT body, is_default FROM ai_prompt_versions WHERE id = ? AND prompt_id = ? LIMIT 1', [historyId, promptId]);
  const row = rows[0];
  if (!row || typeof row.body !== 'string') throw new Error('历史版本不存在');
  const historyWasDefault = row.is_default === true || row.is_default === 1 || row.is_default === '1';
  const isCurrentDefault = historyWasDefault && row.body === getPromptDefinition(promptId)!.defaultBody;
  return savePromptVersionCas(db, { promptId, body: row.body, expectedRevision: input.expectedRevision, userId: input.userId, changeNote: input.changeNote, action: 'rollback', isDefault: isCurrentDefault, audit: input.audit });
};
export const rollbackPromptVersion = rollbackPromptOverride;
