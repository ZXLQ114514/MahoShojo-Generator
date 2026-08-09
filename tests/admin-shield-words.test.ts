import { beforeEach, describe, expect, test, vi } from 'vitest';

const requireAdminUser = vi.fn();
const getShieldWordSettings = vi.fn();
const prepareShieldWordSettingsUpdate = vi.fn();
const prepareAuthAuditLogInsert = vi.fn();
const installRuntimeShieldWordRules = vi.fn();
const batch = vi.fn();

vi.mock('@/lib/auth/admin', () => ({
  requireAdminUser,
  adminJson: (payload: unknown, status: number) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }),
}));
vi.mock('@/lib/db/repositories/shield-word-settings', () => ({
  getShieldWordSettings,
  prepareShieldWordSettingsUpdate,
}));
vi.mock('@/lib/db/repositories/auth-audit-logs', () => ({ prepareAuthAuditLogInsert }));
vi.mock('@/lib/shield-word-runtime', () => ({ installRuntimeShieldWordRules }));

const settingsQuery = { kind: 'settings-query' };
const auditQuery = { kind: 'audit-query' };
const adminAuth = { user: { id: 7, username: 'admin' }, db: { kind: 'db', batch } };

describe('admin shield word API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminUser.mockResolvedValue(adminAuth);
    getShieldWordSettings.mockResolvedValue({ rules: [], revision: null, available: true });
    prepareShieldWordSettingsUpdate.mockReturnValue({
      revision: '2026-08-09T09:00:00.000Z',
      query: settingsQuery,
    });
    prepareAuthAuditLogInsert.mockReturnValue({ id: 'audit-id', query: auditQuery });
    batch.mockResolvedValue([]);
  });

  test('stops unauthorized and cross-origin requests before database access', async () => {
    requireAdminUser.mockResolvedValue({ response: new Response(null, { status: 403 }) });
    const { createAdminShieldWordsHandler } = await import('@/app/api/admin/shield-words/handler');

    const response = await createAdminShieldWordsHandler()(new Request('https://example.test/api/admin/shield-words', {
      method: 'PATCH',
      headers: { Origin: 'https://attacker.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: [] }),
    }));

    expect(response.status).toBe(403);
    expect(requireAdminUser).toHaveBeenCalledWith(expect.any(Request), { requireSameOrigin: true });
    expect(getShieldWordSettings).not.toHaveBeenCalled();
    expect(prepareShieldWordSettingsUpdate).not.toHaveBeenCalled();
    expect(prepareAuthAuditLogInsert).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
  });

  test('rejects invalid and oversized input without writing or auditing', async () => {
    const { createAdminShieldWordsHandler } = await import('@/app/api/admin/shield-words/handler');
    const nonObjectResponse = await createAdminShieldWordsHandler()(new Request('https://example.test/api/admin/shield-words', {
      method: 'PATCH',
      headers: { Origin: 'https://example.test', 'Content-Type': 'application/json' },
      body: 'null',
    }));
    const duplicateResponse = await createAdminShieldWordsHandler()(new Request('https://example.test/api/admin/shield-words', {
      method: 'PATCH',
      headers: { Origin: 'https://example.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: [{ word: '測試詞', replacement: null }, { word: '测试词', replacement: null }] }),
    }));
    const oversizedResponse = await createAdminShieldWordsHandler()(new Request('https://example.test/api/admin/shield-words', {
      method: 'PATCH',
      headers: { Origin: 'https://example.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: [], padding: 'x'.repeat(100_000) }),
    }));

    expect(nonObjectResponse.status).toBe(400);
    expect(duplicateResponse.status).toBe(400);
    expect(oversizedResponse.status).toBe(413);
    expect(prepareShieldWordSettingsUpdate).not.toHaveBeenCalled();
    expect(prepareAuthAuditLogInsert).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
  });

  test('refuses to overwrite when the current settings cannot be read', async () => {
    getShieldWordSettings.mockResolvedValue({ rules: [], revision: null, available: false });
    const { createAdminShieldWordsHandler } = await import('@/app/api/admin/shield-words/handler');

    const response = await createAdminShieldWordsHandler()(new Request('https://example.test/api/admin/shield-words', {
      method: 'PATCH',
      headers: { Origin: 'https://example.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: [] }),
    }));

    expect(response.status).toBe(503);
    expect(prepareShieldWordSettingsUpdate).not.toHaveBeenCalled();
    expect(prepareAuthAuditLogInsert).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
  });

  test('stores normalized rules and writes only aggregate audit metadata', async () => {
    const secretWord = '不应进入审计的词';
    const replacement = '不应进入审计的替换';
    const { createAdminShieldWordsHandler } = await import('@/app/api/admin/shield-words/handler');

    const response = await createAdminShieldWordsHandler()(new Request('https://example.test/api/admin/shield-words', {
      method: 'PATCH',
      headers: { Origin: 'https://example.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: [{ word: ` ${secretWord} `, replacement: ` ${replacement} ` }] }),
    }));

    expect(response.status).toBe(200);
    expect(prepareShieldWordSettingsUpdate).toHaveBeenCalledWith(adminAuth.db, 7, [{ word: secretWord, replacement }]);
    expect(installRuntimeShieldWordRules).toHaveBeenCalledWith(
      [{ word: secretWord, replacement }],
      { revision: '2026-08-09T09:00:00.000Z', available: true },
    );
    expect(prepareAuthAuditLogInsert).toHaveBeenCalledOnce();
    expect(batch).toHaveBeenCalledWith([settingsQuery, auditQuery]);
    const auditInput = prepareAuthAuditLogInsert.mock.calls[0]?.[1] as { metadataJson: string };
    expect(auditInput.metadataJson).not.toContain(secretWord);
    expect(auditInput.metadataJson).not.toContain(replacement);
    expect(JSON.parse(auditInput.metadataJson)).toMatchObject({ beforeCount: 0, afterCount: 1, added: 1 });
  });

  test('does not install runtime rules when the atomic D1 batch fails', async () => {
    batch.mockRejectedValueOnce(new Error('audit insert failed'));
    const { createAdminShieldWordsHandler } = await import('@/app/api/admin/shield-words/handler');
    const request = new Request('https://example.test/api/admin/shield-words', {
      method: 'PATCH',
      headers: { Origin: 'https://example.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: [{ word: '测试词', replacement: null }] }),
    });

    await expect(createAdminShieldWordsHandler()(request)).rejects.toThrow('audit insert failed');
    expect(batch).toHaveBeenCalledWith([settingsQuery, auditQuery]);
    expect(installRuntimeShieldWordRules).not.toHaveBeenCalled();
  });
});
