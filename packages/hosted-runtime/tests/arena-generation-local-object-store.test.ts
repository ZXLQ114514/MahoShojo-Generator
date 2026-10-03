import { afterEach, describe, expect, it, vi } from 'vitest';

const root = `/tmp/mahoshojo-local-object-test-${crypto.randomUUID()}`;
vi.stubEnv('LOCAL_OBJECTS_DIR', root);

describe('local arena object store', () => {
  afterEach(async () => {
    const fs = await import('node:fs/promises');
    await fs.rm(root, { recursive: true, force: true });
  });

  it('writes atomically and reads text back', async () => {
    const { createArenaLocalObjectStoreFromEnvironment } = await import('../src/arena-generation/local-object-store');
    const store = createArenaLocalObjectStoreFromEnvironment({ LOCAL_OBJECTS_DIR: root });
    expect(store).not.toBeNull();
    const result = await store!.put({ key: 'v1/report/output.md', body: '# report', contentType: 'text/markdown', signal: new AbortController().signal });
    expect(result).toMatchObject({ bytes: 8, storedBytes: 8, contentEncoding: null });
    await expect(store!.getText('v1/report/output.md')).resolves.toEqual({ kind: 'found', text: '# report' });
    await expect(store!.getText('v1/report/missing.md')).resolves.toEqual({ kind: 'not-found' });
  });

  it('rejects path traversal', async () => {
    const { createArenaLocalObjectStoreFromEnvironment } = await import('../src/arena-generation/local-object-store');
    const store = createArenaLocalObjectStoreFromEnvironment({ LOCAL_OBJECTS_DIR: root });
    await expect(store!.put({ key: '../escape', body: 'x', contentType: 'text/plain', signal: new AbortController().signal })).rejects.toThrow('LOCAL_OBJECT_KEY_INVALID');
  });
});
