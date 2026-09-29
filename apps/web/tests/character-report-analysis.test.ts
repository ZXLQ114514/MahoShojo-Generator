import { describe, expect, test } from 'vitest';

import { analyzeCharacterBattleReports } from '@/lib/arena/character-report-analysis';
import type { BattleReportCharacterAnalysisRow } from '@/lib/database/battle-report-generations';
import type { BattleReportGenerationCombatantRow } from '@/lib/database/battle-report-generation-combatants';

const combatant = (generationId: string, name: string, dataCardId: string): BattleReportGenerationCombatantRow => ({
  generation_id: generationId,
  sort_index: 0,
  name,
  type: 'character',
  template_id: null,
  is_native: 0,
  is_preset: 0,
  team_id: dataCardId === 'card-a' ? 1 : 2,
  character_guidance: null,
  data_card_id: dataCardId,
  data_card_updated_at: null,
  size_chars: null,
  size_bytes: null,
  created_at: '2026-01-01T00:00:00.000Z',
});

const report = (input: Partial<BattleReportCharacterAnalysisRow> & Pick<BattleReportCharacterAnalysisRow, 'generationId' | 'startedAt' | 'winner'>): BattleReportCharacterAnalysisRow => ({
  generationId: input.generationId,
  startedAt: input.startedAt,
  username: null,
  userId: null,
  mode: 'classic',
  generationMode: 'non-stream',
  winner: input.winner,
  headline: null,
  note: null,
  outputPreview: null,
  outputChars: null,
  outputHasSensitiveWords: null,
  outputHasShieldWords: null,
  ...input,
});

describe('character battle report analysis', () => {
  test('保留规则 K/D 并读取每场最终结果', () => {
    const result = analyzeCharacterBattleReports({
      card: { id: 'card-a', name: '角色 A', description: null, type: 'character', updatedAt: null },
      filters: { fromIso: null, toIso: null, uploaderUsername: null, reportLimit: 2 },
      totalReports: 2,
      uploaders: [],
      reports: [
        report({
          generationId: 'generation-win',
          startedAt: '2026-01-02T00:00:00.000Z',
          winner: '角色 A',
          outputPreview: JSON.stringify({ officialReport: { conclusion: '赢下关键回合。' } }),
        }),
        report({
          generationId: 'generation-loss',
          startedAt: '2026-01-01T00:00:00.000Z',
          winner: '对手',
          outputPreview: '## 最终结果\n对手抓住了破绽。',
          generationMode: 'stream',
        }),
      ],
      combatants: [
        combatant('generation-win', '角色 A', 'card-a'),
        combatant('generation-win', '对手', 'card-b'),
        combatant('generation-loss', '角色 A', 'card-a'),
        combatant('generation-loss', '对手', 'card-b'),
      ],
    });

    expect(result.kills).toBe(1);
    expect(result.deaths).toBe(1);
    expect(result.kd).toBe(1);
    expect(result.finalResultCount).toBe(2);
    expect(result.records.find((item) => item.generationId === 'generation-win')?.finalResult).toBe('赢下关键回合。');
    expect(result.conclusion).toContain('K/D 1.00');
  });
});
