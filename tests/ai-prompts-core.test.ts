import Database from 'better-sqlite3';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  AI_PROMPT_CATALOG,
  getPromptDefinition,
  listPromptDefinitions,
} from '@/lib/ai-prompts/catalog';
import {
  PromptRevisionConflictError,
  getManagedPrompt,
  listPromptHistory,
  rollbackPromptOverride,
  savePromptVersionCas,
} from '@/lib/ai-prompts/repository';
import {
  clearRuntimePromptCache,
  getCachedRuntimePrompt,
  getRuntimePromptSnapshot,
  installRuntimePromptOverride,
  renderManagedPrompt,
} from '@/lib/ai-prompts/runtime';
import { PromptTemplateError, renderPromptTemplate, validatePromptTemplate } from '@/lib/ai-prompts/template';

const createDb = () => {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE site_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_by_user_id INTEGER,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE ai_prompt_versions (
      id TEXT PRIMARY KEY NOT NULL,
      prompt_id TEXT NOT NULL,
      revision TEXT NOT NULL,
      body TEXT NOT NULL,
      action TEXT NOT NULL,
      change_note TEXT NOT NULL,
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL,
      previous_revision TEXT,
      is_default INTEGER NOT NULL DEFAULT 0
    );
  `);

  const client = {
    prepare(sqlText: string) {
      return {
        bind(...params: unknown[]) {
          return {
            all: () => sqlite.prepare(sqlText).all(...params),
          };
        },
        all: (...params: unknown[]) => sqlite.prepare(sqlText).all(...params),
      };
    },
    batch(statements: Array<{ all: () => unknown }>) {
      const transaction = sqlite.transaction(() => statements.map((statement) => statement.all()));
      return Promise.resolve(transaction());
    },
    exec(sqlText: string) {
      return sqlite.exec(sqlText);
    },
  };
  return { db: { $client: client } as never, sqlite };
};

describe('managed AI prompt catalog and renderer', () => {
  test('catalog defaults contain only declared slots', () => {
    expect(AI_PROMPT_CATALOG.length).toBeGreaterThan(20);
    for (const definition of listPromptDefinitions()) {
      const result = validatePromptTemplate({ template: definition.defaultBody, slots: definition.slots });
      expect(result.ok, `${definition.id} should validate`).toBe(true);
      if (definition.active) {
        expect(() => renderPromptTemplate({
          template: definition.defaultBody,
          slots: definition.slots,
          variables: definition.previewVariables ?? {},
        }), `${definition.id} should render with preview variables`).not.toThrow();
      }
    }
  });

  test('rejects unknown and missing required placeholders', () => {
    const definition = getPromptDefinition('character.magical-girl.generate')!;
    const unknown = validatePromptTemplate({ template: '{{realName}} {{secret}}', slots: definition.slots });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.code).toBe('unknown-slot');

    const missing = validatePromptTemplate({ template: '{{realName}}', slots: definition.slots });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('missing-required-slot');

    const malformed = validatePromptTemplate({ template: '{{realName}', slots: definition.slots });
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.error.code).toBe('malformed');

    const nestedJson = validatePromptTemplate({
      template: '协议示例：{"outer":{"inner":true}} / {{realName}} / {{language}}',
      slots: definition.slots,
    });
    expect(nestedJson.ok).toBe(true);
  });

  test('inserts values literally without recursive parsing', () => {
    const output = renderPromptTemplate({
      template: 'A={{a}}; B={{b}}',
      slots: [{ name: 'a', required: true }, { name: 'b' }],
      variables: { a: '{{b}}', b: 'done' },
    });
    expect(output).toBe('A={{b}}; B=done');
    expect(() => renderPromptTemplate({ template: '{{a}}', slots: [{ name: 'a', required: true }], variables: {} })).toThrow(PromptTemplateError);
  });
});

describe('managed AI prompt D1 repository', () => {
  let db: never;
  let sqlite: Database.Database;

  beforeEach(() => {
    const created = createDb();
    db = created.db;
    sqlite = created.sqlite;
  });

  test('uses CAS and appends complete immutable history', async () => {
    const definition = getPromptDefinition('character.magical-girl.generate')!;
    const first = await savePromptVersionCas(db, {
      promptId: definition.id,
      body: `${definition.defaultBody}\n管理员补充`,
      expectedRevision: null,
      userId: 1,
      changeNote: '首次调整',
    });
    expect(first.previousRevision).toBeNull();
    const current = await getManagedPrompt(db, definition.id);
    expect(current.revision).toBe(first.revision);
    expect(current.isOverridden).toBe(true);

    await expect(savePromptVersionCas(db, {
      promptId: definition.id,
      body: definition.defaultBody,
      expectedRevision: null,
      userId: 1,
      changeNote: '过期写入',
    })).rejects.toBeInstanceOf(PromptRevisionConflictError);

    const second = await savePromptVersionCas(db, {
      promptId: definition.id,
      body: definition.defaultBody,
      expectedRevision: first.revision,
      userId: 1,
      changeNote: '恢复默认',
      action: 'reset',
      isDefault: true,
    });
    expect(second.previousRevision).toBe(first.revision);
    const history = await listPromptHistory(db, { promptId: definition.id });
    expect(history).toHaveLength(2);
    expect(history[0]?.body).toBe(definition.defaultBody);
    expect(history[0]?.changeNote).toBe('恢复默认');
    expect(history[1]?.body).toContain('管理员补充');
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM ai_prompt_versions').get()).toEqual({ count: 2 });
  });

  test('rollback creates a new version instead of mutating history', async () => {
    const definition = getPromptDefinition('character.magical-girl.generate')!;
    const first = await savePromptVersionCas(db, { promptId: definition.id, body: definition.defaultBody, expectedRevision: null, userId: 1, changeNote: '版本一' });
    const second = await savePromptVersionCas(db, { promptId: definition.id, body: `${definition.defaultBody}\n版本二`, expectedRevision: first.revision, userId: 1, changeNote: '版本二' });
    const history = await listPromptHistory(db, { promptId: definition.id });
    const firstVersion = history.find((item) => item.body === definition.defaultBody)!;
    const rolled = await rollbackPromptOverride(db, { promptId: definition.id, historyId: firstVersion.id, expectedRevision: second.revision, userId: 1, changeNote: '回滚到版本一' });
    expect(rolled.body).toBe(definition.defaultBody);
    expect(rolled.revision).not.toBe(first.revision);
    expect((await listPromptHistory(db, { promptId: definition.id }))).toHaveLength(3);
  });

  test('rollback to an old default snapshot preserves its exact historical body', async () => {
    const definition = getPromptDefinition('character.magical-girl.generate')!;
    const current = await savePromptVersionCas(db, {
      promptId: definition.id,
      body: `${definition.defaultBody}\n当前覆盖`,
      expectedRevision: null,
      userId: 1,
      changeNote: '当前覆盖',
    });
    const oldDefaultBody = `${definition.defaultBody}\n历史默认快照`;
    sqlite.prepare(`
      INSERT INTO ai_prompt_versions
        (id, prompt_id, revision, body, action, change_note, created_by_user_id, created_at, previous_revision, is_default)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('old-default-id', definition.id, 'old-default-revision', oldDefaultBody, 'reset', '旧默认', 1, '2025-01-01T00:00:00.000Z', null, 1);

    const rolled = await rollbackPromptOverride(db, {
      promptId: definition.id,
      historyId: 'old-default-id',
      expectedRevision: current.revision,
      userId: 1,
      changeNote: '恢复旧默认快照',
    });

    expect(rolled.body).toBe(oldDefaultBody);
    expect(rolled.isDefault).toBe(false);
    expect((await getManagedPrompt(db, definition.id)).body).toBe(oldDefaultBody);
  });
});

