import { afterEach, describe, expect, it } from 'vitest';

import { AI_PROMPT_CATALOG } from '../src/ai-prompts/catalog';
import { ADMIN_BUSINESS_ACTIONS, adminActionVersion } from '../src/admin/business-actions';
import { adminManagementFixture } from './admin-management-fixture';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((close) => close()));

describe('Admin AI prompt mutations', () => {
  it('uses CAS, appends immutable history, and replays idempotently', async () => {
    const fixture = await adminManagementFixture(['ai.write']);
    cleanups.push(() => fixture.sqlite.close());
    const definition = AI_PROMPT_CATALOG.find((item) => item.id === 'review.public-battle-summary')!;
    const key = `ai_text_prompt_v1:${definition.id}`;
    const existing = {
      version: 1,
      promptId: definition.id,
      body: definition.defaultBody,
      revision: 'revision-1',
      previousRevision: null,
      action: 'save',
      isDefault: true,
    };
    fixture.sqlite.exec('INSERT INTO site_settings(key,value,updated_at) VALUES (\'' + key + '\',\'' + JSON.stringify(existing).replaceAll("'", "''") + '\',\'2026-01-01\')');
    const row = fixture.sqlite.prepare('SELECT key,value,updated_by_user_id,updated_at FROM site_settings WHERE key=?').get(key)!;
    const expectedVersion = await adminActionVersion('ai-prompts', row);
    const action = ADMIN_BUSINESS_ACTIONS.find((item) => item.name === 'ai-prompts.save')!;
    const input = {
      id: key,
      expectedVersion,
      bodyText: `${definition.defaultBody}\n管理员补充`,
      reason: '更新公开战报分析措辞',
      idempotencyKey: 'prompt-save-1',
    };

    const result = await action.execute(fixture.db, input, fixture.context);
    expect(result).toMatchObject({ status: 'succeeded', replayed: false });
    expect(await action.execute(fixture.db, input, fixture.context)).toMatchObject({ status: 'succeeded', replayed: true });

    const stored = JSON.parse(fixture.sqlite.prepare('SELECT value FROM site_settings WHERE key=?').get(key)!.value as string) as { body: string; previousRevision: string };
    expect(stored.body).toContain('管理员补充');
    expect(stored.previousRevision).toBe('revision-1');
    expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM ai_prompt_versions').get()?.n).toBe(1);
    expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM admin_audit_events WHERE action=\'ai-prompts.save\'').get()?.n).toBe(1);
  });

  it('rejects unknown placeholders before writing', async () => {
    const fixture = await adminManagementFixture(['ai.write']);
    cleanups.push(() => fixture.sqlite.close());
    const definition = AI_PROMPT_CATALOG.find((item) => item.id === 'review.public-battle-summary')!;
    const key = `ai_text_prompt_v1:${definition.id}`;
    const existing = { version: 1, promptId: definition.id, body: definition.defaultBody, revision: 'revision-1', previousRevision: null, action: 'save', isDefault: true };
    fixture.sqlite.exec('INSERT INTO site_settings(key,value,updated_at) VALUES (\'' + key + '\',\'' + JSON.stringify(existing).replaceAll("'", "''") + '\',\'2026-01-01\')');
    const row = fixture.sqlite.prepare('SELECT key,value,updated_by_user_id,updated_at FROM site_settings WHERE key=?').get(key)!;
    const action = ADMIN_BUSINESS_ACTIONS.find((item) => item.name === 'ai-prompts.save')!;
    await expect(action.execute(fixture.db, {
      id: key,
      expectedVersion: await adminActionVersion('ai-prompts', row),
      bodyText: '{{not-allowed}}',
      reason: 'invalid prompt',
      idempotencyKey: 'prompt-save-invalid',
    }, fixture.context)).rejects.toThrow('ADMIN_PROMPT_TEMPLATE_INVALID');
  });
});
