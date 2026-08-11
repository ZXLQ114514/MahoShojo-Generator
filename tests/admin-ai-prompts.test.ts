import Database from 'better-sqlite3';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const requireAdminUser = vi.fn();
const installRuntimePromptOverride = vi.fn();

vi.mock('@/lib/auth/admin', () => ({
  requireAdminUser,
  adminJson: (payload: unknown, status: number) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  }),
}));

vi.mock('@/lib/ai-prompts/runtime', () => ({ installRuntimePromptOverride }));

type BoundStatement = { all: () => unknown };

const createDb = () => {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    INSERT INTO users (id) VALUES (7);
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
    CREATE TABLE auth_audit_logs (
      id TEXT PRIMARY KEY NOT NULL,
      business_user_id INTEGER,
      event_type TEXT NOT NULL,
      auth_source TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT,
      result_code TEXT NOT NULL,
      metadata_json TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  const client = {
    prepare(sqlText: string) {
      return {
        bind(...params: unknown[]) {
          return { all: () => sqlite.prepare(sqlText).all(...params) };
        },
        all: (...params: unknown[]) => sqlite.prepare(sqlText).all(...params),
      };
    },
    batch(statements: BoundStatement[]) {
      return Promise.resolve(sqlite.transaction(() => statements.map((statement) => statement.all()))());
    },
    exec(sqlText: string) {
      return sqlite.exec(sqlText);
    },
  };
  return { db: { $client: client } as never, sqlite };
};

const request = (path: string, method: string, body?: unknown, headers: Record<string, string> = {}) => new Request(`https://example.test${path}`, {
  method,
  headers: { Origin: 'https://example.test', 'Content-Type': 'application/json', ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const countRows = (sqlite: Database.Database, table: string): number =>
  (sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;

describe('admin AI prompts API', () => {
  let sqlite: Database.Database;
  let db: never;

  beforeEach(() => {
    vi.clearAllMocks();
    const created = createDb();
    sqlite = created.sqlite;
    db = created.db;
    requireAdminUser.mockResolvedValue({ user: { id: 7, username: 'admin' }, db });
  });

  test('requires same-origin admin authorization before every mutation', async () => {
    requireAdminUser.mockResolvedValueOnce({ response: new Response(null, { status: 403 }) });
    const { createAdminAiPromptsHandler } = await import('@/app/api/admin/ai-prompts/handler');
    const response = await createAdminAiPromptsHandler('base')(request('/api/admin/ai-prompts', 'PATCH', {}));

    expect(response.status).toBe(403);
    expect(requireAdminUser).toHaveBeenCalledWith(expect.any(Request), { requireSameOrigin: true });
    expect(countRows(sqlite, 'site_settings')).toBe(0);
  });

  test('writes current value, immutable history, and sanitized audit in one mutation', async () => {
    const { createAdminAiPromptsHandler } = await import('@/app/api/admin/ai-prompts/handler');
    const { getPromptDefinition } = await import('@/lib/ai-prompts/catalog');
    const definition = getPromptDefinition('character.magical-girl.generate')!;
    const secretBody = `${definition.defaultBody}\nprivate-body-marker`;
    const response = await createAdminAiPromptsHandler('base')(request('/api/admin/ai-prompts', 'PATCH', {
      promptId: definition.id,
      template: secretBody,
      expectedRevision: null,
      changeNote: '补充生成约束',
    }));

    expect(response.status).toBe(200);
    expect(countRows(sqlite, 'site_settings')).toBe(1);
    expect(countRows(sqlite, 'ai_prompt_versions')).toBe(1);
    expect(countRows(sqlite, 'auth_audit_logs')).toBe(1);
    expect(installRuntimePromptOverride).toHaveBeenCalledOnce();
    const metadata = sqlite.prepare('SELECT metadata_json FROM auth_audit_logs').get() as { metadata_json: string };
    expect(metadata.metadata_json).not.toContain(secretBody);
    expect(JSON.parse(metadata.metadata_json)).toMatchObject({ promptId: definition.id, action: 'save' });
  });

  test('rolls back current value and history when the audit statement fails', async () => {
    sqlite.exec('DROP TABLE auth_audit_logs');
    const { createAdminAiPromptsHandler } = await import('@/app/api/admin/ai-prompts/handler');
    const { getPromptDefinition } = await import('@/lib/ai-prompts/catalog');
    const definition = getPromptDefinition('character.magical-girl.generate')!;
    const response = await createAdminAiPromptsHandler('base')(request('/api/admin/ai-prompts', 'PATCH', {
      promptId: definition.id,
      template: definition.defaultBody,
      expectedRevision: null,
      changeNote: '审计失败测试',
    }));

    expect(response.ok).toBe(false);
    expect(countRows(sqlite, 'site_settings')).toBe(0);
    expect(countRows(sqlite, 'ai_prompt_versions')).toBe(0);
    expect(installRuntimePromptOverride).not.toHaveBeenCalled();
  });

  test('audits reset and rollback as new atomic versions', async () => {
    const { createAdminAiPromptsHandler } = await import('@/app/api/admin/ai-prompts/handler');
    const { getPromptDefinition } = await import('@/lib/ai-prompts/catalog');
    const definition = getPromptDefinition('character.magical-girl.generate')!;
    const saveResponse = await createAdminAiPromptsHandler('base')(request('/api/admin/ai-prompts', 'PATCH', {
      promptId: definition.id,
      template: `${definition.defaultBody}\n版本二`,
      expectedRevision: null,
      changeNote: '保存版本二',
    }));
    const saved = await saveResponse.json() as { prompt: { revision: string } };
    const resetResponse = await createAdminAiPromptsHandler('base')(request('/api/admin/ai-prompts', 'PATCH', {
      promptId: definition.id,
      template: null,
      expectedRevision: saved.prompt.revision,
      changeNote: '恢复代码默认',
    }));
    const reset = await resetResponse.json() as { prompt: { revision: string } };
    const firstHistory = sqlite.prepare('SELECT id FROM ai_prompt_versions WHERE action = ? ORDER BY created_at ASC LIMIT 1').get('save') as { id: string };
    const rollbackResponse = await createAdminAiPromptsHandler('rollback')(request('/api/admin/ai-prompts/rollback', 'POST', {
      promptId: definition.id,
      historyId: firstHistory.id,
      expectedRevision: reset.prompt.revision,
      changeNote: '回滚到版本二',
    }));

    expect(saveResponse.status).toBe(200);
    expect(resetResponse.status).toBe(200);
    expect(rollbackResponse.status).toBe(200);
    expect(countRows(sqlite, 'ai_prompt_versions')).toBe(3);
    expect(countRows(sqlite, 'auth_audit_logs')).toBe(3);
    expect(installRuntimePromptOverride).toHaveBeenCalledTimes(3);
    const actions = sqlite.prepare('SELECT metadata_json FROM auth_audit_logs ORDER BY created_at, id').all()
      .map((row) => JSON.parse((row as { metadata_json: string }).metadata_json).action);
    expect(actions.sort()).toEqual(['reset', 'rollback', 'save']);
  });

  test('imports the prompts array produced by export without changing its shape', async () => {
    const { createAdminAiPromptsHandler } = await import('@/app/api/admin/ai-prompts/handler');
    const { getPromptDefinition } = await import('@/lib/ai-prompts/catalog');
    const definition = getPromptDefinition('character.magical-girl.generate')!;
    const initialResponse = await createAdminAiPromptsHandler('base')(request('/api/admin/ai-prompts', 'PATCH', {
      promptId: definition.id,
      template: `${definition.defaultBody}\n导出覆盖版本`,
      expectedRevision: null,
      changeNote: '建立导出覆盖版本',
    }));
    expect(initialResponse.status).toBe(200);
    const exportResponse = await createAdminAiPromptsHandler('export')(request('/api/admin/ai-prompts/export', 'GET'));
    const exported = await exportResponse.json() as { version: number; exportedAt: string; prompts: unknown[] };

    const importResponse = await createAdminAiPromptsHandler('import')(request('/api/admin/ai-prompts/import', 'POST', {
      ...exported,
      changeNote: '回导当前配置',
    }));
    const payload = await importResponse.json() as { success?: boolean; appliedCount?: number };

    expect(importResponse.status, JSON.stringify(payload)).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.appliedCount).toBe(exported.prompts.length);
  });

  test('preflights duplicate IDs and stale revisions without partial writes', async () => {
    const { createAdminAiPromptsHandler } = await import('@/app/api/admin/ai-prompts/handler');
    const { getPromptDefinition } = await import('@/lib/ai-prompts/catalog');
    const first = getPromptDefinition('character.magical-girl.generate')!;
    const second = getPromptDefinition('character.magical-girl.details')!;
    const duplicateResponse = await createAdminAiPromptsHandler('bulk')(request('/api/admin/ai-prompts/bulk', 'POST', {
      changeNote: '重复 ID',
      items: [
        { promptId: first.id, template: first.defaultBody, expectedRevision: null },
        { promptId: first.id, template: first.defaultBody, expectedRevision: null },
      ],
    }));
    expect(duplicateResponse.status).toBe(400);
    expect(countRows(sqlite, 'site_settings')).toBe(0);

    const staleResponse = await createAdminAiPromptsHandler('bulk')(request('/api/admin/ai-prompts/bulk', 'POST', {
      changeNote: '过期 revision',
      items: [
        { promptId: first.id, template: first.defaultBody, expectedRevision: null },
        { promptId: second.id, template: second.defaultBody, expectedRevision: 'stale' },
      ],
    }));
    expect(staleResponse.status).toBe(409);
    expect(countRows(sqlite, 'site_settings')).toBe(0);
    expect(countRows(sqlite, 'ai_prompt_versions')).toBe(0);
    expect(countRows(sqlite, 'auth_audit_logs')).toBe(0);
  });

  test('paginates immutable history without duplicates or unreachable versions', async () => {
    const { createAdminAiPromptsHandler } = await import('@/app/api/admin/ai-prompts/handler');
    const { getPromptDefinition } = await import('@/lib/ai-prompts/catalog');
    const definition = getPromptDefinition('character.magical-girl.generate')!;
    let revision: string | null = null;
    for (const suffix of ['一', '二', '三']) {
      const response = await createAdminAiPromptsHandler('base')(request('/api/admin/ai-prompts', 'PATCH', {
        promptId: definition.id,
        template: `${definition.defaultBody}\n分页版本${suffix}`,
        expectedRevision: revision,
        changeNote: `建立分页版本${suffix}`,
      }));
      expect(response.status).toBe(200);
      revision = ((await response.json()) as { prompt: { revision: string } }).prompt.revision;
    }

    const firstResponse = await createAdminAiPromptsHandler('history')(
      request(`/api/admin/ai-prompts/history?promptId=${encodeURIComponent(definition.id)}&limit=2`, 'GET'),
    );
    const first = await firstResponse.json() as { history: Array<{ id: string }>; hasMore: boolean; nextCursor: string | null };
    expect(firstResponse.status).toBe(200);
    expect(first.history).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBeTruthy();

    const secondResponse = await createAdminAiPromptsHandler('history')(
      request(`/api/admin/ai-prompts/history?promptId=${encodeURIComponent(definition.id)}&limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`, 'GET'),
    );
    const second = await secondResponse.json() as { history: Array<{ id: string }>; hasMore: boolean; nextCursor: string | null };
    expect(secondResponse.status).toBe(200);
    expect(second.history).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.history, ...second.history].map((item) => item.id)).size).toBe(3);
  });

  test('preserves service failure status for an all-failed bulk operation', async () => {
    sqlite.exec('DROP TABLE auth_audit_logs');
    const { createAdminAiPromptsHandler } = await import('@/app/api/admin/ai-prompts/handler');
    const { getPromptDefinition } = await import('@/lib/ai-prompts/catalog');
    const first = getPromptDefinition('character.magical-girl.generate')!;
    const second = getPromptDefinition('character.magical-girl.details')!;
    const response = await createAdminAiPromptsHandler('bulk')(request('/api/admin/ai-prompts/bulk', 'POST', {
      changeNote: '批量服务失败',
      items: [
        { promptId: first.id, template: first.defaultBody, expectedRevision: null },
        { promptId: second.id, template: second.defaultBody, expectedRevision: null },
      ],
    }));
    const payload = await response.json() as { error?: string; code?: string; failedCount?: number };

    expect(response.status).toBe(503);
    expect(payload.error).toBeTruthy();
    expect(payload.code).toBe('bulk_service_failure');
    expect(payload.failedCount).toBe(2);
    expect(countRows(sqlite, 'site_settings')).toBe(0);
    expect(countRows(sqlite, 'ai_prompt_versions')).toBe(0);
  });

  test('rejects oversized declarations, invalid revisions, and overlong notes before writing', async () => {
    const { createAdminAiPromptsHandler } = await import('@/app/api/admin/ai-prompts/handler');
    const { getPromptDefinition } = await import('@/lib/ai-prompts/catalog');
    const definition = getPromptDefinition('character.magical-girl.generate')!;
    const oversized = await createAdminAiPromptsHandler('base')(request('/api/admin/ai-prompts', 'PATCH', {}, { 'Content-Length': String(100 * 1024) }));
    const oversizedStream = await createAdminAiPromptsHandler('base')(request('/api/admin/ai-prompts', 'PATCH', { padding: 'x'.repeat(100 * 1024) }));
    const invalidRevision = await createAdminAiPromptsHandler('base')(request('/api/admin/ai-prompts', 'PATCH', {
      promptId: definition.id, template: definition.defaultBody, expectedRevision: 123, changeNote: '测试',
    }));
    const overlongNote = await createAdminAiPromptsHandler('base')(request('/api/admin/ai-prompts', 'PATCH', {
      promptId: definition.id, template: definition.defaultBody, expectedRevision: null, changeNote: 'x'.repeat(501),
    }));
    const unsupportedImport = await createAdminAiPromptsHandler('import')(request('/api/admin/ai-prompts/import', 'POST', {
      version: 2,
      changeNote: '不支持版本',
      prompts: [{ id: definition.id, effectiveBody: definition.defaultBody }],
    }));

    expect(oversized.status).toBe(413);
    expect(oversizedStream.status).toBe(413);
    expect(invalidRevision.status).toBe(400);
    expect(overlongNote.status).toBe(400);
    expect(unsupportedImport.status).toBe(400);
    expect(countRows(sqlite, 'site_settings')).toBe(0);
  });

  test('default marker follows the current catalog body instead of the stored snapshot', async () => {
    const { getManagedPrompt } = await import('@/lib/ai-prompts/repository');
    const { getPromptDefinition } = await import('@/lib/ai-prompts/catalog');
    const definition = getPromptDefinition('character.magical-girl.generate')!;
    sqlite.prepare('INSERT INTO site_settings (key, value, updated_by_user_id, updated_at) VALUES (?, ?, ?, ?)').run(
      `ai_text_prompt_v1:${definition.id}`,
      JSON.stringify({ version: 1, promptId: definition.id, body: 'stale default snapshot', revision: 'r1', action: 'reset', isDefault: true }),
      7,
      new Date().toISOString(),
    );

    const managed = await getManagedPrompt(db, definition.id);
    expect(managed.body).toBe(definition.defaultBody);
    expect(managed.isDefault).toBe(true);
    expect(managed.isOverridden).toBe(false);
  });
});
