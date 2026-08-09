import { and, asc, count, desc, eq, exists, gte, isNotNull, isNull, like, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { battleReportGenerationCombatants, battleReportGenerations, largeObjects, pvpMatchPlayers } from '@/lib/db/schema';

export type BattleReportGenerationStatus = 'completed' | 'aborted' | 'failed';
export type BattleReportGenerationMode = 'stream' | 'non-stream';
export type BattleReportGenerationListSort = 'started_at_desc' | 'started_at_asc';
export type BattleReportPublicListSort = 'published_at_desc' | 'published_at_asc';
export type BattleReportCharacterAnalysisSort = 'started_at_desc' | 'started_at_asc';

export type BattleReportGenerationsListFilter = {
  status?: BattleReportGenerationStatus;
  mode?: string;
  generationMode?: BattleReportGenerationMode;
  pvpOnly?: boolean;
  titleQuery?: string;
  sort?: BattleReportGenerationListSort;
};

export type BattleReportPublicListFilter = {
  titleQuery?: string;
  sort?: BattleReportPublicListSort;
};

export type BattleReportCharacterAnalysisFilter = {
  fromIso?: string;
  toIso?: string;
  uploaderUsername?: string;
  sort?: BattleReportCharacterAnalysisSort;
  /** 仅用于裁剪战报正文，不影响既有统计范围。 */
  viewerUserId?: number;
};

export type PublicBattleReportKDRow = {
  generationId: string;
  startedAt: string;
  publicSince: string | null;
  username: string | null;
  winner: string | null;
  combatantName: string;
};

export type BattleReportCharacterAnalysisRow = {
  generationId: string;
  startedAt: string;
  username: string | null;
  userId: number | null;
  mode: string;
  generationMode: BattleReportGenerationMode;
  winner: string | null;
  headline: string | null;
  note: string | null;
  outputPreview: string | null;
  outputChars: number | null;
  outputHasSensitiveWords: boolean | null;
  outputHasShieldWords: boolean | null;
};

export type BattleReportGenerationInsert = {
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: BattleReportGenerationStatus;
  generationMode: BattleReportGenerationMode;
  endpoint: string;
  ip?: string | null;
  ipAnonymized?: string | null;
  userAgent?: string | null;
  referer?: string | null;
  acceptLanguage?: string | null;
  cfRay?: string | null;
  cfCountry?: string | null;
  userId?: number | null;
  username?: string | null;
  userPrefix?: string | null;
  mode: string;
  scenarioTitle?: string | null;
  scenarioDataCardId?: string | null;
  scenarioDataCardUpdatedAt?: string | null;
  language?: string | null;
  selectedLevel?: string | null;
  storyLength?: string | null;
  readArenaHistory?: boolean | null;
  arenaHistoryReadLimit?: number | null;
  writeArenaHistory?: boolean | null;
  readCurrentState?: boolean | null;
  writeCurrentState?: boolean | null;
  combatantCount?: number | null;
  hasScenario?: boolean | null;
  hasUserGuidance?: boolean | null;
  hasAdjudicationEvents?: boolean | null;
  hasTeams?: boolean | null;
  inputChars?: number | null;
  inputBytes?: number | null;
  userGuidancePreview?: string | null;
  adjudicationEventsPreview?: string | null;
  customProviderId?: string | null;
  customModelId?: string | null;
  isDowngrade?: boolean | null;
  aiProviderName?: string | null;
  aiProviderType?: string | null;
  aiModel?: string | null;
  headline?: string | null;
  winner?: string | null;
  note?: string | null;
  outputChars?: number | null;
  outputBytes?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  cachedTokens?: number | null;
  reasoningTokens?: number | null;
  outputPreview?: string | null;
  outputHasSensitiveWords?: boolean | null;
  outputHasShieldWords?: boolean | null;
  pvpRoomId?: string | null;
  pvpMatchId?: string | null;
  pvpRoundId?: string | null;
  extraJson?: Record<string, unknown> | null;
};

export type BattleReportGenerationRowLite = {
  id: string;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  status: BattleReportGenerationStatus;
  generation_mode: BattleReportGenerationMode;
  endpoint: string;
  user_id: number | null;
  username: string | null;
  mode: string;
  scenario_title: string | null;
  ai_model: string | null;
  scenario_data_card_id: string | null;
  scenario_data_card_updated_at: string | null;
  language: string | null;
  selected_level: string | null;
  story_length: string | null;
  headline: string | null;
  winner: string | null;
  note: string | null;
  output_chars: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cached_tokens: number | null;
  reasoning_tokens: number | null;
  output_preview: string | null;
  output_has_sensitive_words: number | null;
  output_has_shield_words: number | null;
  is_public: number;
  public_since: string | null;
  extra_json: string | null;
  pvp_room_id: string | null;
  pvp_match_id: string | null;
  pvp_round_id: string | null;
  created_at: string;
  updated_at: string;
};

export type BattleReportCountsByStatus = {
  total: number;
  completed: number;
  aborted: number;
  failed: number;
};

const boolToIntOrNull = (value: boolean | null | undefined): number | null => {
  if (typeof value !== 'boolean') return null;
  return value ? 1 : 0;
};

const toInt = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
};

