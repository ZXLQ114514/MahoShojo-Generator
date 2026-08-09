import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import type { AppDrizzleDb } from '@/lib/db/drizzle';
import * as schema from '@/lib/db/schema';
import { listBattleReportGenerationCombatantsByGenerationIds } from '@/lib/db/repositories/battle-report-generation-combatants';

let sqlite: Database;
let db: AppDrizzleDb;
let queryParams: unknown[][];

describe('battle report generation combatants repository', () => {
  beforeEach(() => {
    sqlite = new Database(':memory:');
    queryParams = [];
    db = drizzle(sqlite, {
      schema,
      logger: {
        logQuery(_query, params) {
          queryParams.push(params);
        },
      },
    }) as unknown as AppDrizzleDb;

    sqlite.exec(`
      CREATE TABLE battle_report_generation_combatants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        generation_id TEXT NOT NULL,
        sort_index INTEGER NOT NULL,
        name TEXT NOT NULL,
        type TEXT,
        template_id TEXT,
        is_native INTEGER,
        is_preset INTEGER,
        team_id INTEGER,
        character_guidance TEXT,
        data_card_id TEXT,
        data_card_updated_at TEXT,
        size_chars INTEGER,
        size_bytes INTEGER,
        created_at TEXT NOT NULL
      );

      INSERT INTO battle_report_generation_combatants
        (generation_id, sort_index, name, team_id, data_card_id, created_at)
      VALUES
        ('gen-000', 0, '第二批角色', 1, 'card-target', '2026-08-09T00:00:00.000Z'),
        ('gen-089', 1, '后手', 2, 'card-b', '2026-08-09T00:00:00.000Z'),
        ('gen-089', 0, '先手', 1, 'card-a', '2026-08-09T00:00:00.000Z'),
        ('gen-090', 0, '末场角色', 1, 'card-target', '2026-08-09T00:00:00.000Z');
    `);
  });

  afterEach(() => {
    sqlite.close();
  });

  test('超过 D1 单批参数预算时分批查询并恢复全局排序', async () => {
    const generationIds = Array.from({ length: 91 }, (_, index) => `gen-${String(90 - index).padStart(3, '0')}`);

    const rows = await listBattleReportGenerationCombatantsByGenerationIds(db, generationIds);

    expect(queryParams.map((params) => params.length)).toEqual([90, 1]);
    expect(rows.map((row) => [row.generation_id, row.sort_index])).toEqual([
      ['gen-000', 0],
      ['gen-089', 0],
      ['gen-089', 1],
      ['gen-090', 0],
    ]);
  });

  test('查询前清理空白 ID 并去重，空输入不访问数据库', async () => {
    const duplicateIds = Array.from({ length: 90 }, () => ' gen-089 ');
    const rows = await listBattleReportGenerationCombatantsByGenerationIds(db, [
      ...duplicateIds,
      '',
      '   ',
    ]);

    expect(queryParams).toHaveLength(1);
    expect(queryParams[0]).toEqual(['gen-089']);
    expect(rows).toHaveLength(2);

    queryParams.length = 0;
    await expect(listBattleReportGenerationCombatantsByGenerationIds(db, ['', '   '])).resolves.toEqual([]);
    expect(queryParams).toHaveLength(0);
  });
});
