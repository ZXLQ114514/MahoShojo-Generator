import {
  buildStreamTextAbortOptions,
  classifyStreamRuntimeOutcome,
  createNodeRawStreamAiRuntime,
  LoadBalanceStrategy,
  type GenerateWithAIOptions,
  type RawGenerationConfig,
  type RawReasoningStreamEvent,
  type ManagedPromptRef,
} from '@mahoshojo/hosted-runtime/node-runtime';

import { recordAiChannelOutcome } from '@/lib/ai/availability';
import { config } from '@/lib/config';
import { getLogger } from '@/lib/logger';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { renderManagedPrompt } from '@/lib/ai-prompts/runtime';

const runtime = createNodeRawStreamAiRuntime({
  providers: config.PROVIDERS,
  loadBalanceStrategy: config.LOAD_BALANCE_STRATEGY,
  logger: getLogger('ai'),
  recordAiChannelOutcome,
  managedPromptResolver: (ref: ManagedPromptRef) => renderManagedPrompt(getDrizzleDbFromRuntime(), ref),
});

export const generateWithStreamAI = runtime.generateWithStreamAI;
export {
  buildStreamTextAbortOptions,
  classifyStreamRuntimeOutcome,
  LoadBalanceStrategy,
};
export type {
  GenerateWithAIOptions,
  RawGenerationConfig,
  RawReasoningStreamEvent,
};
