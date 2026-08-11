import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** Immutable administrator history for managed AI prompt templates. */
export const aiPromptVersions = sqliteTable(
  'ai_prompt_versions',
  {
    id: text('id').primaryKey(),
    promptId: text('prompt_id').notNull(),
    revision: text('revision').notNull(),
    body: text('body').notNull(),
    action: text('action').notNull(),
    changeNote: text('change_note').notNull(),
    createdByUserId: integer('created_by_user_id'),
    createdAt: text('created_at').notNull(),
    /** Revision that was read by the administrator before this version. */
    previousRevision: text('previous_revision'),
    /** Whether this version contains the catalog default body. */
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => ({
    promptRevisionUnique: uniqueIndex('ai_prompt_versions_prompt_revision_unique').on(table.promptId, table.revision),
    promptCreatedAtIndex: index('ai_prompt_versions_prompt_created_at_idx').on(table.promptId, table.createdAt),
    createdByIndex: index('ai_prompt_versions_created_by_idx').on(table.createdByUserId, table.createdAt),
  }),
);

export type AiPromptVersionRow = typeof aiPromptVersions.$inferSelect;
export type NewAiPromptVersionRow = typeof aiPromptVersions.$inferInsert;
