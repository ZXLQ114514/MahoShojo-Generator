import { getRequestUrl } from '@/lib/request-url';
import { json, requireAuthUser } from '@/lib/pvp/server';
import { getDataCardById } from '@/lib/database/data-cards';
import {
  countBattleReportGenerationsByCharacterAnalysis,
  getBattleReportGenerationsByCharacterAnalysis,
  listBattleReportCharacterAnalysisUploaders,
} from '@/lib/database/battle-report-generations';
import { getBattleReportGenerationCombatantsByGenerationIds } from '@/lib/database/battle-report-generation-combatants';
import {
  analyzeCharacterBattleReports,
  type CharacterReportAnalysisCard,
} from '@/lib/arena/character-report-analysis';

const clampInt = (value: string | null, fallback: number, min: number, max: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
};

const parseDateFilter = (value: string | null, endOfDay: boolean): string | null => {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
    : trimmed;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const parseReportLimit = (value: string | null): number | null => {
  const trimmed = (value ?? '').trim().toLowerCase();
  if (!trimmed || trimmed === 'all') return null;
  return clampInt(trimmed, 50, 1, 500);
};

async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  const auth = await requireAuthUser(req);
  if ('response' in auth) {
    return auth.response;
  }

  const url = getRequestUrl(req);
  const cardId = (url.searchParams.get('cardId') ?? '').trim();
  if (!cardId) {
    return json({ error: '缺少 cardId' }, { status: 400 });
  }

  const { getDrizzleDbFromRuntime } = await import('@/lib/db/drizzle');
  const db = getDrizzleDbFromRuntime();
  if (!db) {
    return json({ error: '数据库暂时不可用' }, { status: 503 });
  }

  const cardRow = await getDataCardById(cardId, false);
  if (!cardRow || cardRow.user_id !== auth.user.id) {
    return json({ error: '角色卡不存在或无权访问' }, { status: 404 });
  }
  if (cardRow.type !== 'character') {
    return json({ error: '仅支持角色卡分析' }, { status: 400 });
  }

  const fromIso = parseDateFilter(url.searchParams.get('from'), false);
  const toIso = parseDateFilter(url.searchParams.get('to'), true);
  const uploaderUsername = (url.searchParams.get('uploader') ?? '').trim() || null;
  const reportLimit = parseReportLimit(url.searchParams.get('reportLimit'));

  const baseFilter = {
    fromIso: fromIso ?? undefined,
    toIso: toIso ?? undefined,
  } as const;
  const analysisFilter = {
    fromIso: fromIso ?? undefined,
    toIso: toIso ?? undefined,
    uploaderUsername: uploaderUsername ?? undefined,
    sort: 'started_at_desc' as const,
  };

  const [uploaders, totalReports, reports] = await Promise.all([
    listBattleReportCharacterAnalysisUploaders(cardId, baseFilter),
    countBattleReportGenerationsByCharacterAnalysis(cardId, analysisFilter),
    getBattleReportGenerationsByCharacterAnalysis(cardId, reportLimit, 0, analysisFilter),
  ]);

  const combatants = await getBattleReportGenerationCombatantsByGenerationIds(
    reports.map((report) => report.generationId),
  );

  const analysis = analyzeCharacterBattleReports({
    card: {
      id: cardRow.id,
      name: cardRow.name,
      description: typeof cardRow.description === 'string' ? cardRow.description : null,
      type: typeof cardRow.type === 'string' ? cardRow.type : null,
      updatedAt: typeof cardRow.updated_at === 'string' ? cardRow.updated_at : null,
    } satisfies CharacterReportAnalysisCard,
    filters: {
      fromIso,
      toIso,
      uploaderUsername,
      reportLimit,
    },
    totalReports,
    uploaders,
    reports,
    combatants,
  });

  return json({ success: true, analysis }, { status: 200 });
}

export const appRouteHandler = handler;
export default appRouteHandler;
