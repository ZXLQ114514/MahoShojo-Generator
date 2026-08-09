import { describe, expect, test } from 'vitest';

import { extractCharacterReportFinalResult } from '@/lib/arena/character-report-analysis-output';

describe('character report final result parser', () => {
  test('读取非流式 JSON 的 officialReport.conclusion', () => {
    const preview = JSON.stringify({
      headline: '测试战报',
      officialReport: { winner: '角色 A', conclusion: '角色 A 在最后一轮完成逆转。' },
    });

    expect(extractCharacterReportFinalResult({ outputPreview: preview, outputChars: preview.length })).toBe('角色 A 在最后一轮完成逆转。');
  });

  test('读取流式 Markdown 最终结果段落并在下一个标题停止', () => {
    const preview = '# 战报\n\n## 胜利者\n- 角色 A\n\n## 最终结果\n角色 A 稳住节奏并获胜。\n\n## 其他记录\n不应被带入。';
    expect(extractCharacterReportFinalResult({ outputPreview: preview, generationMode: 'stream' })).toBe('角色 A 稳住节奏并获胜。');
  });

  test('D1 预览截断或敏感标记时不猜测正文', () => {
    const preview = '{"officialReport":{"conclusion":"不完整"}}';
    expect(extractCharacterReportFinalResult({ outputPreview: preview, outputChars: preview.length + 2 })).toBeNull();
    expect(extractCharacterReportFinalResult({ outputPreview: preview, outputHasSensitiveWords: true })).toBeNull();
    expect(extractCharacterReportFinalResult({ outputPreview: preview, outputHasShieldWords: true })).toBeNull();
  });

  test('完整流式正文的首尾换行不会被误判为截断', () => {
    const preview = '\n## 最终结果\n角色 A 守住了最后一回合。\n';
    expect(extractCharacterReportFinalResult({ outputPreview: preview, outputChars: preview.length })).toBe('角色 A 守住了最后一回合。');
  });

  test('无目标段落或无效 JSON 返回 null', () => {
    expect(extractCharacterReportFinalResult({ outputPreview: '{"officialReport":' })).toBeNull();
    expect(extractCharacterReportFinalResult({ outputPreview: '# 战报\n\n## 胜利者\n- 角色 A' })).toBeNull();
  });
});
