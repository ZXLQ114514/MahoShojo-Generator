import { and, asc, desc, eq, isNull, like, or, sql } from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import {
  battleReportGenerationCombatants,
  battleReportGenerations,
  dataCards,
  largeObjects,
  siteSettings,
  users,
} from '@/lib/db/schema';

export const DEFAULT_PUBLIC_AI_COOLDOWN_SECONDS = {
  system: 60,
  free: 120,
  custom: 3,
  battle: 120,
} as const;

export type PublicAiCooldownSettings = {
  systemSeconds: number;
  freeSeconds: number;
  customSeconds: number;
  battleSeconds: number;
};

const PUBLIC_AI_SETTING_KEYS = {
  system: 'public_ai_cooldown_system_seconds',
  free: 'public_ai_cooldown_free_seconds',
  custom: 'public_ai_cooldown_custom_seconds',
  battle: 'public_ai_cooldown_battle_seconds',
} as const;

const normalizeCooldownSeconds = (value: unknown, fallback: number): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(86400, Math.trunc(parsed)));
};

export const getPublicAiCooldownSettings = async (db: AppDrizzleDb | null): Promise<PublicAiCooldownSettings> => {
  const fallback = {
    systemSeconds: DEFAULT_PUBLIC_AI_COOLDOWN_SECONDS.system,
    freeSeconds: DEFAULT_PUBLIC_AI_COOLDOWN_SECONDS.free,
    customSeconds: DEFAULT_PUBLIC_AI_COOLDOWN_SECONDS.custom,
    battleSeconds: DEFAULT_PUBLIC_AI_COOLDOWN_SECONDS.battle,
  };
  if (!db) return fallback;
  try {
    const rows = await db
      .select({ key: siteSettings.key, value: siteSettings.value })
      .from(siteSettings)
      .where(or(
        eq(siteSettings.key, PUBLIC_AI_SETTING_KEYS.system),
        eq(siteSettings.key, PUBLIC_AI_SETTING_KEYS.free),
        eq(siteSettings.key, PUBLIC_AI_SETTING_KEYS.custom),
        eq(siteSettings.key, PUBLIC_AI_SETTING_KEYS.battle),
      ));
    const values = new Map(rows.map((row) => [row.key, row.value]));
    const systemSeconds = normalizeCooldownSeconds(values.get(PUBLIC_AI_SETTING_KEYS.system), fallback.systemSeconds);
    return {
      systemSeconds,
      freeSeconds: normalizeCooldownSeconds(values.get(PUBLIC_AI_SETTING_KEYS.free), fallback.freeSeconds),
      customSeconds: normalizeCooldownSeconds(values.get(PUBLIC_AI_SETTING_KEYS.custom), fallback.customSeconds),
      // 兼容此前只有系统/免费/自定义三项的配置：未单独设置战斗间隔时继承系统间隔。
      battleSeconds: values.has(PUBLIC_AI_SETTING_KEYS.battle)
        ? normalizeCooldownSeconds(values.get(PUBLIC_AI_SETTING_KEYS.battle), fallback.battleSeconds)
        : systemSeconds,
    };
  } catch {
    return fallback;
  }
};

