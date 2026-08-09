import { requireAuthUser, type AuthenticatedUser } from '@/lib/auth/server';
import { getBusinessUserById } from '@/lib/db/repositories/business-users';
import { getDrizzleDbFromRuntime, type AppDrizzleDb } from '@/lib/db/drizzle';
import { isSameOriginRequest } from '@/lib/auth/request-security';

export type AdminAuthResult =
  | { user: AuthenticatedUser; db: AppDrizzleDb }
  | { response: Response };

const json = (payload: unknown, status: number): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const requireAdminUser = async (req: Request, options: { requireSameOrigin?: boolean } = {}): Promise<AdminAuthResult> => {
  if (options.requireSameOrigin && !isSameOriginRequest(req)) {
    return { response: json({ error: '跨站请求被拒绝' }, 403) };
  }

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth;

  const db = getDrizzleDbFromRuntime();
  if (!db) return { response: json({ error: '数据库不可用' }, 503) };

  // 每次从 D1 复核管理员状态，避免旧会话或旧 Bearer 权限继续生效。
  const currentUser = await getBusinessUserById(db, auth.user.id);
  if (!currentUser || currentUser.isAdmin !== true) {
    return { response: json({ error: '需要管理员权限' }, 403) };
  }

  return { user: auth.user, db };
};

export const adminJson = json;
