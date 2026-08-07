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
  XemAPI_vip: 'xemapi-vip',
};

export const getBaseProviderName = (name: string): string => name.replace(/_model_\d+$/, '');

const normalizeModelId = (modelId: string): string => modelId.trim().toLowerCase();

const getConfiguredModels = (provider: AIProvider): string[] =>
  (Array.isArray(provider.model) ? provider.model : [provider.model])
    .map((model) => model.trim())
    .filter(Boolean);

export const getRuntimeProviderId = (provider: AIProvider): string => {
  const baseName = getBaseProviderName(provider.name);
  return RUNTIME_PROVIDER_IDS[baseName] ?? baseName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
};

export const supportsModelOverride = (provider: AIProvider, modelId: string): boolean => {
  const normalizedModelId = normalizeModelId(modelId);
  if (!normalizedModelId) return false;

  const providerId = getRuntimeProviderId(provider);
  if (getConfiguredModels(provider).some((model) => normalizeModelId(model) === normalizedModelId)) {
    return true;
  }

  const catalogProvider = AI_PROVIDER_CATALOG.find((item) => item.id === providerId);
  if (catalogProvider) {
    return catalogProvider.models.some((model) => normalizeModelId(model.value) === normalizedModelId);
  }

  return false;
};

export const filterProvidersForModelOverride = (
  providers: AIProvider[],
  modelOverride: string | undefined,
): AIProvider[] => {
  const normalizedModelId = modelOverride?.trim();
  if (!normalizedModelId) return providers;

  const compatibleProviders = providers.filter((provider) => supportsModelOverride(provider, normalizedModelId));
  return compatibleProviders.length > 0 ? compatibleProviders : providers;
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
