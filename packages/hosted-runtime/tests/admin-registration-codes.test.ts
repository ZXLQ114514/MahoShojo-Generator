import { afterEach, describe, expect, it } from 'vitest';
import { ADMIN_BUSINESS_ACTIONS } from '../src/admin/business-actions';
import { adminManagementFixture } from './admin-management-fixture';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((close) => close()));

describe('Admin registration codes', () => {
  it('creates opaque registration code records without accepting plaintext', async () => {
    const fixture = await adminManagementFixture(['registration.write']);
    cleanups.push(() => fixture.sqlite.close());
    const action = ADMIN_BUSINESS_ACTIONS.find((item) => item.name === 'registration-codes.create')!;
    const response = await action.execute(fixture.db, {
      count: 1,
      maxUses: 2,
      validForSeconds: 3600,
      codes: [{ id: '00000000-0000-4000-8000-000000000001', codeHash: 'a'.repeat(64), codePrefix: 'REG-ABCD1234' }],
      reason: '测试注册码',
      idempotencyKey: 'registration-create-1',
    }, fixture.context);
    expect(response).toMatchObject({ status: 'succeeded', result: { count: 1, codePrefixes: ['REG-ABCD1234'] } });
    const row = fixture.sqlite.prepare('SELECT code_hash,code_prefix,max_uses,used_count,claimed_count,created_by_admin_principal_id FROM registration_codes').get();
    expect(row).toMatchObject({ code_hash: 'a'.repeat(64), code_prefix: 'REG-ABCD1234', max_uses: 2, used_count: 0, claimed_count: 0, created_by_admin_principal_id: 'operator' });
  });

  it('revokes a registration code with CAS', async () => {
    const fixture = await adminManagementFixture(['registration.write']);
    cleanups.push(() => fixture.sqlite.close());
    const create = ADMIN_BUSINESS_ACTIONS.find((item) => item.name === 'registration-codes.create')!;
    await create.execute(fixture.db, { count: 1, maxUses: 1, validForSeconds: 0, codes: [{ id: '00000000-0000-4000-8000-000000000002', codeHash: 'b'.repeat(64), codePrefix: 'REG-5678ABCD' }], reason: 'create', idempotencyKey: 'registration-create-2' }, fixture.context);
    const row = fixture.sqlite.prepare('SELECT * FROM registration_codes').get()!;
    const { adminActionVersion } = await import('../src/admin/business-actions');
    const expectedVersion = await adminActionVersion('registration-codes', row);
    const revoke = ADMIN_BUSINESS_ACTIONS.find((item) => item.name === 'registration-codes.revoke')!;
    await expect(revoke.execute(fixture.db, { id: row.id, expectedVersion, reason: 'revoke', idempotencyKey: 'registration-revoke-1' }, fixture.context)).resolves.toMatchObject({ status: 'succeeded' });
    expect(fixture.sqlite.prepare('SELECT revoked_at FROM registration_codes WHERE id=?').get(row.id)?.revoked_at).toBeTruthy();
  });
});
