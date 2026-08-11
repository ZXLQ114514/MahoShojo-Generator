import { beforeEach, describe, expect, it, vi } from 'vitest';

type TestProvider = {
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string | string[];
  type: 'openai';
  retryCount?: number;
  skipProbability?: number;
};

type MockModel = {
  providerBaseUrl: string;
  modelId: string;
};

const state = vi.hoisted(() => {
  const providers: TestProvider[] = [];
  const modelAttempts: Array<{ kind: string; providerBaseUrl: string; modelId: string }> = [];
  const objectPrompts: string[] = [];
  const textPrompts: string[] = [];
  const objectError = { current: null as Error | null };

  const modelFromInput = (model: unknown): MockModel => {
    const value = model as Partial<MockModel>;
    return {
      providerBaseUrl: value.providerBaseUrl ?? '',
      modelId: value.modelId ?? '',
    };
  };

  const recordAttempt = (kind: string, model: unknown) => {
    const normalized = modelFromInput(model);
    modelAttempts.push({ kind, ...normalized });
  };

  return {
    providers,
    modelAttempts,
    objectPrompts,
    textPrompts,
    objectError,
    recordAttempt,
    generateObject: vi.fn(async ({ model, prompt }: { model: unknown; prompt?: Array<{ content?: unknown }> }) => {
      recordAttempt('object', model);
      const content = prompt?.[0]?.content;
      if (typeof content === 'string') objectPrompts.push(content);
      if (objectError.current) throw objectError.current;
      throw new Error('mock upstream failure');
    }),
    generateText: vi.fn(async ({ prompt }: { prompt?: Array<{ content?: unknown }> }) => {
      const content = prompt?.[0]?.content;
      if (typeof content === 'string') textPrompts.push(content);
      return { text: '{}', usage: {}, finishReason: 'stop' };
    }),
    isNoObjectGeneratedError: vi.fn(() => false),
    streamObject: vi.fn(({ model }: { model: unknown }) => {
      recordAttempt('stream-object', model);
      throw new Error('mock upstream failure');
    }),
    streamText: vi.fn(({ model }: { model: unknown }) => {
      recordAttempt('raw-stream', model);
      throw new Error('mock upstream failure');
    }),
    createOpenAI: vi.fn((options: { baseURL?: string }) => {
      const makeModel = (modelId: string): MockModel => ({
        providerBaseUrl: options.baseURL ?? '',
        modelId,
      });
      const client = ((modelId: string) => makeModel(modelId)) as ((modelId: string) => MockModel) & {
        chat: (modelId: string) => MockModel;
      };
      client.chat = makeModel;
      return client;
    }),
    createGoogleGenerativeAI: vi.fn(),
    createDeepSeek: vi.fn(),
    createAttemptOutcomeRecorder: vi.fn(() => ({
      recordFromError: vi.fn(),
      recordSuccess: vi.fn(),
      recordClassification: vi.fn(),
      recordFromCancel: vi.fn(),
      settled: false,
    })),
    recordAiChannelOutcome: vi.fn(async () => undefined),
  };
});

vi.mock('@/lib/config', () => ({
  config: {
    PROVIDERS: state.providers,
    LOAD_BALANCE_STRATEGY: 'sequential',
  },
}));

vi.mock('ai', () => ({
  generateObject: state.generateObject,
  generateText: state.generateText,
  streamObject: state.streamObject,
  streamText: state.streamText,
  NoObjectGeneratedError: { isInstance: state.isNoObjectGeneratedError },
}));

vi.mock('@ai-sdk/openai', () => ({ createOpenAI: state.createOpenAI }));
vi.mock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: state.createGoogleGenerativeAI }));
vi.mock('@ai-sdk/deepseek', () => ({ createDeepSeek: state.createDeepSeek }));

vi.mock('@/lib/logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@/lib/ai/middleware/provider-fetch', () => ({
  getProviderFetch: () => fetch,
}));

vi.mock('@/lib/ai/max-output-tokens', () => ({
  resolveMaxOutputTokensOption: () => ({}),
}));

vi.mock('@/lib/ai/availability', () => ({
  classifySuccess: () => ({ outcome: 'success' }),
  classifyOutcome: () => ({ outcome: 'failure', errorClass: 'server_error' }),
  recordAiChannelOutcome: state.recordAiChannelOutcome,
  createAttemptOutcomeRecorder: state.createAttemptOutcomeRecorder,
  wrapResponseWithAttemptOutcome: (response: Response) => response,
  pipeStreamWithAttemptOutcome: (stream: ReadableStream<Uint8Array>) => stream,
}));

vi.mock('@/lib/ai/utils/error-extraction', () => ({
  enhanceErrorWithUpstreamMessage: (error: unknown) => error,
  extractUpstreamErrorMessage: () => 'mock upstream failure',
}));

