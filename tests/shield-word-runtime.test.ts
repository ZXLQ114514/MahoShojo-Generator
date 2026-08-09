import { beforeEach, describe, expect, test, vi } from 'vitest';

const getDrizzleDbFromRuntime = vi.fn();
const getShieldWordSettings = vi.fn();
const setRuntimeShieldWordRules = vi.fn();

vi.mock('@/lib/db/drizzle', () => ({ getDrizzleDbFromRuntime }));
vi.mock('@/lib/db/repositories/shield-word-settings', () => ({ getShieldWordSettings }));
vi.mock('@/lib/shield-word-filter', () => ({ setRuntimeShieldWordRules }));

describe('runtime shield word rules', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
    getDrizzleDbFromRuntime.mockReset();
    getShieldWordSettings.mockReset();
    setRuntimeShieldWordRules.mockReset();
  });

  test('serves a cached snapshot within the TTL', async () => {
    const db = { kind: 'db' };
    getDrizzleDbFromRuntime.mockReturnValue(db);
    getShieldWordSettings.mockResolvedValue({
      rules: [{ word: '测试词', replacement: null }],
      revision: 'revision-1',
      available: true,
    });
    const { getRuntimeShieldWordRulesSnapshot } = await import('@/lib/shield-word-runtime');

    const first = await getRuntimeShieldWordRulesSnapshot();
    const second = await getRuntimeShieldWordRulesSnapshot();

    expect(getShieldWordSettings).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(second).toEqual({
      rules: [{ word: '测试词', replacement: null }],
      revision: 'revision-1',
      available: true,
    });
    expect(setRuntimeShieldWordRules).toHaveBeenCalledOnce();
  });

  test('does not share an in-flight D1 promise across Worker requests', async () => {
    getDrizzleDbFromRuntime.mockReturnValue({ kind: 'db' });
    let resolveSettings: ((value: unknown) => void) | null = null;
    getShieldWordSettings.mockReturnValue(new Promise((resolve) => {
      resolveSettings = resolve;
    }));
    const { getRuntimeShieldWordRulesSnapshot } = await import('@/lib/shield-word-runtime');

    const firstRequest = getRuntimeShieldWordRulesSnapshot();
    await vi.waitFor(() => expect(getShieldWordSettings).toHaveBeenCalledOnce());
    await expect(getRuntimeShieldWordRulesSnapshot()).resolves.toEqual({
      rules: [],
      revision: null,
      available: false,
    });
    resolveSettings?.({ rules: [], revision: 'revision-ready', available: true });

    await expect(firstRequest).resolves.toEqual({
      rules: [],
      revision: 'revision-ready',
      available: true,
    });
    expect(getShieldWordSettings).toHaveBeenCalledOnce();
  });

  test('falls back to the built-in baseline when runtime D1 resolution throws', async () => {
    getDrizzleDbFromRuntime.mockImplementation(() => {
      throw new Error('D1 unavailable');
    });
    const { getRuntimeShieldWordRulesSnapshot } = await import('@/lib/shield-word-runtime');

    await expect(getRuntimeShieldWordRulesSnapshot()).resolves.toEqual({
      rules: [],
      revision: null,
      available: false,
    });
    expect(setRuntimeShieldWordRules).toHaveBeenCalledWith([]);
  });

  test('keeps the last valid snapshot when a later refresh fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T00:00:00.000Z'));
    getDrizzleDbFromRuntime.mockReturnValue({ kind: 'db' });
    getShieldWordSettings
      .mockResolvedValueOnce({
        rules: [{ word: '有效规则', replacement: null }],
        revision: 'revision-valid',
        available: true,
      })
      .mockRejectedValueOnce(new Error('refresh failed'));
    const { getRuntimeShieldWordRulesSnapshot } = await import('@/lib/shield-word-runtime');

    await getRuntimeShieldWordRulesSnapshot();
    vi.advanceTimersByTime(31_000);
    const snapshot = await getRuntimeShieldWordRulesSnapshot();

    expect(snapshot).toEqual({
      rules: [{ word: '有效规则', replacement: null }],
      revision: 'revision-valid',
      available: true,
    });
    expect(setRuntimeShieldWordRules).toHaveBeenCalledTimes(1);
  });

  test('does not let an older D1 refresh overwrite an administrator install', async () => {
    getDrizzleDbFromRuntime.mockReturnValue({ kind: 'db' });
    let resolveSettings: ((value: unknown) => void) | null = null;
    getShieldWordSettings.mockReturnValue(new Promise((resolve) => {
      resolveSettings = resolve;
    }));
    const {
      getRuntimeShieldWordRulesSnapshot,
      installRuntimeShieldWordRules,
    } = await import('@/lib/shield-word-runtime');

    const pendingSnapshot = getRuntimeShieldWordRulesSnapshot();
    await vi.waitFor(() => expect(getShieldWordSettings).toHaveBeenCalledOnce());
    installRuntimeShieldWordRules(
      [{ word: '管理员新规则', replacement: null }],
      { revision: 'revision-new', available: true },
    );
    resolveSettings?.({
      rules: [{ word: '旧规则', replacement: null }],
      revision: 'revision-old',
      available: true,
    });

    await expect(pendingSnapshot).resolves.toEqual({
      rules: [{ word: '管理员新规则', replacement: null }],
      revision: 'revision-new',
      available: true,
    });
    expect(setRuntimeShieldWordRules).toHaveBeenCalledOnce();
  });
});
