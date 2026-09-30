import { afterEach, describe, expect, it } from 'vitest';
import { ADMIN_BUSINESS_ACTIONS } from '../src/admin/business-actions';
import { adminManagementFixture } from './admin-management-fixture';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((close) => close()));

describe('Admin image generation licenses', () => {
  it('creates a principal-owned license without persisting plaintext key', async () => {
    const fixture = await adminManagementFixture(['ai.write']);
    cleanups.push(() => fixture.sqlite.close());
    const action = ADMIN_BUSINESS_ACTIONS.find((item) => item.name === 'image-generation-licenses.create')!;
    const licenseKey = 'mgl_test-license-secret';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(licenseKey));
    const keyHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const result = await action.execute(fixture.db, {
      maxUses: 3,
      validForSeconds: 3600,
      keyHash,
      keyPrefix: licenseKey.slice(0, 12),
      reason: '本地许可测试',
      idempotencyKey: 'license-create-1',
    }, fixture.context);
    expect(result).toMatchObject({ status: 'succeeded', replayed: false, result: { keyPrefix: expect.stringMatching(/^mgl_/) } });
    const row = fixture.sqlite.prepare('SELECT key_hash, key_prefix, created_by_user_id, created_by_admin_principal_id, remaining_uses FROM image_generation_licenses').get();
    expect(row).toMatchObject({ created_by_user_id: null, created_by_admin_principal_id: 'operator', remaining_uses: 3 });
    expect(JSON.stringify(row)).not.toContain(licenseKey);
    expect(fixture.sqlite.prepare('SELECT result_json FROM admin_operations').get()?.result_json).not.toContain(licenseKey);
  });

  it('revokes a license with version CAS and idempotent replay', async () => {
    const fixture = await adminManagementFixture(['ai.write']);
    cleanups.push(() => fixture.sqlite.close());
    const action = ADMIN_BUSINESS_ACTIONS.find((item) => item.name === 'image-generation-licenses.create')!;
    const createKey = 'mgl_test-license-secret-2';
    const createDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(createKey));
    await action.execute(fixture.db, { maxUses: 1, validForSeconds: 3600, keyHash: Array.from(new Uint8Array(createDigest), (byte) => byte.toString(16).padStart(2, '0')).join(''), keyPrefix: createKey.slice(0, 12), reason: 'create', idempotencyKey: 'license-create-2' }, fixture.context);
    const row = fixture.sqlite.prepare('SELECT * FROM image_generation_licenses').get()!;
    const { adminActionVersion } = await import('../src/admin/business-actions');
    const expectedVersion = await adminActionVersion('image-generation-licenses', row);
    const revoke = ADMIN_BUSINESS_ACTIONS.find((item) => item.name === 'image-generation-licenses.revoke')!;
    const input = { id: row.id, expectedVersion, reason: '撤销测试', idempotencyKey: 'license-revoke-1' };
    expect(await revoke.execute(fixture.db, input, fixture.context)).toMatchObject({ status: 'succeeded', replayed: false });
    expect(await revoke.execute(fixture.db, input, fixture.context)).toMatchObject({ status: 'succeeded', replayed: true });
    expect(fixture.sqlite.prepare('SELECT revoked_at FROM image_generation_licenses WHERE id=?').get(row.id)?.revoked_at).toBeTruthy();
  });
});