export const setPublicAiCooldownSettings = async (
  db: AppDrizzleDb,
  userId: number,
  input: PublicAiCooldownSettings,
): Promise<void> => {
  const values = [
    { key: PUBLIC_AI_SETTING_KEYS.system, value: String(normalizeCooldownSeconds(input.systemSeconds, DEFAULT_PUBLIC_AI_COOLDOWN_SECONDS.system)) },
    { key: PUBLIC_AI_SETTING_KEYS.free, value: String(normalizeCooldownSeconds(input.freeSeconds, DEFAULT_PUBLIC_AI_COOLDOWN_SECONDS.free)) },
    { key: PUBLIC_AI_SETTING_KEYS.custom, value: String(normalizeCooldownSeconds(input.customSeconds, DEFAULT_PUBLIC_AI_COOLDOWN_SECONDS.custom)) },
    { key: PUBLIC_AI_SETTING_KEYS.battle, value: String(normalizeCooldownSeconds(input.battleSeconds, DEFAULT_PUBLIC_AI_COOLDOWN_SECONDS.battle)) },
  ];
  for (const setting of values) {
    await db.insert(siteSettings).values({
      key: setting.key,
      value: setting.value,
      updatedByUserId: userId,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).onConflictDoUpdate({
      target: siteSettings.key,
      set: { value: setting.value, updatedByUserId: userId, updatedAt: sql`CURRENT_TIMESTAMP` },
    });
  }
};

export type AdminDataCardRow = {
  id: string;
  userId: number;
  username: string;
  type: string;
  name: string;
  description: string | null;
  data: string;
  isPublic: number;
  reviewStatus: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type AdminUserRow = {
  id: number;
  username: string;
  email: string;
  isBanned: string | null;
  isAdmin: boolean;
  isReviewExempt: boolean;
  slotCount: number | null;
  createdAt: string | null;
  lastLoginAt: string | null;
  cardCount: number;
  pendingCardCount: number;
};

const toInt = (value: unknown): number => {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? Math.max(0, Math.trunc(numberValue)) : 0;
};

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (character) => `\\${character}`);

export const listAdminDataCards = async (
  db: AppDrizzleDb,
  input: { status?: 'pending' | 'approved' | 'rejected' | 'all'; type?: string; search?: string; limit?: number },
): Promise<AdminDataCardRow[]> => {
  const conditions = [isNull(dataCards.deletedAt)];
  const status = input.status ?? 'pending';
  if (status !== 'all') conditions.push(eq(dataCards.reviewStatus, status));
  if (input.type && input.type !== 'all') conditions.push(eq(dataCards.type, input.type as never));
  const search = typeof input.search === 'string' ? input.search.trim() : '';
  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    conditions.push(or(like(dataCards.name, pattern), like(users.username, pattern))!);
  }

  const rows = await db
    .select({
      id: dataCards.id,
      userId: dataCards.userId,
      username: users.username,
      type: dataCards.type,
      name: dataCards.name,
      description: dataCards.description,
      data: dataCards.data,
      isPublic: sql<number>`CAST(${dataCards.isPublic} AS INTEGER)`,
      reviewStatus: dataCards.reviewStatus,
      createdAt: dataCards.createdAt,
      updatedAt: dataCards.updatedAt,
    })
    .from(dataCards)
    .innerJoin(users, eq(users.id, dataCards.userId))
    .where(and(...conditions))
    .orderBy(status === 'pending' ? asc(dataCards.createdAt) : desc(dataCards.updatedAt))
    .limit(Math.max(1, Math.min(200, Math.trunc(input.limit ?? 50))));

  return rows.map((row) => ({ ...row, isPublic: toInt(row.isPublic) }));
};

export const updateAdminDataCardModeration = async (
  db: AppDrizzleDb,
  cardId: string,
  action: 'approve' | 'reject' | 'private',
): Promise<boolean> => {
  const values = action === 'approve'
    ? { isPublic: sql`1`, reviewStatus: 'approved' as const, publicSince: sql`CURRENT_TIMESTAMP` }
    : { isPublic: sql`-1`, reviewStatus: 'rejected' as const, publicSince: null };
  if (action === 'private') values.isPublic = sql`0`;

  const rows = await db
    .update(dataCards)
    .set({ ...values, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(dataCards.id, cardId), isNull(dataCards.deletedAt)))
    .returning({ id: dataCards.id });
  return rows.length > 0;
};

