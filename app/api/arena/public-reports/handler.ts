import { getRequestUrl } from '@/lib/request-url';
import {
  getBattleReportGenerationByIdLite,
  getPublicBattleReportGenerations,
} from '@/lib/database/battle-report-generations';
import { getBattleReportGenerationCombatantsByGenerationId } from '@/lib/database/battle-report-generation-combatants';
import { loadBattleReportGenerationOutputText } from '@/lib/arena/battle-report-record-utils';
import { hydrateBattleReportCardFromGenerationRecord } from '@/lib/arena/battle-report-card-fallback';
import { applyShieldWords } from '@/lib/shield-word-filter';
import { quickCheck } from '@/lib/sensitive-word-filter';

const json = (payload: unknown, status = 200): Response => new Response(JSON.stringify(payload), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': status === 200 ? 'public, max-age=30' : 'no-store' },
});

const clampInt = (value: string | null, fallback: number, min: number, max: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
};

const isArenaRecord = (endpoint: string, pvpMatchId?: string | null): boolean => {
  const normalizedEndpoint = endpoint.replace(/^\/+/, '');
  return (
    !pvpMatchId &&
    (normalizedEndpoint === 'api/arena/generate' ||
      normalizedEndpoint === 'api/arena/generate-stream' ||
      normalizedEndpoint === 'api/arena/continuous-bundle' ||
      normalizedEndpoint === 'api/generate-battle-story')
  );
};

const readSafeOutput = async (record: Awaited<ReturnType<typeof getBattleReportGenerationByIdLite>>) => {
  if (!record || record.status !== 'completed' || record.is_public !== 1 || !isArenaRecord(record.endpoint, record.pvp_match_id)) return null;
  const output = await loadBattleReportGenerationOutputText({ generationId: record.id, outputPreview: record.output_preview });
  const text = output.outputText?.trim() ?? '';
  if (!text || output.readError) return null;
  if (record.output_has_shield_words === 1) return null;
  const shieldResult = applyShieldWords(`${record.note ?? ''}\n${text}`);
  if (shieldResult.hasShieldWords) return null;
  const sensitiveResult = await quickCheck(`${record.note ?? ''}\n${text}`);
  if (sensitiveResult.hasSensitiveWords) return null;
  return text;
};

export async function appRouteHandler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  try {
    const url = getRequestUrl(req);
    const id = url.searchParams.get('id')?.trim() ?? '';
    if (id) {
      const record = await getBattleReportGenerationByIdLite(id);
      if (!record || record.is_public !== 1 || record.status !== 'completed' || !isArenaRecord(record.endpoint, record.pvp_match_id)) {
        return json({ error: '公开战报不存在' }, 404);
      }
      const outputText = await readSafeOutput(record);
      if (!outputText) return json({ error: '该战报当前不可公开展示' }, 410);
      const hydrated = await hydrateBattleReportCardFromGenerationRecord({
        generationMode: record.generation_mode,
        endpoint: record.endpoint,
        mode: record.mode,
        scenarioTitle: record.scenario_title,
        headline: record.headline,
        winner: record.winner,
        outputPreview: outputText,
        aiModel: record.ai_model,
        promptTokens: record.prompt_tokens,
        completionTokens: record.completion_tokens,
        totalTokens: record.total_tokens,
        cachedTokens: null,
        reasoningTokens: null,
      });
      const combatants = await getBattleReportGenerationCombatantsByGenerationId(record.id);
      return json({
        success: true,
        report: {
          id: record.id,
          startedAt: record.started_at,
          publicSince: record.public_since,
          headline: record.headline,
          winner: record.winner,
          username: record.username,
          note: record.note,
          mode: record.mode,
          scenarioTitle: record.scenario_title,
          language: record.language,
          storyLength: record.story_length,
          output: outputText,
          renderedReport: hydrated.report,
          liveBody: hydrated.liveBody ?? null,
          combatants: combatants.map((item) => ({ sortIndex: item.sort_index, name: item.name, type: item.type, teamId: item.team_id })),
        },
      });
    }

    const limit = clampInt(url.searchParams.get('limit'), 12, 1, 30);
    const offset = clampInt(url.searchParams.get('offset'), 0, 0, 100_000);
    const titleQuery = (url.searchParams.get('q') ?? '').trim().slice(0, 120);
    const sort = url.searchParams.get('sort') === 'published_at_asc' ? 'published_at_asc' : 'published_at_desc';
    const rows = await getPublicBattleReportGenerations(limit, offset, { titleQuery, sort });
    const records = [];
    for (const record of rows) {
      if (record.is_public !== 1 || record.status !== 'completed' || !isArenaRecord(record.endpoint, record.pvp_match_id)) continue;
      const safeOutput = await readSafeOutput(record);
      if (!safeOutput) continue;
      const hydrated = await hydrateBattleReportCardFromGenerationRecord({
        generationMode: record.generation_mode,
        endpoint: record.endpoint,
        mode: record.mode,
        scenarioTitle: record.scenario_title,
        headline: record.headline,
        winner: record.winner,
        outputPreview: safeOutput,
        aiModel: record.ai_model,
        promptTokens: record.prompt_tokens,
        completionTokens: record.completion_tokens,
        totalTokens: record.total_tokens,
        cachedTokens: null,
        reasoningTokens: null,
      });
      const readableExcerpt = (hydrated.liveBody || hydrated.report.article.body || safeOutput).trim();
      records.push({
        id: record.id,
        publicSince: record.public_since,
        startedAt: record.started_at,
        headline: record.headline,
        winner: record.winner,
        username: record.username,
        note: record.note,
        mode: record.mode,
        scenarioTitle: record.scenario_title,
        excerpt: readableExcerpt.slice(0, 280),
      });
    }
    return json({ success: true, records, page: { limit, offset, hasMore: rows.length === limit } });
  } catch (error) {
    console.error('读取公开战报失败:', error);
    return json({ error: '公开战报暂时不可用' }, 500);
  }
}

export default appRouteHandler;
