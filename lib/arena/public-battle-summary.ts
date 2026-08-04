import { z } from 'zod/v3';

import { generateWithAI } from '@/lib/ai';
import { getDrizzleDbFromRuntime, type AppDrizzleDb } from '@/lib/db/drizzle';
import { siteSettings } from '@/lib/db/schema';
import { eq, or } from 'drizzle-orm';
import { applyShieldWords } from '@/lib/shield-word-filter';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { listPublicBattleReportKDRows, type PublicBattleReportKDRow } from '@/lib/db/repositories/battle-report-generations';

export const PUBLIC_BATTLE_SUMMARY_SETTING_KEY = 'public_battle_summary';
export const PUBLIC_BATTLE_SUMMARY_INTERVAL_SETTING_KEY = 'public_battle_summary_interval_minutes';
export const PUBLIC_BATTLE_SUMMARY_MODEL_SETTING_KEY = 'public_battle_summary_model';
export const PUBLIC_BATTLE_SUMMARY_ENABLED_SETTING_KEY = 'public_battle_summary_enabled';

export const DEFAULT_PUBLIC_BATTLE_SUMMARY_SETTINGS = {
  intervalMinutes: 1440,
  model: '',
  enabled: true,
} as const;

export type PublicBattleSummarySettings = {
  intervalMinutes: number;
  model: string;
  enabled: boolean;
};

export type PublicBattleSummaryTier =
  | '超大杯上'
  | '超大杯下'
  | '大杯上'
  | '大杯下'
  | '中杯上'
  | '中杯下'
  | '小杯上'
  | '小杯下';

export type PublicBattleCharacterStats = {
  name: string;
  matches: number;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  winRate: number;
  kd: number | null;
  score: number;
  tier: PublicBattleSummaryTier;
  mechanism: string;
  reason: string;
};

export type PublicBattleSummary = {
  generatedAt: string;
  model: string;
  reportCount: number;
  characterCount: number;
  evaluations: PublicBattleCharacterStats[];
};

type AiEvaluation = {
  characterName: string;
  mechanism: string;
  reason: string;
};

const aiSchema = z.object({
  evaluations: z.array(z.object({
    characterName: z.string(),
    mechanism: z.string(),
    reason: z.string(),
  })).max(200),
});

const normalizeName = (value: string): string => value.trim().replace(/[\s\u3000]+/g, '').toLocaleLowerCase();

const isDraw = (winner: string | null): boolean => {
  const normalized = (winner ?? '').trim().replace(/[\s\u3000]+/g, '').toLocaleLowerCase();
  return !normalized || /平局|和局|无胜者|draw|tie|双方存活|无人获胜/i.test(normalized);
};

