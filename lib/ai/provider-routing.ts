import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';
import type { AIProvider } from '@/lib/config';

export type ChannelContext = {
  providerId: string;
  modelId: string;
  isSystemChannel?: boolean;
};

const RUNTIME_PROVIDER_IDS: Record<string, string> = {
  DeepSeek: 'deepseek',
  HsnAPI: 'hsnapi',
  NewAPI_123nhh: 'newapi-123nhh',
  XemAPI_default: 'xemapi-default',
  XemAPI_vip: 'xemapi-vip',
};

export const getBaseProviderName = (name: string): string => name.replace(/_model_\d+$/, '');

const normalizeModelId = (modelId: string): string => modelId.trim().toLowerCase();

const getConfiguredModels = (provider: AIProvider): string[] =>
  (Array.isArray(provider.model) ? provider.model : [provider.model])
    .filter((model): model is string => typeof model === 'string')
    .map((model) => model.trim())
    .filter(Boolean);

type ModelSupport = 'supported' | 'unsupported' | 'unknown';

const resolveModelSupport = (provider: AIProvider, modelId: string): ModelSupport => {
  const normalizedModelId = normalizeModelId(modelId);
  if (!normalizedModelId) return 'unsupported';

  if (getConfiguredModels(provider).some((model) => normalizeModelId(model) === normalizedModelId)) {
    return 'supported';
  }

  const catalogProvider = AI_PROVIDER_CATALOG.find((item) => item.id === getRuntimeProviderId(provider));
  if (!catalogProvider) {
    // 配置中的自定义/历史供应商没有可验证的目录时，保持 fail-open。
    return 'unknown';
  }

  return catalogProvider.models.some((model) => normalizeModelId(model.value) === normalizedModelId)
    ? 'supported'
    : 'unsupported';
};

export const getRuntimeProviderId = (provider: AIProvider): string => {
  const baseName = getBaseProviderName(provider.name);
  return RUNTIME_PROVIDER_IDS[baseName] ?? baseName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
};

/**
 * 判断一次尝试是否仍然来自显式的 BYOK 供应商。
 *
 * 模型数组展开会给名称追加 `_model_N`，因此不能只比较完整名称；
 * 同时也不能使用 startsWith，否则名称相近的系统渠道会被误标为自定义渠道。
 */
export const isProviderOverrideAttempt = (
  provider: AIProvider,
  providerOverride: AIProvider | undefined,
): boolean => {
  if (!providerOverride) return false;

  return (
    getBaseProviderName(provider.name).trim().toLowerCase() ===
      getBaseProviderName(providerOverride.name).trim().toLowerCase() &&
    provider.baseUrl.trim() === providerOverride.baseUrl.trim() &&
    provider.type === providerOverride.type &&
    provider.apiKey === providerOverride.apiKey
  );
};

export const supportsModelOverride = (provider: AIProvider, modelId: string): boolean => {
  return resolveModelSupport(provider, modelId) === 'supported';
};

export const filterProvidersForModelOverride = (
  providers: AIProvider[],
  modelOverride: string | undefined,
): AIProvider[] => {
  const normalizedModelId = modelOverride?.trim();
  if (!normalizedModelId) return providers;

  const supportStates = providers.map((provider) => resolveModelSupport(provider, normalizedModelId));
  if (!supportStates.includes('supported')) return providers;

  return providers.filter((_, index) => supportStates[index] !== 'unsupported');
};

const expandProviderModels = (providers: AIProvider[]): AIProvider[] => {
  const expandedProviders: AIProvider[] = [];

  for (const provider of providers) {
    if (typeof provider.model === 'string') {
      const normalizedModel = provider.model.trim();
      if (normalizedModel) {
        expandedProviders.push({ ...provider, model: normalizedModel });
      }
      continue;
    }

    if (!Array.isArray(provider.model)) continue;
    provider.model.forEach((model, index) => {
      if (typeof model !== 'string') return;
      const normalizedModel = model.trim();
      if (!normalizedModel) return;
      expandedProviders.push({
        ...provider,
        name: `${provider.name}_model_${index + 1}`,
        model: normalizedModel,
        weight: provider.weight || 1,
      });
    });
  }

  return expandedProviders;
};

/**
 * 生成一次请求所需的供应商尝试列表。
 *
 * 没有模型覆盖时，保留配置中“每个模型都是一个独立尝试”的行为；
 * 有模型覆盖时，同一供应商只保留一个实例，避免其配置的每个模型
 * 都被改写成同一个覆盖模型并重复重试。不同供应商始终保持独立。
 */
export const prepareProvidersForModelOverride = (
  providers: AIProvider[],
  modelOverride: string | undefined,
  options: { restrictToFirstProvider?: boolean } = {},
): AIProvider[] => {
  const providerCandidates = options.restrictToFirstProvider ? providers.slice(0, 1) : providers;
  const normalizedModelId = modelOverride?.trim();
  if (!normalizedModelId) return expandProviderModels(providerCandidates);

  const providersToUse = filterProvidersForModelOverride(providerCandidates, normalizedModelId);
  return providersToUse.map((provider) => ({
    ...provider,
    model: normalizedModelId,
  }));
};

export const resolveAttemptChannelContext = (
  provider: AIProvider,
  modelId: string,
  providedContext: ChannelContext | undefined,
  isCustomProvider: boolean,
): ChannelContext => {
  if (isCustomProvider && providedContext) {
    return { ...providedContext, modelId, isSystemChannel: false };
  }

  return {
    providerId: getRuntimeProviderId(provider),
    modelId,
    isSystemChannel: true,
  };
};
