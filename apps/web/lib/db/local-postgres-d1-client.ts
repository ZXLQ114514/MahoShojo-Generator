import 'server-only';

type PgField = { name: string };
type PgQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> = {
  rows: Row[];
  rowCount: number | null;
  fields: PgField[];
};
type PgClient = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(sqlText: string, params?: unknown[]): Promise<PgQueryResult<Row>>;
  release(): void;
};
type Pool = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(sqlText: string, params?: unknown[]): Promise<PgQueryResult<Row>>;
  connect(): Promise<PgClient>;
};

type D1Row = Record<string, unknown>;

type D1Result = {
  success: boolean;
  results: D1Row[];
  meta: Record<string, unknown>;
  error?: string;
};

type PgModule = { Pool: new (options: { connectionString: string; max: number }) => Pool };
type NodeFs = { readFileSync(path: string, encoding: 'utf8'): string };
type NodePath = { resolve(...parts: string[]): string };

const loadPg = (): PgModule => {
  const dynamicRequire = eval('require') as (moduleName: string) => PgModule;
  return dynamicRequire('pg');
};

const loadNodeFs = (): NodeFs => {
  const dynamicRequire = eval('require') as (moduleName: string) => NodeFs;
  return dynamicRequire('node:fs');
};

const loadNodePath = (): NodePath => {
  const dynamicRequire = eval('require') as (moduleName: string) => NodePath;
  return dynamicRequire('node:path');
};

const LOCAL_SCHEMA_MARKER = '_mahoshojo_local_schema';
const poolCache = new Map<string, Pool>();
const readyCache = new Map<string, Promise<void>>();
const clientCache = new Map<string, LocalPostgresD1Client>();

const replaceQuestionMarks = (sqlText: string): string => {
  let parameterIndex = 0;
  let quote: string | null = null;
  let output = '';

  for (let index = 0; index < sqlText.length; index += 1) {
    const character = sqlText[index];
    if (quote) {
      output += character;
      if (character === quote && sqlText[index + 1] === quote) {
        output += sqlText[index + 1];
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "'" || character === '"' || character === '`') {
      quote = character === '`' ? '"' : character;
      output += character === '`' ? '"' : character;
      continue;
    }
    if (character === '?') {
      parameterIndex += 1;
      output += `$${parameterIndex}`;
      continue;
    }
    output += character;
  }

  return output;
};

export const translateLocalPostgresSql = (sqlText: string): string => {
  let translated = sqlText.trim().replace(/;+$\s*/g, '');
  const isInsertOrIgnore = /^INSERT\s+OR\s+IGNORE\s+/i.test(translated);
  translated = translated.replace(/^INSERT\s+OR\s+IGNORE\s+/i, 'INSERT ');
  translated = translated.replace(/datetime\('now',\s*'-3 days'\)/gi, "CURRENT_TIMESTAMP - INTERVAL '3 days'");
  translated = translated.replace(/unixepoch\(\)/gi, 'EXTRACT(EPOCH FROM NOW())::BIGINT');
  translated = translated.replace(
    /strftime\('\%s',\s*((?:"[^"]+"\.)?"[^"]+")\)/gi,
    "EXTRACT(EPOCH FROM $1::timestamp)",
  );
  translated = translated.replace(
    /json_extract\(\s*((?:"[^"]+"\.)?"[^"]+"),\s*'\$\.([A-Za-z0-9_]+)'\s*\)/gi,
    "($1::jsonb ->> '$2')",
  );
  translated = replaceQuestionMarks(translated);

  if (isInsertOrIgnore && !/\sON\s+CONFLICT\s+/i.test(translated)) {
    const returningIndex = translated.search(/\sRETURNING\s/i);
    if (returningIndex >= 0) {
      translated = `${translated.slice(0, returningIndex)} ON CONFLICT DO NOTHING${translated.slice(returningIndex)}`;
    } else {
      translated += ' ON CONFLICT DO NOTHING';
    }
  }
  return translated;
};

/** 解析 schema 中每张表的 BOOLEAN 列集，供 INSERT 字面量转换使用 */
const collectBooleanColumns = (schemaSql: string): Map<string, Set<string>> => {
  const result = new Map<string, Set<string>>();
  const tablePattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_]+)\s*\(([\s\S]*?)\)\s*;/gi;
  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tablePattern.exec(schemaSql)) !== null) {
    const tableName = tableMatch[1].toLowerCase();
    const body = tableMatch[2];
    const columns = new Set<string>();
    for (const columnMatch of body.matchAll(/([a-z_]+)\s+BOOLEAN\b/gi)) {
      columns.add(columnMatch[1].toLowerCase());
    }
    result.set(tableName, columns);
  }
  return result;
};

