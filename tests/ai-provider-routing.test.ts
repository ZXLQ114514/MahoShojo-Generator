import { describe, expect, it } from 'vitest';

import type { AIProvider } from '@/lib/config';
import {
  filterProvidersForModelOverride,
  getRuntimeProviderId,
  isProviderOverrideAttempt,
  prepareProvidersForModelOverride,
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

  it('目录未知的独立供应商不会因其他渠道兼容而被误删', () => {
    const defaultXem = provider('XemAPI_default', 'deepseek-v4-pro');
    const vipXem = provider('XemAPI_vip', 'gpt-5.5');

    expect(filterProvidersForModelOverride([defaultXem, vipXem], 'gpt-5.5').map((item) => item.name)).toEqual([
      'XemAPI_default',
      'XemAPI_vip',
    ]);
    expect(getRuntimeProviderId(defaultXem)).toBe('xemapi-default');
    expect(getRuntimeProviderId(vipXem)).toBe('xemapi-vip');
  });

  it('XemAPI_default 目录未知时仍保留 fail-open 渠道', () => {
    const defaultXem = provider('XemAPI_default', 'xem-default-model');
    const vipXem = provider('XemAPI_vip', 'gpt-5.5');

    expect(supportsModelOverride(defaultXem, 'gpt-5.5')).toBe(false);
    expect(filterProvidersForModelOverride([defaultXem, vipXem], 'gpt-5.5').map((item) => item.name)).toEqual([
      'XemAPI_default',
      'XemAPI_vip',
    ]);
  });

  it('有模型覆盖时每个供应商只生成一个尝试，并保留独立供应商身份', () => {
    const providers = [
      provider('NewAPI_123nhh', ['gpt-5.4', 'gpt-5.5']),
      provider('HsnAPI', ['glm-5.2', 'gpt-5.2']),
      provider('XemAPI_vip', ['gpt-5.4', 'gpt-5.5']),
    ];

    const prepared = prepareProvidersForModelOverride(providers, 'gpt-5.5');

    expect(prepared.map((item) => item.name)).toEqual([
      'NewAPI_123nhh',
      'XemAPI_vip',
    ]);
    expect(prepared.map((item) => item.model)).toEqual(['gpt-5.5', 'gpt-5.5']);
  });

  it('未知覆盖模型也不会按供应商配置模型数量重复尝试', () => {
    const providers = [
      provider('custom-relay', ['model-a', 'model-b']),
      provider('another-relay', ['model-c', 'model-d']),
    ];

    const prepared = prepareProvidersForModelOverride(providers, 'custom-model');

    expect(prepared).toHaveLength(2);
    expect(prepared.map((item) => item.name)).toEqual(['custom-relay', 'another-relay']);
    expect(prepared.every((item) => item.model === 'custom-model')).toBe(true);
  });

  it('规范化模型覆盖值后再写入供应商尝试', () => {
    const providers = [provider('NewAPI_123nhh', ['gpt-5.4', 'gpt-5.5'])];

    const prepared = prepareProvidersForModelOverride(providers, '  gpt-5.5  ');

    expect(prepared).toHaveLength(1);
    expect(prepared[0].model).toBe('gpt-5.5');
  });

  it('自定义策略限制为首个供应商，不会切换到兼容的系统渠道', () => {
    const providers = [
      provider('custom-relay', 'custom-default'),
      provider('XemAPI_vip', ['gpt-5.4', 'gpt-5.5']),
    ];

    const prepared = prepareProvidersForModelOverride(providers, 'gpt-5.5', {
      restrictToFirstProvider: true,
    });

    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toMatchObject({ name: 'custom-relay', model: 'gpt-5.5' });
  });

  it('无覆盖模型时会剔除空模型数组', () => {
    expect(prepareProvidersForModelOverride([
      provider('empty-array-provider', []),
      provider('empty-string-provider', '   '),
    ], undefined)).toEqual([]);
  });

  it('没有模型覆盖时仍按配置模型展开独立尝试', () => {
    const providers = [provider('HsnAPI', ['model-a', 'model-b'])];

    const prepared = prepareProvidersForModelOverride(providers, undefined);

    expect(prepared.map((item) => ({ name: item.name, model: item.model }))).toEqual([
      { name: 'HsnAPI_model_1', model: 'model-a' },
      { name: 'HsnAPI_model_2', model: 'model-b' },
    ]);
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

  it('只将同一端点和凭据的模型展开标记为自定义渠道', () => {
    const override = provider('relay', ['model-a', 'model-b']);
    const expandedAttempt = { ...override, name: 'relay_model_2', model: 'model-b' };
    const similarlyNamedSystemProvider = provider('relay_backup', 'model-b');
    const sameNameDifferentEndpoint = { ...override, baseUrl: 'https://other.example/v1' };
    const sameNameDifferentKey = { ...override, apiKey: 'another-key' };

    expect(isProviderOverrideAttempt(expandedAttempt, override)).toBe(true);
    expect(isProviderOverrideAttempt(similarlyNamedSystemProvider, override)).toBe(false);
    expect(isProviderOverrideAttempt(sameNameDifferentEndpoint, override)).toBe(false);
    expect(isProviderOverrideAttempt(sameNameDifferentKey, override)).toBe(false);
  });
});
