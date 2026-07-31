import { adminJson, requireAdminUser } from '@/lib/auth/admin';
import { createAuthAuditLog } from '@/lib/db/repositories/auth-audit-logs';
import { deleteAdminBattleReport, listAdminBattleReports } from '@/lib/db/repositories/admin';
import { getLargeObjectByOwnerRef } from '@/lib/database/large-objects';
import { deleteObject } from '@/lib/r2';

const getClientIp = (req: Request): string | null =>
  req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

export const createAdminBattleReportsHandler = () => async (req: Request): Promise<Response> => {
  if (req.method === 'GET') {
    const auth = await requireAdminUser(req);
    if ('response' in auth) return auth.response;
    const url = new URL(req.url);
    return adminJson({ reports: await listAdminBattleReports(auth.db, {
      search: url.searchParams.get('search') ?? '',
      limit: Number(url.searchParams.get('limit') ?? 100),
    }) }, 200);
  }

  if (req.method !== 'DELETE') return adminJson({ error: '不支持的请求方法' }, 405);
  const auth = await requireAdminUser(req, { requireSameOrigin: true });
  if ('response' in auth) return auth.response;

  let body: { generationId?: unknown };
  try {
    body = await req.json() as { generationId?: unknown };
  } catch {
    return adminJson({ error: '请求体不是合法 JSON' }, 400);
  }
  const generationId = typeof body.generationId === 'string' ? body.generationId.trim() : '';
  if (!generationId || generationId.length > 128) return adminJson({ error: '缺少有效的 generationId' }, 400);

  const largeObject = await getLargeObjectByOwnerRef('battle_report_generation_output', generationId);
  const changed = await deleteAdminBattleReport(auth.db, generationId);
  if (!changed) return adminJson({ error: '战报不存在或已删除' }, 404);

  if (largeObject?.r2_key) {
    const r2Result = await deleteObject(largeObject.r2_key);
    if (!r2Result.success) console.warn('删除战报 R2 正文失败:', generationId, r2Result.error);
  }

  await createAuthAuditLog(auth.db, {
    businessUserId: auth.user.id,
    eventType: 'admin_battle_report_delete',
    authSource: 'admin-panel',
    ip: getClientIp(req),
    userAgent: req.headers.get('user-agent'),
    resultCode: 'success',
    metadataJson: JSON.stringify({ generationId }),
  });
  return adminJson({ success: true }, 200);
};
