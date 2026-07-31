import { adminJson, requireAdminUser } from '@/lib/auth/admin';
import { createAuthAuditLog } from '@/lib/db/repositories/auth-audit-logs';
import {
  DEFAULT_PUBLIC_AI_COOLDOWN_SECONDS,
  getPublicAiCooldownSettings,
  setPublicAiCooldownSettings,
} from '@/lib/db/repositories/admin';

const getClientIp = (req: Request): string | null =>
  req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

const parseSeconds = (value: unknown): number | null => {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0 || numberValue > 86400) return null;
  return Math.trunc(numberValue);
};

export const createAdminSettingsHandler = () => async (req: Request): Promise<Response> => {
  const auth = await requireAdminUser(req, { requireSameOrigin: req.method === 'PATCH' });
  if ('response' in auth) return auth.response;

  if (req.method === 'GET') {
    return adminJson({
      publicAiCooldown: await getPublicAiCooldownSettings(auth.db),
      defaults: {
        systemSeconds: DEFAULT_PUBLIC_AI_COOLDOWN_SECONDS.system,
        freeSeconds: DEFAULT_PUBLIC_AI_COOLDOWN_SECONDS.free,
        customSeconds: DEFAULT_PUBLIC_AI_COOLDOWN_SECONDS.custom,
        battleSeconds: DEFAULT_PUBLIC_AI_COOLDOWN_SECONDS.battle,
      },
    }, 200);
  }

  if (req.method !== 'PATCH') return adminJson({ error: '不支持的请求方法' }, 405);
  let body: { publicAiCooldown?: { systemSeconds?: unknown; freeSeconds?: unknown; customSeconds?: unknown; battleSeconds?: unknown } };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return adminJson({ error: '请求体不是合法 JSON' }, 400);
  }

  const values = body.publicAiCooldown;
  const systemSeconds = parseSeconds(values?.systemSeconds);
  const freeSeconds = parseSeconds(values?.freeSeconds);
  const customSeconds = parseSeconds(values?.customSeconds);
  const battleSeconds = parseSeconds(values?.battleSeconds);
  if (systemSeconds === null || freeSeconds === null || customSeconds === null || battleSeconds === null) {
    return adminJson({ error: '等待时长必须是 0 到 86400 之间的整数秒' }, 400);
  }

  await setPublicAiCooldownSettings(auth.db, auth.user.id, { systemSeconds, freeSeconds, customSeconds, battleSeconds });
  await createAuthAuditLog(auth.db, {
    businessUserId: auth.user.id,
    eventType: 'admin_settings_update',
    authSource: 'admin-panel',
    ip: getClientIp(req),
    userAgent: req.headers.get('user-agent'),
    resultCode: 'success',
    metadataJson: JSON.stringify({ setting: 'public_ai_cooldown', systemSeconds, freeSeconds, customSeconds, battleSeconds }),
  });
  return adminJson({ success: true, publicAiCooldown: { systemSeconds, freeSeconds, customSeconds, battleSeconds } }, 200);
};
