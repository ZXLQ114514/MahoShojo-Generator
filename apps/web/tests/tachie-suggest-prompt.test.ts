import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDrizzleDbFromRuntime: vi.fn(),
  getPromptDefinition: vi.fn(),
  renderManagedPrompt: vi.fn(),
}));

vi.mock('@/lib/db/drizzle', () => ({ getDrizzleDbFromRuntime: mocks.getDrizzleDbFromRuntime }));
vi.mock('@/lib/ai-prompts/catalog', () => ({ getPromptDefinition: mocks.getPromptDefinition }));
vi.mock('@/lib/ai-prompts/runtime', () => ({ renderManagedPrompt: mocks.renderManagedPrompt }));

describe('tachie managed prompt route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPromptDefinition.mockReturnValue({ kind: 'image' });
    mocks.getDrizzleDbFromRuntime.mockReturnValue({ db: true });
    mocks.renderManagedPrompt.mockResolvedValue('managed prompt');
  });

  test('只允许 image prompt 并限制变量', async () => {
    const { POST } = await import('@/app/api/tachie/suggest-prompt/handler');
    const response = await POST(new Request('https://example.test/api/tachie/suggest-prompt', {
      method: 'POST',
      body: JSON.stringify({ promptId: 'review.character-report-analysis', variables: { stats: 'x' } }),
    }));
    expect(response.status).toBe(400);
    expect(mocks.renderManagedPrompt).not.toHaveBeenCalled();
  });

  test('D1 失败时回退 immutable default', async () => {
    mocks.renderManagedPrompt.mockRejectedValueOnce(new Error('db unavailable')).mockResolvedValueOnce('default prompt');
    const { POST } = await import('@/app/api/tachie/suggest-prompt/handler');
    const response = await POST(new Request('https://example.test/api/tachie/suggest-prompt', {
      method: 'POST',
      body: JSON.stringify({ promptId: 'image.tachie.character-positive', variables: { character: '角色' } }),
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ prompt: 'default prompt', source: 'default' });
    expect(mocks.renderManagedPrompt).toHaveBeenNthCalledWith(2, null, expect.objectContaining({ variables: { character: '角色' } }));
  });
});
