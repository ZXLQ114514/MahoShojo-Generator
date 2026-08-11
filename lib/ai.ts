import { generateObject, generateText, NoObjectGeneratedError } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { z } from 'zod/v3';
import { config, AIProvider } from "./config";
import { getLogger } from "./logger";
import { getProviderFetch } from "@/lib/ai/middleware/provider-fetch";
import { resolveGenerationSettings } from "@/lib/ai/generation-settings/resolve";
import type { GenerationSettingsContext, UserGenerationOverrides } from "@/lib/ai/generation-settings/types";
import { enhanceErrorWithUpstreamMessage } from "@/lib/ai/utils/error-extraction";
import { buildStructuredJsonInstructionFromZodSchema, parseStructuredJsonWithSchema } from "@/lib/ai/utils/structured-json";
import { classifySuccess, classifyOutcome, recordAiChannelOutcome } from "@/lib/ai/availability";
import { buildReasoningSummary } from "@/lib/ai/reasoning-normalizer";
import {
  isProviderOverrideAttempt,
  prepareProvidersForModelOverride,
  resolveAttemptChannelContext,
} from '@/lib/ai/provider-routing';
import type { AIReasoningEnvelope } from "@/types/ai-reasoning";
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { renderManagedPrompt, type TextPromptRef } from '@/lib/ai-prompts/runtime';

// 延迟函数
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const log = getLogger('ai');

// 生成配置接口
export interface GenerationConfig<T, I = string> {
  /** 固定提示词可以直接传文本，也可以引用管理员可编辑的目录项。 */
  systemPrompt: string | TextPromptRef;
  temperature?: number;
  promptBuilder: (input: I) => string | TextPromptRef;
  /** 可选的完整托管模板；存在时替代旧的 systemPrompt + promptBuilder。 */
  promptRefBuilder?: (input: I) => TextPromptRef;
  /** 服务端不可编辑的保护后缀，始终放在管理员托管模板之后。 */
  protectedPromptSuffixBuilder?: (input: I) => string;
  schema: z.ZodSchema<T>;
  taskName: string;
  maxOutputTokens?: number;
  modelOverride?: string; // 新增：可选的模型覆盖参数
  generationOverrides?: UserGenerationOverrides;
  /** 生成设置上下文：system/custom 通道统一传递 providerId 与用户覆盖。 */
  generationSettingsContext?: GenerationSettingsContext;
}

const createAIClient = (provider: AIProvider) => {
  if (provider.type === 'google') {
    return createGoogleGenerativeAI({
      apiKey: provider.apiKey,
      baseURL: provider.baseUrl,
    });
  } else if (provider.type === 'deepseek') {
    return createDeepSeek({
      apiKey: provider.apiKey,
      baseURL: provider.baseUrl,
    });
  }
  else {
    return createOpenAI({
      apiKey: provider.apiKey,
      baseURL: provider.baseUrl,
      fetch: getProviderFetch(provider)
    });
  }
};

const getErrorText = (error: unknown): string => {
  if (!error) return '';
  if (error instanceof Error) return error.message || '';
  try {
    return String(error);
  } catch {
    return '';
  }
};

const isJsonModeNotSupportedError = (error: unknown): boolean => {
  const msg = getErrorText(error);
  const lowered = msg.toLowerCase();

  // Google/Gemma: JSON mode is not enabled for models/xxx
  if (lowered.includes('json mode is not enabled')) return true;

  // OpenAI-compatible providers / OpenRouter: response_format not supported
  if (
    lowered.includes('response_format') &&
    (lowered.includes('not') || lowered.includes('unsupported') || lowered.includes('unknown') || lowered.includes('invalid'))
  )
    return true;

  // OpenAI-compatible providers: json_schema / response_format json_schema not supported
  if (lowered.includes('json_schema') && (lowered.includes('not') || lowered.includes('unsupported'))) return true;

  // 通用：明确声明“不支持 JSON/JSON schema/structured output”
  if (lowered.includes('does not support') && (lowered.includes('json') || lowered.includes('schema'))) return true;
  if (lowered.includes('not supported') && (lowered.includes('json') || lowered.includes('schema'))) return true;
  if (lowered.includes('unsupported') && (lowered.includes('json') || lowered.includes('schema') || lowered.includes('structured'))) return true;

  return false;
};

