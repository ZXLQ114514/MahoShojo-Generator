import {
  createNodeStructuredAiRuntime,
  LoadBalanceStrategy,
  type GenerationConfig,
  type GenerateWithAIOptions,
  type ManagedPromptRef,
} from '@mahoshojo/hosted-runtime/node-runtime';

import { recordAiChannelOutcome } from '@/lib/ai/availability';
import { config } from '@/lib/config';
import { getLogger } from '@/lib/logger';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { renderManagedPrompt } from '@/lib/ai-prompts/runtime';

const runtime = createNodeStructuredAiRuntime({
  providers: config.PROVIDERS,
  loadBalanceStrategy: config.LOAD_BALANCE_STRATEGY,
  logger: getLogger('ai'),
  recordAiChannelOutcome,
  managedPromptResolver: (ref: ManagedPromptRef) => renderManagedPrompt(getDrizzleDbFromRuntime(), ref),
});

export const generateWithAI = runtime.generateWithAI;
export { LoadBalanceStrategy };
export type { GenerationConfig, GenerateWithAIOptions };
