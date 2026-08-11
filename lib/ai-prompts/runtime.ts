import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { getPromptDefinition, type TextPromptId } from './catalog';
import { getManagedPrompt, type ManagedPrompt } from './repository';
import { renderPromptTemplate, type PromptVariables } from './template';

export const AI_PROMPT_RUNTIME_TTL_MS = 30_000;

export type TextPromptRef = {
  id: TextPromptId;
  variables: Record<string, string>;
  /** Keep a legacy prompt after the managed block when it carries a parser protocol. */
  legacyMode?: 'replace' | 'append';
};

export type RuntimePromptSnapshot = {
  promptId: string;
  body: string;
  revision: string | null;
  isDefault: boolean;
  loadedAt: number;
};

type CacheEntry = RuntimePromptSnapshot & { expiresAt: number };

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<RuntimePromptSnapshot>>();
const generations = new Map<string, number>();

const normalizeId = (promptId: string): string => {
  const id = typeof promptId === 'string' ? promptId.trim() : '';
  if (!id || !getPromptDefinition(id)) throw new Error('未知的提示词 ID');
  return id;
};

const currentGeneration = (id: string): number => generations.get(id) ?? 0;
const bumpGeneration = (id: string): number => {
  const next = currentGeneration(id) + 1;
  generations.set(id, next);
  return next;
};

const toSnapshot = (prompt: ManagedPrompt, loadedAt = Date.now()): RuntimePromptSnapshot => ({
  promptId: prompt.id,
  body: prompt.body,
  revision: prompt.revision,
  isDefault: prompt.isDefault,
  loadedAt,
});

type RuntimePromptInstallInput = Omit<RuntimePromptSnapshot, 'loadedAt'> & { loadedAt?: number };

const installSnapshot = (snapshot: RuntimePromptInstallInput, ttlMs = AI_PROMPT_RUNTIME_TTL_MS): RuntimePromptSnapshot => {
  const id = normalizeId(snapshot.promptId);
  const normalized: RuntimePromptSnapshot = {
    promptId: id,
    body: snapshot.body,
    revision: snapshot.revision ?? null,
    isDefault: snapshot.isDefault === true,
    loadedAt: typeof snapshot.loadedAt === 'number' && Number.isFinite(snapshot.loadedAt) ? snapshot.loadedAt : Date.now(),
  };
  cache.set(id, { ...normalized, expiresAt: Date.now() + Math.max(0, ttlMs) });
  bumpGeneration(id);
  return normalized;
};

/** Install a just-saved value on the current Worker without waiting for TTL. */
export const installRuntimePrompt = (snapshot: RuntimePromptInstallInput, ttlMs = AI_PROMPT_RUNTIME_TTL_MS): RuntimePromptSnapshot =>
  installSnapshot(snapshot, ttlMs);

export const installRuntimePromptOverride = (value: {
  promptId: string;
  body: string;
  revision: string | null;
  isDefault?: boolean;
}, ttlMs = AI_PROMPT_RUNTIME_TTL_MS): RuntimePromptSnapshot =>
  installSnapshot({
    promptId: value.promptId,
    body: value.body,
    revision: value.revision,
    isDefault: value.isDefault === true,
    loadedAt: Date.now(),
  }, ttlMs);

export const installRuntimePromptOverrides = (
  values: readonly { promptId: string; body: string; revision: string | null; isDefault?: boolean }[],
  ttlMs = AI_PROMPT_RUNTIME_TTL_MS,
): RuntimePromptSnapshot[] => values.map((value) => installRuntimePromptOverride(value, ttlMs));

export const invalidateRuntimePrompt = (promptId: string): void => {
  const id = normalizeId(promptId);
  cache.delete(id);
  bumpGeneration(id);
};

export const clearRuntimePromptCache = (): void => {
  cache.clear();
  inFlight.clear();
  for (const id of generations.keys()) generations.set(id, currentGeneration(id) + 1);
};

export const getRuntimePromptSnapshot = async (
  db: AppDrizzleDb | null,
  promptId: string,
  options: { ttlMs?: number } = {},
): Promise<RuntimePromptSnapshot> => {
  const id = normalizeId(promptId);
  const now = Date.now();
  const cached = cache.get(id);
  if (cached && cached.expiresAt > now) return cached;
  const existing = inFlight.get(id);
  if (existing) return existing;

  const queryGeneration = currentGeneration(id);
  const pending = getManagedPrompt(db, id)
    .catch(() => {
      // D1 can be briefly unavailable during a deploy or an isolate wake-up.
      // Keep the AI path usable with the immutable code default instead of
      // returning an empty prompt or failing the whole request.
      const definition = getPromptDefinition(id)!;
      return {
        ...definition,
        body: definition.defaultBody,
        revision: null,
        previousRevision: null,
        action: 'default' as const,
        isOverridden: false,
        isDefault: true,
        updatedAt: null,
        updatedByUserId: null,
        invalidOverride: false,
      } satisfies Awaited<ReturnType<typeof getManagedPrompt>>;
    })
    .then((managed) => {
      // A save/reset may have installed a newer value while this D1 read was
      // in flight. Never let the old response overwrite that value.
      if (currentGeneration(id) !== queryGeneration) {
        const newest = cache.get(id);
        if (newest) return newest;
      }
      return installSnapshot(toSnapshot(managed), options.ttlMs ?? AI_PROMPT_RUNTIME_TTL_MS);
    })
    .catch(() => {
      // A transient D1 read failure must not prevent an AI request from using
      // the immutable code default. A later request will retry after TTL.
      if (currentGeneration(id) !== queryGeneration) {
        const newest = cache.get(id);
        if (newest) return newest;
      }
      const definition = getPromptDefinition(id)!;
      return installSnapshot({
        promptId: id,
        body: definition.defaultBody,
        revision: null,
        isDefault: true,
        loadedAt: Date.now(),
      }, options.ttlMs ?? AI_PROMPT_RUNTIME_TTL_MS);
    })
    .finally(() => {
      if (inFlight.get(id) === pending) inFlight.delete(id);
    });
  inFlight.set(id, pending);
  return pending;
};

export const renderManagedPrompt = async (
  db: AppDrizzleDb | null,
  ref: TextPromptRef,
): Promise<string> => {
  const id = normalizeId(ref.id);
  const definition = getPromptDefinition(id)!;
  const snapshot = await getRuntimePromptSnapshot(db, id);
  return renderPromptTemplate({ template: snapshot.body, variables: ref.variables, slots: definition.slots });
};

export const resolvePromptTemplate = renderManagedPrompt;

/** Synchronous read for code that already loaded a runtime snapshot. */
export const renderRuntimePrompt = (snapshot: RuntimePromptSnapshot, variables: PromptVariables): string => {
  const definition = getPromptDefinition(normalizeId(snapshot.promptId))!;
  return renderPromptTemplate({ template: snapshot.body, variables, slots: definition.slots });
};

export const getCachedRuntimePrompt = (promptId: string): RuntimePromptSnapshot | null => {
  const id = normalizeId(promptId);
  const entry = cache.get(id);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry;
};