const shouldForceTextJsonFallback = (modelId: string): boolean => {
  const normalized = typeof modelId === 'string' ? modelId.toLowerCase() : '';

  // Gemma 系列（尤其是通过 Google Generative Language API）普遍不支持 JSON mode，
  // 但仍可通过纯文本输出 JSON + 本地解析/修复 的方式完成结构化任务。
  if (normalized.includes('gemma')) return true;

  // GLM 系列目前也倾向于不支持 JSON mode（如 glm-4.x / glm-5.x / ZhipuAI/GLM-*.x / chatglm），
  // 统一走“文本 JSON + 本地解析/修复”以避免硬错误与重复请求。
  if (normalized.includes('glm')) return true;

  return false;
};

const MAX_NON_STREAM_REASONING_CHARS = 12_000;

const normalizeReasoningText = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();
};

const clampReasoningText = (
  text: string,
  maxChars = MAX_NON_STREAM_REASONING_CHARS
): { text: string; truncated: boolean } => {
  if (!text) return { text: '', truncated: false };
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
};

const readReasoningTokensFromUsage = (usage: unknown): number | null => {
  if (!usage || typeof usage !== 'object') return null;

  const readNumber = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : null;

  const readPath = (obj: unknown, path: string): number | null => {
    let current: any = obj;
    for (const key of path.split('.')) {
      if (!current || typeof current !== 'object') return null;
      current = current[key];
    }
    return readNumber(current);
  };

  const usageRecord = usage as Record<string, unknown>;
  const root =
    (usageRecord.usage && typeof usageRecord.usage === 'object'
      ? (usageRecord.usage as Record<string, unknown>)
      : null) ??
    (usageRecord.tokenUsage && typeof usageRecord.tokenUsage === 'object'
      ? (usageRecord.tokenUsage as Record<string, unknown>)
      : null) ??
    usageRecord;

  const candidatePaths = [
    'reasoningTokens',
    'reasoning_tokens',
    'outputTokensDetails.reasoningTokens',
    'output_tokens_details.reasoning_tokens',
    'completionTokensDetails.reasoningTokens',
    'completion_tokens_details.reasoning_tokens',
  ];

  for (const path of candidatePaths) {
    const value = readPath(root, path);
    if (value !== null) return value;
  }

  return null;
};

const buildNonStreamReasoningEnvelope = (
  rawReasoningText: unknown,
  usage: unknown
): AIReasoningEnvelope | null => {
  const normalizedText = normalizeReasoningText(rawReasoningText);
  const { text: reasoningText, truncated } = clampReasoningText(normalizedText);
  const reasoningTokens = readReasoningTokensFromUsage(usage);

  if (!reasoningText) {
    if (reasoningTokens === null) return null;
    return {
      status: 'unavailable',
      source: 'sdk',
      summary: null,
      text: null,
      reasoningTokens,
    };
  }

  const summary = buildReasoningSummary(reasoningText);
  return {
    status: 'done',
    source: 'sdk',
    summary,
    text: reasoningText,
    reasoningTokens,
    ...(truncated ? { anomalyFlags: ['truncated'] } : {}),
  };
};

/**
 * 随机打乱数组的函数 (Fisher-Yates shuffle)
 */
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * 根据权重随机选择元素
 */
function weightedRandomSelect<T extends { weight?: number }>(items: T[]): T[] {
  if (items.length === 0) return [];

  // 如果没有权重，返回随机打乱的数组
  if (!items.some(item => item.weight)) {
    return shuffleArray(items);
  }

  const sorted = [...items].sort((a, b) => {
    const weightA = a.weight || 1;
    const weightB = b.weight || 1;
    // 添加随机因子，权重高的更容易被选中，但不是绝对的
    return (weightB + Math.random() * 0.5) - (weightA + Math.random() * 0.5);
  });

  return sorted;
}

/**
 * 从模型数组中随机选择一个模型
 */
function selectRandomModel(models: string | string[]): string {
  if (typeof models === 'string') {
    return models;
  }
  if (Array.isArray(models) && models.length > 0) {
    return models[Math.floor(Math.random() * models.length)];
  }
  throw new Error('无效的模型配置');
}

/**
 * 负载均衡策略枚举
 */
