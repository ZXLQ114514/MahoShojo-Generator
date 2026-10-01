import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { consumeRegistrationCode, finalizeRegistrationCodeClaim, hashRegistrationCode, releaseRegistrationCodeClaim, startRegistrationCodeDispatch } from '../src/registration-codes';

type SqliteStatement = { all(..._values: unknown[]): Record<string, unknown>[]; run(..._values: unknown[]): unknown };
type SqliteDatabase = {
  exec(_sql: string): void;
  close(): void;
  prepare(_sql: string): SqliteStatement;
};
type D1Statement = {
  sql: string;
  values: unknown[];
  bind(..._values: unknown[]): D1Statement;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
};
type D1Client = {
  prepare(_sql: string): D1Statement;
  batch(_statements: D1Statement[]): Promise<Array<{ results: Record<string, unknown>[] }>>;
};
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (_name: string) => SqliteDatabase };

function sqliteClient() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE registration_codes (id TEXT PRIMARY KEY,code_hash TEXT UNIQUE NOT NULL,code_prefix TEXT NOT NULL,
    max_uses INTEGER NOT NULL,used_count INTEGER NOT NULL DEFAULT 0,claimed_count INTEGER NOT NULL DEFAULT 0,expires_at TEXT,
    created_by_admin_principal_id TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,revoked_at TEXT);
    CREATE TABLE registration_code_claims (id TEXT PRIMARY KEY,code_id TEXT NOT NULL,status TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);`);
  const client: D1Client = {
  prepare(_sql) {
      let values: unknown[] = [];
      const statement: D1Statement = {
        sql: _sql,
        get values() { return values; },
        set values(next: unknown[]) { values = next; },
         bind(...bound) { values = bound; return statement; },
        async all<T>() { return { results: sqlite.prepare(_sql).all(...values) as T[] }; },
        async run() { return { meta: { changes: Number((sqlite.prepare(_sql).run(...values) as { changes?: number }).changes ?? 0) } }; },
      };
      return statement;
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((statement) => {
          const stored = statement;
          const prepared = sqlite.prepare(stored.sql);
          const rows = /\bRETURNING\b|^\s*SELECT\b/i.test(stored.sql)
            ? prepared.all(...stored.values)
            : (prepared.run(...stored.values), []);
          return { results: rows };
        });
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { sqlite, client };
}

describe('registration code lifecycle', () => {
  it('normalizes separators and hashes without storing plaintext', async () => {
    expect(await hashRegistrationCode(' reg-test1234 ')).toBe(await hashRegistrationCode('REG-TEST1234'));
  });

  it('claims one use under concurrency and does not persist plaintext', async () => {
    const { sqlite, client } = sqliteClient();
    const code = 'REG-ABCDEF0123456789ABCDEF0123456789';
    const hash = await hashRegistrationCode(code);
    sqlite.prepare(`INSERT INTO registration_codes(id,code_hash,code_prefix,max_uses,created_by_admin_principal_id,created_at,updated_at) VALUES('code-1',?,'REG-TEST123456789012',1,'operator',?,?)`).run(hash, new Date().toISOString(), new Date().toISOString());
    const [first, second] = await Promise.all([consumeRegistrationCode(client, code), consumeRegistrationCode(client, code)]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    const winner = first ?? second;
    expect(winner).toMatchObject({ claimId: expect.any(String), codeId: 'code-1' });
    expect(await startRegistrationCodeDispatch(client, winner!.claimId)).toBe(true);
    expect(await finalizeRegistrationCodeClaim(client, winner!.claimId)).toBe(true);
    expect(await releaseRegistrationCodeClaim(client, winner!.claimId)).toBe(false);
    expect(await consumeRegistrationCode(client, code)).toBeNull();
    expect(sqlite.prepare('SELECT used_count,claimed_count FROM registration_codes WHERE id=?').all('code-1')[0]).toMatchObject({ used_count: 1, claimed_count: 0 });
    sqlite.close();
  });
});
