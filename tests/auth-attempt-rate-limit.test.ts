import { describe, expect, test } from 'vitest';

import {
  __resetAuthAttemptRateLimitForTest,
  acquireAuthAttemptRateLimit,
} from '@/lib/auth/attempt-rate-limit';

const buildRequest = (ip: string): Request =>
  new Request('https://example.com/api/auth/login', {
    headers: {
      'cf-connecting-ip': ip,
    },
  });

describe('auth attempt rate limit', () => {
  test('登录与注册尝试限流默认关闭', () => {
    __resetAuthAttemptRateLimitForTest();
    const req = buildRequest('1.1.1.1');

    for (let i = 0; i < 40; i += 1) {
      expect(
        acquireAuthAttemptRateLimit({
          req,
          actionType: 'register',
          email: 'Hikari@Example.com',
          username: 'hikari',
          nowMs: 1_000,
        }),
      ).toEqual({
        allowed: true,
        retryAfterSeconds: 0,
      });

      expect(
        acquireAuthAttemptRateLimit({
          req,
          actionType: 'login',
          identifier: 'Hikari@Example.com',
          nowMs: 1_000,
        }),
      ).toEqual({
        allowed: true,
        retryAfterSeconds: 0,
      });
    }
  });
});