describe('managed AI prompt runtime cache', () => {
  beforeEach(() => clearRuntimePromptCache());

  test('installs saved values immediately and renders through the catalog', async () => {
    const definition = getPromptDefinition('character.magical-girl.generate')!;
    installRuntimePromptOverride({ promptId: definition.id, body: '真名={{realName}} / {{language}}', revision: 'r1' });
    expect(getCachedRuntimePrompt(definition.id)?.revision).toBe('r1');
    await expect(renderManagedPrompt(null, { id: definition.id, variables: { realName: 'A', language: 'zh-CN' } })).resolves.toBe('真名=A / zh-CN');
  });

  test('falls back to catalog defaults without a D1 binding', async () => {
    const definition = getPromptDefinition('character.magical-girl.generate')!;
    const snapshot = await getRuntimePromptSnapshot(null, definition.id);
    expect(snapshot.revision).toBeNull();
    expect(snapshot.body).toBe(definition.defaultBody);
  });

  test('falls back to catalog defaults when a D1 read fails', async () => {
    const definition = getPromptDefinition('character.magical-girl.generate')!;
    const snapshot = await getRuntimePromptSnapshot({} as never, definition.id);
    expect(snapshot.revision).toBeNull();
    expect(snapshot.body).toBe(definition.defaultBody);
  });
});
