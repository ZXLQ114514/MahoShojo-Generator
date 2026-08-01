import { describe, expect, test } from 'vitest';
import { translateLocalPostgresSql } from '@/lib/db/local-postgres-d1-client';

describe('本地 PostgreSQL SQL 兼容转换', () => {
  test('只转换 SQLite 的 INSERT OR IGNORE，并保留 RETURNING 顺序', () => {
    expect(translateLocalPostgresSql('INSERT OR IGNORE INTO user_badges (user_id) VALUES (?) RETURNING id')).toBe(
      'INSERT INTO user_badges (user_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id',
    );
  });

  test('普通 INSERT 不会被错误追加冲突策略', () => {
    expect(translateLocalPostgresSql('INSERT INTO users (email) VALUES (?) RETURNING id')).toBe(
      'INSERT INTO users (email) VALUES ($1) RETURNING id',
    );
  });

  test('转换项目使用的 SQLite 时间和 JSON 函数', () => {
    const sql = translateLocalPostgresSql(
      `SELECT * FROM data_cards WHERE public_since <= datetime('now', '-3 days') AND strftime('%s', "data_cards"."created_at") > 0 AND json_extract("data_cards"."data", '$.nativeAllowed') = 'true'`,
    );
    expect(sql).toContain("CURRENT_TIMESTAMP - INTERVAL '3 days'");
    expect(sql).toContain('EXTRACT(EPOCH FROM "data_cards"."created_at"::timestamp)');
    expect(sql).toContain("(\"data_cards\".\"data\"::jsonb ->> 'nativeAllowed')");
  });
});
