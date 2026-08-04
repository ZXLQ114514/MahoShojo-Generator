import { getRequestUrl } from '@/lib/request-url';
import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';
import { createRequestAuthUserResolver } from '@/lib/auth/request-auth-user';
import { acquirePublicAiRateLimit, buildPublicAiRateLimitResponse } from '@/lib/ai/public-rate-limit';
import {
  generatePublicBattleSummary,
  getPublicBattleSummarySettings,
  getStoredPublicBattleSummary,
  setStoredPublicBattleSummary,
} from '@/lib/arena/public-battle-summary';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';

const json = (payload: unknown, status = 200): Response => new Response(JSON.stringify(payload), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': status === 200 ? 'no-store' : 'no-store' },
});

const allowedModels = new Set(
  AI_PROVIDER_CATALOG.flatMap((provider) => provider.models.map((model) => model.value)).filter((model) => model && model !== 'default'),
);

let autoSummaryPromise: Promise<Response> | null = null;

const readModel = (value: unknown): string => {
  const model = typeof value === 'string' ? value.trim() : '';
  if (!model) return '';
  return allowedModels.has(model) ? model : '';
};

const shouldRefresh = (generatedAt: string | undefined, intervalMinutes: number): boolean => {
  if (!generatedAt) return true;
  const timestamp = Date.parse(generatedAt);
  return !Number.isFinite(timestamp) || Date.now() - timestamp >= intervalMinutes * 60_000;
};

export async function GET(req: Request): Promise<Response> {
  try {
    const db = getDrizzleDbFromRuntime();
    const settings = await getPublicBattleSummarySettings(db);
    const stored = await getStoredPublicBattleSummary(db);
    const url = getRequestUrl(req);
    const auto = url.searchParams.get('auto') === '1' || url.searchParams.get('auto') === 'true';

    if (auto && settings.enabled && shouldRefresh(stored?.generatedAt, settings.intervalMinutes)) {
      if (!autoSummaryPromise) {
        autoSummaryPromise = (async () => {
          const authUser = await createRequestAuthUserResolver(req).getUser();
          const summary = await generatePublicBattleSummary({ model: settings.model, username: authUser?.username ?? '匿名用户' });
          if (db) await setStoredPublicBattleSummary(db, null, summary);
          return json({ success: true, source: 'auto', summary, settings });
        })().finally(() => {
          autoSummaryPromise = null;
        });
      }
      return await autoSummaryPromise;
    }

    return json({ success: true, source: 'stored', summary: stored, settings });
  } catch (error) {
    console.error('读取公开战报总结失败:', error);
    return json({ error: '公开战报总结暂时不可用' }, 500);
  }
}

export async function POST(req: Request): Promise<Response> {
  const rateLimit = await acquirePublicAiRateLimit({ req, actionType: 'public_battle_summary', providerMode: 'system' });
  if (!rateLimit.allowed) return buildPublicAiRateLimitResponse(rateLimit);

  try {
    const body = await req.json().catch(() => ({})) as { model?: unknown };
    const rawModel = typeof body.model === 'string' ? body.model.trim() : '';
    const model = readModel(rawModel);
    if (rawModel && !model) return json({ error: '总结模型不在可用模型目录中' }, 400);
    const authUser = await createRequestAuthUserResolver(req).getUser();
    const summary = await generatePublicBattleSummary({ model, username: authUser?.username ?? '匿名用户' });
    return json({ success: true, source: 'manual', summary });
  } catch (error) {
    console.error('生成公开战报总结失败:', error);
    return json({ error: error instanceof Error ? error.message : '公开战报总结生成失败' }, 500);
  }
}
