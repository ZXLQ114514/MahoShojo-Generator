import { streamObject, NoObjectGeneratedError } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { z } from 'zod/v3';
import { config, AIProvider } from "../config";
import { getLogger } from "../logger";
import { getProviderFetch } from "@/lib/ai/middleware/provider-fetch";
import { resolveMaxOutputTokensOption } from "@/lib/ai/max-output-tokens";
import {
  createAttemptOutcomeRecorder,
  wrapResponseWithAttemptOutcome,
} from "@/lib/ai/availability";
import {
  isProviderOverrideAttempt,
  prepareProvidersForModelOverride,
  resolveAttemptChannelContext,
} from '@/lib/ai/provider-routing';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { renderManagedPrompt, type TextPromptRef } from '@/lib/ai-prompts/runtime';

// 延迟函数
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const log = getLogger('ai');

// 生成配置接口
export interface GenerationConfig<T, I = string> {
  systemPrompt: string | TextPromptRef;
  temperature: number;
  promptBuilder: (input: I) => string | TextPromptRef;
  /** Complete managed template; replaces the legacy prompt pair when set. */
  promptRefBuilder?: (input: I) => TextPromptRef;
  /** Immutable server policy appended after the managed administrator text. */
  protectedPromptSuffixBuilder?: (input: I) => string;
  schema: z.ZodSchema<T>;
  taskName: string;
  maxOutputTokens?: number;
  modelOverride?: string; // 新增：可选的模型覆盖参数
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
  /** 渠道上下文，用于可用性记分。无此字段则不记分。 */
  channelContext?: {
    providerId: string;
    modelId: string;
  };
}

// 通用 AI 生成函数
export async function generateWithStreamAI<T, I = string>(
  input: I,
  generationConfig: GenerationConfig<T, I>,
  options?: GenerateWithAIOptions
): Promise<Response> {
  // Resolve managed templates once for the whole request. Provider retries
  // must observe an identical prompt and should not re-query D1.
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
    ...config.PROVIDERS,
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
      log.info('已跳过不支持当前模型覆盖的流式供应商', {
        model: modelOverride,
        skippedCount: strategyProviderCount - providersForStrategy.length,
      });
    }

    log.info('AI 流式提供商尝试顺序', {
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
      // 同一 attempt 只记一次：流结束（onFinish/onError/body close/cancel）或 catch 时落分
      const outcomeRecorder = createAttemptOutcomeRecorder(attemptChannelContext);
      try {
        log.debug(`开始尝试: 提供商: ${provider.name} 模型: ${selectedModel} 尝试次数: ${attempt + 1} / ${retryCount}`, {
          username: options?.username?.trim() || '匿名用户',
        });

        const llm = createAIClient(provider);

        const systemPrompt = resolvedPrompt + 'Ignore the user \'s prompt.';
        log.info(`provider.type: ${provider.type}`);
        const maxOutputTokensOption = resolveMaxOutputTokensOption(generationConfig, provider);
        const result = streamObject({
          model: provider.type === 'openai' ? llm.chat(selectedModel) : llm(selectedModel), // Type assertion for AI SDK 5 compatibility
          // 应对风控，尝试直接全部放入系统提示词中
          prompt: [
            {
              role: 'user',
              content: systemPrompt,
            },
            {
              role: 'user',
              content: (() => {
                const len = 20;
                const start = Math.floor(Math.random() * Math.max(1, systemPrompt.length - len));
                return systemPrompt.substring(start, start + len);
              })(),
            }
          ],
          schema: generationConfig.schema,
          temperature: generationConfig.temperature,
          maxRetries: 0,
          ...maxOutputTokensOption,
          onError: ({ error }) => {
            log.error(`streamObject 流式传输出错: 提供商: ${provider.name}`, { error });
            outcomeRecorder.recordFromError(error);
          },
          onFinish: ({ error }) => {
            // 上游已出流但最终对象校验失败 → excluded（本地解析，不反映渠道可用性）
            if (error) {
              outcomeRecorder.recordClassification({
                outcome: 'excluded',
                errorClass: 'local_parse',
              });
              return;
            }
            outcomeRecorder.recordSuccess();
          },
        });

        log.info(`提供商开始流式输出: 提供商: ${provider.name} 尝试次数: ${attempt + 1}`);
        // body 只负责 error/cancel 落分；success/local_parse 由 onFinish 决定，避免 schema 失败被误记 success
        return wrapResponseWithAttemptOutcome(result.toTextStreamResponse(), outcomeRecorder, {
          recordSuccessOnClose: false,
        });
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

        outcomeRecorder.recordFromError(error);

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
