import { config, type AIProvider } from '@/lib/config';

import {
  isXemApiImageModel,
  parseXemApiImageResponse,
  type XemApiImageResult,
} from './types';

export type XemApiImageGenerationInput = {
  prompt: string;
  apiKey?: string;
  size?: '1024x1024' | '1536x1024' | '1024x1536';
  quality?: 'low' | 'medium' | 'high' | 'standard';
  style?: 'vivid' | 'natural';
  n?: number;
  responseFormat?: 'url' | 'b64_json';
};

export type XemApiImageGenerationResult = XemApiImageResult & {
  providerName: string;
  model: 'gpt-image-2';
};

const XEM_API_PROVIDER_NAMES = ['XemAPI_default', 'XemAPI_vip'] as const;
const DEFAULT_MODEL = 'gpt-image-2' as const;
const DEFAULT_SIZE = '1024x1024' as const;
const DEFAULT_QUALITY = 'standard' as const;
const DEFAULT_STYLE = 'vivid' as const;
const DEFAULT_RESPONSE_FORMAT = 'url' as const;
const MAX_PROMPT_CHARS = 50_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const resolveXemApiImageProvider = (
  providers: readonly AIProvider[] = config.PROVIDERS,
): AIProvider | null => {
  for (const name of XEM_API_PROVIDER_NAMES) {
    const provider = providers.find((item) => item.name === name && item.apiKey.trim() && item.baseUrl.trim());
    if (provider) return provider;
  }
  return null;
};

export const buildXemApiImageRequest = (input: XemApiImageGenerationInput): RequestInit => {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error('图片提示词不能为空');
  if (prompt.length > MAX_PROMPT_CHARS) throw new Error('图片提示词过长');

  const n = Math.max(1, Math.min(10, Math.floor(input.n ?? 1)));
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      prompt,
      size: input.size ?? DEFAULT_SIZE,
      quality: input.quality ?? DEFAULT_QUALITY,
      style: input.style ?? DEFAULT_STYLE,
      n,
      response_format: input.responseFormat ?? DEFAULT_RESPONSE_FORMAT,
    }),
  };
};

const readJson = async (response: Response): Promise<unknown> => {
  const raw = await response.text();
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};

const getImageGenerationUrl = (baseUrl: string): string =>
  `${baseUrl.trim().replace(/\/+$/, '')}/images/generations`;

/**
 * 服务端调用 XemAPI 的 gpt-image-2。
 * 图片生成不自动重试，避免一次用户操作产生重复计费任务。
 */
export const generateXemApiImage = async (
  input: XemApiImageGenerationInput,
  providers: readonly AIProvider[] = config.PROVIDERS,
  fetchImpl: typeof fetch = fetch,
): Promise<XemApiImageGenerationResult> => {
  const provider = resolveXemApiImageProvider(providers);
  if (!provider) throw new Error('未配置可用的 XemAPI 图片供应商');

  const request = buildXemApiImageRequest(input);
  const headers = new Headers(request.headers);
  headers.set('Authorization', `Bearer ${(input.apiKey?.trim() || provider.apiKey).trim()}`);

  const response = await fetchImpl(getImageGenerationUrl(provider.baseUrl), {
    ...request,
    headers,
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(`XemAPI 图片生成失败（HTTP ${response.status}）`);
  }

  const result = parseXemApiImageResponse(payload);
  if (result.imageUrls.length === 0 && !result.taskId) {
    throw new Error('XemAPI 返回结果中没有图片或任务 ID');
  }

  return {
    ...result,
    providerName: provider.name,
    model: DEFAULT_MODEL,
  };
};

export const isSupportedXemApiImageRequest = (value: unknown): value is XemApiImageGenerationInput => {
  if (!isRecord(value)) return false;
  const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : '';
  return prompt.length > 0 && prompt.length <= MAX_PROMPT_CHARS && isXemApiImageModel(DEFAULT_MODEL);
};