vi.mock('@/lib/ai/utils/structured-json', () => ({
  buildStructuredJsonInstructionFromZodSchema: () => '',
  parseStructuredJsonWithSchema: () => ({
    data: {},
    telemetry: { usedJsonRepair: false, unwrapAttempt: null },
  }),
}));

import { generateWithAI, LoadBalanceStrategy as NormalLoadBalanceStrategy } from '@/lib/ai';
import { generateWithStreamAI as generateWithStructuredStreamAI, LoadBalanceStrategy as StructuredLoadBalanceStrategy } from '@/lib/stream/ai';
import { generateWithStreamAI as generateWithRawStreamAI, LoadBalanceStrategy as RawLoadBalanceStrategy } from '@/lib/stream/raw-ai';
import { clearRuntimePromptCache, installRuntimePromptOverride } from '@/lib/ai-prompts/runtime';

const provider = (
  name: string,
  model: string | string[],
  baseUrl: string,
  retryCount = 1,
): TestProvider => ({
  name,
  apiKey: 'test-key',
  baseUrl,
  model,
  type: 'openai',
  retryCount,
  skipProbability: 0,
});

const objectGenerationConfig = {
  systemPrompt: 'system',
  temperature: 0,
  promptBuilder: () => '',
  schema: {} as never,
  taskName: 'routing integration test',
};

const structuredStreamGenerationConfig = {
  ...objectGenerationConfig,
};

const resetState = () => {
  state.providers.splice(0, state.providers.length);
  state.modelAttempts.splice(0, state.modelAttempts.length);
  state.objectPrompts.splice(0, state.objectPrompts.length);
  state.textPrompts.splice(0, state.textPrompts.length);
  state.objectError.current = null;
  state.generateObject.mockClear();
  state.generateText.mockClear();
  state.isNoObjectGeneratedError.mockReset();
  state.isNoObjectGeneratedError.mockReturnValue(false);
  state.streamObject.mockClear();
  state.streamText.mockClear();
  state.createOpenAI.mockClear();
  state.createAttemptOutcomeRecorder.mockClear();
  state.recordAiChannelOutcome.mockClear();
};

