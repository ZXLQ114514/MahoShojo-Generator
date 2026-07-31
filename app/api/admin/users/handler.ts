import { count, eq } from 'drizzle-orm';
import { adminJson, requireAdminUser } from '@/lib/auth/admin';
import { createAuthAuditLog } from '@/lib/db/repositories/auth-audit-logs';
import { listAdminUsers, updateAdminUser } from '@/lib/db/repositories/admin';
import { users } from '@/lib/db/schema';

const getClientIp = (req: Request): string | null =>
  req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

export const createAdminUsersHandler = () => async (req: Request): Promise<Response> => {
  if (req.method === 'GET') {
    const auth = await requireAdminUser(req);
    if ('response' in auth) return auth.response;
    const url = new URL(req.url);
    return adminJson({ users: await listAdminUsers(auth.db, url.searchParams.get('search') ?? '') }, 200);
  }

  if (req.method !== 'PATCH') return adminJson({ error: '不支持的请求方法' }, 405);
  const auth = await requireAdminUser(req, { requireSameOrigin: true });
  if ('response' in auth) return auth.response;

  let body: {
    userId?: unknown;
    isBanned?: unknown;
    isAdmin?: unknown;
    isReviewExempt?: unknown;
    slotCount?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return adminJson({ error: '请求体不是合法 JSON' }, 400);
  }

  const userId = typeof body.userId === 'number' && Number.isSafeInteger(body.userId)
    ? body.userId
    : typeof body.userId === 'string' && /^\d+$/.test(body.userId.trim())
      ? Number(body.userId)
      : 0;
  if (!Number.isSafeInteger(userId) || userId <= 0) return adminJson({ error: '缺少有效的 userId' }, 400);

  const patch: { isBanned?: boolean; isAdmin?: boolean; isReviewExempt?: boolean; slotCount?: number } = {};
  for (const field of ['isBanned', 'isAdmin', 'isReviewExempt'] as const) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== 'boolean') return adminJson({ error: `${field} 必须是布尔值` }, 400);
      patch[field] = body[field];
    }
  }
  if (body.slotCount !== undefined) {
    const slotCount = typeof body.slotCount === 'number' ? body.slotCount : Number(body.slotCount);
    if (!Number.isFinite(slotCount) || slotCount < 0 || slotCount > 1000) return adminJson({ error: 'slotCount 必须在 0 到 1000 之间' }, 400);
    patch.slotCount = Math.trunc(slotCount);
  }
  if (Object.keys(patch).length === 0) return adminJson({ error: '没有可更新的字段' }, 400);

  if (userId === auth.user.id && (patch.isAdmin !== undefined || patch.isBanned !== undefined)) {
    return adminJson({ error: '不能通过管理员页面修改自己的管理员身份或封禁状态' }, 403);
  }

  if (userId !== auth.user.id && patch.isAdmin === false) {
    const rows = await auth.db.select({ count: count() }).from(users).where(eq(users.isAdmin, true));
    if (Number(rows[0]?.count ?? 0) <= 1) return adminJson({ error: '不能移除最后一名管理员' }, 409);
  }

  const changed = await updateAdminUser(auth.db, userId, patch);
  if (!changed) return adminJson({ error: '用户不存在' }, 404);

  await createAuthAuditLog(auth.db, {
    businessUserId: auth.user.id,
    eventType: 'admin_user_update',
    authSource: 'admin-panel',
    ip: getClientIp(req),
    userAgent: req.headers.get('user-agent'),
    resultCode: 'success',
    metadataJson: JSON.stringify({ targetUserId: userId, fields: Object.keys(patch) }),
  });

  return adminJson({ success: true }, 200);
};