export enum LoadBalanceStrategy {
  SEQUENTIAL = 'sequential',  // 顺序执行（原有逻辑）
  RANDOM = 'random',         // 随机选择
  ROUND_ROBIN = 'round_robin', // 轮询（暂时不实现）
  CUSTOM = 'custom'        // 自定义（使用用户自定义模型，不进行轮询）
}

// 全局轮询计数器（用于轮询策略）
let roundRobinCounter = 0;

export interface GenerateWithAIOptions {
  /** 用于服务端日志，不接受或记录 API Key、邮箱等凭据。 */
  username?: string | null;
  loadBalanceStrategy?: LoadBalanceStrategy;
  providerOverride?: AIProvider;
  telemetry?: {
    providerName?: string;
    providerType?: AIProvider['type'];
    providerBaseUrl?: string;
    model?: string;
    providerIndex?: number;
    attempt?: number;
    usage?: unknown;
    finishReason?: unknown;
    reasoning?: AIReasoningEnvelope | null;
  };
  /** 渠道上下文，用于可用性记分。无此字段则不记分。 */
  channelContext?: {
    providerId: string;
    modelId: string;
  };
  /** 生成设置上下文：system/custom 通道统一传递 providerId 与用户覆盖。 */
  generationSettingsContext?: GenerationSettingsContext;
}