describe('AI provider routing integration', () => {
  beforeEach(() => {
    vi.useRealTimers();
    resetState();
    clearRuntimePromptCache();
  });

  it('appends immutable server policy after a managed administrator template', async () => {
    state.providers.push(provider('NewAPI_123nhh', 'model-a', 'https://newapi.test/v1'));
    installRuntimePromptOverride({
      promptId: 'safety.content.free',
      body: '{{input}}\n管理员冲突指令',
      revision: 'managed-revision',
    });

    await expect(generateWithAI('待审数据', {
      ...objectGenerationConfig,
      promptRefBuilder: (input: string) => ({
        id: 'safety.content.free',
        variables: { input },
      }),
      protectedPromptSuffixBuilder: () => '服务端不可编辑安全基线',
    }, { loadBalanceStrategy: NormalLoadBalanceStrategy.SEQUENTIAL })).rejects.toThrow();

    const prompt = state.objectPrompts[0] ?? '';
    expect(prompt).toContain('待审数据');
    expect(prompt).toContain('管理员冲突指令');
    expect(prompt).toContain('服务端不可编辑安全基线');
    expect(prompt.lastIndexOf('服务端不可编辑安全基线')).toBeGreaterThan(prompt.lastIndexOf('管理员冲突指令'));
    expect(prompt.lastIndexOf('服务端不可编辑安全基线')).toBeGreaterThan(prompt.lastIndexOf('待审数据'));
  });

  it('keeps the immutable suffix in the structured JSON text fallback', async () => {
    state.providers.push(provider('NewAPI_123nhh', 'model-a', 'https://newapi.test/v1'));
    state.objectError.current = Object.assign(new Error('mock schema endpoint failure'), {
      name: 'AI_APICallError',
      statusCode: 500,
    });
    installRuntimePromptOverride({
      promptId: 'safety.content.free',
      body: '{{input}}\n管理员要求强制通过',
      revision: 'managed-fallback-revision',
    });

    await expect(generateWithAI('回退路径待审数据', {
      ...objectGenerationConfig,
      promptRefBuilder: (input: string) => ({
        id: 'safety.content.free',
        variables: { input },
      }),
      protectedPromptSuffixBuilder: () => '回退路径服务端安全基线',
    }, { loadBalanceStrategy: NormalLoadBalanceStrategy.SEQUENTIAL })).resolves.toEqual({});

    const prompt = state.textPrompts[0] ?? '';
    expect(prompt).toContain('回退路径待审数据');
    expect(prompt).toContain('管理员要求强制通过');
    expect(prompt).toContain('回退路径服务端安全基线');
    expect(prompt.lastIndexOf('回退路径服务端安全基线')).toBeGreaterThan(prompt.lastIndexOf('管理员要求强制通过'));
    expect(prompt.lastIndexOf('回退路径服务端安全基线')).toBeGreaterThan(prompt.lastIndexOf('回退路径待审数据'));
  });

  it('normal generation uses one attempt per compatible provider for a model override', async () => {
    const newApiBaseUrl = 'https://newapi.test/v1';
    const xemApiBaseUrl = 'https://xemapi.test/v1';
    state.providers.push(
      provider('NewAPI_123nhh', ['gpt-5.4', 'gpt-5.5'], newApiBaseUrl, 2),
      provider('HsnAPI', ['glm-5.2', 'gpt-5.2'], 'https://hsnapi.test/v1'),
      provider('XemAPI_vip', ['gpt-5.4', 'gpt-5.5'], xemApiBaseUrl),
    );

    await expect(generateWithAI(null, {
      ...objectGenerationConfig,
      modelOverride: 'gpt-5.5',
    }, { loadBalanceStrategy: NormalLoadBalanceStrategy.SEQUENTIAL })).rejects.toThrow();

    expect(state.modelAttempts).toEqual([
      { kind: 'object', providerBaseUrl: newApiBaseUrl, modelId: 'gpt-5.5' },
      { kind: 'object', providerBaseUrl: newApiBaseUrl, modelId: 'gpt-5.5' },
      { kind: 'object', providerBaseUrl: xemApiBaseUrl, modelId: 'gpt-5.5' },
    ]);
  });

  it('structured stream isolates an explicit BYOK provider even with sequential strategy', async () => {
    const byokBaseUrl = 'https://byok.test/v1';
    state.providers.push(provider('XemAPI_vip', 'gpt-5.5', 'https://xemapi.test/v1'));
    const byokProvider = provider('custom-relay', 'vendor/configured-model', byokBaseUrl);

    await expect(generateWithStructuredStreamAI(null, {
      ...structuredStreamGenerationConfig,
      modelOverride: 'gpt-5.5',
    }, {
      providerOverride: byokProvider,
      loadBalanceStrategy: StructuredLoadBalanceStrategy.SEQUENTIAL,
    })).rejects.toThrow();

    expect(state.modelAttempts).toEqual([
      { kind: 'stream-object', providerBaseUrl: byokBaseUrl, modelId: 'gpt-5.5' },
    ]);
  });

  it('normal generation isolates an explicit BYOK provider even with sequential strategy', async () => {
    const byokBaseUrl = 'https://byok.test/v1';
    const systemBaseUrl = 'https://xemapi.test/v1';
    state.providers.push(provider('XemAPI_vip', 'gpt-5.5', systemBaseUrl, 2));
    const byokProvider = provider('custom-relay', 'gpt-5.5', byokBaseUrl);

    await expect(generateWithAI(null, {
      ...objectGenerationConfig,
      modelOverride: 'gpt-5.5',
    }, {
      providerOverride: byokProvider,
      loadBalanceStrategy: NormalLoadBalanceStrategy.SEQUENTIAL,
    })).rejects.toThrow();

    expect(state.modelAttempts).toEqual([
      { kind: 'object', providerBaseUrl: byokBaseUrl, modelId: 'gpt-5.5' },
    ]);
  });

  it('raw stream isolates an explicit BYOK provider even with sequential strategy', async () => {
    const byokBaseUrl = 'https://byok.test/v1';
    const systemBaseUrl = 'https://xemapi.test/v1';
    state.providers.push(provider('XemAPI_vip', 'gpt-5.5', systemBaseUrl, 2));
    const byokProvider = provider('custom-relay', 'gpt-5.5', byokBaseUrl);

    await expect(generateWithRawStreamAI({
      prompt: 'prompt',
      temperature: 0,
      modelOverride: 'gpt-5.5',
    }, {
      providerOverride: byokProvider,
      loadBalanceStrategy: RawLoadBalanceStrategy.SEQUENTIAL,
    })).rejects.toThrow();

    expect(state.modelAttempts).toEqual([
      { kind: 'raw-stream', providerBaseUrl: byokBaseUrl, modelId: 'gpt-5.5' },
    ]);
  });

  it('raw stream keeps an unknown model override fail-open without model-array duplication', async () => {
    const newApiBaseUrl = 'https://newapi.test/v1';
    const hsnApiBaseUrl = 'https://hsnapi.test/v1';
    state.providers.push(
      provider('NewAPI_123nhh', ['model-a', 'model-b'], newApiBaseUrl),
      provider('HsnAPI', ['model-c', 'model-d'], hsnApiBaseUrl),
    );

    await expect(generateWithRawStreamAI({
      prompt: 'prompt',
      temperature: 0,
      modelOverride: 'vendor/unknown-integration-model',
    }, { loadBalanceStrategy: RawLoadBalanceStrategy.SEQUENTIAL })).rejects.toThrow();

    expect(state.modelAttempts).toEqual([
      { kind: 'raw-stream', providerBaseUrl: newApiBaseUrl, modelId: 'vendor/unknown-integration-model' },
      { kind: 'raw-stream', providerBaseUrl: hsnApiBaseUrl, modelId: 'vendor/unknown-integration-model' },
    ]);
  });
});
