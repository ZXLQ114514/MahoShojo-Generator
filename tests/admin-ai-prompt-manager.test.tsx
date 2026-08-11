import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  authStorage: { fetch: vi.fn() },
}));

import { AiPromptManager } from '@/components/admin/AiPromptManager';

describe('admin AI prompt manager', () => {
  test('renders the prompt inventory controls and operational boundaries', () => {
    const html = renderToStaticMarkup(<AiPromptManager />);

    expect(html).toContain('固定业务模板和图像推荐词均可在此维护');
    expect(html).toContain('Schema 文字目前只做盘点');
    expect(html).toContain('未接入项会明确标记');
    expect(html).toContain('aria-label="搜索 AI 提示词"');
    expect(html).toContain('aria-label="按提示词分类筛选"');
    expect(html).toContain('aria-label="按提示词状态筛选"');
    expect(html).toContain('导出 JSON');
    expect(html).toContain('导入 JSON');
    expect(html).toContain('加载中');
  });
});