/** 按顶层逗号拆分（跳过单引号字符串与嵌套括号） */
const splitTopLevelValues = (valuesText: string): string[] => {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let inQuote = false;
  for (let i = 0; i < valuesText.length; i += 1) {
    const char = valuesText[i];
    if (inQuote) {
      current += char;
      if (char === "'") {
        if (valuesText[i + 1] === "'") {
          current += valuesText[i + 1];
          i += 1;
        } else {
          inQuote = false;
        }
      }
      continue;
    }
    if (char === "'") {
      inQuote = true;
      current += char;
      continue;
    }
    if (char === '(') {
      depth += 1;
      current += char;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      current += char;
      continue;
    }
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
};

/** 将 INSERT 语句中布尔列对应位置的裸 0/1 字面量转换为 FALSE/TRUE */
const translateInsertBooleanLiterals = (
  statement: string,
  booleanColumns: Map<string, Set<string>>,
): string => {
  const headMatch = statement.match(/^\s*INSERT\s+INTO\s+([a-z_]+)\s*\(([\s\S]*?)\)\s*VALUES\s*\(/i);
  if (!headMatch) return statement;
  const tableName = headMatch[1].toLowerCase();
  const booleanSet = booleanColumns.get(tableName);
  if (!booleanSet) return statement;

  const columns = splitTopLevelValues(headMatch[2]).map((column) => column.replace(/^["`]|["`]$/g, '').toLowerCase());
  const valuesIndex = headMatch[0].length - 1; // 指向 VALUES 开头的 '('
  const valuesStart = statement.indexOf('(', valuesIndex);
  if (valuesStart < 0) return statement;
  // 找到匹配的 VALUES 闭合括号（顶层）
  let depth = 0;
  let valuesEnd = -1;
  let inQuote = false;
  for (let i = valuesStart; i < statement.length; i += 1) {
    const char = statement[i];
    if (inQuote) {
      if (char === "'") {
        if (statement[i + 1] === "'") { i += 1; } else { inQuote = false; }
      }
      continue;
    }
    if (char === "'") { inQuote = true; continue; }
    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) { valuesEnd = i; break; }
    }
  }
  if (valuesEnd < 0) return statement;

  const valuesText = statement.slice(valuesStart + 1, valuesEnd);
  const values = splitTopLevelValues(valuesText);
  const replaced = values.map((value, index) => {
    const column = columns[index];
    if (column && booleanSet.has(column) && /^\s*[01]\s*$/.test(value)) {
      return value.trim() === '1' ? 'TRUE' : 'FALSE';
    }
    return value;
  });
  return `${statement.slice(0, valuesStart + 1)}${replaced.join(', ')}${statement.slice(valuesEnd)}`;
};

const translateSchema = (schemaSql: string): string => {
  let translated = schemaSql
    .replace(/\bDATETIME\b(?!\s*\()/gi, 'TIMESTAMP')
    .replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi, 'INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY')
    .replace(/\bBOOLEAN(\s+NOT\s+NULL)?\s+DEFAULT\s+0\b/gi, 'BOOLEAN$1 DEFAULT FALSE')
    .replace(/\bBOOLEAN(\s+NOT\s+NULL)?\s+DEFAULT\s+1\b/gi, 'BOOLEAN$1 DEFAULT TRUE')
    .replace(/unixepoch\(\)/gi, 'EXTRACT(EPOCH FROM NOW())::BIGINT')
    .replace(/datetime\('now',\s*'-3 days'\)/gi, "CURRENT_TIMESTAMP - INTERVAL '3 days'")
    .replace(/^INSERT\s+OR\s+IGNORE\s+/gim, 'INSERT ');

  const booleanColumns = collectBooleanColumns(translated);
  translated = translated.replace(/(INSERT\s+INTO[\s\S]*?;)/gi, (statement) => {
    const withBooleans = translateInsertBooleanLiterals(statement, booleanColumns);
    if (/\sON\s+CONFLICT\s+/i.test(withBooleans)) return withBooleans;
    return withBooleans.replace(/;\s*$/, ' ON CONFLICT DO NOTHING;');
  });
  return translated;
};

const getPool = (connectionString: string): Pool => {
  const cached = poolCache.get(connectionString);
  if (cached) return cached;
  const pool = new (loadPg().Pool)({ connectionString, max: 10 });
  poolCache.set(connectionString, pool);
  return pool;
};

const ensureLocalSchema = (pool: Pool, connectionString: string): Promise<void> => {
  const cached = readyCache.get(connectionString);
  if (cached) return cached;

  const ready = (async () => {
    const client = await pool.connect();
    try {
      await client.query(`CREATE TABLE IF NOT EXISTS ${LOCAL_SCHEMA_MARKER} (id BOOLEAN PRIMARY KEY DEFAULT TRUE, schema_version INTEGER NOT NULL)`);
      const marker = await client.query<{ schema_version: number }>(
        `SELECT schema_version FROM ${LOCAL_SCHEMA_MARKER} WHERE id = TRUE LIMIT 1`,
      );
      if (marker.rows.length > 0) return;

      // workspace 包内运行时 cwd 为 apps/web，schema.sql 位于 apps/web/lib/database/
      const schemaPath = loadNodePath().resolve(process.cwd(), 'lib/database/schema.sql');
      const schemaSql = translateSchema(loadNodeFs().readFileSync(schemaPath, 'utf8'));
      // better-auth 域表（ba_user）定义在仓库根 drizzle/0000 迁移中，业务 schema.sql 仅以
      // FOREIGN KEY 引用；PostgreSQL 要求被引用表先存在，故本地初始化前置创建。
      const authDomainPath = loadNodePath().resolve(process.cwd(), '../../drizzle/0000_auth_domain_bootstrap.sql');
      const authDomainSql = loadNodeFs().readFileSync(authDomainPath, 'utf8');
      const baUserMatch = authDomainSql.match(/CREATE TABLE IF NOT EXISTS ba_user \([\s\S]*?\n\);/);
      if (!baUserMatch) {
        throw new Error('本地 PostgreSQL 初始化失败：未能在 drizzle/0000 中找到 ba_user 域表定义');
      }
      const baUserSql = translateSchema(baUserMatch[0]);
      await client.query('BEGIN');
      try {
        await client.query(baUserSql);
        await client.query(schemaSql);
        await client.query(`INSERT INTO ${LOCAL_SCHEMA_MARKER} (id, schema_version) VALUES (TRUE, 1)`);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } finally {
      client.release();
    }
  })();

  readyCache.set(connectionString, ready);
  return ready;
};

class LocalPostgresPreparedStatement {
  constructor(
    private readonly pool: Pool,
    private readonly ready: Promise<void>,
    readonly sqlText: string,
    readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): LocalPostgresPreparedStatement {
    return new LocalPostgresPreparedStatement(this.pool, this.ready, this.sqlText, params);
  }

  async run(): Promise<D1Result> {
    await this.ready;
    const result = await this.pool.query(translateLocalPostgresSql(this.sqlText), this.params);
    return { success: true, results: [], meta: { changes: result.rowCount ?? 0 } };
  }

  async all(): Promise<D1Result> {
    await this.ready;
    const result = await this.pool.query<D1Row>(translateLocalPostgresSql(this.sqlText), this.params);
    return { success: true, results: result.rows, meta: { changes: result.rowCount ?? 0 } };
  }

  async first<T = unknown>(columnName?: string): Promise<T | null> {
    const result = await this.all();
    const row = result.results[0];
    if (!row) return null;
    if (columnName) return (row[columnName] ?? null) as T | null;
    return row as T;
  }

  async raw(options?: { columnNames?: boolean }): Promise<unknown[][] | [string[], ...unknown[][]]> {
    await this.ready;
    const result = await this.pool.query<Record<string, unknown>>(translateLocalPostgresSql(this.sqlText), this.params);
    const columns = result.fields.map((field) => field.name);
    const rows = result.rows.map((row) => columns.map((column) => row[column]));
    return options?.columnNames ? [columns, ...rows] : rows;
  }
}

class LocalPostgresD1Client {
  constructor(private readonly pool: Pool, private readonly ready: Promise<void>) {}

  prepare(sqlText: string): LocalPostgresPreparedStatement {
    return new LocalPostgresPreparedStatement(this.pool, this.ready, sqlText);
  }

  async batch(statements: LocalPostgresPreparedStatement[]): Promise<D1Result[]> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const results: D1Result[] = [];
      for (const statement of statements) {
        const result = await client.query(translateLocalPostgresSql(statement.sqlText), statement.params);
        results.push({ success: true, results: result.rows as D1Row[], meta: { changes: result.rowCount ?? 0 } });
      }
      await client.query('COMMIT');
      return results;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async exec(sqlText: string): Promise<{ count: number; duration: number }> {
    await this.ready;
    const result = await this.pool.query(translateLocalPostgresSql(sqlText));
    return { count: result.rowCount ?? 0, duration: 0 };
  }
}

export const createLocalPostgresD1Client = (): unknown => {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error('本地 PostgreSQL 模式缺少 DATABASE_URL 配置');
  }
  const pool = getPool(connectionString);
  const ready = ensureLocalSchema(pool, connectionString);
  const cached = clientCache.get(connectionString);
  if (cached) return cached;
  const client = new LocalPostgresD1Client(pool, ready);
  clientCache.set(connectionString, client);
  return client;
};