import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { listPublicBattleReportKDRows, type PublicBattleReportKDRow } from '@/lib/db/repositories/battle-report-generations';

const json = (payload: unknown, status = 200): Response => new Response(JSON.stringify(payload), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

const normalizeText = (value: string | null | undefined): string =>
  (value ?? '').trim().replace(/[\u3000\s]+/g, '').toLocaleLowerCase();

const isDraw = (winner: string | null): boolean => {
  const normalized = normalizeText(winner);
  return !normalized || /平局|和局|无胜者|draw|tie|双方存活|无人获胜/i.test(normalized);
};

const parseDateFilter = (value: string | null, endOfDay: boolean): string | undefined => {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return undefined;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? new Date(`${trimmed}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`)
    : new Date(trimmed);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

type CharacterStats = { name: string; kills: number; deaths: number; matches: number };

const buildStats = (rows: PublicBattleReportKDRow[]) => {
  const reports = new Map<string, {
    startedAt: string;
    winner: string;
    combatants: string[];
  }>();
  for (const row of rows) {
    const existing = reports.get(row.generationId) ?? {
      startedAt: row.startedAt,
      winner: row.winner?.trim() ?? '',
      combatants: [],
    };
    if (row.combatantName.trim()) existing.combatants.push(row.combatantName.trim());
    reports.set(row.generationId, existing);
  }

  const stats = new Map<string, CharacterStats>();
  const timeline: Array<{ generationId: string; startedAt: string; label: string; characters: Record<string, number | null> }> = [];
  let validReportCount = 0;
  const validReports = [...reports.entries()]
    .sort(([, a], [, b]) => a.startedAt.localeCompare(b.startedAt));

  for (const [generationId, report] of validReports) {
    if (isDraw(report.winner)) continue;
    const names = [...new Map(report.combatants.map((name) => [normalizeText(name), name])).values()];
    if (names.length < 2) continue;
    const winnerKey = normalizeText(report.winner);
    const winnerName = [...names]
      .sort((a, b) => normalizeText(b).length - normalizeText(a).length)
      .find((name) => normalizeText(name) === winnerKey || winnerKey.includes(normalizeText(name)) || normalizeText(name).includes(winnerKey));
    if (!winnerName) continue;
    validReportCount += 1;

    const winnerKeyForStats = normalizeText(winnerName);
    for (const name of names) {
      const key = normalizeText(name);
      const item = stats.get(key) ?? { name, kills: 0, deaths: 0, matches: 0 };
      item.name = item.name || name;
      item.matches += 1;
      if (key === winnerKeyForStats) item.kills += 1;
      else item.deaths += 1;
      stats.set(key, item);
    }

    const snapshot: Record<string, number | null> = {};
    for (const item of stats.values()) snapshot[item.name] = item.deaths === 0 ? null : item.kills / item.deaths;
    timeline.push({
      generationId,
      startedAt: report.startedAt,
      label: new Date(report.startedAt).toLocaleDateString('zh-CN'),
      characters: snapshot,
    });
  }

  const summary = [...stats.values()]
    .map((item) => ({ ...item, kd: item.deaths === 0 ? null : item.kills / item.deaths }))
    .sort((a, b) => ((b.kd ?? -1) - (a.kd ?? -1)) || (b.kills + b.deaths - a.kills - a.deaths) || a.name.localeCompare(b.name));
  return { summary, timeline, reportCount: validReportCount };
};

export async function appRouteHandler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  try {
    const url = new URL(req.url);
    const db = getDrizzleDbFromRuntime();
    if (!db) return json({ error: '数据库暂时不可用' }, 503);
    const username = (url.searchParams.get('username') ?? '').trim().slice(0, 80);
    const rows = await listPublicBattleReportKDRows(db, {
      fromIso: parseDateFilter(url.searchParams.get('from'), false),
      toIso: parseDateFilter(url.searchParams.get('to'), true),
      username: username || undefined,
    });
    const { summary, timeline, reportCount } = buildStats(rows);
    const uploaders = [...new Set(rows.map((row) => row.username?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b));
    return json({ success: true, reportCount, summary, timeline, uploaders });
  } catch (error) {
    console.error('读取公开战报角色 K/D 统计失败:', error);
    return json({ error: '公开战报统计暂时不可用' }, 500);
  }
}

export default appRouteHandler;
