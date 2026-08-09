import { describe, expect, test } from 'vitest';

import {
  normalizeShieldWordRules,
  SHIELD_WORD_MAX_LENGTH,
  SHIELD_WORD_MAX_RULES,
} from '@/lib/shield-word-settings';

describe('shield word settings validation', () => {
  test('trims valid rules and preserves mask versus replacement mode', () => {
    expect(normalizeShieldWordRules([
      { word: '  测试词  ', replacement: null },
      { word: '替换词', replacement: '  安全文本  ' },
    ])).toEqual({
      ok: true,
      rules: [
        { word: '测试词', replacement: null },
        { word: '替换词', replacement: '安全文本' },
      ],
    });
  });

  test('rejects normalized duplicates, control characters and empty replacement text', () => {
    expect(normalizeShieldWordRules([
      { word: '測試詞', replacement: null },
      { word: '测试词', replacement: null },
    ])).toMatchObject({ ok: false });
    expect(normalizeShieldWordRules([{ word: '测\n试', replacement: null }])).toMatchObject({ ok: false });
    expect(normalizeShieldWordRules([{ word: '测试', replacement: '   ' }])).toMatchObject({ ok: false });
  });

  test('rejects replacements that reintroduce built-in or custom shield words', () => {
    expect(normalizeShieldWordRules([
      { word: '新规则', replacement: '中国' },
    ])).toMatchObject({ ok: false, error: '第 1 条替换文本不能包含屏蔽词' });
    expect(normalizeShieldWordRules([
      { word: '星际禁词', replacement: '星际禁词' },
    ])).toMatchObject({ ok: false, error: '第 1 条替换文本不能包含屏蔽词' });
  });

  test('enforces rule count and word length limits', () => {
    expect(normalizeShieldWordRules(Array.from({ length: SHIELD_WORD_MAX_RULES + 1 }, (_, index) => ({
      word: `词${index}`,
      replacement: null,
    })))).toMatchObject({ ok: false });
    expect(normalizeShieldWordRules([{ word: '词'.repeat(SHIELD_WORD_MAX_LENGTH + 1), replacement: null }])).toMatchObject({ ok: false });
  });
});
