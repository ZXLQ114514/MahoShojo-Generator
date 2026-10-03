import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { ArenaGenerationObjectStore } from './d1-finalization';

const rootPath = (env: Readonly<Record<string, string | undefined>>): string | null => {
  const root = env.LOCAL_OBJECTS_DIR?.trim();
  return root ? path.resolve(root) : null;
};

const safePath = (root: string, key: string): string => {
  if (!key.trim() || key.includes('\0')) throw new Error('LOCAL_OBJECT_KEY_INVALID');
  const normalized = key.replace(/\\/gu, '/').replace(/^\/+/, '');
  const target = path.resolve(root, normalized);
  if (target === root || !target.startsWith(`${root}${path.sep}`)) {
    throw new Error('LOCAL_OBJECT_KEY_INVALID');
  }
  return target;
};

export type LocalObjectStore = ArenaGenerationObjectStore & {
  root: string;
};

export const createArenaLocalObjectStoreFromEnvironment = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): LocalObjectStore | null => {
  const root = rootPath(env);
  if (!root) return null;
  return Object.freeze({
    root,
    async put(input) {
      const target = safePath(root, input.key);
      const temporary = `${target}.tmp-${crypto.randomUUID()}`;
      const body = new TextEncoder().encode(input.body);
      const parent = path.dirname(target);
      await fs.mkdir(parent, { recursive: true });
      try {
        await fs.writeFile(temporary, body, { flag: 'wx' });
        await fs.rename(temporary, target);
      } catch (error) {
        await fs.rm(temporary, { force: true }).catch(() => undefined);
        throw error;
      }
      return {
        bytes: body.byteLength,
        storedBytes: body.byteLength,
        contentEncoding: null,
      };
    },
    async getText(key) {
      try {
        const bytes = await fs.readFile(safePath(root, key));
        return { kind: 'found', text: new TextDecoder().decode(bytes) };
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return { kind: 'not-found' };
        throw error;
      }
    },
  });
};
