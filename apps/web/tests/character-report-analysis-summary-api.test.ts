import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuthUser: vi.fn(),
  isSameOriginRequest: vi.fn(),
  acquirePublicAiRateLimit: vi.fn(),
  buildPublicAiRateLimitResponse: vi.fn(),
  isAllowedCharacterReportSummaryModel: vi.fn(),
  normalizeCharacterReportSummaryModel: vi.fn(),
  generateCharacterReportAiSummary: vi.fn(),
  parseCharacterReportAnalysisFilters: vi.fn(),
  loadCharacterReportAnalysis: vi.fn(),
}));

vi.mock('@/lib/pvp/server', () => ({
  json: (payload: unknown, init?: ResponseInit) => new Response(JSON.stringify(payload), { status: init?.status ?? 200 }),
  requireAuthUser: mocks.requireAuthUser,
}));
vi.mock('@/lib/auth/request-security', () => ({ isSameOriginRequest: mocks.isSameOriginRequest }));
vi.mock('@/lib/ai/public-rate-limit', () => ({
  acquirePublicAiRateLimit: mocks.acquirePublicAiRateLimit,
  buildPublicAiRateLimitResponse: mocks.buildPublicAiRateLimitResponse,
}));
vi.mock('@/lib/arena/character-report-analysis-summary', () => ({
  isAllowedCharacterReportSummaryModel: mocks.isAllowedCharacterReportSummaryModel,
  normalizeCharacterReportSummaryModel: mocks.normalizeCharacterReportSummaryModel,
  generateCharacterReportAiSummary: mocks.generateCharacterReportAiSummary,
}));
vi.mock('@/lib/arena/character-report-analysis-data', () => ({
  parseCharacterReportAnalysisFilters: mocks.parseCharacterReportAnalysisFilters,
  loadCharacterReportAnalysis: mocks.loadCharacterReportAnalysis,
}));

const readJson = async (response: Response) => response.json() as Promise<Record<string, unknown>>;

describe('character report AI summary API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isSameOriginRequest.mockReturnValue(true);
    mocks.requireAuthUser.mockResolvedValue({ user: { id: 7, username: 'tester' } });
    mocks.isAllowedCharacterReportSummaryModel.mockImplementation((model: string) => model === 'default' || model === 'gpt-5.5');
    mocks.normalizeCharacterReportSummaryModel.mockImplementation((model: string) => model || 'default');
    mocks.acquirePublicAiRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0, identityScope: 'user' });
    mocks.parseCharacterReportAnalysisFilters.mockReturnValue({ fromIso: null, toIso: null, uploaderUsername: null, reportLimit: 50 });
  });

  test('跨站请求在认证和查询前被拒绝', async () => {
    mocks.isSameOriginRequest.mockReturnValue(false);
    const { POST } = await import('@/app/api/me/character-report-analysis/summary/handler');
    const response = await POST(new Request('https://example.test/api/me/character-report-analysis/summary', { method: 'POST', body: '{}' }));

    expect(response.status).toBe(403);
    expect(mocks.requireAuthUser).not.toHaveBeenCalled();
    expect(mocks.loadCharacterReportAnalysis).not.toHaveBeenCalled();
  });

  test('未知模型不会进入限流或数据库查询', async () => {
    const { POST } = await import('@/app/api/me/character-report-analysis/summary/handler');
    const response = await POST(new Request('https://example.test/api/me/character-report-analysis/summary', {
      method: 'POST',
      body: JSON.stringify({ cardId: 'card-a', model: 'unknown-model' }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.acquirePublicAiRateLimit).not.toHaveBeenCalled();
    expect(mocks.loadCharacterReportAnalysis).not.toHaveBeenCalled();
  });

  test('服务端按筛选快照重新加载并保留规则总结', async () => {
    const analysis = {
      conclusion: '规则结论',
      strengths: ['规则优势'],
      weaknesses: ['规则弱势'],
      filters: { fromIso: null, toIso: null, uploaderUsername: null, reportLimit: 100 },
    };
    mocks.loadCharacterReportAnalysis.mockResolvedValue({ analysis });
    mocks.generateCharacterReportAiSummary.mockResolvedValue({
      generationKey: 'summary-1',
      generatedAt: '2026-01-01T00:00:00.000Z',
      model: 'gpt-5.5',
      conclusion: 'AI 结论',
      strengths: ['AI 优势'],
      weaknesses: ['AI 弱势'],
      finalResultCount: 1,
      isFallback: false,
    });
    const { POST } = await import('@/app/api/me/character-report-analysis/summary/handler');
    const response = await POST(new Request('https://example.test/api/me/character-report-analysis/summary', {
      method: 'POST',
      body: JSON.stringify({
        cardId: 'card-a',
        model: 'gpt-5.5',
        filters: { reportLimit: 100 },
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.loadCharacterReportAnalysis).toHaveBeenCalledWith({
      cardId: 'card-a',
      userId: 7,
      filters: { fromIso: null, toIso: null, uploaderUsername: null, reportLimit: 50 },
    });
    expect(mocks.generateCharacterReportAiSummary).toHaveBeenCalledWith({ analysis, model: 'gpt-5.5', username: 'tester' });
    const payload = await readJson(response);
    expect(payload.ruleSummary).toEqual({ conclusion: '规则结论', strengths: ['规则优势'], weaknesses: ['规则弱势'] });
    expect((payload.summary as { generationKey?: string }).generationKey).toBe('summary-1');
  });
});
