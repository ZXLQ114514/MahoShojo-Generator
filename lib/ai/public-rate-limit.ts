import { ACTIVITY_TOKEN_HEADER, verifyActivityToken } from '@/lib/auth/activity-token';
import { anonymizeIp, getClientIpFromHeaders } from '@/lib/arena/battle-report-log-utils';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { getPublicAiCooldownSettings } from '@/lib/db/repositories/admin';

export type PublicAiRateLimitAction =
  | 'magical_girl_generate'
  | 'magical_girl_details_generate'
  | 'canshou_generate'
  | 'scenario_generate'
  | 'free_generate'
  | 'sublimation_generate';

export type PublicAiProviderMode = 'system' | 'custom';

export type AcquirePublicAiRateLimitInput = {
  req: Request;
  actionType: PublicAiRateLimitAction;
  providerMode: PublicAiProviderMode;
  nowMs?: number;
};

export type AcquirePublicAiRateLimitResult =
  | {
      allowed: true;
      retryAfterSeconds: 0;
      identityScope: 'user' | 'ip' | 'unknown';
    }
  | {
      allowed: false;
      retryAfterSeconds: number;
      reason: 'identity_cooldown';
      identityScope: 'user' | 'ip' | 'unknown';
    };

export type PublicAiRateLimitRejectedResult = Extract<AcquirePublicAiRateLimitResult, { allowed: false }>;

type IdentityResolution =
  | { scope: 'user'; key: string }
  | { scope: 'ip'; key: string }
  | { scope: 'unknown'; key: string };

const identityLastAcceptedAt = new Map<string, number>();

const SWEEP_INTERVAL = 256;
const SWEEP_STALE_AFTER_MS = 60 * 60 * 1000;

let acquireCallCount = 0;

const clampRetryAfterSeconds = (valueMs: number): number => {
  return Math.max(1, Math.ceil(Math.max(1, valueMs) / 1000));
};

const getCooldownMs = async (
  actionType: PublicAiRateLimitAction,
  providerMode: PublicAiProviderMode,
): Promise<number> => {
  const settings = await getPublicAiCooldownSettings(getDrizzleDbFromRuntime());
  if (providerMode === 'custom') return settings.customSeconds * 1000;

  if (actionType === 'free_generate') {
    return settings.freeSeconds * 1000;
  }

  return settings.systemSeconds * 1000;
};

const maybeSweepExpiredStates = (nowMs: number): void => {
  acquireCallCount += 1;
  if (acquireCallCount % SWEEP_INTERVAL !== 0) return;

  for (const [key, acceptedAt] of identityLastAcceptedAt.entries()) {
    if (nowMs - acceptedAt > SWEEP_STALE_AFTER_MS) {
      identityLastAcceptedAt.delete(key);
    }
  }
};

const resolveIdentity = async (req: Request): Promise<IdentityResolution> => {
  const activityToken = req.headers.get(ACTIVITY_TOKEN_HEADER);
  if (activityToken) {
    const verified = await verifyActivityToken(activityToken);
    if (verified) {
      return {
        scope: 'user',
        key: `user:${verified.userId}`,
      };
    }
  }

  const ipAnonymized = anonymizeIp(getClientIpFromHeaders(req.headers));
  if (ipAnonymized) {
    return {
      scope: 'ip',
      key: `ip:${ipAnonymized}`,
    };
  }

  return {
    scope: 'unknown',
    key: 'unknown',
  };
};

export const acquirePublicAiRateLimit = async (
  input: AcquirePublicAiRateLimitInput,
): Promise<AcquirePublicAiRateLimitResult> => {
  const nowMs = typeof input.nowMs === 'number' ? input.nowMs : Date.now();
  maybeSweepExpiredStates(nowMs);

  const identity = await resolveIdentity(input.req);
  const cooldownMs = await getCooldownMs(input.actionType, input.providerMode);
  const key = `${input.providerMode}:${input.actionType}:${identity.key}`;
  const lastAcceptedAt = identityLastAcceptedAt.get(key) ?? 0;

  if (lastAcceptedAt > 0) {
    const elapsed = nowMs - lastAcceptedAt;
    if (elapsed < cooldownMs) {
      return {
        allowed: false,
        retryAfterSeconds: clampRetryAfterSeconds(cooldownMs - elapsed),
        reason: 'identity_cooldown',
        identityScope: identity.scope,
      };
    }
  }

  identityLastAcceptedAt.set(key, nowMs);
  return {
    allowed: true,
    retryAfterSeconds: 0,
    identityScope: identity.scope,
  };
};

export const inferPublicAiProviderMode = (customProviderPayload: unknown): PublicAiProviderMode => {
  if (!customProviderPayload || typeof customProviderPayload !== 'object') return 'system';
  const providerId = typeof (customProviderPayload as { providerId?: unknown }).providerId === 'string'
    ? (customProviderPayload as { providerId: string }).providerId.trim()
    : '';
  return providerId && providerId !== 'system' ? 'custom' : 'system';
};

export const buildPublicAiRateLimitResponse = (result: PublicAiRateLimitRejectedResult): Response => {
  return new Response(
    JSON.stringify({
      error: `请求过于频繁，请在 ${result.retryAfterSeconds} 秒后重试`,
      reason: result.reason,
      retryAfter: result.retryAfterSeconds,
      retryAfterSeconds: result.retryAfterSeconds,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Retry-After': String(result.retryAfterSeconds),
      },
    },
  );
};

export const __resetPublicAiRateLimitForTest = (): void => {
  identityLastAcceptedAt.clear();
  acquireCallCount = 0;
};
