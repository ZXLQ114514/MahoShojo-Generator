import { describe, expect, test } from 'vitest';
import { createLocalPostgresD1Client } from '@/lib/db/local-postgres-d1-client';

const hasLocalPostgresConfiguration = process.env.MAHOSHOJO_RUNTIME_MODE === 'local'
  && Boolean(process.env.DATABASE_URL?.trim());

// 冒烟验证：MAHOSHOJO_RUNTIME_MODE=local + 本地 Postgres 时，
// createLocalPostgresD1Client 能初始化 schema 并执行 D1-like 查询。
// 运行：MAHOSHOJO_RUNTIME_MODE=local DATABASE_URL=postgresql://mahoshojo:change_me@127.0.0.1:5432/mahoshojo <vitest> tests/local-runtime-smoke.test.ts
describe('本地运行时冒烟（Postgres 模拟 D1）', () => {
  test.skipIf(!hasLocalPostgresConfiguration)('创建 client 并执行查询', async () => {
    const client = createLocalPostgresD1Client();
    expect(client).toBeTruthy();

    const stmt = (client as { prepare(sql: string): { first<T>(col?: string): Promise<T | null> } }).prepare('SELECT 1 AS ok');
    const row = await stmt.first<{ ok: number }>();
    expect(row).toBeTruthy();
  }, 60000);

  test.skipIf(!hasLocalPostgresConfiguration)('schema 初始化后核心表存在', async () => {
    const client = createLocalPostgresD1Client();
    const stmt = (client as { prepare(sql: string): { all(): Promise<{ results: Array<{ table_name: string }> }> } }).prepare(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('users', 'data_cards', 'battle_report_generations')",
    );
    const result = await stmt.all();
    const names = result.results.map((r) => r.table_name);
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain('users');
  }, 60000);
});
