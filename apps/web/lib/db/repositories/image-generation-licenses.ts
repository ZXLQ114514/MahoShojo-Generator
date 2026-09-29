import { and, asc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';

import { randomUUID } from '@/lib/crypto';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { imageGenerationLicenses } from '@/lib/db/schema';

export type CreateImageGenerationLicenseInput = {
  keyHash: string;
  keyPrefix: string;
  maxUses: number;
  expiresAt: string;
  createdByUserId: number;
  now?: string;
};

export type ImageGenerationLicenseListItem = {
  id: string;
  keyPrefix: string;
  maxUses: number;
  remainingUses: number;
  expiresAt: string;
  createdByUserId: number;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

const normalizeIso = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const normalizePositiveInteger = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;

const mapLicense = (row: typeof imageGenerationLicenses.$inferSelect): ImageGenerationLicenseListItem => ({
  id: row.id,
  keyPrefix: row.keyPrefix,
  maxUses: row.maxUses,
  remainingUses: row.remainingUses,
  expiresAt: row.expiresAt,
  createdByUserId: row.createdByUserId,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  lastUsedAt: row.lastUsedAt ?? null,
  revokedAt: row.revokedAt ?? null,
});

export const createImageGenerationLicense = async (
  db: AppDrizzleDb,
  input: CreateImageGenerationLicenseInput,
): Promise<ImageGenerationLicenseListItem> => {
  const maxUses = normalizePositiveInteger(input.maxUses);
  const expiresAt = normalizeIso(input.expiresAt);
  const createdByUserId = normalizePositiveInteger(input.createdByUserId);
  const now = normalizeIso(input.now ?? new Date().toISOString());
  if (!input.keyHash.trim() || !input.keyPrefix.trim() || maxUses === null || !expiresAt || createdByUserId === null || !now) {
    throw new Error('图片生成许可参数无效');
  }

  const row = {
    id: randomUUID(),
    keyHash: input.keyHash.trim(),
    keyPrefix: input.keyPrefix.trim(),
    maxUses,
    remainingUses: maxUses,
    expiresAt,
    createdByUserId,
    createdAt: now,
    updatedAt: now,
  };

  const inserted = await db.insert(imageGenerationLicenses).values(row).returning();
  const created = inserted[0];
  if (!created) throw new Error('图片生成许可创建失败');
  return mapLicense(created);
};

export const listImageGenerationLicenses = async (
  db: AppDrizzleDb,
  limit = 100,
): Promise<ImageGenerationLicenseListItem[]> => {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const rows = await db
    .select()
    .from(imageGenerationLicenses)
    .orderBy(asc(imageGenerationLicenses.createdAt))
    .limit(safeLimit);
  return rows.map(mapLicense);
};

export const revokeImageGenerationLicense = async (
  db: AppDrizzleDb,
  id: string,
  now = new Date().toISOString(),
): Promise<boolean> => {
  const safeId = id.trim();
  const safeNow = normalizeIso(now);
  if (!safeId || !safeNow) return false;
  const result = await db
    .update(imageGenerationLicenses)
    .set({ revokedAt: safeNow, updatedAt: safeNow })
    .where(and(eq(imageGenerationLicenses.id, safeId), isNull(imageGenerationLicenses.revokedAt)))
    .returning({ id: imageGenerationLicenses.id });
  return result.length > 0;
};

/** 原子预扣减一次许可，最后一次使用后立即标记为 revoked。 */
export const consumeImageGenerationLicense = async (
  db: AppDrizzleDb,
  keyHash: string,
  now = new Date().toISOString(),
): Promise<ImageGenerationLicenseListItem | null> => {
  const safeHash = keyHash.trim();
  const safeNow = normalizeIso(now);
  if (!safeHash || !safeNow) return null;

  const result = await db
    .update(imageGenerationLicenses)
    .set({
      remainingUses: sql`${imageGenerationLicenses.remainingUses} - 1`,
      lastUsedAt: safeNow,
      revokedAt: sql`CASE WHEN ${imageGenerationLicenses.remainingUses} <= 1 THEN ${safeNow} ELSE ${imageGenerationLicenses.revokedAt} END`,
      updatedAt: safeNow,
    })
    .where(and(
      eq(imageGenerationLicenses.keyHash, safeHash),
      gt(imageGenerationLicenses.remainingUses, 0),
      gt(imageGenerationLicenses.expiresAt, safeNow),
      isNull(imageGenerationLicenses.revokedAt),
    ))
    .returning();

  const consumed = result[0];
  return consumed ? mapLicense(consumed) : null;
};

export const revokeExpiredOrExhaustedImageGenerationLicenses = async (
  db: AppDrizzleDb,
  now = new Date().toISOString(),
): Promise<number> => {
  const safeNow = normalizeIso(now);
  if (!safeNow) return 0;
  const rows = await db
    .update(imageGenerationLicenses)
    .set({ revokedAt: safeNow, updatedAt: safeNow })
    .where(and(
      isNull(imageGenerationLicenses.revokedAt),
      or(
        lte(imageGenerationLicenses.expiresAt, safeNow),
        lte(imageGenerationLicenses.remainingUses, 0),
      ),
    ))
    .returning({ id: imageGenerationLicenses.id });
  return rows.length;
};
