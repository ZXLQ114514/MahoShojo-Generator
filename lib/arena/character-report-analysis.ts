import type { BattleReportCharacterAnalysisRow } from '@/lib/database/battle-report-generations';
import type { BattleReportGenerationCombatantRow } from '@/lib/database/battle-report-generation-combatants';
import { extractCharacterReportFinalResult } from '@/lib/arena/character-report-analysis-output';

export type CharacterReportAnalysisCard = {
  id: string;
  name: string;
  description: string | null;
  type: string | null;
  updatedAt: string | null;
};

export type CharacterReportAnalysisFilters = {
  fromIso: string | null;
  toIso: string | null;
  uploaderUsername: string | null;
  reportLimit: number | null;
};

export type CharacterReportOutcome = 'win' | 'loss' | 'draw' | 'unknown';

export type CharacterReportTimelinePoint = {
  generationId: string;
  startedAt: string;
  username: string | null;
  mode: string;
  outcome: CharacterReportOutcome;
  cumulativeWins: number;
  cumulativeLosses: number;
  cumulativeDraws: number;
  cumulativeUnknowns: number;
  cumulativeWinRate: number | null;
  cumulativeKd: number | null;
  label: string;
};

export type CharacterReportBreakdownRow = {
  label: string;
  count: number;
  wins: number;
  losses: number;
  draws: number;
  unknowns: number;
  winRate: number | null;
};

export type CharacterReportAnalysisReportRow = {
  generationId: string;
  startedAt: string;
  username: string | null;
  userId: number | null;
  mode: string | null;
  winner: string | null;
  headline: string | null;
  note: string | null;
  finalResult?: string | null;
};

export type CharacterReportAnalysisRecord = {
  generationId: string;
  startedAt: string;
  username: string | null;
  mode: string;
  outcome: CharacterReportOutcome;
  finalResult: string | null;
};

export type CharacterReportAiSummary = {
  generationKey: string;
  generatedAt: string;
  model: string;
  conclusion: string;
  strengths: string[];
  weaknesses: string[];
  finalResultCount: number;
  isFallback: boolean;
};

export type CharacterReportAnalysisResult = {
  card: CharacterReportAnalysisCard;
  filters: CharacterReportAnalysisFilters;
  totalReports: number;
  includedReports: number;
  moreAvailable: boolean;
  wins: number;
  losses: number;
  draws: number;
  unknowns: number;
  decisiveReports: number;
  winRate: number | null;
  kills: number;
  deaths: number;
  kd: number | null;
  firstStartedAt: string | null;
  lastStartedAt: string | null;
  uploaders: string[];
  modeBreakdown: CharacterReportBreakdownRow[];
  uploaderBreakdown: CharacterReportBreakdownRow[];
  timeline: CharacterReportTimelinePoint[];
  records: CharacterReportAnalysisRecord[];
  finalResultCount: number;
  strengths: string[];
  weaknesses: string[];
  conclusion: string;
};

const DRAW_PATTERN = /平局|和局|无胜者|draw|tie|双方存活|无人获胜/i;

const normalizeText = (value: string | null | undefined): string =>
  (value ?? '').trim().replace(/[\u3000\s]+/g, '').toLocaleLowerCase();

const formatDateLabel = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('zh-CN');
};

const formatRate = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return '暂无';
  return `${value.toFixed(1)}%`;
};

const formatKd = (value: number | null): string => {
  if (value === null) return '∞';
  return value.toFixed(2);
};

const isDrawWinner = (winner: string | null | undefined): boolean => {
  const normalized = normalizeText(winner);
  return !normalized || DRAW_PATTERN.test(normalized);
};

const findWinnerCombatant = (
  winner: string,
  combatants: BattleReportGenerationCombatantRow[],
): BattleReportGenerationCombatantRow | null => {
  const winnerKey = normalizeText(winner);
  if (!winnerKey) return null;
  return [...combatants]
    .sort((a, b) => normalizeText(b.name).length - normalizeText(a.name).length)
    .find((combatant) => {
      const nameKey = normalizeText(combatant.name);
      return nameKey === winnerKey || winnerKey.includes(nameKey) || nameKey.includes(winnerKey);
    }) ?? null;
};

