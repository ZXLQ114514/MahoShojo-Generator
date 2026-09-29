import { json, requireAuthUser } from '@/lib/pvp/server';
import { isSameOriginRequest } from '@/lib/auth/request-security';
import { acquirePublicAiRateLimit, buildPublicAiRateLimitResponse } from '@/lib/ai/public-rate-limit';
import {
  generateCharacterReportAiSummary,
  isAllowedCharacterReportSummaryModel,
  normalizeCharacterReportSummaryModel,
} from '@/lib/arena/character-report-analysis-summary';
import {
  loadCharacterReportAnalysis,
  parseCharacterReportAnalysisFilters,
} from '@/lib/arena/character-report-analysis-data';

type SummaryRequestBody = {
  cardId?: unknown;
  model?: unknown;
  from?: unknown;
  to?: unknown;
  uploader?: unknown;
  reportLimit?: unknown;
  filters?: {
    from?: unknown;
    to?: unknown;
    uploader?: unknown;
    reportLimit?: unknown;
  } | null;
};

const readBody = async (req: Request): Promise<SummaryRequestBody | null> => {
  try {
    const value = await req.json();
    return value && typeof value === 'object' ? value as SummaryRequestBody : null;
  } catch {
    return null;
  }
};

const errorResponse = (message: string, status: number): Response => json({ error: message }, { status });

export async function POST(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);
  if (!isSameOriginRequest(req)) return errorResponse('跨站请求被拒绝', 403);

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const body = await readBody(req);
  if (!body) return errorResponse('请求体不是有效 JSON', 400);

  const cardId = typeof body.cardId === 'string' ? body.cardId.trim() : '';
  if (!cardId) return errorResponse('缺少 cardId', 400);

  const rawModel = body.model == null ? '' : typeof body.model === 'string' ? body.model.trim() : null;
  if (rawModel === null) return errorResponse('总结模型格式无效', 400);
  if (rawModel && !isAllowedCharacterReportSummaryModel(rawModel)) {
    return errorResponse('总结模型不在可用模型目录中', 400);
  }

  const filtersSource = body.filters ?? body;
  const filters = parseCharacterReportAnalysisFilters({
    from: filtersSource.from,
    to: filtersSource.to,
    uploader: filtersSource.uploader,
    reportLimit: filtersSource.reportLimit,
  });

  const rateLimit = await acquirePublicAiRateLimit({
    req,
    actionType: 'character_report_analysis_summary',
    providerMode: 'system',
  });
  if (!rateLimit.allowed) return buildPublicAiRateLimitResponse(rateLimit);

  try {
    const loaded = await loadCharacterReportAnalysis({ cardId, userId: auth.user.id, filters });
    if ('error' in loaded) return errorResponse(loaded.error, loaded.status);

    const summary = await generateCharacterReportAiSummary({
      analysis: loaded.analysis,
      model: normalizeCharacterReportSummaryModel(rawModel),
      username: auth.user.username,
    });

    return json({
      success: true,
      summary,
      // 返回规则字段但不覆盖它们，客户端可以在同一屏并列保留两种总结。
      ruleSummary: {
        conclusion: loaded.analysis.conclusion,
        strengths: loaded.analysis.strengths,
        weaknesses: loaded.analysis.weaknesses,
      },
      filters: loaded.analysis.filters,
    }, { status: 200 });
  } catch {
    // 不把上游错误原文回传，避免意外暴露供应商响应或内部配置。
    console.error('生成角色战报 AI 总结失败');
    return errorResponse('角色战报 AI 总结暂时不可用', 500);
  }
}

export const appRouteHandler = POST;
export default appRouteHandler;
