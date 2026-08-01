import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const imageGenerationLicenses = sqliteTable('image_generation_licenses', {
  id: text('id').primaryKey(),
  keyHash: text('key_hash').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  maxUses: integer('max_uses').notNull(),
  remainingUses: integer('remaining_uses').notNull(),
  expiresAt: text('expires_at').notNull(),
  createdByUserId: integer('created_by_user_id').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  lastUsedAt: text('last_used_at'),
  revokedAt: text('revoked_at'),
}, (table) => ({
  keyHashUnique: uniqueIndex('image_generation_licenses_key_hash_unique').on(table.keyHash),
  expiresAtIndex: index('image_generation_licenses_expires_at_idx').on(table.expiresAt),
  revokedAtIndex: index('image_generation_licenses_revoked_at_idx').on(table.revokedAt),
}));
