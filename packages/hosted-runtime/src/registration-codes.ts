export type RegistrationCodeStatement = {
  bind(..._values: unknown[]): RegistrationCodeStatement;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
};

export type RegistrationCodeClient = {
  prepare(_sql: string): RegistrationCodeStatement;
  batch(_statements: RegistrationCodeStatement[]): Promise<Array<{ results?: Array<Record<string, unknown>> }>>;
};

export type RegistrationCodeMetadata = {
  claimId: string;
  codeId: string;
};

const claimExpiresInMs = 15 * 60 * 1000;

export const normalizeRegistrationCode = (value: string): string =>
  value.trim().replace(/[\s-]/gu, '').toUpperCase();

export async function hashRegistrationCode(value: string): Promise<string> {
  const normalized = normalizeRegistrationCode(value);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Atomically claims one registration-code use and records only non-secret claim metadata. */
export async function consumeRegistrationCode(
  client: RegistrationCodeClient,
  code: string,
): Promise<RegistrationCodeMetadata | null> {
  if (!/^REG[A-F0-9]{32}$/u.test(normalizeRegistrationCode(code))) return null;
  const codeHash = await hashRegistrationCode(code);
  const claimId = crypto.randomUUID();
  const now = new Date().toISOString();
  const claimExpiresAt = new Date(Date.now() + claimExpiresInMs).toISOString();
  const result = await client.batch([
    client.prepare(`DELETE FROM registration_code_claims WHERE id IN (
      SELECT id FROM registration_code_claims WHERE code_id=(SELECT id FROM registration_codes WHERE code_hash=?)
        AND status IN ('released','expired') ORDER BY updated_at LIMIT 100
    )`).bind(codeHash),
    client.prepare(`UPDATE registration_code_claims SET status='expired',updated_at=?
      WHERE code_id=(SELECT id FROM registration_codes WHERE code_hash=?) AND status='claimed' AND expires_at<=?`).bind(now, codeHash, now),
    client.prepare(`UPDATE registration_codes SET used_count=(SELECT COUNT(*) FROM registration_code_claims c WHERE c.code_id=registration_codes.id AND c.status='consumed'),claimed_count=(SELECT COUNT(*) FROM registration_code_claims c WHERE c.code_id=registration_codes.id AND c.status='claimed' AND c.expires_at>?),updated_at=? WHERE code_hash=?`).bind(now, now, codeHash),
    client.prepare(`INSERT INTO registration_code_claims (id,code_id,status,expires_at,created_at,updated_at)
      SELECT ?,id,'claimed',?,?,? FROM registration_codes
      WHERE code_hash=? AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at>?)
        AND (SELECT COUNT(*) FROM registration_code_claims c
          WHERE c.code_id=registration_codes.id AND c.status IN ('claimed','dispatching','consumed')
            AND (c.status<>'claimed' OR c.expires_at>?)) < max_uses
      RETURNING id,code_id`).bind(claimId, claimExpiresAt, now, now, codeHash, now, now),
    client.prepare(`UPDATE registration_codes SET used_count=(SELECT COUNT(*) FROM registration_code_claims c WHERE c.code_id=registration_codes.id AND c.status='consumed'),claimed_count=(SELECT COUNT(*) FROM registration_code_claims c WHERE c.code_id=registration_codes.id AND c.status='claimed' AND c.expires_at>?),updated_at=? WHERE code_hash=?`).bind(now, now, codeHash),
  ]);
  const claimRow = result[3]?.results?.[0];
  if (!claimRow) return null;
  return { claimId, codeId: String(claimRow.code_id) };
}

/** Once a signup may be dispatched, an unknown result must not release this use. */
export async function startRegistrationCodeDispatch(client: RegistrationCodeClient, claimId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await client.batch([
    client.prepare(`UPDATE registration_code_claims SET status='dispatching',updated_at=?
      WHERE id=? AND status='claimed' AND expires_at>? RETURNING id`).bind(now, claimId, now),
    client.prepare(`UPDATE registration_codes SET claimed_count=(SELECT COUNT(*) FROM registration_code_claims c
      WHERE c.code_id=registration_codes.id AND c.status IN ('claimed','dispatching')
        AND (c.status='dispatching' OR c.expires_at>?)),updated_at=?
      WHERE id=(SELECT code_id FROM registration_code_claims WHERE id=? AND status='dispatching')`).bind(now, now, claimId),
  ]);
  return (result[0]?.results?.length ?? 0) === 1;
}

export async function finalizeRegistrationCodeClaim(client: RegistrationCodeClient, claimId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await client.batch([
    client.prepare(`UPDATE registration_code_claims SET status='consumed',updated_at=? WHERE id=? AND status='dispatching' RETURNING id`).bind(now, claimId),
    client.prepare(`UPDATE registration_codes SET used_count=(SELECT COUNT(*) FROM registration_code_claims c WHERE c.code_id=registration_codes.id AND c.status='consumed'),claimed_count=(SELECT COUNT(*) FROM registration_code_claims c WHERE c.code_id=registration_codes.id AND c.status='claimed' AND c.expires_at>?),updated_at=? WHERE id=(SELECT code_id FROM registration_code_claims WHERE id=?)`).bind(now, now, claimId),
  ]);
  return (result[0]?.results?.length ?? 0) === 1;
}

export async function releaseRegistrationCodeClaim(client: RegistrationCodeClient, claimId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await client.batch([
    client.prepare(`UPDATE registration_code_claims SET status='released',updated_at=? WHERE id=? AND status IN ('claimed','dispatching') RETURNING id`).bind(now, claimId),
    client.prepare(`UPDATE registration_codes SET claimed_count=(SELECT COUNT(*) FROM registration_code_claims c WHERE c.code_id=registration_codes.id AND c.status='claimed' AND c.expires_at>?),updated_at=? WHERE id=(SELECT code_id FROM registration_code_claims WHERE id=?)`).bind(now, now, claimId),
  ]);
  return (result[0]?.results?.length ?? 0) === 1;
}

export async function expireRegistrationCodeClaims(client: RegistrationCodeClient): Promise<number> {
  const now = new Date().toISOString();
  const result = await client.prepare(`UPDATE registration_code_claims SET status='expired',updated_at=?
    WHERE id IN (SELECT id FROM registration_code_claims WHERE status='claimed' AND expires_at<=? ORDER BY expires_at LIMIT 100)
    RETURNING id`).bind(now, now).all();
  return result.results?.length ?? 0;
}
