import { generateUUID } from './core';
import { touchUserLastActivity } from './user-activity';

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
};

export interface BattleReportGenerationInsert {
  id?: string;
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
  note?: string | null;
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
}

export interface BattleReportGenerationRowLite {
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
}

export interface BattleReportCharacterAnalysisRow {
  generationId: string;
  startedAt: string;
  username: string | null;
  userId: number | null;
  mode: string | null;
  winner: string | null;
  headline: string | null;
  note: string | null;
}

export type BattleReportCountsByStatus = {
  total: number;
  completed: number;
  aborted: number;
  failed: number;
};

type BattleReportGenerationsRepoBundle = {
  db: unknown;
  insertBattleReportGenerationRecord: (
    db: unknown,
    id: string,
    payload: Omit<BattleReportGenerationInsert, 'id'>,
    nowIso: string,
  ) => Promise<boolean>;
  updateBattleReportGenerationOutputPreview: (
    db: unknown,
    generationId: string,
    outputPreview: string | null,
    nowIso: string,
  ) => Promise<boolean>;
  getBattleReportGenerationByIdLite: (
    db: unknown,
    generationId: string,
  ) => Promise<BattleReportGenerationRowLite | null>;
  listBattleReportGenerationsByUserIdLite: (
    db: unknown,
    userId: number,
    limit: number,
    offset: number,
    filter?: BattleReportGenerationsListFilter,
  ) => Promise<BattleReportGenerationRowLite[]>;
  countBattleReportGenerationsByUserId: (
    db: unknown,
    userId: number,
    filter?: BattleReportGenerationsListFilter,
  ) => Promise<number>;
  updateBattleReportGenerationCombatantsWriteResult: (
    db: unknown,
    id: string,
    payload: { ok: boolean; expectedRows: number; errorMessage?: string | null },
    nowIso: string,
  ) => Promise<boolean>;
  updateBattleReportGenerationExtraJson: (
    db: unknown,
    id: string,
    extraJson: Record<string, unknown> | null,
    nowIso: string,
  ) => Promise<boolean>;
  countBattleReportGenerationsByUserIdSince: (
    db: unknown,
    userId: number,
    sinceIso: string,
  ) => Promise<BattleReportCountsByStatus>;
  updateBattleReportGenerationOutputHasSensitiveWords: (
    db: unknown,
    id: string,
    outputHasSensitiveWords: boolean,
    nowIso: string,
  ) => Promise<boolean>;
  updateBattleReportGenerationPublication: (
    db: unknown,
    generationId: string,
    isPublic: boolean,
    nowIso: string,
    mode?: string | null,
  ) => Promise<boolean>;
  updateBattleReportGenerationNote: (
    db: unknown,
    generationId: string,
    note: string | null,
  ) => Promise<boolean>;
  listPublicBattleReportGenerationsLite: (
    db: unknown,
    limit: number,
    offset: number,
    filter?: BattleReportPublicListFilter,
  ) => Promise<BattleReportGenerationRowLite[]>;
  countBattleReportGenerationsByCharacterAnalysis: (
    db: unknown,
    dataCardId: string,
    filter?: BattleReportCharacterAnalysisFilter,
  ) => Promise<number>;
  listBattleReportGenerationsByCharacterAnalysis: (
    db: unknown,
    dataCardId: string,
    limit: number | null | undefined,
    offset?: number | null,
    filter?: BattleReportCharacterAnalysisFilter,
  ) => Promise<BattleReportCharacterAnalysisRow[]>;
  listBattleReportCharacterAnalysisUploaders: (
    db: unknown,
    dataCardId: string,
    filter?: Pick<BattleReportCharacterAnalysisFilter, 'fromIso' | 'toIso'>,
  ) => Promise<string[]>;
};

