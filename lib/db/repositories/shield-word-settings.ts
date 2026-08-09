import { eq } from 'drizzle-orm';

import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { siteSettings } from '@/lib/db/schema';
import {
  normalizeShieldWordRules,
  SHIELD_WORD_SETTINGS_VERSION,
} from '@/lib/shield-word-settings';
import type { ShieldWordRule } from '@/lib/shield-word-filter';

export const SHIELD_WORD_SETTINGS_KEY = 'shield_word_rules_v1';

export type ShieldWordSettings = {
  rules: ShieldWordRule[];
  revision: string | null;
  available: boolean;
};

export const getShieldWordSettings = async (db: AppDrizzleDb | null): Promise<ShieldWordSettings> => {
  if (!db) return { rules: [], revision: null, available: false };
  try {
    const [row] = await db
      .select({ value: siteSettings.value, updatedAt: siteSettings.updatedAt })
      .from(siteSettings)
      .where(eq(siteSettings.key, SHIELD_WORD_SETTINGS_KEY))
      .limit(1);
    if (!row) return { rules: [], revision: null, available: true };
    const parsed = JSON.parse(row.value) as { version?: unknown; rules?: unknown };
    if (parsed.version !== SHIELD_WORD_SETTINGS_VERSION) return { rules: [], revision: null, available: false };
    const normalized = normalizeShieldWordRules(parsed.rules);
    return normalized.ok
      ? { rules: normalized.rules, revision: row.updatedAt, available: true }
      : { rules: [], revision: null, available: false };
  } catch {
    return { rules: [], revision: null, available: false };
  }
};

export const prepareShieldWordSettingsUpdate = (
  db: AppDrizzleDb,
  userId: number,
  rules: readonly ShieldWordRule[],
) => {
  const normalized = normalizeShieldWordRules(rules);
  if (!normalized.ok) throw new Error(normalized.error);
  const updatedAt = new Date().toISOString();
  const value = JSON.stringify({ version: SHIELD_WORD_SETTINGS_VERSION, rules: normalized.rules });
  const query = db.insert(siteSettings).values({
    key: SHIELD_WORD_SETTINGS_KEY,
    value,
    updatedByUserId: userId,
    updatedAt,
  }).onConflictDoUpdate({
    target: siteSettings.key,
    set: { value, updatedByUserId: userId, updatedAt },
  });
  return { revision: updatedAt, query };
};