const findWinner = (winner: string, names: string[]): string | null => {
  const winnerKey = normalizeName(winner);
  if (!winnerKey) return null;
  return [...names]
    .sort((a, b) => normalizeName(b).length - normalizeName(a).length)
    .find((name) => {
      const nameKey = normalizeName(name);
      return nameKey === winnerKey || winnerKey.includes(nameKey) || nameKey.includes(winnerKey);
    }) ?? null;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const getPublicBattleSummaryTier = (score: number): PublicBattleSummaryTier => {
  if (score >= 90) return '超大杯上';
  if (score >= 80) return '超大杯下';
  if (score >= 70) return '大杯上';
  if (score >= 60) return '大杯下';
  if (score >= 50) return '中杯上';
  if (score >= 40) return '中杯下';
  if (score >= 25) return '小杯上';
  return '小杯下';
};

const buildScore = (matches: number, wins: number, kills: number, deaths: number): number => {
  // 拉普拉斯平滑避免一场偶然胜利直接得到最高评价。
  const smoothedWinRate = (wins + 1) / (matches + 2);
  const smoothedKd = (kills + 1) / (deaths + 1);
  const sampleScore = Math.min(matches / 10, 1) * 10;
  return Math.round(clamp(smoothedWinRate * 55 + (smoothedKd / (smoothedKd + 1)) * 35 + sampleScore, 0, 100));
};

const buildMechanism = (stats: { matches: number; wins: number; losses: number; kills: number; deaths: number; winRate: number; kd: number | null }): string => {
  const kdText = stats.kd === null ? '∞' : stats.kd.toFixed(2);
  return `固定机制：综合分 = 平滑胜率 55% + 平滑 K/D 35% + 样本量 10%；当前 ${stats.matches} 场，胜 ${stats.wins}，负 ${stats.losses}，击杀 ${stats.kills}，死亡 ${stats.deaths}，胜率 ${stats.winRate.toFixed(1)}%，K/D ${kdText}。胜率和 K/D 使用平滑计算，样本不足会被压低。`;
};

export const buildPublicBattleCharacterStats = (rows: PublicBattleReportKDRow[]): { reportCount: number; characters: Omit<PublicBattleCharacterStats, 'mechanism' | 'reason'>[] } => {
  const reports = new Map<string, { winner: string; combatants: string[] }>();
  for (const row of rows) {
    const report = reports.get(row.generationId) ?? { winner: row.winner?.trim() ?? '', combatants: [] };
    if (row.combatantName.trim()) report.combatants.push(row.combatantName.trim());
    reports.set(row.generationId, report);
  }

  const stats = new Map<string, { name: string; matches: number; wins: number; losses: number; kills: number; deaths: number }>();
  let reportCount = 0;
  for (const report of reports.values()) {
    if (isDraw(report.winner)) continue;
    const names = [...new Map(report.combatants.map((name) => [normalizeName(name), name])).values()];
    if (names.length < 2) continue;
    const winner = findWinner(report.winner, names);
    if (!winner) continue;
    reportCount += 1;
    for (const name of names) {
      const key = normalizeName(name);
      const current = stats.get(key) ?? { name, matches: 0, wins: 0, losses: 0, kills: 0, deaths: 0 };
      current.matches += 1;
      if (key === normalizeName(winner)) {
        current.wins += 1;
        current.kills += 1;
      } else {
        current.losses += 1;
        current.deaths += 1;
      }
      stats.set(key, current);
    }
  }

  const characters = [...stats.values()].map((item) => {
    const winRate = item.matches > 0 ? (item.wins / item.matches) * 100 : 0;
    const kd = item.deaths > 0 ? item.kills / item.deaths : item.kills > 0 ? null : 0;
    const score = buildScore(item.matches, item.wins, item.kills, item.deaths);
    return {
      ...item,
      winRate,
      kd,
      score,
      tier: getPublicBattleSummaryTier(score),
    };
  }).sort((a, b) => b.score - a.score || b.matches - a.matches || a.name.localeCompare(b.name));

  return { reportCount, characters };
};

const safeAiText = async (value: string, fallback: string): Promise<string> => {
  const filtered = applyShieldWords(value.trim()).filteredText.trim();
  if (!filtered) return fallback;
  const checked = await quickCheck(filtered);
  return checked.hasSensitiveWords ? fallback : filtered.slice(0, 500);
};

export const getPublicBattleSummarySettings = async (db: AppDrizzleDb | null): Promise<PublicBattleSummarySettings> => {
  if (!db) return { ...DEFAULT_PUBLIC_BATTLE_SUMMARY_SETTINGS };
  try {
    const rows = await db.select({ key: siteSettings.key, value: siteSettings.value }).from(siteSettings).where(
      sqlOrSettingKeys(),
    );
    const values = new Map(rows.map((row) => [row.key, row.value]));
    const interval = Number(values.get(PUBLIC_BATTLE_SUMMARY_INTERVAL_SETTING_KEY));
    return {
      intervalMinutes: Number.isFinite(interval) ? clamp(Math.trunc(interval), 5, 10080) : DEFAULT_PUBLIC_BATTLE_SUMMARY_SETTINGS.intervalMinutes,
      model: values.get(PUBLIC_BATTLE_SUMMARY_MODEL_SETTING_KEY)?.trim() ?? DEFAULT_PUBLIC_BATTLE_SUMMARY_SETTINGS.model,
      enabled: values.get(PUBLIC_BATTLE_SUMMARY_ENABLED_SETTING_KEY) !== 'false',
    };
  } catch {
    return { ...DEFAULT_PUBLIC_BATTLE_SUMMARY_SETTINGS };
  }
};

const sqlOrSettingKeys = () => {
  // 在这里延迟构造条件，避免把配置 key 散落到管理员和公开接口。
  return or(
    eq(siteSettings.key, PUBLIC_BATTLE_SUMMARY_INTERVAL_SETTING_KEY),
    eq(siteSettings.key, PUBLIC_BATTLE_SUMMARY_MODEL_SETTING_KEY),
    eq(siteSettings.key, PUBLIC_BATTLE_SUMMARY_ENABLED_SETTING_KEY),
  )!;
};

export const setPublicBattleSummarySettings = async (db: AppDrizzleDb, userId: number, input: PublicBattleSummarySettings): Promise<void> => {
  const values = [
    { key: PUBLIC_BATTLE_SUMMARY_INTERVAL_SETTING_KEY, value: String(clamp(Math.trunc(input.intervalMinutes), 5, 10080)) },
    { key: PUBLIC_BATTLE_SUMMARY_MODEL_SETTING_KEY, value: input.model.trim().slice(0, 120) },
    { key: PUBLIC_BATTLE_SUMMARY_ENABLED_SETTING_KEY, value: input.enabled ? 'true' : 'false' },
  ];
  for (const setting of values) {
    await db.insert(siteSettings).values({ key: setting.key, value: setting.value, updatedByUserId: userId, updatedAt: new Date().toISOString() }).onConflictDoUpdate({
      target: siteSettings.key,
      set: { value: setting.value, updatedByUserId: userId, updatedAt: new Date().toISOString() },
    });
  }
};

export const getStoredPublicBattleSummary = async (db: AppDrizzleDb | null): Promise<PublicBattleSummary | null> => {
  if (!db) return null;
  const row = await db.select({ value: siteSettings.value }).from(siteSettings).where(eq(siteSettings.key, PUBLIC_BATTLE_SUMMARY_SETTING_KEY)).limit(1);
  if (!row[0]?.value) return null;
  try {
    const parsed = JSON.parse(row[0].value) as PublicBattleSummary;
    return parsed && Array.isArray(parsed.evaluations) ? parsed : null;
  } catch {
    return null;
  }
};

export const setStoredPublicBattleSummary = async (db: AppDrizzleDb, userId: number | null, summary: PublicBattleSummary): Promise<void> => {
  const value = JSON.stringify(summary);
  await db.insert(siteSettings).values({ key: PUBLIC_BATTLE_SUMMARY_SETTING_KEY, value, updatedByUserId: userId, updatedAt: new Date().toISOString() }).onConflictDoUpdate({
    target: siteSettings.key,
    set: { value, updatedByUserId: userId, updatedAt: new Date().toISOString() },
  });
};

export const generatePublicBattleSummary = async (input: { model?: string; username?: string | null }): Promise<PublicBattleSummary> => {
  const db = getDrizzleDbFromRuntime();
  if (!db) throw new Error('总结服务暂不可用');
  const stats = buildPublicBattleCharacterStats(await listPublicBattleReportKDRows(db));
  const model = input.model?.trim() ?? '';
  const aiResult = stats.characters.length === 0
    ? { evaluations: [] as AiEvaluation[] }
    : await generateWithAI(
      { stats: stats.characters },
      {
        systemPrompt: '你是公开竞技场数据分析师。只根据提供的统计数据，为每个角色写简短、具体、可核验的评价理由和战斗机制。不得改变数值、等级或虚构没有给出的事件。',
        temperature: 0.2,
        taskName: '公开战报角色评价总结',
        schema: aiSchema,
        promptBuilder: (value) => `请为以下每个角色生成评价。只返回 JSON。机制必须解释胜率、K/D 和样本量如何影响评价；理由必须引用给出的数值。不要输出 Markdown。\n${JSON.stringify(value.stats)}`,
        ...(model ? { modelOverride: model } : {}),
      },
      { loadBalanceStrategy: model ? undefined : undefined, username: input.username ?? '匿名用户' },
    );

  const aiMap = new Map(aiResult.evaluations.map((item) => [normalizeName(item.characterName), item]));
  const evaluations: PublicBattleCharacterStats[] = [];
  for (const item of stats.characters) {
    const ai = aiMap.get(normalizeName(item.name));
    const fallbackReason = `${item.name} 当前 ${item.matches} 场中获胜 ${item.wins} 场，胜率 ${item.winRate.toFixed(1)}%，综合分 ${item.score}，归入${item.tier}。`;
    evaluations.push({
      ...item,
      mechanism: await safeAiText(ai?.mechanism ?? '', buildMechanism(item)),
      reason: await safeAiText(ai?.reason ?? '', fallbackReason),
    });
  }
  return {
    generatedAt: new Date().toISOString(),
    model: model || '系统默认配置',
    reportCount: stats.reportCount,
    characterCount: evaluations.length,
    evaluations,
  };
};
