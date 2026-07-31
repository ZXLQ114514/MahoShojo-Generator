import {
  getBattleReportGenerationByIdLite,
  updateBattleReportGenerationPublication,
} from '@/lib/database/battle-report-generations';
import { loadBattleReportGenerationOutputText } from '@/lib/arena/battle-report-record-utils';
import { applyShieldWords } from '@/lib/shield-word-filter';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { json, requireAuthUser } from '@/lib/pvp/server';

const getGenerationId = (url: string): string | null => {
  const parts = new URL(url).pathname.split('/').filter(Boolean);
  const index = parts.findIndex((part) => part === 'battle-reports');
  const value = index >= 0 ? parts[index + 1] : null;
  return value && value.length <= 128 ? value : null;
};

const parseIsPublic = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : null;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return null;
};

export async function appRouteHandler(req: Request): Promise<Response> {
  if (req.method !== 'PATCH') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const generationId = getGenerationId(req.url);
  if (!generationId) return json({ error: '缺少或无效的 generationId' }, { status: 400 });

  const record = await getBattleReportGenerationByIdLite(generationId);
  if (!record) return json({ error: '战报记录不存在' }, { status: 404 });
  if (record.user_id !== auth.user.id) return json({ error: '只有战报创建者可以修改公开状态' }, { status: 403 });
  const normalizedEndpoint = record.endpoint.replace(/^\/+/, '');
  const isArenaGenerationEndpoint =
    normalizedEndpoint === 'api/arena/generate' ||
    normalizedEndpoint === 'api/arena/generate-stream' ||
    normalizedEndpoint === 'api/arena/continuous-bundle' ||
    normalizedEndpoint === 'api/generate-battle-story';
  if (!isArenaGenerationEndpoint || record.pvp_match_id) {
    return json({ error: '只有竞技场战报支持公开展示，PVP 战报暂不支持' }, { status: 400 });
  }

  let body: { isPublic?: unknown; mode?: unknown };
  try {
    body = await req.json() as { isPublic?: unknown };
  } catch {
    return json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }
  const isPublic = parseIsPublic(body.isPublic);
  if (isPublic === null) return json({ error: 'isPublic 必须是布尔值' }, { status: 400 });
  const mode = typeof body.mode === 'string' && ['classic', 'kizuna', 'daily', 'scenario'].includes(body.mode)
    ? body.mode
    : null;

  if (isPublic) {
    if (record.status !== 'completed') return json({ error: '只有已完成的战报可以公开' }, { status: 400 });
    if (record.output_has_shield_words === 1) return json({ error: '战报包含屏蔽词，不能公开' }, { status: 422 });

    const output = await loadBattleReportGenerationOutputText({
      generationId: record.id,
      outputPreview: record.output_preview,
    });
    const outputText = output.outputText?.trim() ?? '';
    if (!outputText || output.readError) return json({ error: '战报正文尚未保存完整，暂时不能公开' }, { status: 422 });

    const shieldResult = applyShieldWords(`${record.note ?? ''}\n${outputText}`);
    if (shieldResult.hasShieldWords) return json({ error: '战报包含屏蔽词，不能公开' }, { status: 422 });
    const sensitiveResult = await quickCheck(`${record.note ?? ''}\n${outputText}`);
    if (sensitiveResult.hasSensitiveWords) return json({ error: '战报包含敏感内容，不能公开' }, { status: 422 });
  }

  const updated = await updateBattleReportGenerationPublication(record.id, isPublic, mode);
  if (!updated) return json({ error: '公开状态保存失败' }, { status: 503 });
  return json({ success: true, isPublic });
}

export default appRouteHandler;
