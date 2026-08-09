import { describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/ai', () => ({ generateWithAI: vi.fn() }));

import {
  buildCharacterReportSummaryPromptInput,
  generateCharacterReportAiSummary,
  isAllowedCharacterReportSummaryModel,
} from '@/lib/arena/character-report-analysis-summary';
import type { CharacterReportAnalysisResult } from '@/lib/arena/character-report-analysis';

const analysis = (overrides: Partial<CharacterReportAnalysisResult> = {}): CharacterReportAnalysisResult => ({
  card: { id: 'card-a', name: '角色 A', description: null, type: 'character', updatedAt: null },
  filters: { fromIso: null, toIso: null, uploaderUsername: null, reportLimit: 50 },
  totalReports: 1,
  includedReports: 1,
  moreAvailable: false,
  wins: 1,
  losses: 0,
  draws: 0,
  unknowns: 0,
  decisiveReports: 1,
  winRate: 100,
  kills: 1,
  deaths: 0,
  kd: null,
  firstStartedAt: '2026-01-01T00:00:00.000Z',
  lastStartedAt: '2026-01-01T00:00:00.000Z',
  uploaders: [],
  modeBreakdown: [],
  uploaderBreakdown: [],
  timeline: [],
  records: [{
    generationId: 'generation-1',
    startedAt: '2026-01-01T00:00:00.000Z',
    username: null,
    mode: 'classic',
    outcome: 'win',
    finalResult: '赢下最后一轮。',
  }],
  finalResultCount: 1,
  strengths: ['胜率高'],
  weaknesses: [],
  conclusion: '规则总结',
  ...overrides,
});

describe('character report AI summary contract', () => {
  test('只允许系统模型目录中的值', () => {
    expect(isAllowedCharacterReportSummaryModel('default')).toBe(true);
    expect(isAllowedCharacterReportSummaryModel('gpt-5.5')).toBe(true);
    expect(isAllowedCharacterReportSummaryModel('https://attacker.example/model')).toBe(false);
    expect(isAllowedCharacterReportSummaryModel('__custom_model_id__')).toBe(false);
  });

  test('提示词输入包含最终结果和 K/D 定义', () => {
    const promptInput = buildCharacterReportSummaryPromptInput(analysis());
    expect(promptInput.character.kdDefinition).toContain('胜负映射');
    expect(promptInput.finalResults[0]?.text).toBe('赢下最后一轮。');
  });

  test('无样本时保留规则总结并生成唯一键', async () => {
    const first = await generateCharacterReportAiSummary({ analysis: analysis({ includedReports: 0, totalReports: 0, finalResultCount: 0 }), model: 'default' });
    const second = await generateCharacterReportAiSummary({ analysis: analysis({ includedReports: 0, totalReports: 0, finalResultCount: 0 }), model: 'default' });

    expect(first.isFallback).toBe(true);
    expect(first.conclusion).toBe('规则总结');
    expect(first.generationKey).toBeTruthy();
    expect(second.generationKey).not.toBe(first.generationKey);
  });
});