const parseTeamIdFromWinner = (winner: string): number | null => {
  const normalized = normalizeText(winner);
  if (!normalized) return null;
  const match = normalized.match(/(?:team|队伍|第)?(\d+)(?:队|组|号)?/i);
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
};

const resolveOutcome = (
  report: CharacterReportAnalysisReportRow,
  combatants: BattleReportGenerationCombatantRow[],
  card: CharacterReportAnalysisCard,
): CharacterReportOutcome => {
  const winnerText = report.winner?.trim() ?? '';
  if (isDrawWinner(winnerText)) return 'draw';

  const selectedRows = combatants.filter((combatant) => normalizeText(combatant.data_card_id) === normalizeText(card.id));
  const selectedRow = selectedRows[0] ?? null;
  if (!selectedRow) return 'unknown';

  const winnerCombatant = findWinnerCombatant(winnerText, combatants);
  if (winnerCombatant) {
    if (normalizeText(winnerCombatant.data_card_id) === normalizeText(card.id)) return 'win';
    if (selectedRow.team_id != null && winnerCombatant.team_id != null) {
      return selectedRow.team_id === winnerCombatant.team_id ? 'win' : 'loss';
    }
    if (normalizeText(winnerCombatant.name) === normalizeText(card.name)) return 'win';
    return 'loss';
  }

  const winnerTeamId = parseTeamIdFromWinner(winnerText);
  if (winnerTeamId != null && selectedRow.team_id != null) {
    return selectedRow.team_id === winnerTeamId ? 'win' : 'loss';
  }

  if (normalizeText(winnerText) === normalizeText(card.name)) return 'win';
  return 'unknown';
};

const buildBreakdown = (
  rows: Array<CharacterReportAnalysisRecord & { mode: string }>,
  keySelector: (row: CharacterReportAnalysisRecord & { mode: string }) => string,
): CharacterReportBreakdownRow[] => {
  const map = new Map<string, { count: number; wins: number; losses: number; draws: number; unknowns: number }>();

  for (const row of rows) {
    const key = keySelector(row) || '未知';
    const current = map.get(key) ?? { count: 0, wins: 0, losses: 0, draws: 0, unknowns: 0 };
    current.count += 1;
    if (row.outcome === 'win') current.wins += 1;
    else if (row.outcome === 'loss') current.losses += 1;
    else if (row.outcome === 'draw') current.draws += 1;
    else current.unknowns += 1;
    map.set(key, current);
  }

  return [...map.entries()]
    .map(([label, value]) => ({
      label,
      count: value.count,
      wins: value.wins,
      losses: value.losses,
      draws: value.draws,
      unknowns: value.unknowns,
      winRate: value.wins + value.losses > 0 ? (value.wins / (value.wins + value.losses)) * 100 : null,
    }))
    .sort((left, right) => right.count - left.count || right.wins - left.wins || left.label.localeCompare(right.label, 'zh-CN'));
};

const buildStrengths = (input: {
  reportCount: number;
  winRate: number | null;
  kd: number | null;
  recentWinRate: number | null;
  recentCount: number;
  recentDelta: number | null;
  dominantMode: CharacterReportBreakdownRow | null;
}): string[] => {
  const strengths: string[] = [];

  if (input.reportCount >= 5 && input.winRate !== null && input.winRate >= 60) {
    strengths.push(`整体胜率 ${input.winRate.toFixed(1)}%，正向样本占优。`);
  }
  if (input.kd !== null && input.kd >= 1.2) {
    strengths.push(`K/D ${input.kd.toFixed(2)}，击杀效率高于死亡效率。`);
  }
  if (input.recentCount >= 3 && input.recentWinRate !== null && input.winRate !== null && input.recentDelta !== null && input.recentDelta >= 10) {
    strengths.push(`最近 ${input.recentCount} 场的胜率高于整体，近期状态在回升。`);
  }
  if (input.dominantMode && input.dominantMode.count >= 3 && input.dominantMode.winRate !== null && input.dominantMode.winRate >= 60) {
    strengths.push(`在「${input.dominantMode.label}」模式下表现更强。`);
  }

  return strengths;
};

