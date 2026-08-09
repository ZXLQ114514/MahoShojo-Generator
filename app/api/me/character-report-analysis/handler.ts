import { getRequestUrl } from '@/lib/request-url';
import { json, requireAuthUser } from '@/lib/pvp/server';
import {
  loadCharacterReportAnalysis,
  parseCharacterReportAnalysisFilters,
} from '@/lib/arena/character-report-analysis-data';

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

  const filters = parseCharacterReportAnalysisFilters({
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
    uploader: url.searchParams.get('uploader'),
    reportLimit: url.searchParams.get('reportLimit'),
  });
  const result = await loadCharacterReportAnalysis({ cardId, userId: auth.user.id, filters });
  if ('error' in result) return json({ error: result.error }, { status: result.status });
  return json({ success: true, analysis: result.analysis }, { status: 200 });
}

export const appRouteHandler = handler;
export default appRouteHandler;
