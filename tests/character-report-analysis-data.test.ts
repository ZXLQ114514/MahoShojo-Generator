import { describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/sensitive-word-filter', () => ({
  quickCheck: vi.fn(async (text: string) => ({ hasSensitiveWords: text.includes('[敏感]') })),
}));
vi.mock('@/lib/shield-word-filter', () => ({
  applyShieldWords: (text: string) => ({ hasShieldWords: text.includes('[屏蔽]'), filteredText: text }),
}));

import { removeUnsafeFinalResultPreviews } from '@/lib/arena/character-report-analysis-data';
import type { BattleReportCharacterAnalysisRow } from '@/lib/database/battle-report-generations';

const report = (outputPreview: string): BattleReportCharacterAnalysisRow => ({
  generationId: 'generation-1',
  startedAt: '2026-01-01T00:00:00.000Z',
  username: 'tester',
  userId: 7,
  mode: 'classic',
  generationMode: 'non-stream',
  winner: '角色 A',
  headline: null,
  note: null,
  outputPreview,
  outputChars: outputPreview.length,
  outputHasSensitiveWords: false,
  outputHasShieldWords: false,
});

describe('character report analysis source safety', () => {
  test('敏感最终结果不会进入分析或 AI 输入', async () => {
    const result = await removeUnsafeFinalResultPreviews([
      report(JSON.stringify({ officialReport: { conclusion: '含有[敏感]内容。' } })),
    ]);

    expect(result[0]?.outputPreview).toBeNull();
  });

  test('安全最终结果保留原始预览以维持截断判断', async () => {
    const preview = JSON.stringify({ officialReport: { conclusion: '安全结论。' } });
    const result = await removeUnsafeFinalResultPreviews([report(preview)]);

    expect(result[0]?.outputPreview).toBe(preview);
  });
});
