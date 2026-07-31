import { describe, expect, it } from 'vitest';

import { parseAIProvidersFromEnv } from '@/lib/config';

describe('config ai provider parsing', () => {
  it('仅在显式 allowAnonymous 时保留匿名 OpenAI provider', () => {
    const providers = parseAIProvidersFromEnv({
      AI_PROVIDERS_CONFIG: JSON.stringify([
        {
          name: 'opencode_zen_free',
          apiKey: '',
          allowAnonymous: true,
          baseUrl: 'https://opencode.ai/zen/v1',
          model: 'big-pickle',
          type: 'openai',
        },
        {
          name: 'anonymous_google',
          apiKey: '',
          allowAnonymous: true,
          baseUrl: 'https://example.com/v1',
          model: 'gemini-2.5-flash',
          type: 'google',
        },
        {
          name: 'missing_key_openai',
          apiKey: '',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          type: 'openai',
        },
      ]),
    } as NodeJS.ProcessEnv);

    expect(providers).toHaveLength(1);
    expect(providers[0]).toEqual({
      name: 'opencode_zen_free',
      apiKey: '',
      allowAnonymous: true,
      baseUrl: 'https://opencode.ai/zen/v1',
      model: 'big-pickle',
      type: 'openai',
      retryCount: 1,
      skipProbability: 0,
    });
  });

  it('按 AI_PROVIDER_PRIORITY 重排供应商，同时保留未列出的供应商顺序', () => {
    const providers = parseAIProvidersFromEnv({
      AI_PROVIDER_PRIORITY: 'NewAPI_123nhh, HsnAPI',
      AI_PROVIDERS_CONFIG: JSON.stringify([
        { name: 'HsnAPI', apiKey: 'hsn-key', baseUrl: 'https://hsn.example/v1', model: 'model-a', type: 'openai' },
        { name: 'XemAPI_vip', apiKey: 'xem-key', baseUrl: 'https://xem.example/v1', model: 'model-b', type: 'openai' },
        { name: 'NewAPI_123nhh', apiKey: 'new-key', baseUrl: 'https://new.example/v1', model: 'model-c', type: 'openai' },
      ]),
    } as NodeJS.ProcessEnv);

    expect(providers.map((provider) => provider.name)).toEqual([
      'NewAPI_123nhh',
      'HsnAPI',
      'XemAPI_vip',
    ]);
  });

  it('未配置优先级时默认优先使用 NewAPI_123nhh', () => {
    const providers = parseAIProvidersFromEnv({
      AI_PROVIDERS_CONFIG: JSON.stringify([
        { name: 'HsnAPI', apiKey: 'hsn-key', baseUrl: 'https://hsn.example/v1', model: 'model-a', type: 'openai' },
        { name: 'NewAPI_123nhh', apiKey: 'new-key', baseUrl: 'https://new.example/v1', model: 'model-b', type: 'openai' },
      ]),
    } as NodeJS.ProcessEnv);

    expect(providers.map((provider) => provider.name)).toEqual([
      'NewAPI_123nhh',
      'HsnAPI',
    ]);
  });
});
