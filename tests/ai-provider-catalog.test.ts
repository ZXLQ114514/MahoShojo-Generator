import { describe, expect, it } from 'vitest';

import { AI_PROVIDER_CATALOG, resolveAIProviderModel } from '@/lib/ai/constants';

describe('ai-provider-catalog', () => {
  it('provider id 必须唯一', () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];

    for (const provider of AI_PROVIDER_CATALOG) {
      if (seen.has(provider.id)) duplicates.push(provider.id);
      seen.add(provider.id);
    }

    expect(duplicates).toEqual([]);
  });

  it('每个 provider 的 model value 必须唯一', () => {
    const errors: Array<{ providerId: string; duplicates: string[] }> = [];

    for (const provider of AI_PROVIDER_CATALOG) {
      const seen = new Set<string>();
      const duplicates = new Set<string>();

      for (const model of provider.models) {
        if (seen.has(model.value)) duplicates.add(model.value);
        seen.add(model.value);
      }

      if (duplicates.size > 0) {
        errors.push({ providerId: provider.id, duplicates: Array.from(duplicates) });
      }
    }

    expect(errors).toEqual([]);
  });
  it('系统默认配置模型列表与当前服务器默认供应商保持一致', () => {
    const systemProvider = AI_PROVIDER_CATALOG.find(item => item.id === 'system');
    const hsnProvider = AI_PROVIDER_CATALOG.find(item => item.id === 'hsnapi');
    const deepSeekProvider = AI_PROVIDER_CATALOG.find(item => item.id === 'deepseek');
    const newApiProvider = AI_PROVIDER_CATALOG.find(item => item.id === 'newapi-123nhh');
    const xemApiProvider = AI_PROVIDER_CATALOG.find(item => item.id === 'xemapi-vip');

    expect(systemProvider?.models.map(model => model.value)).toEqual([
      'default',
      'codex-auto-review',
      'deepseek-v4-flash',
      'glm-5.2',
      'gpt-5.2',
      'sensenova-6.7-flash-lite',
      'deepseek-v4-pro',
      'gpt-5.4',
      'gpt-5.5',
      'qwen3.7-max-t',
      'deepseek-ai/deepseek-v4-pro',
    ]);
    expect(hsnProvider?.models.map(model => model.value)).toEqual([
      'codex-auto-review',
      'deepseek-v4-flash',
      'glm-5.2',
      'gpt-5.2',
      'sensenova-6.7-flash-lite',
    ]);
    expect(deepSeekProvider?.models.map(model => model.value)).toEqual([
      'deepseek-v4-flash-0731',
      'deepseek-v4-pro',
      'deepseek-chat',
      'deepseek-reasoner',
      'deepseek-r1',
    ]);
    expect(deepSeekProvider && resolveAIProviderModel(deepSeekProvider, 'deepseek-v4-flash-0731')).toEqual({
      modelId: 'deepseek-v4-flash',
      isCustom: false,
    });
    expect(newApiProvider?.baseUrl).toBe('https://api.123nhh.com/v1');
    expect(newApiProvider?.models.map(model => model.value)).toEqual(expect.arrayContaining([
      'deepseek-v4-pro',
      'deepseek-v4-flash',
      'gpt-5.4',
      'gpt-5.5',
      'glm-5.2',
    ]));
    expect(xemApiProvider?.models.map(model => model.value)).toEqual([
      'gpt-5.4',
      'gpt-5.5',
      'deepseek-ai/deepseek-v4-pro',
    ]);
  });

  it('已有 Gemma 模型目录包含新的 Gemma 4 模型', () => {
    const providerIds = ['google-cloudflare'];

    for (const providerId of providerIds) {
      const provider = AI_PROVIDER_CATALOG.find(item => item.id === providerId);
      const modelValues = provider?.models.map(model => model.value) ?? [];

      expect(modelValues).toContain('gemma-4-31b-it');
      expect(modelValues).toContain('gemma-4-26b-a4b-it');
    }
  });

  it('词元跳动目录包含 OpenAI 兼容端点与关键文本模型', () => {
    const provider = AI_PROVIDER_CATALOG.find(item => item.id === 'tokendance');
    const modelValues = provider?.models.map(model => model.value) ?? [];

    expect(provider?.name).toBe('词元跳动 TokenDance');
    expect(provider?.baseUrl).toBe('https://tokendance.space/gateway/v1');
    expect(provider?.type).toBe('openai');
    expect(modelValues).toEqual(expect.arrayContaining([
      'minimax-m2.7',
      'glm-5.1',
      'deepseek-v4-flash-0731',
      'kimi-k2.6',
      'seed-2.0-pro',
    ]));
  });

  it('小米 MiMo 目录只公开当前精简后的普通 API 模型', () => {
    const normalProvider = AI_PROVIDER_CATALOG.find(item => item.id === 'xiaomi-mimo');

    expect(normalProvider?.name).toBe('小米 MiMo');
    expect(normalProvider?.baseUrl).toBe('https://api.xiaomimimo.com/v1');
    expect(normalProvider?.type).toBe('openai');
    expect(normalProvider?.description).toContain('sk-');
    expect(normalProvider?.models.map(model => model.value)).toEqual([
      'mimo-v2.5-pro',
      'mimo-v2.5',
    ]);
    expect(AI_PROVIDER_CATALOG.some(item => item.id.startsWith('xiaomi-mimo-token-plan'))).toBe(false);
  });

  it('不再暴露已由上游精简的独立商汤 Token Plan 入口', () => {
    const provider = AI_PROVIDER_CATALOG.find(item => item.id === 'sensenova-token-plan');

    expect(provider).toBeUndefined();
  });
});
