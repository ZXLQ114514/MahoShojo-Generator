import { beforeEach, describe, expect, test, vi } from 'vitest';

const getDrizzleDbFromRuntime = vi.fn();
const renderManagedPrompt = vi.fn();

vi.mock('@/lib/db/drizzle', () => ({ getDrizzleDbFromRuntime }));
vi.mock('@/lib/ai-prompts/runtime', () => ({ renderManagedPrompt }));

const request = (body: unknown, headers: Record<string, string> = {}) => new Request('https://example.test/api/tachie/suggest-prompt', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

describe('tachie managed prompt suggestion API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDrizzleDbFromRuntime.mockReturnValue({ kind: 'db' });
    renderManagedPrompt.mockResolvedValue('托管图像提示词');
  });

  test('only accepts POST and an explicit image prompt allowlist', async () => {
    const { handleTachieSuggestPrompt } = await import('@/app/api/tachie/suggest-prompt/handler');
    const methodResponse = await handleTachieSuggestPrompt(new Request('https://example.test/api/tachie/suggest-prompt'));
    const textPromptResponse = await handleTachieSuggestPrompt(request({
      promptId: 'character.magical-girl.generate',
      variables: { realName: '测试' },
    }));
    const unknownResponse = await handleTachieSuggestPrompt(request({ promptId: 'image.unknown', variables: {} }));

    expect(methodResponse.status).toBe(405);
    expect(textPromptResponse.status).toBe(400);
    expect(unknownResponse.status).toBe(400);
    expect(renderManagedPrompt).not.toHaveBeenCalled();
  });

  test('rejects oversized and malformed request bodies before rendering', async () => {
    const { handleTachieSuggestPrompt } = await import('@/app/api/tachie/suggest-prompt/handler');
    const oversizedResponse = await handleTachieSuggestPrompt(request({ padding: 'x'.repeat(49 * 1024) }));
    const malformedResponse = await handleTachieSuggestPrompt(new Request('https://example.test/api/tachie/suggest-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    }));

    expect(oversizedResponse.status).toBe(413);
    expect(malformedResponse.status).toBe(400);
    expect(renderManagedPrompt).not.toHaveBeenCalled();
  });

  test('bounds variable count, names, and values', async () => {
    const { handleTachieSuggestPrompt } = await import('@/app/api/tachie/suggest-prompt/handler');
    const tooManyVariables = Object.fromEntries(Array.from({ length: 13 }, (_, index) => [`value${index}`, 'x']));
    const countResponse = await handleTachieSuggestPrompt(request({
      promptId: 'image.arena.illustration',
      variables: tooManyVariables,
    }));
    const nameResponse = await handleTachieSuggestPrompt(request({
      promptId: 'image.arena.illustration',
      variables: { '__proto__[polluted]': 'x' },
    }));

    expect(countResponse.status).toBe(400);
    expect(nameResponse.status).toBe(400);
    expect(renderManagedPrompt).not.toHaveBeenCalled();
  });

  test('renders only the selected managed image template with normalized variables', async () => {
    const { handleTachieSuggestPrompt } = await import('@/app/api/tachie/suggest-prompt/handler');
    const protectedTail = '硬性禁止：标题、文字、Logo、水印。';
    const response = await handleTachieSuggestPrompt(request({
      promptId: 'image.arena.illustration',
        variables: { report: `战报\u0000${'x'.repeat(9_000)}${protectedTail}` },
    }));
    const payload = await response.json() as { prompt: string; promptId: string; source: string };

    expect(response.status).toBe(200);
    expect(payload).toEqual({ prompt: '托管图像提示词', promptId: 'image.arena.illustration', source: 'managed' });
    expect(renderManagedPrompt).toHaveBeenCalledWith(
      { kind: 'db' },
      {
        id: 'image.arena.illustration',
        variables: { report: expect.not.stringContaining('\u0000') },
      },
    );
    const renderedRef = renderManagedPrompt.mock.calls[0]?.[1] as { variables: { report: string } };
    expect(renderedRef.variables.report).not.toContain('\u0000');
    expect(renderedRef.variables.report).toContain('x'.repeat(9_000));
    expect(renderedRef.variables.report.endsWith(protectedTail)).toBe(true);
  });

  test('falls back to the immutable catalog default without exposing D1 failures', async () => {
    renderManagedPrompt
      .mockRejectedValueOnce(new Error('D1 internal secret'))
      .mockResolvedValueOnce('代码默认图像提示词');
    const { handleTachieSuggestPrompt } = await import('@/app/api/tachie/suggest-prompt/handler');
    const response = await handleTachieSuggestPrompt(request({
      promptId: 'image.tea-party.scene',
      variables: { scene: '雨夜茶会' },
    }));
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toEqual({ prompt: '代码默认图像提示词', promptId: 'image.tea-party.scene', source: 'default' });
    expect(renderManagedPrompt).toHaveBeenNthCalledWith(2, null, {
      id: 'image.tea-party.scene',
      variables: { scene: '雨夜茶会' },
    });
    expect(JSON.stringify(payload)).not.toContain('D1 internal secret');
  });
});