// 通用 AI 生成函数
export async function generateWithAI<T, I = string>(
  input: I,
  generationConfig: GenerationConfig<T, I>,
  options?: GenerateWithAIOptions
): Promise<T> {
  // Resolve managed templates once per request, before entering provider/retry
  // loops. This keeps a retry on the same request consistent and avoids a D1
  // read for every provider attempt.
  const promptDb = getDrizzleDbFromRuntime();
  const resolvePromptValue = async (value: string | TextPromptRef): Promise<string> => {
    if (typeof value === 'string') return value;
    return renderManagedPrompt(promptDb, value);
  };
  const managedPromptRef = generationConfig.promptRefBuilder?.(input);
  const managedOrLegacyPrompt = managedPromptRef
    ? await renderManagedPrompt(promptDb, managedPromptRef)
    : [
        await resolvePromptValue(generationConfig.systemPrompt),
        await resolvePromptValue(generationConfig.promptBuilder(input)),
      ]
        .filter((part) => part.trim().length > 0)
        .join('\n\n');
  const protectedSuffix = generationConfig.protectedPromptSuffixBuilder?.(input)?.trim() ?? '';
  const resolvedPrompt = [managedOrLegacyPrompt, protectedSuffix]
    .filter((part) => part.trim().length > 0)
    .join('\n\n');
  const baseProviders: AIProvider[] = [
    ...(options?.providerOverride ? [options.providerOverride] : []),
    ...config.PROVIDERS.map((provider) => ({
      ...provider,
      // config.PROVIDERS 属于系统通道；显式标记后才能命中 system::<model> 能力登记。
      providerId: provider.providerId ?? 'system',
    })),
  ];

  if (baseProviders.length === 0) {
    log.error("没有配置 API Key");
    throw new Error("没有配置 API Key");
  }

  if (options?.providerOverride) {
    log.info(`优先使用用户自定义提供商: ${options.providerOverride.name}`);
  }

  // 如果没有指定策略，从配置中读取
  const strategy = options?.loadBalanceStrategy || (config.LOAD_BALANCE_STRATEGY as LoadBalanceStrategy) || LoadBalanceStrategy.RANDOM;
  // 显式用户供应商使用用户自己的凭据；即使调用方没有传 CUSTOM，
  // 也不能在失败后回退到服务端供应商。
  const restrictToFirstProvider = strategy === LoadBalanceStrategy.CUSTOM || Boolean(options?.providerOverride);
  const strategyProviderCount = restrictToFirstProvider ? 1 : baseProviders.length;
  const modelOverride = generationConfig.modelOverride?.trim() || undefined;
  const providersForStrategy = prepareProvidersForModelOverride(baseProviders, modelOverride, {
    restrictToFirstProvider,
  });

  if (providersForStrategy.length === 0) {
    log.error('没有可用的 AI 模型配置');
    throw new Error('没有可用的 AI 模型配置');
  }

  // 如果有模型覆盖，记录日志
  if (modelOverride) {
    log.info(`使用模型覆盖: ${modelOverride}`);
  }

  let lastError: unknown = null;
  let providersToTry: AIProvider[] = [];

  // 根据负载均衡策略决定提供商顺序
  switch (strategy) {
    case LoadBalanceStrategy.RANDOM:
      // 使用权重随机选择
      providersToTry = weightedRandomSelect(providersForStrategy);
      log.debug('使用加权随机策略', {
        order: providersToTry.map(p => `${p.name}(${typeof p.model === 'string' ? p.model : 'multi'})`)
      });
      break;

    case LoadBalanceStrategy.ROUND_ROBIN:
      // 轮询选择提供商
      const startIndex = roundRobinCounter % providersForStrategy.length;
      providersToTry = [
        ...providersForStrategy.slice(startIndex),
        ...providersForStrategy.slice(0, startIndex)
      ];
      roundRobinCounter++;
      log.debug('使用轮询策略', {
        startIndex: startIndex + 1,
        order: providersToTry.map(p => `${p.name}(${typeof p.model === 'string' ? p.model : 'multi'})`)
      });
      break;
    case LoadBalanceStrategy.CUSTOM:
      // 自定义策略：优先使用用户自定义模型，不进行轮询
      providersToTry = [providersForStrategy[0]];
      log.debug('使用自定义策略', {
        order: providersToTry.map(p => `${p.name}(${typeof p.model === 'string' ? p.model : 'multi'})`)
      });
      break;
    case LoadBalanceStrategy.SEQUENTIAL:
    default:
      // 顺序执行（原有逻辑）
      providersToTry = [...providersForStrategy];
      log.debug('使用顺序策略', {
        order: providersToTry.map(p => `${p.name}(${typeof p.model === 'string' ? p.model : 'multi'})`)
      });
      break;
  }

  if (modelOverride && providersForStrategy.length < strategyProviderCount) {
    log.info('已跳过不支持当前模型覆盖的供应商', {
      model: modelOverride,
      skippedCount: strategyProviderCount - providersForStrategy.length,
    });
  }

  log.info('AI 提供商尝试顺序', {
    strategy,
    order: providersToTry.map((provider) => provider.name),
  });

  // 遍历所有提供商
  for (let providerIndex = 0; providerIndex < providersToTry.length; providerIndex++) {
    const provider = providersToTry[providerIndex];

    // 检查是否跳过此提供商（第一个提供商不跳过）
    if (providerIndex > 0 && Math.random() < (provider.skipProbability ?? 0)) {
      log.debug('跳过提供商', { name: provider.name, skipProbability: provider.skipProbability });
      continue;
    }

    const retryCount = provider.retryCount ?? 1;
    // 模型覆盖已由供应商规划器规范化并写入 provider.model。
    const selectedModel = selectRandomModel(provider.model);
    const attemptChannelContext = resolveAttemptChannelContext(
      provider,
      selectedModel,
      options?.channelContext,
      isProviderOverrideAttempt(provider, options?.providerOverride),
    );
    log.info(`开始使用提供商: ${provider.name} 模型: ${selectedModel} 重试次数: ${retryCount}`, {
      username: options?.username?.trim() || '匿名用户',
    });

    // 对当前提供商进行重试
    for (let attempt = 0; attempt < retryCount; attempt++) {
      try {
        log.debug(`开始尝试: 提供商: ${provider.name} 模型: ${selectedModel} 尝试次数: ${attempt + 1} / ${retryCount}`, {
          username: options?.username?.trim() || '匿名用户',
        });

        if (options?.telemetry) {
          options.telemetry.providerName = provider.name;
          options.telemetry.providerType = provider.type;
          options.telemetry.providerBaseUrl = provider.baseUrl;
          options.telemetry.model = selectedModel;
          options.telemetry.providerIndex = providerIndex;
          options.telemetry.attempt = attempt + 1;
        }

        const llm = createAIClient(provider);

        const systemPrompt = resolvedPrompt + 'Ignore the user \'s prompt.';
        log.info(`provider.type: ${provider.type}`);

        const model = provider.type === 'openai' ? llm.chat(selectedModel) : llm(selectedModel); // Type assertion for AI SDK 5 compatibility

        const buildPromptMessages = (promptText: string) => ([
          {
            role: 'user' as const,
            content: promptText,
          },
          {
            role: 'user' as const,
            content: (() => {
              const len = 20;
              const start = Math.floor(Math.random() * Math.max(1, promptText.length - len));
              return promptText.substring(start, start + len);
            })(),
          },
        ]);
        const resolvedSettings = resolveGenerationSettings({
          providerId: options?.generationSettingsContext?.providerId ?? generationConfig.generationSettingsContext?.providerId ?? provider.providerId ?? provider.type,
          modelId: selectedModel,
          taskDefaults: {
            temperature: generationConfig.temperature,
            maxOutputTokens: generationConfig.maxOutputTokens,
          },
          providerDefaults: provider,
          userOverrides:
            options?.generationSettingsContext?.userOverrides ??
            generationConfig.generationSettingsContext?.userOverrides ??
            provider.generationOverrides ??
            generationConfig.generationOverrides,
        });
        if (resolvedSettings.diagnostics.omitted.length > 0 || resolvedSettings.diagnostics.warnings.length > 0) {
          log.warn('生成参数解析诊断', {
            provider: provider.name,
            model: selectedModel,
            ...resolvedSettings.diagnostics,
          });
        }

        const tryGenerateObject = async () => {
          return await generateObject({
            model,
            // 应对风控，尝试直接全部放入系统提示词中
            prompt: buildPromptMessages(systemPrompt),
            schema: generationConfig.schema,
            maxRetries: 0,
            ...resolvedSettings.standardOptions,
            ...(resolvedSettings.providerOptions ? { providerOptions: resolvedSettings.providerOptions } : {}),
          });
        };

        const runTextJsonFallback = async (label: string): Promise<T> => {
          const guidedPrompt =
            `${systemPrompt}\n\n` +
            buildStructuredJsonInstructionFromZodSchema(generationConfig.schema);

          const textResult = await generateText({
            model,
            prompt: buildPromptMessages(guidedPrompt),
            maxRetries: 0,
            ...resolvedSettings.standardOptions,
            ...(resolvedSettings.providerOptions ? { providerOptions: resolvedSettings.providerOptions } : {}),
          });

          const parsed = parseStructuredJsonWithSchema(textResult.text, generationConfig.schema, {
            taskName: generationConfig.taskName,
          });

          log.info(`兼容回退解析成功（${label}）`, {
            provider: provider.name,
            model: selectedModel,
            usedJsonRepair: parsed.telemetry.usedJsonRepair,
            unwrap: parsed.telemetry.unwrapAttempt,
          });

          if (options?.telemetry) {
            options.telemetry.usage = textResult.usage;
            options.telemetry.finishReason = textResult.finishReason;
            options.telemetry.reasoning = buildNonStreamReasoningEnvelope(textResult.reasoningText, textResult.usage);
          }

          return parsed.data as T;
        };

        // 0) 预判：某些模型（如 Gemma / GLM）不支持 JSON mode，直接走“文本 JSON + 本地解析”避免硬错误与二次请求
        if (shouldForceTextJsonFallback(selectedModel)) {
          log.warn('检测到模型可能不支持 JSON mode，直接启用兼容回退（文本生成 JSON + 本地解析）', {
            provider: provider.name,
            model: selectedModel,
          });
          return await runTextJsonFallback('预判直达');
        }

        let object: unknown;
        let usage: unknown;
        let finishReason: unknown;
        let reasoning: AIReasoningEnvelope | null = null;

        try {
          const result = await tryGenerateObject();
          object = result.object;
          usage = result.usage;
          finishReason = result.finishReason;
          reasoning = buildNonStreamReasoningEnvelope((result as { reasoning?: unknown }).reasoning, result.usage);
        } catch (rawError) {
          // 1) Schema/JSON 生成失败：尝试直接从 error.text 做解析/修复（无需额外调用模型）
          if (NoObjectGeneratedError.isInstance(rawError) && typeof rawError.text === 'string') {
            try {
              const repaired = parseStructuredJsonWithSchema(rawError.text, generationConfig.schema, {
                taskName: generationConfig.taskName,
              });
              log.warn('generateObject 失败，但已通过本地 JSON 修复+Schema 校验恢复结果', {
                provider: provider.name,
                model: selectedModel,
                usedJsonRepair: repaired.telemetry.usedJsonRepair,
                unwrap: repaired.telemetry.unwrapAttempt,
              });

              if (options?.telemetry) {
                options.telemetry.usage = rawError.usage;
                options.telemetry.finishReason = rawError.finishReason;
                options.telemetry.reasoning = buildNonStreamReasoningEnvelope(undefined, rawError.usage);
              }

              return repaired.data as T;
            } catch {
              // 本地修复失败时，再尝试一次“文本 JSON 回退重试”
              try {
                return await runTextJsonFallback('NoObjectGeneratedError 分支');
              } catch {
                // ignore，继续走后续回退策略
              }
            }
          }

          const enhancedError = enhanceErrorWithUpstreamMessage(rawError);

          // 2) 上游不支持 JSON 模式：退化为“纯文本生成 JSON + 本地解析/修复”
          if (isJsonModeNotSupportedError(enhancedError)) {
            log.warn('检测到上游不支持 JSON 模式，启用兼容回退（文本生成 JSON + 本地解析）', {
              provider: provider.name,
              model: selectedModel,
              error: enhancedError.message,
            });
            return await runTextJsonFallback('JSON 模式不支持分支');
          }

          // 3) 部分供应商在 JSON schema / response_format 路径会直接报 APICallError（甚至是 5xx），
          //    此时再尝试走“文本 JSON + 本地解析”作为兜底，有机会恢复成功。
          const maybeApiCallError = rawError as any;
          const apiCallStatusCode = typeof maybeApiCallError?.statusCode === 'number' ? maybeApiCallError.statusCode : null;
          const shouldTryTextFallback =
            maybeApiCallError?.name === 'AI_APICallError' && apiCallStatusCode !== 401 && apiCallStatusCode !== 403 && apiCallStatusCode !== 429;

          if (shouldTryTextFallback) {
            log.warn('generateObject 触发 APICallError，尝试兼容回退（文本生成 JSON + 本地解析）', {
              provider: provider.name,
              model: selectedModel,
              statusCode: apiCallStatusCode,
              error: enhancedError.message,
            });

            try {
              return await runTextJsonFallback('APICallError 分支');
            } catch {
              // ignore，继续抛出增强后的错误
            }
          }

          throw enhancedError;
        }

        log.info(`提供商生成成功: 提供商: ${provider.name} 尝试次数: ${attempt + 1}`, {
          username: options?.username?.trim() || '匿名用户',
        });
        if (attemptChannelContext) {
          const ctx = attemptChannelContext;
          void recordAiChannelOutcome({ providerId: ctx.providerId, modelId: ctx.modelId, ...classifySuccess() });
        }
        if (options?.telemetry) {
          options.telemetry.usage = usage;
          options.telemetry.finishReason = finishReason;
          options.telemetry.reasoning = reasoning;
        }
        return object as T;
      } catch (error) {
        lastError = error;
        log.error(`提供商 ${provider.name} 第 ${attempt + 1} 次失败`, {
          username: options?.username?.trim() || '匿名用户',
          error,
        });

        if (NoObjectGeneratedError.isInstance(error)) {
          log.debug(`NoObjectGeneratedError 详情: 提供商: ${provider.name}`, {
            cause: error.cause,
            text: error.text,
            response: error.response,
            usage: error.usage,
            finishReason: error.finishReason
          });
        }

        // 记录本次 attempt 的失败 outcome
        if (attemptChannelContext) {
          const ctx = attemptChannelContext;
          const outcome = classifyOutcome(ctx.isSystemChannel === true, error);
          void recordAiChannelOutcome({ providerId: ctx.providerId, modelId: ctx.modelId, ...outcome });
        }

        // 如果不是最后一次尝试，等待后再重试
        if (attempt < retryCount - 1) {
          const waitTime = (attempt + 1) * 200; // 递增等待时间
          log.debug(`等待后重试: ${waitTime}ms`);
          await sleep(waitTime);
        }
      }
    }

    log.warn(`提供商所有尝试都失败了: ${provider.name}`);
  }

  log.error(`所有提供商都失败了: ${lastError}`);
  throw new Error(`${generationConfig.taskName}失败: ${lastError}`);
}
