import { z } from 'zod';
import { commonInput, defineAction, fields, mutationInput, snapshot } from './core';

const positive = z.number().int().positive().max(1_000_000);

export const IMAGE_GENERATION_ACTIONS = [
  defineAction({
    name: 'image-generation-licenses.create',
    label: '创建图片生成许可',
    resource: 'image-generation-licenses',
    capability: 'ai.write',
      fields: fields([['maxUses', '可使用次数', 'number'], ['validForSeconds', '有效秒数', 'number'], ['keyHash', '许可哈希', 'text'], ['keyPrefix', '许可前缀', 'text']]),
  }, z.object({
    ...commonInput,
    maxUses: positive,
    validForSeconds: z.number().int().min(60).max(365 * 24 * 60 * 60),
    keyHash: z.string().regex(/^[a-f0-9]{64}$/),
    keyPrefix: z.string().regex(/^mgl_[A-Za-z0-9_-]{8}$/),
  }).strict(), async (_db, input, context) => {
    // The browser generates the plaintext key. The server receives only hash/prefix.
    const hash = input.keyHash;
    const keyPrefix = input.keyPrefix;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + input.validForSeconds * 1000).toISOString();
    return {
      targetId: keyPrefix,
      plan: {
        primary: {
          name: 'create-image-generation-license',
          sql: `INSERT INTO image_generation_licenses (id,key_hash,key_prefix,max_uses,remaining_uses,expires_at,created_by_user_id,created_by_admin_principal_id,created_at,updated_at)
            SELECT ?,?,?,?,?,?,NULL,?,?,? WHERE {{admin_guard}}`,
          bindings: [crypto.randomUUID(), hash, keyPrefix, input.maxUses, input.maxUses, expiresAt, context.principalId, now, now],
          expectedChanges: 1,
        },
        result: { keyPrefix, maxUses: input.maxUses, expiresAt },
      },
    };
  }),
  defineAction({
    name: 'image-generation-licenses.revoke',
    label: '撤销图片生成许可',
    resource: 'image-generation-licenses',
    capability: 'ai.write',
    fields: fields([['id', '许可 ID', 'text'], ['expectedVersion', '当前版本', 'text']]),
  }, z.object(mutationInput).strict(), async (db, input) => {
    const current = await snapshot(db, 'image-generation-licenses', input.id, input.expectedVersion);
    const now = new Date().toISOString();
    return {
      targetId: input.id,
      plan: {
        primary: {
          name: 'revoke-image-generation-license',
          sql: `UPDATE image_generation_licenses SET revoked_at=?,updated_at=? WHERE ${current.where} AND revoked_at IS NULL AND {{admin_guard}}`,
          bindings: [now, now, ...current.bindings],
        },
        result: { id: input.id, revoked: true },
      },
    };
  }),
];
