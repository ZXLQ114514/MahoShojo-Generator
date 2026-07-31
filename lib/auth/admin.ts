import { requireAuthUser, type AuthenticatedUser } from '@/lib/auth/server';
import { getBusinessUserById } from '@/lib/db/repositories/business-users';
import { getDrizzleDbFromRuntime, type AppDrizzleDb } from '@/lib/db/drizzle';

export type AdminAuthResult =
  | { user: AuthenticatedUser; db: AppDrizzleDb }
  | { response: Response };

const json = (payload: unknown, status: number): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const readRequestOrigin = (req: Request): string => {
  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || req.headers.get('host')?.trim();
  if (!host) return new URL(req.url).origin;

  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  let protocol = forwardedProto;
  if (!protocol) {
    const cfVisitor = req.headers.get('cf-visitor');
    try {
      const scheme = cfVisitor ? (JSON.parse(cfVisitor) as { scheme?: unknown }).scheme : null;
      if (typeof scheme === 'string' && scheme.trim()) protocol = scheme.trim();
    } catch {
      // Ignore malformed proxy metadata and fall back to the request URL.
    }
  }
  if (!protocol) protocol = new URL(req.url).protocol.replace(/:$/, '');
  return `${protocol}://${host}`;
};

const sameOrigin = (req: Request): boolean => {
  const requestOrigin = readRequestOrigin(req);
  const origin = req.headers.get('origin');
  if (origin && origin !== requestOrigin) return false;

  const referer = req.headers.get('referer');
  if (referer) {
    try {
      if (new URL(referer).origin !== requestOrigin) return false;
    } catch {
      return false;
    }
  }
  return true;
};

export const requireAdminUser = async (req: Request, options: { requireSameOrigin?: boolean } = {}): Promise<AdminAuthResult> => {
  if (options.requireSameOrigin && !sameOrigin(req)) {
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
