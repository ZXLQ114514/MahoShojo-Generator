import { describe, expect, it } from 'vitest';

import {
  applyShieldWords,
  createShieldWordFilter,
  setRuntimeShieldWordRules,
} from '@/lib/shield-word-filter';

describe('shield-word-filter', () => {
  const decodeBase64Utf8 = (input: string): string => {
    if (typeof atob === 'function') {
      const binaryString = atob(input);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return new TextDecoder('utf-8').decode(bytes);
    }
    return Buffer.from(input, 'base64').toString('utf8');
  };

  it('replaces configured word with replacement text', () => {
    const result = applyShieldWords('我来自中国。');
    expect(result.hasShieldWords).toBe(true);
    expect(result.filteredText).toBe('我来自【国度】。');
  });

  it('replaces traditional variant with replacement text', () => {
    const result = applyShieldWords('我来自中國。');
    expect(result.hasShieldWords).toBe(true);
    expect(result.filteredText).toBe('我来自【国度】。');
  });

  it('masks default shield words with a non-markdown-safe symbol', () => {
    const word = decodeBase64Utf8('5Y+R5oOF'); // 发情
    const result = applyShieldWords(`abc${word}def`);
    expect(result.hasShieldWords).toBe(true);
    expect(result.filteredText).toBe('abc❀❀def');
  });

  it('keeps text unchanged when no shield words appear', () => {
    const text = '这是一段安全的文本。';
    const result = applyShieldWords(text);
    expect(result.hasShieldWords).toBe(false);
    expect(result.filteredText).toBe(text);
  });

  it('keeps exact-match indexes aligned when Unicode lowercase would expand', () => {
    const result = applyShieldWords('İİ发情');

    expect(result.hasShieldWords).toBe(true);
    expect(result.filteredText).toBe('İİ❀❀');
  });

  it('merges custom mask and replacement rules with the built-in baseline', () => {
    const filter = createShieldWordFilter([
      { word: '星际禁词', replacement: null },
      { word: '古老咒语', replacement: '【安全描述】' },
    ]);

    expect(filter('这是星际禁词。').filteredText).toBe('这是❀❀❀❀。');
    expect(filter('古老咒语已消失。').filteredText).toBe('【安全描述】已消失。');
    expect(filter('我来自中国。').filteredText).toBe('我来自【国度】。');
  });

  it('uses the longest non-overlapping match and supports custom pinyin detection', () => {
    const filter = createShieldWordFilter([
      { word: '星际', replacement: '短词' },
      { word: '星际禁词', replacement: '长词' },
    ]);

    expect(filter('星际禁词').filteredText).toBe('长词');
    expect(filter('xing ji jin ci').filteredText).toBe('长词');
  });

  it('masks the full union of partially overlapping rules', () => {
    const filter = createShieldWordFilter([
      { word: '星际禁', replacement: '前段' },
      { word: '禁词测试', replacement: '后段' },
    ]);

    expect(filter('星际禁词测试').filteredText).toBe('❀❀❀❀❀❀');
  });

  it('can install and clear runtime custom rules without disabling built-in rules', () => {
    setRuntimeShieldWordRules([{ word: '临时禁词', replacement: null }]);
    expect(applyShieldWords('临时禁词').hasShieldWords).toBe(true);

    setRuntimeShieldWordRules([]);
    expect(applyShieldWords('临时禁词').hasShieldWords).toBe(false);
    expect(applyShieldWords('我来自中国。').filteredText).toBe('我来自【国度】。');
  });
});
