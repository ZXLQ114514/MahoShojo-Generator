import { describe, expect, test } from 'vitest';

import { formatImagePromptAppearance } from '@/lib/tachie/prompt-utils';

describe('image prompt appearance formatter', () => {
  test('将结构化外观转换为自然语言并移除 JSON 结构', () => {
    const prompt = formatImagePromptAppearance({
      hairColor: '银蓝色',
      hairStyle: '长发',
      outfit: '黑色礼装',
      accessories: ['水晶耳坠', '金属发饰'],
    });

    expect(prompt).toContain('发色为银蓝色');
    expect(prompt).toContain('发型为长发');
    expect(prompt).toContain('服装为黑色礼装');
    expect(prompt).toContain('配饰为水晶耳坠、金属发饰');
    expect(prompt).not.toContain('{');
    expect(prompt).not.toContain('hairColor:');
  });

  test('兼容纯文本外观和嵌套对象', () => {
    expect(formatImagePromptAppearance('银发，蓝眼')).toBe('银发，蓝眼');
    expect(formatImagePromptAppearance({ colors: { hair: '银色', eyes: '蓝色' } })).toBe('colors为银色、蓝色');
  });
});
