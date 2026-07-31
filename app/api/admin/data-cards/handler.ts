import { createAuthAuditLog } from '@/lib/db/repositories/auth-audit-logs';
import {
  listAdminDataCards,
  updateAdminDataCardModeration,
} from '@/lib/db/repositories/admin';
import { adminJson, requireAdminUser } from '@/lib/auth/admin';

const getClientIp = (req: Request): string | null =>
  req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

export const createAdminDataCardsHandler = () => async (req: Request): Promise<Response> => {
  if (req.method === 'GET') {
    const auth = await requireAdminUser(req);
    if ('response' in auth) return auth.response;

    const url = new URL(req.url);
    const statusValue = url.searchParams.get('status') ?? 'pending';
    const status = ['pending', 'approved', 'rejected', 'all'].includes(statusValue)
      ? (statusValue as 'pending' | 'approved' | 'rejected' | 'all')
      : 'pending';
    const cards = await listAdminDataCards(auth.db, {
      status,
      type: url.searchParams.get('type') ?? 'character',
      search: url.searchParams.get('search') ?? '',
      limit: Number(url.searchParams.get('limit') ?? 50),
    });
    return adminJson({ cards }, 200);
  }

  if (req.method !== 'POST') return adminJson({ error: '不支持的请求方法' }, 405);
  const auth = await requireAdminUser(req, { requireSameOrigin: true });
  if ('response' in auth) return auth.response;

  let body: { cardId?: unknown; action?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return adminJson({ error: '请求体不是合法 JSON' }, 400);
  }

  const cardId = typeof body.cardId === 'string' ? body.cardId.trim() : '';
  const action = body.action === 'approve' || body.action === 'reject' || body.action === 'private' ? body.action : null;
  if (!cardId || cardId.length > 128 || !action) return adminJson({ error: '缺少有效的 cardId 或 action' }, 400);

  const changed = await updateAdminDataCardModeration(auth.db, cardId, action);
  if (!changed) return adminJson({ error: '角色卡不存在或已删除' }, 404);

  await createAuthAuditLog(auth.db, {
    businessUserId: auth.user.id,
    eventType: `admin_data_card_${action}`,
    authSource: 'admin-panel',
    ip: getClientIp(req),
    userAgent: req.headers.get('user-agent'),
    resultCode: 'success',
    metadataJson: JSON.stringify({ cardId }),
  });

  return adminJson({ success: true }, 200);
};
