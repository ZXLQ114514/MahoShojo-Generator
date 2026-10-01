import { getBetterAuthBootstrapStatus } from '@/lib/auth/better-auth';
import { getBetterAuthInstance, hasBetterAuthDatabaseBinding } from '@/lib/auth/better-auth-app';
import { appendSetCookieHeaders } from '@/lib/auth/set-cookie';
import { buildInternalAuthHeader, INTERNAL_AUTH_HEADER } from '@/lib/auth/internal-auth';

export type BetterAuthBridgeUnavailableCode =
  | 'BETTER_AUTH_MISCONFIGURED'
  | 'BETTER_AUTH_DB_UNAVAILABLE'
  | 'BETTER_AUTH_INIT_FAILED';

export type BetterAuthBridgeResult =
  | { ok: true; response: Response }
  | { ok: false; code: BetterAuthBridgeUnavailableCode; message: string; dispatched: boolean };

export type BetterAuthBridgeAvailability =
  | { available: true }
  | { available: false; code: BetterAuthBridgeUnavailableCode; message: string };

const DEFAULT_BETTER_AUTH_BASE_URL = 'http://localhost:3000';

const resolveBetterAuthBaseURL = (): string => {
  const configured = process.env.BETTER_AUTH_URL?.trim();
  return configured || DEFAULT_BETTER_AUTH_BASE_URL;
};

const copyHeader = (source: Headers, target: Headers, key: string): void => {
  const value = source.get(key);
  if (value && value.trim().length > 0) {
    target.set(key, value);
  }
};

export const invokeBetterAuthJsonEndpoint = async (input: {
  path: string;
  body: unknown;
  sourceHeaders: Headers;
}): Promise<BetterAuthBridgeResult> => {
  const availability = getBetterAuthBridgeAvailability();
  if (!availability.available) {
    return {
      ok: false,
      code: availability.code,
      message: availability.message,
      dispatched: false,
    };
  }

  const auth = getBetterAuthInstance();
  if (!auth) {
    return { ok: false, code: 'BETTER_AUTH_INIT_FAILED', message: 'Better Auth 初始化失败', dispatched: false };
  }

  const normalizedPath = input.path.startsWith('/') ? input.path : `/${input.path}`;
  const url = new URL(normalizedPath, resolveBetterAuthBaseURL());

  const requestHeaders = new Headers({
    'Content-Type': 'application/json',
  });
  const body = JSON.stringify(input.body ?? {});
  const internalAuth = await buildInternalAuthHeader(normalizedPath, body);
  if (internalAuth) requestHeaders.set(INTERNAL_AUTH_HEADER, internalAuth);
  copyHeader(input.sourceHeaders, requestHeaders, 'cookie');
  copyHeader(input.sourceHeaders, requestHeaders, 'origin');
  copyHeader(input.sourceHeaders, requestHeaders, 'referer');
  copyHeader(input.sourceHeaders, requestHeaders, 'user-agent');
  copyHeader(input.sourceHeaders, requestHeaders, 'x-forwarded-for');
  copyHeader(input.sourceHeaders, requestHeaders, 'x-real-ip');
  copyHeader(input.sourceHeaders, requestHeaders, 'cf-connecting-ip');

  try {
    const response = await (auth as { handler: (req: Request) => Promise<Response> }).handler(
      new Request(url.toString(), {
        method: 'POST',
        headers: requestHeaders,
        body,
      }),
    );

    return { ok: true, response };
  } catch {
    // Provider/adapter errors can contain untrusted request data (including
    // credentials). Do not log the raw error or the sign-up body here.
    console.error('[auth][bridge] 调用 Better Auth 端点失败:', normalizedPath);
    return { ok: false, code: 'BETTER_AUTH_INIT_FAILED', message: 'Better Auth 请求执行失败', dispatched: true };
  }
};

export const getBetterAuthBridgeAvailability = (): BetterAuthBridgeAvailability => {
  const status = getBetterAuthBootstrapStatus();
  if (status === 'misconfigured') {
    return { available: false, code: 'BETTER_AUTH_MISCONFIGURED', message: 'Better Auth 配置不完整' };
  }

  if (!hasBetterAuthDatabaseBinding()) {
    return {
      available: false,
      code: 'BETTER_AUTH_DB_UNAVAILABLE',
      message: 'Better Auth 所需 D1 绑定不可用',
    };
  }

  const auth = getBetterAuthInstance();
  if (!auth) {
    return { available: false, code: 'BETTER_AUTH_INIT_FAILED', message: 'Better Auth 初始化失败' };
  }

  return { available: true };
};

export { appendSetCookieHeaders };

export const readJsonSafely = async <T>(response: Response): Promise<T | null> => {
  try {
    return (await response.clone().json()) as T;
  } catch {
    return null;
  }
};

export const extractErrorMessage = (payload: unknown, fallback: string): string => {
  if (!payload || typeof payload !== 'object') return fallback;
  const record = payload as Record<string, unknown>;

  const error = record.error;
  if (typeof error === 'string' && error.trim().length > 0) return error;

  const message = record.message;
  if (typeof message === 'string' && message.trim().length > 0) return message;

  return fallback;
};