const readBattleReportGenerationsRepoBundle = async (): Promise<BattleReportGenerationsRepoBundle | null> => {
  try {
    const [{ getDrizzleDbFromRuntime }, repo] = await Promise.all([
      import('@/lib/db/drizzle'),
      import('@/lib/db/repositories/battle-report-generations'),
    ]);
    const db = getDrizzleDbFromRuntime();
    if (!db) return null;

    return {
      db,
      insertBattleReportGenerationRecord: repo.insertBattleReportGenerationRecord as BattleReportGenerationsRepoBundle['insertBattleReportGenerationRecord'],
      updateBattleReportGenerationOutputPreview: repo.updateBattleReportGenerationOutputPreview as BattleReportGenerationsRepoBundle['updateBattleReportGenerationOutputPreview'],
      getBattleReportGenerationByIdLite: repo.getBattleReportGenerationByIdLite as BattleReportGenerationsRepoBundle['getBattleReportGenerationByIdLite'],
      listBattleReportGenerationsByUserIdLite: repo.listBattleReportGenerationsByUserIdLite as BattleReportGenerationsRepoBundle['listBattleReportGenerationsByUserIdLite'],
      countBattleReportGenerationsByUserId: repo.countBattleReportGenerationsByUserId as BattleReportGenerationsRepoBundle['countBattleReportGenerationsByUserId'],
      updateBattleReportGenerationCombatantsWriteResult: repo.updateBattleReportGenerationCombatantsWriteResult as BattleReportGenerationsRepoBundle['updateBattleReportGenerationCombatantsWriteResult'],
      updateBattleReportGenerationExtraJson: repo.updateBattleReportGenerationExtraJson as BattleReportGenerationsRepoBundle['updateBattleReportGenerationExtraJson'],
      countBattleReportGenerationsByUserIdSince: repo.countBattleReportGenerationsByUserIdSince as BattleReportGenerationsRepoBundle['countBattleReportGenerationsByUserIdSince'],
      updateBattleReportGenerationOutputHasSensitiveWords: repo.updateBattleReportGenerationOutputHasSensitiveWords as BattleReportGenerationsRepoBundle['updateBattleReportGenerationOutputHasSensitiveWords'],
      updateBattleReportGenerationPublication: repo.updateBattleReportGenerationPublication as BattleReportGenerationsRepoBundle['updateBattleReportGenerationPublication'],
      updateBattleReportGenerationNote: repo.updateBattleReportGenerationNote as BattleReportGenerationsRepoBundle['updateBattleReportGenerationNote'],
      listPublicBattleReportGenerationsLite: repo.listPublicBattleReportGenerationsLite as BattleReportGenerationsRepoBundle['listPublicBattleReportGenerationsLite'],
      countBattleReportGenerationsByCharacterAnalysis: repo.countBattleReportGenerationsByCharacterAnalysis as BattleReportGenerationsRepoBundle['countBattleReportGenerationsByCharacterAnalysis'],
      listBattleReportGenerationsByCharacterAnalysis: repo.listBattleReportGenerationsByCharacterAnalysis as BattleReportGenerationsRepoBundle['listBattleReportGenerationsByCharacterAnalysis'],
      listBattleReportCharacterAnalysisUploaders: repo.listBattleReportCharacterAnalysisUploaders as BattleReportGenerationsRepoBundle['listBattleReportCharacterAnalysisUploaders'],
    };
  } catch {
    return null;
  }
};

export async function createBattleReportGenerationRecord(
  payload: BattleReportGenerationInsert,
): Promise<string | null> {
  try {
    const bundle = await readBattleReportGenerationsRepoBundle();
    if (!bundle) return null;
    const nowIso = new Date().toISOString();
    const id = payload.id ?? generateUUID();
    const ok = await bundle.insertBattleReportGenerationRecord(
      bundle.db,
      id,
      payload as Omit<BattleReportGenerationInsert, 'id'>,
      nowIso,
    );
    if (!ok) return null;

    if (typeof payload.userId === 'number' && Number.isFinite(payload.userId) && payload.userId > 0) {
      await touchUserLastActivity(payload.userId, payload.endedAt || payload.startedAt);
    }
    return id;
  } catch (error) {
    console.error('写入 battle_report_generations 失败:', error);
    return null;
  }
}

export async function updateBattleReportGenerationOutputPreview(
  generationId: string,
  outputPreview: string | null,
): Promise<boolean> {
  const id = typeof generationId === 'string' ? generationId.trim() : '';
  if (!id) return false;

  try {
    const bundle = await readBattleReportGenerationsRepoBundle();
    if (!bundle) return false;
    return await bundle.updateBattleReportGenerationOutputPreview(bundle.db, id, outputPreview, new Date().toISOString());
  } catch (error) {
    console.error('更新 battle_report_generations.output_preview 失败:', error);
    return false;
  }
}

