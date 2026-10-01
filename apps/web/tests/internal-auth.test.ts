import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Better Auth internal subrequest guard', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('signs and verifies the exact auth path', async () => {
    vi.stubEnv('BETTER_AUTH_SECRET', 'internal-auth-test-secret-which-is-long-enough');
    const { buildInternalAuthHeader, INTERNAL_AUTH_HEADER, verifyInternalAuthHeader } = await import('@/lib/auth/internal-auth');
    const body = JSON.stringify({ email: 'user@example.com', password: 'safe' });
    const header = await buildInternalAuthHeader('/api/auth/sign-up/email', body);
    const request = new Request('https://example.com/api/auth/sign-up/email', { method: 'POST', body, headers: { [INTERNAL_AUTH_HEADER]: header! } });
    expect(await verifyInternalAuthHeader(request)).toBe(true);
    const otherPath = new Request('https://example.com/api/auth/sign-in/email', { method: 'POST', body, headers: { [INTERNAL_AUTH_HEADER]: header! } });
    expect(await verifyInternalAuthHeader(otherPath)).toBe(false);
    const otherBody = new Request('https://example.com/api/auth/sign-up/email', { method: 'POST', body: JSON.stringify({ email: 'attacker@example.com', password: 'safe' }), headers: { [INTERNAL_AUTH_HEADER]: header! } });
    expect(await verifyInternalAuthHeader(otherBody)).toBe(false);
  });
});
