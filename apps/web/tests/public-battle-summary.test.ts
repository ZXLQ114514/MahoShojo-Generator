import { describe, expect, it } from 'vitest';

import {
  buildPublicBattleCharacterStats,
  getPublicBattleSummaryTier,
} from '@/lib/arena/public-battle-summary';

describe('public battle summary', () => {
  it('使用固定八档边界', () => {
    expect(getPublicBattleSummaryTier(100)).toBe('超大杯上');
    expect(getPublicBattleSummaryTier(90)).toBe('超大杯上');
    expect(getPublicBattleSummaryTier(89)).toBe('超大杯下');
    expect(getPublicBattleSummaryTier(70)).toBe('大杯上');
    expect(getPublicBattleSummaryTier(50)).toBe('中杯上');
    expect(getPublicBattleSummaryTier(25)).toBe('小杯上');
    expect(getPublicBattleSummaryTier(24)).toBe('小杯下');
  });

  it('只基于非平局公开战报统计角色，并保留样本量', () => {
    const result = buildPublicBattleCharacterStats([
      { generationId: 'one', startedAt: '2026-01-01', publicSince: '2026-01-01', username: 'u', winner: 'A', combatantName: 'A' },
      { generationId: 'one', startedAt: '2026-01-01', publicSince: '2026-01-01', username: 'u', winner: 'A', combatantName: 'B' },
      { generationId: 'two', startedAt: '2026-01-02', publicSince: '2026-01-02', username: 'u', winner: '平局', combatantName: 'A' },
      { generationId: 'two', startedAt: '2026-01-02', publicSince: '2026-01-02', username: 'u', winner: '平局', combatantName: 'B' },
    ]);

    expect(result.reportCount).toBe(1);
    expect(result.characters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'A', matches: 1, wins: 1, losses: 0, kills: 1, deaths: 0 }),
      expect.objectContaining({ name: 'B', matches: 1, wins: 0, losses: 1, kills: 0, deaths: 1 }),
    ]));
  });
});