const toIntOrNull = (value: unknown): number | null => {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
};

const toBoolOrNull = (value: unknown): boolean | null => {
  if (value == null) return null;
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  return null;
};

const buildWhereForListQuery = (
  userId: number,
  filter?: BattleReportGenerationsListFilter,
) => {
  const conditions = [eq(battleReportGenerations.userId, userId)];

  const status = filter?.status;
  if (status === 'completed' || status === 'aborted' || status === 'failed') {
    conditions.push(eq(battleReportGenerations.status, status));
  }

  const generationMode = filter?.generationMode;
  if (generationMode === 'stream' || generationMode === 'non-stream') {
    conditions.push(eq(battleReportGenerations.generationMode, generationMode));
  }

  const mode = typeof filter?.mode === 'string' ? filter.mode.trim() : '';
  if (mode) {
    conditions.push(eq(battleReportGenerations.mode, mode));
  }

  if (filter?.pvpOnly) {
    conditions.push(isNotNull(battleReportGenerations.pvpMatchId));
  }

  const titleQuery = typeof filter?.titleQuery === 'string' ? filter.titleQuery.trim() : '';
  if (titleQuery) {
    const safe = titleQuery.length > 120 ? titleQuery.slice(0, 120) : titleQuery;
    const pattern = `%${safe}%`;
    conditions.push(
      or(
        like(battleReportGenerations.headline, pattern),
        like(battleReportGenerations.scenarioTitle, pattern),
      )!,
    );
  }

  return and(...conditions)!;
};

const mapLiteRow = (row: {
  id: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: string;
  generationMode: string;
  endpoint: string;
  userId: number | null;
  username: string | null;
  mode: string | null;
  scenarioTitle: string | null;
  aiModel: string | null;
  scenarioDataCardId: string | null;
  scenarioDataCardUpdatedAt: string | null;
  language: string | null;
  selectedLevel: string | null;
  storyLength: string | null;
  headline: string | null;
  winner: string | null;
  note: string | null;
  outputChars: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cachedTokens: number | null;
  reasoningTokens: number | null;
  outputPreview: string | null;
  outputHasSensitiveWords: number | null;
  outputHasShieldWords: number | null;
  isPublic: number | null;
  publicSince: string | null;
  extraJson: string | null;
  pvpRoomId: string | null;
  pvpMatchId: string | null;
  pvpRoundId: string | null;
  createdAt: string;
  updatedAt: string;
}): BattleReportGenerationRowLite => ({
  id: row.id,
  started_at: row.startedAt,
  ended_at: row.endedAt,
  duration_ms: toInt(row.durationMs, 0),
  status: (row.status === 'aborted' || row.status === 'failed' ? row.status : 'completed') as BattleReportGenerationStatus,
  generation_mode: (row.generationMode === 'non-stream' ? 'non-stream' : 'stream') as BattleReportGenerationMode,
  endpoint: row.endpoint,
  user_id: toIntOrNull(row.userId),
  username: row.username,
  mode: row.mode ?? '',
  scenario_title: row.scenarioTitle,
  ai_model: row.aiModel,
  scenario_data_card_id: row.scenarioDataCardId,
  scenario_data_card_updated_at: row.scenarioDataCardUpdatedAt,
  language: row.language,
  selected_level: row.selectedLevel,
  story_length: row.storyLength,
  headline: row.headline,
  winner: row.winner,
  note: row.note,
  output_chars: toIntOrNull(row.outputChars),
  prompt_tokens: toIntOrNull(row.promptTokens),
  completion_tokens: toIntOrNull(row.completionTokens),
  total_tokens: toIntOrNull(row.totalTokens),
  cached_tokens: toIntOrNull(row.cachedTokens),
  reasoning_tokens: toIntOrNull(row.reasoningTokens),
  output_preview: row.outputPreview,
  output_has_sensitive_words: toIntOrNull(row.outputHasSensitiveWords),
  output_has_shield_words: toIntOrNull(row.outputHasShieldWords),
  is_public: toInt(row.isPublic, 0),
  public_since: row.publicSince,
  extra_json: row.extraJson,
  pvp_room_id: row.pvpRoomId,
  pvp_match_id: row.pvpMatchId,
  pvp_round_id: row.pvpRoundId,
  created_at: row.createdAt,
  updated_at: row.updatedAt,
});

