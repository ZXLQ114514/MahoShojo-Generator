import { describe, expect, it } from 'vitest';

import type { AIProvider } from '@/lib/config';
import {
  filterProvidersForModelOverride,
  getRuntimeProviderId,
  resolveAttemptChannelContext,
  supportsModelOverride,
} from '@/lib/ai/provider-routing';

const provider = (name: string, model: string | string[]): AIProvider => ({
  name,
  apiKey: 'test-key',
  baseUrl: `https://${name}.example/v1`,
  model,
  type: 'openai',
  retryCount: 3,
});

describe('ai provider routing', () => {
  it('按供应商目录过滤不支持模型覆盖的渠道', () => {
    const providers = [
      provider('NewAPI_123nhh', 'deepseek-v4-pro'),
      provider('HsnAPI', ['glm-5.2', 'gpt-5.2']),
      provider('DeepSeek', 'deepseek-v4-pro'),
      provider('XemAPI_vip', ['gpt-5.4', 'gpt-5.5']),
    ];

    expect(filterProvidersForModelOverride(providers, 'glm-5.2').map((item) => item.name)).toEqual([
      'NewAPI_123nhh',
      'HsnAPI',
    ]);
    expect(supportsModelOverride(providers[2], 'glm-5.2')).toBe(false);
    expect(supportsModelOverride(provider('HsnAPI', 'sensenova-u1-fast'), 'sensenova-u1-fast')).toBe(true);
  });

  it('未知自定义模型没有兼容目录时保留原有渠道', () => {
    const providers = [provider('custom-relay', 'custom-default')];
    expect(filterProvidersForModelOverride(providers, 'custom-model')).toEqual(providers);
  });

  it('为系统渠道生成真实供应商上下文，并保留自定义渠道上下文', () => {
    const systemContext = resolveAttemptChannelContext(
      provider('NewAPI_123nhh_model_1', 'deepseek-v4-pro'),
      'glm-5.2',
      undefined,
      false,
    );
    expect(systemContext).toEqual({ providerId: 'newapi-123nhh', modelId: 'glm-5.2', isSystemChannel: true });
    expect(getRuntimeProviderId(provider('HsnAPI_model_2', 'gpt-5.2'))).toBe('hsnapi');

    expect(resolveAttemptChannelContext(
      provider('custom-relay', 'custom-default'),
      'custom-model',
      { providerId: 'custom-relay', modelId: 'custom-model' },
      true,
    )).toEqual({ providerId: 'custom-relay', modelId: 'custom-model', isSystemChannel: false });
  });
});
