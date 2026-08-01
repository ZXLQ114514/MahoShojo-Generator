import { describe, expect, test } from 'vitest';

import { buildCharacterPortraitPrompt, formatImagePromptAppearance } from '@/lib/tachie/prompt-utils';

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

  test('角色立绘提示词包含单人完整身体约束且不直接暴露整段 Markdown 版式', () => {
    const prompt = buildCharacterPortraitPrompt({
      appearance: { hairColor: '银色', outfit: '白色礼服' },
      description: '# 角色档案\n\n- 能力：操纵星光\n- 资料：不要把这些内容做成海报',
      characterType: 'magical-girl',
    });

    expect(prompt).toContain('单人，完整身体，从头到脚');
    expect(prompt).toContain('只生成一张没有任何可读文字的插画画面');
    expect(prompt).toContain('操纵星光');
    expect(prompt).not.toContain('# 角色档案');
    expect(prompt).not.toContain('\n- 能力');
  });
});