const buildWeaknesses = (input: {
  reportCount: number;
  winRate: number | null;
  kd: number | null;
  drawShare: number | null;
  recentWinRate: number | null;
  recentCount: number;
  recentDelta: number | null;
}): string[] => {
  const weaknesses: string[] = [];

  if (input.reportCount >= 5 && input.winRate !== null && input.winRate <= 45) {
    weaknesses.push(`整体胜率 ${input.winRate.toFixed(1)}%，决胜能力偏弱。`);
  }
  if (input.kd !== null && input.kd < 1) {
    weaknesses.push(`K/D ${input.kd.toFixed(2)}，死亡高于击杀，容错率偏低。`);
  }
  if (input.drawShare !== null && input.drawShare >= 0.25) {
    weaknesses.push(`平局占比偏高，说明战局收束效率还有提升空间。`);
  }
  if (input.recentCount >= 3 && input.recentWinRate !== null && input.winRate !== null && input.recentDelta !== null && input.recentDelta <= -10) {
    weaknesses.push(`最近 ${input.recentCount} 场表现低于整体，近期走势偏弱。`);
  }

  return weaknesses;
};

const buildConclusion = (input: {
  cardName: string;
  reportCount: number;
  includedReports: number;
  totalReports: number;
  winRate: number | null;
  kd: number | null;
  strengths: string[];
  weaknesses: string[];
}): string => {
  const winRateText = formatRate(input.winRate);
  const kdText = formatKd(input.kd);
  const scopeText = input.includedReports === input.totalReports
    ? `${input.includedReports} 场`
    : `${input.includedReports}/${input.totalReports} 场`;
  const strengthText = input.strengths[0] ?? '暂无明确优势';
  const weaknessText = input.weaknesses[0] ?? '暂无明显短板，但仍建议结合更多样本观察';
  return `${input.cardName} 在当前样本中共统计 ${scopeText} 匹配战报，胜率 ${winRateText}，K/D ${kdText}。${strengthText} ${weaknessText}`;
};