export async function getBattleReportGenerationByIdLite(
  generationId: string,
): Promise<BattleReportGenerationRowLite | null> {
  try {
    const bundle = await readBattleReportGenerationsRepoBundle();
    if (!bundle) return null;
    return await bundle.getBattleReportGenerationByIdLite(bundle.db, generationId);
  } catch (error) {
    console.error('读取 battle_report_generations(id) 失败:', error);
    return null;
  }
}

export async function getBattleReportGenerationsByUserIdLite(
  userId: number,
  limit: number,
  offset = 0,
  filter?: BattleReportGenerationsListFilter,
): Promise<BattleReportGenerationRowLite[]> {
  try {
    const bundle = await readBattleReportGenerationsRepoBundle();
    if (!bundle) return [];
    return await bundle.listBattleReportGenerationsByUserIdLite(bundle.db, userId, limit, offset, filter);
  } catch (error) {
    console.error('读取 battle_report_generations(user) 失败:', error);
    return [];
  }
}

export async function countBattleReportGenerationsByUserId(
  userId: number,
  filter?: BattleReportGenerationsListFilter,
): Promise<number> {
  try {
    const bundle = await readBattleReportGenerationsRepoBundle();
    if (!bundle) return 0;
    return await bundle.countBattleReportGenerationsByUserId(bundle.db, userId, filter);
  } catch (error) {
    console.error('统计 battle_report_generations(user) 失败:', error);
    return 0;
  }
}

export function buildBattleReportGenerationsWhereClause(
  userId: number,
  filter?: BattleReportGenerationsListFilter,
): { whereSql: string; params: unknown[]; orderBySql: string } {
  const where: string[] = ['user_id = ?'];
  const params: unknown[] = [userId];

  const status = filter?.status;
  if (status === 'completed' || status === 'aborted' || status === 'failed') {
    where.push('status = ?');
    params.push(status);
  }

  const generationMode = filter?.generationMode;
  if (generationMode === 'stream' || generationMode === 'non-stream') {
    where.push('generation_mode = ?');
    params.push(generationMode);
  }

  const mode = typeof filter?.mode === 'string' ? filter.mode.trim() : '';
  if (mode) {
    where.push('mode = ?');
    params.push(mode);
  }

  if (filter?.pvpOnly) {
    where.push('pvp_match_id IS NOT NULL');
  }

  const titleQuery = typeof filter?.titleQuery === 'string' ? filter.titleQuery.trim() : '';
  if (titleQuery) {
    const safe = titleQuery.length > 120 ? titleQuery.slice(0, 120) : titleQuery;
    const pattern = `%${safe}%`;
    where.push('(headline LIKE ? OR scenario_title LIKE ?)');
    params.push(pattern, pattern);
  }

  const sort = filter?.sort;
  const orderBySql = sort === 'started_at_asc' ? 'started_at ASC' : 'started_at DESC';

  return { whereSql: where.join(' AND '), params, orderBySql };
}

export async function updateBattleReportGenerationCombatantsWriteResult(
  id: string,
  payload: { ok: boolean; expectedRows: number; errorMessage?: string | null },
): Promise<boolean> {
  try {
    const bundle = await readBattleReportGenerationsRepoBundle();
    if (!bundle) return false;
    return await bundle.updateBattleReportGenerationCombatantsWriteResult(bundle.db, id, payload, new Date().toISOString());
  } catch (error) {
    console.error('更新 battle_report_generations.combatants_* 失败:', error);
    return false;
  }
}

export async function updateBattleReportGenerationExtraJson(
  id: string,
  extraJson: Record<string, unknown> | null,
): Promise<boolean> {
  try {
    const bundle = await readBattleReportGenerationsRepoBundle();
    if (!bundle) return false;
    return await bundle.updateBattleReportGenerationExtraJson(bundle.db, id, extraJson, new Date().toISOString());
  } catch (error) {
    console.error('更新 battle_report_generations.extra_json 失败:', error);
    return false;
  }
}

