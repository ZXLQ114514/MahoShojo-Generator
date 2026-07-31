import { beforeEach, describe, expect, test, vi } from 'vitest';

const requireAdminUser = vi.fn();
const listAdminDataCards = vi.fn();
const updateAdminDataCardModeration = vi.fn();
const createAuthAuditLog = vi.fn();

vi.mock('@/lib/auth/admin', () => ({
  requireAdminUser,
  adminJson: (payload: unknown, status: number) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }),
}));
vi.mock('@/lib/db/repositories/admin', () => ({
  listAdminDataCards,
  updateAdminDataCardModeration,
  listAdminUsers: vi.fn(),
  updateAdminUser: vi.fn(),
}));
vi.mock('@/lib/db/repositories/auth-audit-logs', () => ({ createAuthAuditLog }));

describe('admin API security boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('unauthorized card listing stops before querying data', async () => {
    requireAdminUser.mockResolvedValue({
      response: new Response(JSON.stringify({ error: '需要管理员权限' }), { status: 403 }),
    });
    const { createAdminDataCardsHandler } = await import('@/app/api/admin/data-cards/handler');

    const response = await createAdminDataCardsHandler()(new Request('https://example.test/api/admin/data-cards'));

    expect(response.status).toBe(403);
    expect(listAdminDataCards).not.toHaveBeenCalled();
  });

  test('card mutation stops at the admin auth gate before the database operation', async () => {
    requireAdminUser.mockResolvedValue({
      response: new Response(JSON.stringify({ error: '跨站请求被拒绝' }), { status: 403 }),
    });
    const { createAdminDataCardsHandler } = await import('@/app/api/admin/data-cards/handler');

    const response = await createAdminDataCardsHandler()(new Request('https://example.test/api/admin/data-cards', {
      method: 'POST',
      headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId: 'card-1', action: 'approve' }),
    }));

    expect(response.status).toBe(403);
    expect(updateAdminDataCardModeration).not.toHaveBeenCalled();
    expect(createAuthAuditLog).not.toHaveBeenCalled();
  });
});
