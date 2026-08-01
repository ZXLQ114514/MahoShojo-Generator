import { adminJson, requireAdminUser } from '@/lib/auth/admin';
import { createAuthAuditLog } from '@/lib/db/repositories/auth-audit-logs';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import {
  createImageGenerationLicense,
  listImageGenerationLicenses,
  revokeExpiredOrExhaustedImageGenerationLicenses,
  revokeImageGenerationLicense,
} from '@/lib/db/repositories/image-generation-licenses';
import {
  createImageGenerationLicenseKey,
  getImageGenerationLicenseKeyPrefix,
  hashImageGenerationLicenseKey,
} from '@/lib/tachie/license';

const MAX_USES = 1_000_000;
const MIN_VALID_FOR_SECONDS = 60;
const MAX_VALID_FOR_SECONDS = 365 * 24 * 60 * 60;

const getClientIp = (req: Request): string | null =>
  req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

const parsePositiveInteger = (value: unknown, min: number, max: number): number | null => {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(numberValue) || numberValue < min || numberValue > max) return null;
  return numberValue;
};

const auditAdminLicenseEvent = async (
  db: AppDrizzleDb,
  req: Request,
  userId: number,
  eventType: string,
  metadata: Record<string, unknown>,
) => {
  await createAuthAuditLog(db, {
    businessUserId: userId,
    eventType,
    authSource: 'admin-panel',
    ip: getClientIp(req),
    userAgent: req.headers.get('user-agent'),
    resultCode: 'success',
    metadataJson: JSON.stringify(metadata),
  });
};

export const createAdminImageGenerationLicensesHandler = () => async (req: Request): Promise<Response> => {
  const auth = await requireAdminUser(req, { requireSameOrigin: req.method !== 'GET' });
  if ('response' in auth) return auth.response;

  if (req.method === 'GET') {
    await revokeExpiredOrExhaustedImageGenerationLicenses(auth.db);
    return adminJson({ licenses: await listImageGenerationLicenses(auth.db) }, 200);
  }

  if (req.method === 'POST') {
    let body: { maxUses?: unknown; validForSeconds?: unknown };
    try {
      body = await req.json() as typeof body;
    } catch {
      return adminJson({ error: '请求体不是合法 JSON' }, 400);
    }

    const maxUses = parsePositiveInteger(body.maxUses, 1, MAX_USES);
    const validForSeconds = parsePositiveInteger(body.validForSeconds, MIN_VALID_FOR_SECONDS, MAX_VALID_FOR_SECONDS);
    if (maxUses === null || validForSeconds === null) {
      return adminJson({ error: '使用次数或有效时间无效' }, 400);
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + validForSeconds * 1000).toISOString();
    const licenseKey = createImageGenerationLicenseKey();
    const record = await createImageGenerationLicense(auth.db, {
      keyHash: await hashImageGenerationLicenseKey(licenseKey),
      keyPrefix: getImageGenerationLicenseKeyPrefix(licenseKey),
      maxUses,
      expiresAt,
      createdByUserId: auth.user.id,
      now: now.toISOString(),
    });

    await auditAdminLicenseEvent(auth.db, req, auth.user.id, 'admin_image_generation_license_create', {
      licenseId: record.id,
      keyPrefix: record.keyPrefix,
      maxUses,
      expiresAt,
    });

    return adminJson({
      success: true,
      licenseKey,
      license: record,
      warning: '许可密钥只显示这一次，请立即复制保存。',
    }, 201);
  }

  if (req.method === 'DELETE') {
    let body: { id?: unknown };
    try {
      body = await req.json() as typeof body;
    } catch {
      return adminJson({ error: '请求体不是合法 JSON' }, 400);
    }
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!id || id.length > 128) return adminJson({ error: '缺少有效的许可证 ID' }, 400);

    const changed = await revokeImageGenerationLicense(auth.db, id);
    if (!changed) return adminJson({ error: '许可证不存在或已经失效' }, 404);

    await auditAdminLicenseEvent(auth.db, req, auth.user.id, 'admin_image_generation_license_revoke', {
      licenseId: id,
    });
    return adminJson({ success: true }, 200);
  }

  return adminJson({ error: '不支持的请求方法' }, 405);
};