export async function countBattleReportGenerationsByUserIdSince(
  userId: number,
  sinceIso: string,
): Promise<BattleReportCountsByStatus> {
  const out: BattleReportCountsByStatus = { total: 0, completed: 0, aborted: 0, failed: 0 };
  try {
    const bundle = await readBattleReportGenerationsRepoBundle();
    if (!bundle) return out;
    return await bundle.countBattleReportGenerationsByUserIdSince(bundle.db, userId, sinceIso);
  } catch (error) {
    console.error('统计 battle_report_generations(user, since) 失败:', error);
    return out;
  }
}

export async function updateBattleReportGenerationOutputHasSensitiveWords(
  id: string,
  outputHasSensitiveWords: boolean,
): Promise<boolean> {
  try {
    const bundle = await readBattleReportGenerationsRepoBundle();
    if (!bundle) return false;
    return await bundle.updateBattleReportGenerationOutputHasSensitiveWords(
      bundle.db,
      id,
      outputHasSensitiveWords,
      new Date().toISOString(),
    );
  } catch (error) {
    console.error('更新 battle_report_generations.output_has_sensitive_words 失败:', error);
    return false;
  }
}

export async function updateBattleReportGenerationPublication(
  generationId: string,
  isPublic: boolean,
  mode?: string | null,
): Promise<boolean> {
  const id = typeof generationId === 'string' ? generationId.trim() : '';
  if (!id) return false;
  try {
    const bundle = await readBattleReportGenerationsRepoBundle();
    if (!bundle) return false;
    return await bundle.updateBattleReportGenerationPublication(bundle.db, id, isPublic, new Date().toISOString(), mode);
  } catch (error) {
    console.error('更新战报公开状态失败:', error);
    return false;
  }
}

export async function updateBattleReportGenerationNote(
  generationId: string,
  note: string | null,
): Promise<boolean> {
  const id = typeof generationId === 'string' ? generationId.trim() : '';
  if (!id) return false;
  try {
    const bundle = await readBattleReportGenerationsRepoBundle();
    if (!bundle) return false;
    return await bundle.updateBattleReportGenerationNote(bundle.db, id, note,);
  } catch (error) {
    console.error('更新战报备注失败:', error);
    return false;
  }
}

export async function getPublicBattleReportGenerations(
  limit: number,
  offset = 0,
  filter?: BattleReportPublicListFilter,
): Promise<BattleReportGenerationRowLite[]> {
  try {
    const bundle = await readBattleReportGenerationsRepoBundle();
    if (!bundle) return [];
    return await bundle.listPublicBattleReportGenerationsLite(bundle.db, limit, offset, filter);
  } catch (error) {
    console.error('读取公开战报失败:', error);
    return [];
  }
}

export async function countBattleReportGenerationsByCharacterAnalysis(
  dataCardId: string,
  filter?: BattleReportCharacterAnalysisFilter,
): Promise<number> {
  try {
    const bundle = await readBattleReportGenerationsRepoBundle();
    if (!bundle) return 0;
    return await bundle.countBattleReportGenerationsByCharacterAnalysis(bundle.db, dataCardId, filter);
  } catch (error) {
    console.error('统计角色战报分析数量失败:', error);
    return 0;
  }
}

export async function getBattleReportGenerationsByCharacterAnalysis(
  dataCardId: string,
  limit: number | null | undefined,
  offset = 0,
  filter?: BattleReportCharacterAnalysisFilter,
): Promise<BattleReportCharacterAnalysisRow[]> {
  try {
    const bundle = await readBattleReportGenerationsRepoBundle();
    if (!bundle) return [];
    return await bundle.listBattleReportGenerationsByCharacterAnalysis(bundle.db, dataCardId, limit, offset, filter);
  } catch (error) {
    console.error('读取角色战报分析记录失败:', error);
    return [];
  }
}

export async function listBattleReportCharacterAnalysisUploaders(
  dataCardId: string,
  filter?: Pick<BattleReportCharacterAnalysisFilter, 'fromIso' | 'toIso'>,
): Promise<string[]> {
  try {
    const bundle = await readBattleReportGenerationsRepoBundle();
    if (!bundle) return [];
    return await bundle.listBattleReportCharacterAnalysisUploaders(bundle.db, dataCardId, filter);
  } catch (error) {
    console.error('读取角色战报分析上传人失败:', error);
    return [];
  }
}
