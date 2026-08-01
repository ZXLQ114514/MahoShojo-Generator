import {
  getBattleReportGenerationByIdLite,
  updateBattleReportGenerationNote,
  updateBattleReportGenerationOutputHasSensitiveWords,
} from '@/lib/database/battle-report-generations';
import {
  extractBattleReportGenerationErrorMessage,
  loadBattleReportGenerationOutputText,
} from '@/lib/arena/battle-report-record-utils';
import { getBattleReportGenerationCombatantsByGenerationId } from '@/lib/database/battle-report-generation-combatants';
import { parseGenerationCombatantsFallback } from '@/lib/database/arena-ratings';
import { isUserInPvpMatch } from '@/lib/database/pvp';
import { json, requireAuthUser } from '@/lib/pvp/server';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { applyShieldWords } from '@/lib/shield-word-filter';
import { getLargeObjectByOwnerRef } from '@/lib/database/large-objects';
import { deleteObject } from '@/lib/r2';

const getGenerationIdFromUrl = (url: string): string | null => {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    // /api/me/battle-reports/:generationId
    const idx = parts.findIndex((p) => p === 'battle-reports');
    if (idx === -1) return null;
    return parts[idx + 1] || null;
  } catch {
    return null;
  }
};

async function handler(req: Request): Promise<Response> {
  if (!['GET', 'PATCH', 'DELETE'].includes(req.method)) return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const generationId = getGenerationIdFromUrl(req.url);
  if (!generationId) return json({ error: '缺少 generationId' }, { status: 400 });

  const record = await getBattleReportGenerationByIdLite(generationId);
  if (!record) return json({ error: '记录不存在' }, { status: 404 });

  const isOwner = record.user_id === auth.user.id;
  const canReadByPvp = record.pvp_match_id ? await isUserInPvpMatch(record.pvp_match_id, auth.user.id) : false;
  if (!isOwner && !canReadByPvp) return json({ error: '无权限' }, { status: 403 });

  if (req.method === 'PATCH') {
    if (!isOwner) return json({ error: '只有上传者可以修改备注' }, { status: 403 });
    let body: { note?: unknown };
    try {
      body = await req.json() as { note?: unknown };
    } catch {
      return json({ error: '请求体不是合法 JSON' }, { status: 400 });
    }
    if (typeof body.note !== 'string') return json({ error: 'note 必须是字符串' }, { status: 400 });
    const note = body.note.trim().slice(0, 500) || null;
    if (record.is_public === 1) {
      const output = await loadBattleReportGenerationOutputText({
        generationId: record.id,
        outputPreview: record.output_preview,
        outputChars: record.output_chars,
      });
      const combined = `${note ?? ''}\n${output.outputText ?? ''}`;
      if (applyShieldWords(combined).hasShieldWords) return json({ error: '公开备注或战报正文包含屏蔽词，不能保存' }, { status: 422 });
      if ((await quickCheck(combined)).hasSensitiveWords) return json({ error: '公开备注或战报正文包含敏感内容，不能保存' }, { status: 422 });
    }
    const updated = await updateBattleReportGenerationNote(record.id, note);
    return updated ? json({ success: true, note }) : json({ error: '备注保存失败' }, { status: 503 });
  }

  if (req.method === 'DELETE') {
    if (!isOwner) return json({ error: '只有上传者可以删除自己的战报' }, { status: 403 });
    const largeObject = await getLargeObjectByOwnerRef('battle_report_generation_output', record.id);
    const deleted = await deleteBattleReportGenerationRecordFromRuntime(record.id);
    if (!deleted) return json({ error: '战报删除失败或已不存在' }, { status: 404 });
    if (largeObject?.r2_key) {
      const r2Result = await deleteObject(largeObject.r2_key);
      if (!r2Result.success) console.warn('删除用户战报 R2 正文失败:', record.id, r2Result.error);
    }
    return json({ success: true });
  }

  const tableCombatants = await getBattleReportGenerationCombatantsByGenerationId(generationId);
  const combatants = tableCombatants.length > 0 ? tableCombatants : parseGenerationCombatantsFallback(generationId, record.extra_json);

  const output = await loadBattleReportGenerationOutputText({
    generationId: record.id,
    outputPreview: record.output_preview,
    outputChars: record.output_chars,
  });
  const outputPreview = output.outputText || null;
  const hasPreviewText = Boolean(outputPreview && outputPreview.trim());

  let contentBlocked = record.output_has_sensitive_words === 1;
  if (hasPreviewText) {
    const sensitiveCheck = await quickCheck(outputPreview!);
    contentBlocked = Boolean(sensitiveCheck.hasSensitiveWords);
    await updateBattleReportGenerationOutputHasSensitiveWords(record.id, contentBlocked);
  }

  const canRegenerate = output.hasStoredOutput && !output.readError && !contentBlocked;
  const errorMessage = extractBattleReportGenerationErrorMessage(record.extra_json);

  return json({
    success: true,
    record: {
      id: record.id,
      startedAt: record.started_at,
      endedAt: record.ended_at,
      durationMs: record.duration_ms,
      status: record.status,
      endpoint: record.endpoint,
      generationMode: record.generation_mode,
      mode: record.mode,
      scenarioTitle: record.scenario_title,
      language: record.language,
      storyLength: record.story_length,
      headline: record.headline,
      winner: record.winner,
      username: record.username,
      note: record.note,
      isPublic: record.is_public === 1,
      outputPreview: contentBlocked ? null : outputPreview,
      hasPreview: Boolean(outputPreview && outputPreview.trim()) && !contentBlocked,
      contentBlocked,
      canRegenerate,
      outputSource: output.source,
      outputReadError: output.readError,
      errorMessage,
      outputHasShieldWords: Boolean(record.output_has_shield_words),
      pvpRoomId: record.pvp_room_id,
      pvpMatchId: record.pvp_match_id,
      pvpRoundId: record.pvp_round_id,
    },
    combatants: combatants.map((c) => ({
      sortIndex: c.sort_index,
      name: c.name,
      type: c.type,
      templateId: c.template_id,
      isNative: Boolean(c.is_native),
      isPreset: Boolean(c.is_preset),
      teamId: c.team_id,
      characterGuidance: typeof c.character_guidance === 'string' && c.character_guidance.trim() ? c.character_guidance : null,
      dataCardId: c.data_card_id,
      dataCardUpdatedAt: c.data_card_updated_at,
    })),
  });
}

const deleteBattleReportGenerationRecordFromRuntime = async (generationId: string): Promise<boolean> => {
  const { getDrizzleDbFromRuntime } = await import('@/lib/db/drizzle');
  const { deleteBattleReportGenerationRecord } = await import('@/lib/db/repositories/battle-report-generations');
  const db = getDrizzleDbFromRuntime();
  return db ? deleteBattleReportGenerationRecord(db, generationId) : false;
};

export const appRouteHandler = handler;
export default appRouteHandler;
