import { integer, index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const registrationCodes = sqliteTable('registration_codes', {
  id: text('id').primaryKey(),
  codeHash: text('code_hash').notNull(),
  codePrefix: text('code_prefix').notNull(),
  maxUses: integer('max_uses').notNull(),
  usedCount: integer('used_count').notNull().default(0),
  claimedCount: integer('claimed_count').notNull().default(0),
  expiresAt: text('expires_at'),
  createdByAdminPrincipalId: text('created_by_admin_principal_id').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  revokedAt: text('revoked_at'),
}, (table) => ({
  codeHashUnique: uniqueIndex('registration_codes_code_hash_unique').on(table.codeHash),
  expiresAtIndex: index('registration_codes_expires_at_idx').on(table.expiresAt),
  revokedAtIndex: index('registration_codes_revoked_at_idx').on(table.revokedAt),
}));

export const registrationCodeClaims = sqliteTable('registration_code_claims', {
  id: text('id').primaryKey(),
  codeId: text('code_id').notNull(),
  status: text('status').notNull(),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  codeStatusIndex: index('registration_code_claims_code_status_idx').on(table.codeId, table.status, table.expiresAt),
}));