export const listAdminUsers = async (db: AppDrizzleDb, search = '', limit = 100): Promise<AdminUserRow[]> => {
  const normalizedSearch = search.trim();
  const conditions = normalizedSearch
    ? [or(like(users.username, `%${escapeLike(normalizedSearch)}%`), like(users.email, `%${escapeLike(normalizedSearch)}%`))!]
    : [];

  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      isBanned: users.isBanned,
      isAdmin: users.isAdmin,
      isReviewExempt: users.isReviewExempt,
      slotCount: users.slotCount,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
      cardCount: sql<number>`(SELECT COUNT(*) FROM data_cards dc WHERE dc.user_id = ${users.id} AND dc.deleted_at IS NULL)`,
      pendingCardCount: sql<number>`(SELECT COUNT(*) FROM data_cards dc WHERE dc.user_id = ${users.id} AND dc.is_public = 1 AND dc.review_status = 'pending' AND dc.deleted_at IS NULL)`,
    })
    .from(users)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(users.createdAt), asc(users.id))
    .limit(Math.max(1, Math.min(200, Math.trunc(limit))));

  return rows.map((row) => ({
    ...row,
    isBanned: typeof row.isBanned === 'string' ? row.isBanned : null,
    isAdmin: Boolean(row.isAdmin),
    isReviewExempt: Boolean(row.isReviewExempt),
    slotCount: row.slotCount == null ? null : toInt(row.slotCount),
    cardCount: toInt(row.cardCount),
    pendingCardCount: toInt(row.pendingCardCount),
  }));
};

export const updateAdminUser = async (
  db: AppDrizzleDb,
  userId: number,
  patch: { isBanned?: boolean; isAdmin?: boolean; isReviewExempt?: boolean; slotCount?: number },
): Promise<boolean> => {
  const values: Record<string, unknown> = { updatedAt: sql`CURRENT_TIMESTAMP` };
  if (patch.isBanned !== undefined) values.isBanned = patch.isBanned ? 'admin_banned' : null;
  if (patch.isAdmin !== undefined) values.isAdmin = patch.isAdmin;
  if (patch.isReviewExempt !== undefined) values.isReviewExempt = patch.isReviewExempt;
  if (patch.slotCount !== undefined) values.slotCount = Math.max(0, Math.min(1000, Math.trunc(patch.slotCount)));

  const rows = await db.update(users).set(values as never).where(eq(users.id, userId)).returning({ id: users.id });
  return rows.length > 0;
};

export type AdminBattleReportRow = {
  id: string;
  userId: number | null;
  username: string | null;
  headline: string | null;
  mode: string | null;
  status: string;
  endpoint: string;
  isPublic: number;
  startedAt: string;
  pvpMatchId: string | null;
};

export const listAdminBattleReports = async (
  db: AppDrizzleDb,
  input: { search?: string; limit?: number } = {},
): Promise<AdminBattleReportRow[]> => {
  const search = typeof input.search === 'string' ? input.search.trim() : '';
  const conditions = search
    ? [or(
      like(battleReportGenerations.headline, `%${escapeLike(search)}%`),
      like(users.username, `%${escapeLike(search)}%`),
      like(battleReportGenerations.id, `%${escapeLike(search)}%`),
    )!]
    : [];
  const rows = await db
    .select({
      id: battleReportGenerations.id,
      userId: battleReportGenerations.userId,
      username: users.username,
      headline: battleReportGenerations.headline,
      mode: battleReportGenerations.mode,
      status: battleReportGenerations.status,
      endpoint: battleReportGenerations.endpoint,
      isPublic: sql<number>`CAST(${battleReportGenerations.isPublic} AS INTEGER)`,
      startedAt: battleReportGenerations.startedAt,
      pvpMatchId: battleReportGenerations.pvpMatchId,
    })
    .from(battleReportGenerations)
    .leftJoin(users, eq(users.id, battleReportGenerations.userId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(battleReportGenerations.startedAt))
    .limit(Math.max(1, Math.min(200, Math.trunc(input.limit ?? 100))));

  return rows.map((row) => ({ ...row, isPublic: toInt(row.isPublic) }));
};

export const deleteAdminBattleReport = async (db: AppDrizzleDb, generationId: string): Promise<boolean> => {
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