export const insertBattleReportGenerationRecord = async (
  db: AppDrizzleDb,
  id: string,
  payload: BattleReportGenerationInsert,
  nowIso: string,
): Promise<boolean> => {
  const inserted = await db
    .insert(battleReportGenerations)
    .values({
      id,
      startedAt: payload.startedAt,
      endedAt: payload.endedAt,
      durationMs: payload.durationMs,
      status: payload.status,
      generationMode: payload.generationMode,
      endpoint: payload.endpoint,
      ip: payload.ip ?? null,
      ipAnonymized: payload.ipAnonymized ?? null,
      userAgent: payload.userAgent ?? null,
      referer: payload.referer ?? null,
      acceptLanguage: payload.acceptLanguage ?? null,
      cfRay: payload.cfRay ?? null,
      cfCountry: payload.cfCountry ?? null,
      userId: payload.userId ?? null,
      username: payload.username ?? null,
      userPrefix: payload.userPrefix ?? null,
      mode: payload.mode,
      scenarioTitle: payload.scenarioTitle ?? null,
      scenarioDataCardId: payload.scenarioDataCardId ?? null,
      scenarioDataCardUpdatedAt: payload.scenarioDataCardUpdatedAt ?? null,
      language: payload.language ?? null,
      selectedLevel: payload.selectedLevel ?? null,
      storyLength: payload.storyLength ?? null,
      readArenaHistory: boolToIntOrNull(payload.readArenaHistory),
      arenaHistoryReadLimit: payload.arenaHistoryReadLimit ?? null,
      writeArenaHistory: boolToIntOrNull(payload.writeArenaHistory),
      readCurrentState: boolToIntOrNull(payload.readCurrentState),
      writeCurrentState: boolToIntOrNull(payload.writeCurrentState),
      combatantCount: payload.combatantCount ?? null,
      hasScenario: boolToIntOrNull(payload.hasScenario),
      hasUserGuidance: boolToIntOrNull(payload.hasUserGuidance),
      hasAdjudicationEvents: boolToIntOrNull(payload.hasAdjudicationEvents),
      hasTeams: boolToIntOrNull(payload.hasTeams),
      inputChars: payload.inputChars ?? null,
      inputBytes: payload.inputBytes ?? null,
      userGuidancePreview: payload.userGuidancePreview ?? null,
      adjudicationEventsPreview: payload.adjudicationEventsPreview ?? null,
      customProviderId: payload.customProviderId ?? null,
      customModelId: payload.customModelId ?? null,
      isDowngrade: boolToIntOrNull(payload.isDowngrade),
      aiProviderName: payload.aiProviderName ?? null,
      aiProviderType: payload.aiProviderType ?? null,
      aiModel: payload.aiModel ?? null,
      headline: payload.headline ?? null,
      winner: payload.winner ?? null,
      note: payload.note ?? null,
      outputChars: payload.outputChars ?? null,
      outputBytes: payload.outputBytes ?? null,
      promptTokens: payload.promptTokens ?? null,
      completionTokens: payload.completionTokens ?? null,
      totalTokens: payload.totalTokens ?? null,
      cachedTokens: payload.cachedTokens ?? null,
      reasoningTokens: payload.reasoningTokens ?? null,
      outputPreview: payload.outputPreview ?? null,
      outputHasSensitiveWords: boolToIntOrNull(payload.outputHasSensitiveWords),
      outputHasShieldWords: boolToIntOrNull(payload.outputHasShieldWords),
      pvpRoomId: payload.pvpRoomId ?? null,
      pvpMatchId: payload.pvpMatchId ?? null,
      pvpRoundId: payload.pvpRoundId ?? null,
      extraJson: payload.extraJson ? JSON.stringify(payload.extraJson) : null,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .returning({
      id: battleReportGenerations.id,
    });

  return inserted.length > 0;
};

export const updateBattleReportGenerationOutputPreview = async (
  db: AppDrizzleDb,
  generationId: string,
  outputPreview: string | null,
  nowIso: string,
): Promise<boolean> => {
  const updated = await db
    .update(battleReportGenerations)
    .set({
      outputPreview,
      updatedAt: nowIso,
    })
    .where(eq(battleReportGenerations.id, generationId))
    .returning({
      id: battleReportGenerations.id,
    });

  return updated.length > 0;
};

export const getBattleReportGenerationByIdLite = async (
  db: AppDrizzleDb,
  generationId: string,
): Promise<BattleReportGenerationRowLite | null> => {
  const rows = await db
    .select({
      id: battleReportGenerations.id,
      startedAt: battleReportGenerations.startedAt,
      endedAt: battleReportGenerations.endedAt,
      durationMs: battleReportGenerations.durationMs,
      status: battleReportGenerations.status,
      generationMode: battleReportGenerations.generationMode,
      endpoint: battleReportGenerations.endpoint,
      userId: battleReportGenerations.userId,
      username: battleReportGenerations.username,
      mode: battleReportGenerations.mode,
      scenarioTitle: battleReportGenerations.scenarioTitle,
      aiModel: battleReportGenerations.aiModel,
      scenarioDataCardId: battleReportGenerations.scenarioDataCardId,
      scenarioDataCardUpdatedAt: battleReportGenerations.scenarioDataCardUpdatedAt,
      language: battleReportGenerations.language,
      selectedLevel: battleReportGenerations.selectedLevel,
      storyLength: battleReportGenerations.storyLength,
      headline: battleReportGenerations.headline,
      winner: battleReportGenerations.winner,
      note: battleReportGenerations.note,
      outputChars: battleReportGenerations.outputChars,
      promptTokens: battleReportGenerations.promptTokens,
      completionTokens: battleReportGenerations.completionTokens,
      totalTokens: battleReportGenerations.totalTokens,
      cachedTokens: battleReportGenerations.cachedTokens,
      reasoningTokens: battleReportGenerations.reasoningTokens,
      outputPreview: battleReportGenerations.outputPreview,
      outputHasSensitiveWords: battleReportGenerations.outputHasSensitiveWords,
      outputHasShieldWords: battleReportGenerations.outputHasShieldWords,
      isPublic: battleReportGenerations.isPublic,
      publicSince: battleReportGenerations.publicSince,
      extraJson: battleReportGenerations.extraJson,
      pvpRoomId: battleReportGenerations.pvpRoomId,
      pvpMatchId: battleReportGenerations.pvpMatchId,
      pvpRoundId: battleReportGenerations.pvpRoundId,
      createdAt: battleReportGenerations.createdAt,
      updatedAt: battleReportGenerations.updatedAt,
    })
    .from(battleReportGenerations)
    .where(eq(battleReportGenerations.id, generationId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return mapLiteRow(row);
};

export const listBattleReportGenerationsByUserIdLite = async (
  db: AppDrizzleDb,
  userId: number,
  limit: number,
  offset: number,
  filter?: BattleReportGenerationsListFilter,
): Promise<BattleReportGenerationRowLite[]> => {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const safeOffset = Math.max(0, Math.floor(offset));
  const where = buildWhereForListQuery(userId, filter);
  const sort = filter?.sort === 'started_at_asc' ? 'started_at_asc' : 'started_at_desc';

  const rows = await db
    .select({
      id: battleReportGenerations.id,
      startedAt: battleReportGenerations.startedAt,
      endedAt: battleReportGenerations.endedAt,
      durationMs: battleReportGenerations.durationMs,
      status: battleReportGenerations.status,
      generationMode: battleReportGenerations.generationMode,
      endpoint: battleReportGenerations.endpoint,
      userId: battleReportGenerations.userId,
      username: battleReportGenerations.username,
      mode: battleReportGenerations.mode,
      scenarioTitle: battleReportGenerations.scenarioTitle,
      aiModel: battleReportGenerations.aiModel,
      scenarioDataCardId: battleReportGenerations.scenarioDataCardId,
      scenarioDataCardUpdatedAt: battleReportGenerations.scenarioDataCardUpdatedAt,
      language: battleReportGenerations.language,
      selectedLevel: battleReportGenerations.selectedLevel,
      storyLength: battleReportGenerations.storyLength,
      headline: battleReportGenerations.headline,
      winner: battleReportGenerations.winner,
      note: battleReportGenerations.note,
      outputChars: battleReportGenerations.outputChars,
      promptTokens: battleReportGenerations.promptTokens,
      completionTokens: battleReportGenerations.completionTokens,
      totalTokens: battleReportGenerations.totalTokens,
      cachedTokens: battleReportGenerations.cachedTokens,
      reasoningTokens: battleReportGenerations.reasoningTokens,
      outputPreview: battleReportGenerations.outputPreview,
      outputHasSensitiveWords: battleReportGenerations.outputHasSensitiveWords,
      outputHasShieldWords: battleReportGenerations.outputHasShieldWords,
      isPublic: battleReportGenerations.isPublic,
      publicSince: battleReportGenerations.publicSince,
      extraJson: battleReportGenerations.extraJson,
      pvpRoomId: battleReportGenerations.pvpRoomId,
      pvpMatchId: battleReportGenerations.pvpMatchId,
      pvpRoundId: battleReportGenerations.pvpRoundId,
      createdAt: battleReportGenerations.createdAt,
      updatedAt: battleReportGenerations.updatedAt,
    })
    .from(battleReportGenerations)
    .where(where)
    .orderBy(sort === 'started_at_asc' ? asc(battleReportGenerations.startedAt) : desc(battleReportGenerations.startedAt))
    .limit(safeLimit)
    .offset(safeOffset);

  return rows.map(mapLiteRow);
};

export const countBattleReportGenerationsByUserId = async (
  db: AppDrizzleDb,
  userId: number,
  filter?: BattleReportGenerationsListFilter,
): Promise<number> => {
  const rows = await db
    .select({ total: count() })
    .from(battleReportGenerations)
    .where(buildWhereForListQuery(userId, filter));

  return Math.max(0, toInt(rows[0]?.total, 0));
};

export const updateBattleReportGenerationCombatantsWriteResult = async (
  db: AppDrizzleDb,
  id: string,
  payload: { ok: boolean; expectedRows: number; errorMessage?: string | null },
  nowIso: string,
): Promise<boolean> => {
  const updated = await db
    .update(battleReportGenerations)
    .set({
      combatantsWriteOk: payload.ok ? 1 : 0,
      combatantsRowCount: payload.expectedRows,
      combatantsWriteError: payload.ok ? null : (payload.errorMessage || 'unknown error'),
      updatedAt: nowIso,
    })
    .where(eq(battleReportGenerations.id, id))
    .returning({ id: battleReportGenerations.id });

  return updated.length > 0;
};

export const updateBattleReportGenerationExtraJson = async (
  db: AppDrizzleDb,
  id: string,
  extraJson: Record<string, unknown> | null,
  nowIso: string,
): Promise<boolean> => {
  const updated = await db
    .update(battleReportGenerations)
    .set({
      extraJson: extraJson ? JSON.stringify(extraJson) : null,
      updatedAt: nowIso,
    })
    .where(eq(battleReportGenerations.id, id))
    .returning({ id: battleReportGenerations.id });

  return updated.length > 0;
};

export const countBattleReportGenerationsByUserIdSince = async (
  db: AppDrizzleDb,
  userId: number,
  sinceIso: string,
): Promise<BattleReportCountsByStatus> => {
  const out: BattleReportCountsByStatus = { total: 0, completed: 0, aborted: 0, failed: 0 };
  const rows = await db
    .select({
      status: battleReportGenerations.status,
      total: count(),
    })
    .from(battleReportGenerations)
    .where(and(eq(battleReportGenerations.userId, userId), gte(battleReportGenerations.startedAt, sinceIso)))
    .groupBy(battleReportGenerations.status);

  for (const row of rows) {
    const countValue = Math.max(0, toInt(row.total, 0));
    out.total += countValue;
    if (row.status === 'completed') out.completed += countValue;
    else if (row.status === 'aborted') out.aborted += countValue;
    else if (row.status === 'failed') out.failed += countValue;
  }

  return out;
};

export const updateBattleReportGenerationOutputHasSensitiveWords = async (
  db: AppDrizzleDb,
  id: string,
  outputHasSensitiveWords: boolean,
  nowIso: string,
): Promise<boolean> => {
  const updated = await db
    .update(battleReportGenerations)
    .set({
      outputHasSensitiveWords: outputHasSensitiveWords ? 1 : 0,
      updatedAt: nowIso,
    })
    .where(eq(battleReportGenerations.id, id))
    .returning({ id: battleReportGenerations.id });

  return updated.length > 0;
};

export const updateBattleReportGenerationPublication = async (
  db: AppDrizzleDb,
  generationId: string,
  isPublic: boolean,
  nowIso: string,
  mode?: string | null,
): Promise<boolean> => {
  const updated = await db
    .update(battleReportGenerations)
    .set({
      isPublic: isPublic ? 1 : 0,
      publicSince: isPublic ? sql`COALESCE(${battleReportGenerations.publicSince}, ${nowIso})` : null,
      updatedAt: nowIso,
      ...(mode ? { mode } : {}),
    })
    .where(eq(battleReportGenerations.id, generationId))
    .returning({ id: battleReportGenerations.id });

  return updated.length > 0;
};

export const updateBattleReportGenerationNote = async (
  db: AppDrizzleDb,
  generationId: string,
  note: string | null,
): Promise<boolean> => {
  const rows = await db
    .update(battleReportGenerations)
    .set({ note, updatedAt: new Date().toISOString() })
    .where(eq(battleReportGenerations.id, generationId))
    .returning({ id: battleReportGenerations.id });
  return rows.length > 0;
};

export const deleteBattleReportGenerationRecord = async (db: AppDrizzleDb, generationId: string): Promise<boolean> => {
  const safeId = generationId.trim();
  if (!safeId) return false;
  await db.delete(battleReportGenerationCombatants).where(eq(battleReportGenerationCombatants.generationId, safeId));
  await db.delete(largeObjects).where(and(
    eq(largeObjects.kind, 'battle_report_generation_output'),
    eq(largeObjects.ownerRefId, safeId),
  ));
  const rows = await db.delete(battleReportGenerations)
    .where(eq(battleReportGenerations.id, safeId))
    .returning({ id: battleReportGenerations.id });
  return rows.length > 0;
};

export const listPublicBattleReportGenerationsLite = async (
  db: AppDrizzleDb,
  limit: number,
  offset: number,
  filter?: BattleReportPublicListFilter,
): Promise<BattleReportGenerationRowLite[]> => {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const safeOffset = Math.max(0, Math.floor(offset));
  const conditions = [
    eq(battleReportGenerations.isPublic, 1),
    eq(battleReportGenerations.status, 'completed'),
  ];
  const titleQuery = typeof filter?.titleQuery === 'string' ? filter.titleQuery.trim().slice(0, 120) : '';
  if (titleQuery) {
    const pattern = `%${titleQuery}%`;
    conditions.push(or(like(battleReportGenerations.headline, pattern), like(battleReportGenerations.scenarioTitle, pattern))!);
  }

  const rows = await db
    .select({
      id: battleReportGenerations.id,
      startedAt: battleReportGenerations.startedAt,
      endedAt: battleReportGenerations.endedAt,
      durationMs: battleReportGenerations.durationMs,
      status: battleReportGenerations.status,
      generationMode: battleReportGenerations.generationMode,
      endpoint: battleReportGenerations.endpoint,
      userId: battleReportGenerations.userId,
      username: battleReportGenerations.username,
      mode: battleReportGenerations.mode,
      scenarioTitle: battleReportGenerations.scenarioTitle,
      aiModel: battleReportGenerations.aiModel,
      scenarioDataCardId: battleReportGenerations.scenarioDataCardId,
      scenarioDataCardUpdatedAt: battleReportGenerations.scenarioDataCardUpdatedAt,
      language: battleReportGenerations.language,
      selectedLevel: battleReportGenerations.selectedLevel,
      storyLength: battleReportGenerations.storyLength,
      headline: battleReportGenerations.headline,
      winner: battleReportGenerations.winner,
      note: battleReportGenerations.note,
      outputChars: battleReportGenerations.outputChars,
      promptTokens: battleReportGenerations.promptTokens,
      completionTokens: battleReportGenerations.completionTokens,
      totalTokens: battleReportGenerations.totalTokens,
      cachedTokens: battleReportGenerations.cachedTokens,
      reasoningTokens: battleReportGenerations.reasoningTokens,
      outputPreview: battleReportGenerations.outputPreview,
      outputHasSensitiveWords: battleReportGenerations.outputHasSensitiveWords,
      outputHasShieldWords: battleReportGenerations.outputHasShieldWords,
      isPublic: battleReportGenerations.isPublic,
      publicSince: battleReportGenerations.publicSince,
      extraJson: battleReportGenerations.extraJson,
      pvpRoomId: battleReportGenerations.pvpRoomId,
      pvpMatchId: battleReportGenerations.pvpMatchId,
      pvpRoundId: battleReportGenerations.pvpRoundId,
      createdAt: battleReportGenerations.createdAt,
      updatedAt: battleReportGenerations.updatedAt,
    })
    .from(battleReportGenerations)
    .where(and(...conditions))
    .orderBy(filter?.sort === 'published_at_asc' ? asc(battleReportGenerations.publicSince) : desc(battleReportGenerations.publicSince))
    .limit(safeLimit)
    .offset(safeOffset);

  return rows.map(mapLiteRow);
};

export const listPublicBattleReportKDRows = async (
  db: AppDrizzleDb,
  filter: { fromIso?: string; toIso?: string; username?: string } = {},
): Promise<PublicBattleReportKDRow[]> => {
  const arenaEndpoints = [
    'api/arena/generate',
    '/api/arena/generate',
    'api/arena/generate-stream',
    '/api/arena/generate-stream',
    'api/arena/continuous-bundle',
    '/api/arena/continuous-bundle',
    'api/generate-battle-story',
    '/api/generate-battle-story',
  ];
  const conditions = [
    eq(battleReportGenerations.isPublic, 1),
    eq(battleReportGenerations.status, 'completed'),
    isNull(battleReportGenerations.pvpMatchId),
    or(isNull(battleReportGenerations.mode), ne(battleReportGenerations.mode, 'daily'))!,
    or(...arenaEndpoints.map((endpoint) => eq(battleReportGenerations.endpoint, endpoint)))!,
  ];

  if (filter.fromIso) conditions.push(gte(battleReportGenerations.startedAt, filter.fromIso));
  if (filter.toIso) conditions.push(lte(battleReportGenerations.startedAt, filter.toIso));
  if (filter.username) conditions.push(eq(battleReportGenerations.username, filter.username));

  const rows = await db
    .select({
      generationId: battleReportGenerations.id,
      startedAt: battleReportGenerations.startedAt,
      publicSince: battleReportGenerations.publicSince,
      username: battleReportGenerations.username,
      winner: battleReportGenerations.winner,
      combatantName: battleReportGenerationCombatants.name,
    })
    .from(battleReportGenerations)
    .innerJoin(
      battleReportGenerationCombatants,
      eq(battleReportGenerationCombatants.generationId, battleReportGenerations.id),
    )
    .where(and(...conditions))
    .orderBy(asc(battleReportGenerations.startedAt), asc(battleReportGenerationCombatants.sortIndex));

  return rows.map((row) => ({
    generationId: row.generationId,
    startedAt: row.startedAt,
    publicSince: row.publicSince,
    username: row.username,
    winner: row.winner,
    combatantName: row.combatantName,
  }));
};

const buildCharacterAnalysisExistsCondition = (db: AppDrizzleDb, dataCardId: string): SQL => {
  const trimmed = dataCardId.trim();
  return exists(
    db
      .select({ one: sql<number>`1` })
      .from(battleReportGenerationCombatants)
      .where(and(
        eq(battleReportGenerationCombatants.generationId, battleReportGenerations.id),
        eq(battleReportGenerationCombatants.dataCardId, trimmed),
      )),
  );
};

const buildCharacterAnalysisConditions = (
  db: AppDrizzleDb,
  dataCardId: string,
  filter?: BattleReportCharacterAnalysisFilter,
): SQL[] => {
  const safeCardId = dataCardId.trim();
  if (!safeCardId) {
    return [];
  }

  const conditions: SQL[] = [
    eq(battleReportGenerations.status, 'completed'),
    buildCharacterAnalysisExistsCondition(db, safeCardId),
  ];

  const fromIso = typeof filter?.fromIso === 'string' ? filter.fromIso.trim() : '';
  if (fromIso) {
    conditions.push(gte(battleReportGenerations.startedAt, fromIso));
  }

  const toIso = typeof filter?.toIso === 'string' ? filter.toIso.trim() : '';
  if (toIso) {
    conditions.push(lte(battleReportGenerations.startedAt, toIso));
  }

  const uploaderUsername = typeof filter?.uploaderUsername === 'string' ? filter.uploaderUsername.trim() : '';
  if (uploaderUsername) {
    conditions.push(eq(battleReportGenerations.username, uploaderUsername));
  }

  return conditions;
};

const buildCharacterAnalysisOutputVisibilityCondition = (
  db: AppDrizzleDb,
  viewerUserId: number | undefined,
): SQL => {
  const safeViewerUserId = typeof viewerUserId === 'number' && Number.isSafeInteger(viewerUserId) && viewerUserId > 0
    ? viewerUserId
    : null;
  if (safeViewerUserId === null) {
    return sql`0`;
  }

  return or(
    eq(battleReportGenerations.userId, safeViewerUserId),
    eq(battleReportGenerations.isPublic, 1),
    exists(
      db
        .select({ one: sql<number>`1` })
        .from(pvpMatchPlayers)
        .where(and(
          eq(pvpMatchPlayers.matchId, battleReportGenerations.pvpMatchId),
          eq(pvpMatchPlayers.userId, safeViewerUserId),
        )),
    ),
  ) ?? sql`0`;
};

export const countBattleReportGenerationsByCharacterAnalysis = async (
  db: AppDrizzleDb,
  dataCardId: string,
  filter?: BattleReportCharacterAnalysisFilter,
): Promise<number> => {
  const safeCardId = dataCardId.trim();
  if (!safeCardId) return 0;

  const rows = await db
    .select({ total: count() })
    .from(battleReportGenerations)
    .where(and(...buildCharacterAnalysisConditions(db, safeCardId, filter)));

  return Math.max(0, toInt(rows[0]?.total, 0));
};

export const listBattleReportGenerationsByCharacterAnalysis = async (
  db: AppDrizzleDb,
  dataCardId: string,
  limit: number | null | undefined,
  offset: number | null | undefined = 0,
  filter?: BattleReportCharacterAnalysisFilter,
): Promise<BattleReportCharacterAnalysisRow[]> => {
  const safeCardId = dataCardId.trim();
  if (!safeCardId) return [];

  const safeOffset = Math.max(0, Math.floor(typeof offset === 'number' && Number.isFinite(offset) ? offset : 0));
  const outputVisible = buildCharacterAnalysisOutputVisibilityCondition(db, filter?.viewerUserId);
  const rowsQuery = db
    .select({
      generationId: battleReportGenerations.id,
      startedAt: battleReportGenerations.startedAt,
      username: battleReportGenerations.username,
      userId: battleReportGenerations.userId,
      mode: battleReportGenerations.mode,
      generationMode: battleReportGenerations.generationMode,
      winner: battleReportGenerations.winner,
      headline: battleReportGenerations.headline,
      note: battleReportGenerations.note,
      // 角色卡关联并不等于可以读取战报正文。私有正文只对上传者或 PVP 参与者可见。
      outputPreview: sql<string | null>`CASE WHEN ${outputVisible} THEN ${battleReportGenerations.outputPreview} ELSE NULL END`,
      outputChars: battleReportGenerations.outputChars,
      outputHasSensitiveWords: battleReportGenerations.outputHasSensitiveWords,
      outputHasShieldWords: battleReportGenerations.outputHasShieldWords,
    })
    .from(battleReportGenerations)
    .where(and(...buildCharacterAnalysisConditions(db, safeCardId, filter)))
    .orderBy(filter?.sort === 'started_at_asc' ? asc(battleReportGenerations.startedAt) : desc(battleReportGenerations.startedAt))
    .offset(safeOffset);

  const safeLimit = typeof limit === 'number' && Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : null;
  const rows = safeLimit && safeLimit > 0 ? await rowsQuery.limit(safeLimit) : await rowsQuery;

  return rows.map((row) => ({
    generationId: row.generationId,
    startedAt: row.startedAt,
    username: row.username,
    userId: row.userId,
    mode: typeof row.mode === 'string' && row.mode.trim() ? row.mode.trim() : '未知模式',
    generationMode: row.generationMode === 'stream' ? 'stream' : 'non-stream',
    winner: row.winner,
    headline: row.headline,
    note: row.note,
    outputPreview: row.outputPreview,
    outputChars: toIntOrNull(row.outputChars),
    outputHasSensitiveWords: toBoolOrNull(row.outputHasSensitiveWords),
    outputHasShieldWords: toBoolOrNull(row.outputHasShieldWords),
  }));
};

export const listBattleReportCharacterAnalysisUploaders = async (
  db: AppDrizzleDb,
  dataCardId: string,
  filter?: Pick<BattleReportCharacterAnalysisFilter, 'fromIso' | 'toIso'>,
): Promise<string[]> => {
  const safeCardId = dataCardId.trim();
  if (!safeCardId) return [];

  const rows = await db
    .select({
      username: battleReportGenerations.username,
    })
    .from(battleReportGenerations)
    .where(and(...buildCharacterAnalysisConditions(db, safeCardId, filter)))
    .groupBy(battleReportGenerations.username)
    .orderBy(asc(battleReportGenerations.username));

  return rows
    .map((row) => (typeof row.username === 'string' ? row.username.trim() : ''))
    .filter((username) => Boolean(username));
};
