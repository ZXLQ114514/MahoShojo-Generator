import { getDataCardById } from '@/lib/database/data-cards';
import {
  countBattleReportGenerationsByCharacterAnalysis,
  getBattleReportGenerationsByCharacterAnalysis,
  listBattleReportCharacterAnalysisUploaders,
  type BattleReportCharacterAnalysisRow,
} from '@/lib/database/battle-report-generations';
import { getBattleReportGenerationCombatantsByGenerationIds } from '@/lib/database/battle-report-generation-combatants';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { applyShieldWords } from '@/lib/shield-word-filter';
import { quickCheck } from '@/lib/sensitive-word-filter';
import {
  analyzeCharacterBattleReports,
  type CharacterReportAnalysisCard,
  type CharacterReportAnalysisFilters,
  type CharacterReportAnalysisResult,
} from '@/lib/arena/character-report-analysis';
import { extractCharacterReportFinalResult } from '@/lib/arena/character-report-analysis-output';

export type CharacterReportAnalysisLoadInput = {
  cardId: string;
  userId: number;
  filters: CharacterReportAnalysisFilters;
};

export type CharacterReportAnalysisLoadResult =
  | { analysis: CharacterReportAnalysisResult }
  | { error: string; status: number };

export const parseDateFilterValue = (value: unknown, endOfDay: boolean): string | null => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
    : trimmed;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
};

export const parseReportLimitValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return clampInt(value, 50, 1, 500);
  }
  const trimmed = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!trimmed || trimmed === 'all') return null;
  return clampInt(trimmed, 50, 1, 500);
};

export const parseCharacterReportAnalysisFilters = (input: {
  from?: unknown;
  to?: unknown;
  uploader?: unknown;
  reportLimit?: unknown;
}): CharacterReportAnalysisFilters => ({
  fromIso: parseDateFilterValue(input.from, false),
  toIso: parseDateFilterValue(input.to, true),
  uploaderUsername: (typeof input.uploader === 'string' ? input.uploader.trim().slice(0, 200) : '') || null,
  reportLimit: parseReportLimitValue(input.reportLimit),
});

export const removeUnsafeFinalResultPreviews = async (
  reports: BattleReportCharacterAnalysisRow[],
): Promise<BattleReportCharacterAnalysisRow[]> => {
  return Promise.all(reports.map(async (report) => {
    if (!report.outputPreview) return report;

    try {
      // 先检查原始预览，避免被解析器的替换结果掩盖原正文中的违规内容。
      if (report.outputHasShieldWords === true || applyShieldWords(report.outputPreview).hasShieldWords) {
        return { ...report, outputPreview: null };
      }
      // 只对将进入客户端和模型的最终结果复跑敏感词检查，避免把整篇战报重复送入过滤器。
      const finalResult = extractCharacterReportFinalResult(report);
      if (!finalResult) {
        return { ...report, outputPreview: null };
      }
      const sensitiveResult = await quickCheck(finalResult);
      if (sensitiveResult.hasSensitiveWords) return { ...report, outputPreview: null };
      // 不把解析后的文本写回，保留 outputChars 的原始正文截断语义。
      return report;
    } catch {
      // 内容安全检查或解析异常时默认不向客户端/模型暴露正文。
      return { ...report, outputPreview: null };
    }
  }));
};

export const loadCharacterReportAnalysis = async (
  input: CharacterReportAnalysisLoadInput,
): Promise<CharacterReportAnalysisLoadResult> => {
  const cardId = input.cardId.trim();
  if (!cardId) return { error: '缺少 cardId', status: 400 };

  const db = getDrizzleDbFromRuntime();
  if (!db) return { error: '数据库暂时不可用', status: 503 };

  const cardRow = await getDataCardById(cardId, false);
  if (!cardRow || cardRow.user_id !== input.userId) {
    return { error: '角色卡不存在或无权访问', status: 404 };
  }
  if (cardRow.type !== 'character') {
    return { error: '仅支持角色卡分析', status: 400 };
  }

  const baseFilter = {
    fromIso: input.filters.fromIso ?? undefined,
    toIso: input.filters.toIso ?? undefined,
  } as const;
  const analysisFilter = {
    fromIso: input.filters.fromIso ?? undefined,
    toIso: input.filters.toIso ?? undefined,
    uploaderUsername: input.filters.uploaderUsername ?? undefined,
    sort: 'started_at_desc' as const,
    viewerUserId: input.userId,
  };

  const [uploaders, totalReports, reports] = await Promise.all([
    listBattleReportCharacterAnalysisUploaders(cardId, baseFilter),
    countBattleReportGenerationsByCharacterAnalysis(cardId, analysisFilter),
    getBattleReportGenerationsByCharacterAnalysis(cardId, input.filters.reportLimit, 0, analysisFilter),
  ]);
  const safeReports = await removeUnsafeFinalResultPreviews(reports);
  const combatants = await getBattleReportGenerationCombatantsByGenerationIds(
    safeReports.map((report) => report.generationId),
  );

  const card = {
    id: cardRow.id,
    name: cardRow.name,
    description: typeof cardRow.description === 'string' ? cardRow.description : null,
    type: typeof cardRow.type === 'string' ? cardRow.type : null,
    updatedAt: typeof cardRow.updated_at === 'string' ? cardRow.updated_at : null,
  } satisfies CharacterReportAnalysisCard;

  return {
    analysis: analyzeCharacterBattleReports({
      card,
      filters: input.filters,
      totalReports,
      uploaders,
      reports: safeReports,
      combatants,
    }),
  };
};