export const analyzeCharacterBattleReports = (input: {
  card: CharacterReportAnalysisCard;
  filters: CharacterReportAnalysisFilters;
  totalReports: number;
  uploaders: string[];
  reports: BattleReportCharacterAnalysisRow[];
  combatants: BattleReportGenerationCombatantRow[];
}): CharacterReportAnalysisResult => {
  const reportByGenerationId = new Map<string, BattleReportCharacterAnalysisRow>();
  for (const report of input.reports) {
    reportByGenerationId.set(report.generationId, report);
  }

  const combatantsByGenerationId = new Map<string, BattleReportGenerationCombatantRow[]>();
  for (const combatant of input.combatants) {
    const list = combatantsByGenerationId.get(combatant.generation_id) ?? [];
    list.push(combatant);
    combatantsByGenerationId.set(combatant.generation_id, list);
  }

  const rawRecords = [...reportByGenerationId.values()]
    .sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt) || left.generationId.localeCompare(right.generationId, 'zh-CN'))
    .map((report) => {
      const combatants = combatantsByGenerationId.get(report.generationId) ?? [];
      return {
        generationId: report.generationId,
        startedAt: report.startedAt,
        username: report.username,
        mode: (typeof report.mode === 'string' && report.mode.trim()) ? report.mode.trim() : '未知模式',
        outcome: resolveOutcome(report, combatants, input.card),
        finalResult: extractCharacterReportFinalResult({
          outputPreview: report.outputPreview,
          outputChars: report.outputChars,
          generationMode: report.generationMode,
          outputHasSensitiveWords: report.outputHasSensitiveWords,
          outputHasShieldWords: report.outputHasShieldWords,
        }),
      } as CharacterReportAnalysisRecord & { mode: string };
    });

  const records = [...rawRecords].sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt) || right.generationId.localeCompare(left.generationId, 'zh-CN'));
  const includedReports = records.length;
  const finalResultCount = records.filter((record) => Boolean(record.finalResult)).length;
  const wins = records.filter((record) => record.outcome === 'win').length;
  const losses = records.filter((record) => record.outcome === 'loss').length;
  const draws = records.filter((record) => record.outcome === 'draw').length;
  const unknowns = records.filter((record) => record.outcome === 'unknown').length;
  const decisiveReports = wins + losses;
  const winRate = decisiveReports > 0 ? (wins / decisiveReports) * 100 : null;
  const kills = wins;
  const deaths = losses;
  const kd = deaths > 0 ? kills / deaths : kills > 0 ? null : 0;
  const firstStartedAt = rawRecords[0]?.startedAt ?? null;
  const lastStartedAt = rawRecords[rawRecords.length - 1]?.startedAt ?? null;
  const recentRecords = rawRecords.slice(Math.max(0, rawRecords.length - 5));
  const recentWins = recentRecords.filter((record) => record.outcome === 'win').length;
  const recentLosses = recentRecords.filter((record) => record.outcome === 'loss').length;
  const recentDecisive = recentWins + recentLosses;
  const recentWinRate = recentDecisive > 0 ? (recentWins / recentDecisive) * 100 : null;
  const recentDelta = recentWinRate !== null && winRate !== null ? recentWinRate - winRate : null;
  const drawShare = includedReports > 0 ? draws / includedReports : null;

  const modeBreakdown = buildBreakdown(rawRecords, (row) => row.mode || '未知模式');
  const dominantMode = modeBreakdown[0] ?? null;
  const uploaderBreakdown = buildBreakdown(rawRecords, (row) => row.username?.trim() || '未知用户');
  const strengths = buildStrengths({
    reportCount: includedReports,
    winRate,
    kd,
    recentWinRate,
    recentCount: recentRecords.length,
    recentDelta,
    dominantMode,
  });
  const weaknesses = buildWeaknesses({
    reportCount: includedReports,
    winRate,
    kd,
    drawShare,
    recentWinRate,
    recentCount: recentRecords.length,
    recentDelta,
  });

  const timeline: CharacterReportTimelinePoint[] = rawRecords.map((record, index) => {
    const soFar = rawRecords.slice(0, index + 1);
    const cumulativeWins = soFar.filter((item) => item.outcome === 'win').length;
    const cumulativeLosses = soFar.filter((item) => item.outcome === 'loss').length;
    const cumulativeDraws = soFar.filter((item) => item.outcome === 'draw').length;
    const cumulativeUnknowns = soFar.filter((item) => item.outcome === 'unknown').length;
    const decisive = cumulativeWins + cumulativeLosses;
    const cumulativeWinRate = decisive > 0 ? (cumulativeWins / decisive) * 100 : null;
    const cumulativeKd = cumulativeLosses > 0 ? cumulativeWins / cumulativeLosses : cumulativeWins > 0 ? null : 0;
    return {
      generationId: record.generationId,
      startedAt: record.startedAt,
      username: record.username,
      mode: record.mode,
      outcome: record.outcome,
      cumulativeWins,
      cumulativeLosses,
      cumulativeDraws,
      cumulativeUnknowns,
      cumulativeWinRate,
      cumulativeKd,
      label: formatDateLabel(record.startedAt),
    };
  });

  const conclusion = buildConclusion({
    cardName: input.card.name,
    reportCount: includedReports,
    includedReports,
    totalReports: input.totalReports,
    winRate,
    kd,
    strengths,
    weaknesses,
  });

  return {
    card: input.card,
    filters: input.filters,
    totalReports: input.totalReports,
    includedReports,
    moreAvailable: input.totalReports > includedReports,
    wins,
    losses,
    draws,
    unknowns,
    decisiveReports,
    winRate,
    kills,
    deaths,
    kd,
    firstStartedAt,
    lastStartedAt,
    uploaders: input.uploaders,
    modeBreakdown,
    uploaderBreakdown,
    timeline,
    records,
    finalResultCount,
    strengths,
    weaknesses,
    conclusion,
  };
};
