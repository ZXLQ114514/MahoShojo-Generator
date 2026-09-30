import { z } from 'zod';
import { getPromptDefinition } from '../../ai-prompts/catalog';
import { promptByteLength, validatePromptTemplate } from '../../ai-prompts/template';
import { defineAction, fields, versionInput } from './core';
import type { AdminDatabase } from '../database';
import type { AdminGuardedStatement } from '../operations';

const PROMPT_KEY_PREFIX = 'ai_text_prompt_v1:';
const MAX_PROMPT_BODY_BYTES = 64 * 1024;

type StoredPromptValue = {
  version: 1;
  promptId: string;
  body: string;
  revision: string;
  previousRevision: string | null;
  action: 'save' | 'reset';
  isDefault: boolean;
};

const parsePromptKey = (value: string): string => {
  if (!value.startsWith(PROMPT_KEY_PREFIX)) throw new Error('ADMIN_PROMPT_ID_INVALID');
  const promptId = value.slice(PROMPT_KEY_PREFIX.length);
  if (!getPromptDefinition(promptId)) throw new Error('ADMIN_PROMPT_ID_INVALID');
  return promptId;
};

const parseStoredValue = (promptId: string, value: unknown): StoredPromptValue | null => {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredPromptValue>;
    if (parsed.version !== 1 || parsed.promptId !== promptId || typeof parsed.body !== 'string' || typeof parsed.revision !== 'string') return null;
    return {
      version: 1,
      promptId,
      body: parsed.body,
      revision: parsed.revision,
      previousRevision: typeof parsed.previousRevision === 'string' ? parsed.previousRevision : null,
      action: parsed.action === 'reset' ? 'reset' : 'save',
      isDefault: parsed.isDefault === true,
    };
  } catch {
    return null;
  }
};

const PROMPT_ACTION_FIELDS = fields([
  ['id', '提示词 ID', 'text'],
  ['expectedVersion', '当前版本', 'text'],
  ['bodyText', '提示词正文', 'text'],
]);

export const AI_PROMPT_ACTIONS = [defineAction(
  {
    name: 'ai-prompts.save',
    label: '保存 AI 提示词',
    resource: 'ai-prompts',
    capability: 'ai.write',
    fields: PROMPT_ACTION_FIELDS,
  },
  z.object({
    reason: z.string().trim().min(1).max(1000),
    idempotencyKey: z.string().trim().min(1).max(128),
    id: z.string().trim().min(1).max(128),
    expectedVersion: versionInput,
    bodyText: z.string(),
  }).strict(),
  async (db, input) => compilePromptMutation(db, input, false),
)];

async function compilePromptMutation(
  db: AdminDatabase,
  input: { id: string; expectedVersion: string; bodyText: string; reason: string },
  reset: boolean,
) {
  const promptId = parsePromptKey(input.id);
  const definition = getPromptDefinition(promptId)!;
  const current = await db.prepare('SELECT key,value,updated_by_user_id,updated_at FROM site_settings WHERE key=? LIMIT 1').bind(input.id).first<Record<string, unknown>>();
  const { adminActionVersion } = await import('./core');
  const actualVersion = current ? await adminActionVersion('ai-prompts', current) : null;
  if (!current || actualVersion !== input.expectedVersion) {
    return {
      targetId: input.id,
      plan: {
        primary: {
          name: 'prompt-version-conflict',
          sql: 'UPDATE site_settings SET updated_at=updated_at WHERE 1=0 AND {{admin_guard}}',
          bindings: [],
          expectedChanges: 1,
        },
        result: { id: input.id, conflict: true },
      },
    };
  }

  const body = reset ? definition.defaultBody : input.bodyText;
  if (promptByteLength(body) > MAX_PROMPT_BODY_BYTES) throw new Error('ADMIN_PROMPT_TOO_LARGE');
  const validation = validatePromptTemplate({ template: body, slots: definition.slots });
  if (!validation.ok) throw new Error('ADMIN_PROMPT_TEMPLATE_INVALID');
  const previous = parseStoredValue(promptId, current.value);
  const now = new Date().toISOString();
  const revision = crypto.randomUUID();
  const storedValue = JSON.stringify({
    version: 1,
    promptId,
    body,
    revision,
    previousRevision: previous?.revision ?? null,
    action: reset ? 'reset' : 'save',
    isDefault: reset,
  } satisfies StoredPromptValue);
  const versionId = crypto.randomUUID();
  const history: AdminGuardedStatement = {
    name: 'append-prompt-history',
    sql: `INSERT INTO ai_prompt_versions (id,prompt_id,revision,body,action,change_note,created_by_user_id,created_at,previous_revision,is_default)
      SELECT ?,?,?,?,?,?,?,?, ?,? WHERE EXISTS (SELECT 1 FROM site_settings WHERE key=? AND value=?) AND {{admin_guard}}`,
    bindings: [versionId, promptId, revision, body, reset ? 'reset' : 'save', input.reason, null, now, previous?.revision ?? null, reset ? 1 : 0, input.id, storedValue],
    expectedChanges: 1,
  };
  return {
    targetId: input.id,
    plan: {
      primary: {
        name: 'save-prompt-setting',
        sql: 'UPDATE site_settings SET value=?,updated_by_user_id=NULL,updated_at=? WHERE key=? AND value=? AND {{admin_guard}}',
        bindings: [storedValue, now, input.id, current.value],
        expectedChanges: 1,
      },
      effects: [history],
      result: { id: input.id, revision, reset },
    },
  };
}
