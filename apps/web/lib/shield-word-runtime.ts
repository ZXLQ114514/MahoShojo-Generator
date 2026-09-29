import 'server-only';

import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { getShieldWordSettings } from '@/lib/db/repositories/shield-word-settings';
import { setRuntimeShieldWordRules, type ShieldWordRule } from '@/lib/shield-word-filter';

const RUNTIME_RULE_TTL_MS = 30_000;

let loadedAt = 0;
let loadedRules: ShieldWordRule[] = [];
let loadedRevision: string | null = null;
let settingsAvailable = false;
let installGeneration = 0;
let refreshInProgress = false;

type RuntimeShieldWordInstallOptions = {
  revision?: string | null;
  available?: boolean;
};

export const installRuntimeShieldWordRules = (
  rules: readonly ShieldWordRule[],
  options: RuntimeShieldWordInstallOptions = {},
): void => {
  loadedRules = rules.map((rule) => ({ ...rule }));
  loadedRevision = options.revision ?? null;
  settingsAvailable = options.available ?? true;
  installGeneration += 1;
  setRuntimeShieldWordRules(loadedRules);
  loadedAt = Date.now();
};

export const ensureRuntimeShieldWordRules = async (): Promise<void> => {
  if (Date.now() - loadedAt < RUNTIME_RULE_TTL_MS) return;
  // Worker 请求之间不共享正在执行 D1 I/O 的 Promise，避免跨请求上下文等待。
  if (refreshInProgress) return;

  refreshInProgress = true;
  const refreshGeneration = installGeneration;
  try {
    const db = getDrizzleDbFromRuntime();
    if (!db) {
      if (loadedAt === 0) installRuntimeShieldWordRules([], { available: false });
      else loadedAt = Date.now();
      return;
    }
    const settings = await getShieldWordSettings(db);
    // 管理员可能在本次 D1 查询期间安装了更新快照，旧查询不得覆盖新规则。
    if (installGeneration !== refreshGeneration) return;
    // 已有有效快照不能被瞬时 D1 故障覆盖。
    if (!settings.available && loadedAt > 0) {
      loadedAt = Date.now();
      return;
    }
    if (!settings.available) {
      installRuntimeShieldWordRules([], { available: false });
      return;
    }
    installRuntimeShieldWordRules(settings.rules, {
      revision: settings.revision,
      available: true,
    });
  } catch {
    // 过滤规则刷新失败不能阻断私有业务请求；公开内容路径会根据 available 失败关闭。
    if (loadedAt > 0) loadedAt = Date.now();
    else installRuntimeShieldWordRules([], { available: false });
  } finally {
    refreshInProgress = false;
  }
};

export const getRuntimeShieldWordRulesSnapshot = async () => {
  await ensureRuntimeShieldWordRules();
  return {
    rules: loadedRules.map((rule) => ({ ...rule })),
    revision: loadedRevision,
    available: settingsAvailable,
  };
};
