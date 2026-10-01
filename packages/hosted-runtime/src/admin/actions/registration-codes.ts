import { z } from 'zod';
import { commonInput, defineAction, fields, mutationInput, snapshot } from './core';

const codeInput = z.object({
  id: z.string().uuid(),
  codeHash: z.string().regex(/^[a-f0-9]{64}$/),
  codePrefix: z.string().regex(/^REG-[A-F0-9]{8}$/),
}).strict();

const create = defineAction({
  name: 'registration-codes.create',
  label: '生成注册码',
  resource: 'registration-codes',
  capability: 'registration.write',
  fields: fields([
    ['count', '生成数量（1–100）', 'number'],
    ['maxUses', '每码可注册次数', 'number'],
    ['validForSeconds', '有效秒数（0 表示永不过期）', 'number'],
  ]),
}, z.object({
  ...commonInput,
  count: z.number().int().min(1).max(100),
  maxUses: z.number().int().min(1).max(1000),
  validForSeconds: z.number().int().min(0).max(365 * 24 * 60 * 60),
  codes: z.array(codeInput).min(1).max(100),
}).strict().superRefine((input, context) => {
  if (input.codes.length !== input.count) context.addIssue({ code: 'custom', path: ['codes'], message: '注册码数量与 count 不一致' });
}), async (_db, input, context) => {
  const now = new Date().toISOString();
  const expiresAt = input.validForSeconds === 0 ? null : new Date(Date.now() + input.validForSeconds * 1000).toISOString();
  const values = input.codes.map((code) => ({
    id: code.id,
    codeHash: code.codeHash,
    codePrefix: code.codePrefix,
  }));
  return {
    targetId: `batch:${input.count}`,
    plan: {
      primary: {
        name: 'create-registration-codes',
        expectedChanges: input.count,
        sql: `INSERT INTO registration_codes
          (id,code_hash,code_prefix,max_uses,used_count,claimed_count,expires_at,created_by_admin_principal_id,created_at,updated_at)
          SELECT json_extract(value,'$.id'),json_extract(value,'$.codeHash'),json_extract(value,'$.codePrefix'),?,?,0,?,?,?,?
          FROM json_each(?) WHERE NOT EXISTS (
            SELECT 1 FROM registration_codes existing WHERE existing.code_hash=json_extract(value,'$.codeHash')
          ) AND {{admin_guard}}`,
        bindings: [input.maxUses, 0, expiresAt, context.principalId, now, now, JSON.stringify(values)],
      },
      result: { count: input.count, codePrefixes: values.map((value) => value.codePrefix), expiresAt, maxUses: input.maxUses },
    },
  };
});

const revoke = defineAction({
  name: 'registration-codes.revoke',
  label: '撤销注册码',
  resource: 'registration-codes',
  capability: 'registration.write',
  fields: fields([['id', '注册码记录 ID', 'text'], ['expectedVersion', '当前版本', 'text']]),
}, z.object(mutationInput).strict(), async (db, input) => {
  const current = await snapshot(db, 'registration-codes', input.id, input.expectedVersion);
  const now = new Date().toISOString();
  return {
    targetId: input.id,
    plan: {
      primary: {
        name: 'revoke-registration-code',
        sql: `UPDATE registration_codes SET revoked_at=?,updated_at=? WHERE ${current.where} AND revoked_at IS NULL AND {{admin_guard}}`,
        bindings: [now, now, ...current.bindings],
      },
      result: { id: input.id, revoked: true },
    },
  };
});

export const REGISTRATION_CODE_ACTIONS = [create, revoke];
