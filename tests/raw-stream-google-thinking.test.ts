import { describe, expect, it } from 'vitest';

import { resolveRawStreamProviderOptions } from '@/lib/stream/raw-ai';

describe('resolveRawStreamProviderOptions', () => {
  it('为 Google Gemini 补充默认 reasoning 回流配置', () => {
    expect(resolveRawStreamProviderOptions('google', 'gemini-2.5-flash')).toEqual({
      google: { thinkingConfig: { includeThoughts: true } },
    });
  });

  it('不为 Google 非 Gemini 或 OpenAI 兼容 Gemini 补充默认配置', () => {
    expect(resolveRawStreamProviderOptions('google', 'gemma-4-31b-it')).toBeUndefined();
    expect(resolveRawStreamProviderOptions('openai', 'gemini-2.5-flash')).toBeUndefined();
  });

  it('完整保留显式 thinkingBudget: 0，不重新开启 Thinking', () => {
    const providerOptions = {
      google: { thinkingConfig: { thinkingBudget: 0 } },
    };

    expect(resolveRawStreamProviderOptions('google', 'gemini-2.5-flash', providerOptions)).toBe(providerOptions);
  });

  it('完整保留显式 thinkingLevel 和 includeThoughts', () => {
    const providerOptions = {
      google: { thinkingConfig: { thinkingLevel: 'high', includeThoughts: false } },
      openai: { reasoningEffort: 'high' },
    };

    expect(resolveRawStreamProviderOptions('google', 'Gemini-3.6-Flash', providerOptions)).toBe(providerOptions);
  });

  it('补默认配置时保留 Google 和其他 Provider 的既有选项', () => {
    expect(resolveRawStreamProviderOptions('google', ' gemini-2.5-flash ', {
      google: { structuredOutputs: true },
      openai: { reasoningEffort: 'low' },
    })).toEqual({
      google: {
        structuredOutputs: true,
        thinkingConfig: { includeThoughts: true },
      },
      openai: { reasoningEffort: 'low' },
    });
  });
});
