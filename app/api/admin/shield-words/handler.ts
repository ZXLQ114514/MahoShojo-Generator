import { adminJson, requireAdminUser } from '@/lib/auth/admin';
import { prepareAuthAuditLogInsert } from '@/lib/db/repositories/auth-audit-logs';
import {
  getShieldWordSettings,
  prepareShieldWordSettingsUpdate,
} from '@/lib/db/repositories/shield-word-settings';
import { sha256Hex } from '@/lib/pvp/crypto';
import {
  getShieldWordRuleKey,
  normalizeShieldWordRules,
  SHIELD_WORD_MAX_LENGTH,
  SHIELD_WORD_MAX_REPLACEMENT_LENGTH,
  SHIELD_WORD_MAX_REQUEST_BYTES,
  SHIELD_WORD_MAX_RULES,
} from '@/lib/shield-word-settings';
import { getBuiltInShieldWordCount } from '@/lib/shield-word-filter';
import { installRuntimeShieldWordRules } from '@/lib/shield-word-runtime';

const getClientIp = (req: Request): string | null =>
  req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

const summarizeChanges = (
  before: Awaited<ReturnType<typeof getShieldWordSettings>>['rules'],
  after: Awaited<ReturnType<typeof getShieldWordSettings>>['rules'],
) => {
  const beforeMap = new Map(before.map((rule) => [getShieldWordRuleKey(rule.word), rule.replacement]));
  const afterMap = new Map(after.map((rule) => [getShieldWordRuleKey(rule.word), rule.replacement]));
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const [key, replacement] of afterMap) {
    if (!beforeMap.has(key)) added += 1;
    else if (beforeMap.get(key) !== replacement) changed += 1;
  }
  for (const key of beforeMap.keys()) if (!afterMap.has(key)) removed += 1;
  return { added, removed, changed };
};

export const createAdminShieldWordsHandler = () => async (req: Request): Promise<Response> => {
  const auth = await requireAdminUser(req, { requireSameOrigin: req.method === 'PATCH' });
  if ('response' in auth) return auth.response;

  if (req.method === 'GET') {
    const settings = await getShieldWordSettings(auth.db);
    if (!settings.available) return adminJson({ error: '屏蔽词设置读取失败' }, 503);
    return adminJson({
      rules: settings.rules,
      revision: settings.revision,
      builtInRuleCount: getBuiltInShieldWordCount(),
      limits: {
        maxRules: SHIELD_WORD_MAX_RULES,
        maxWordLength: SHIELD_WORD_MAX_LENGTH,
        maxReplacementLength: SHIELD_WORD_MAX_REPLACEMENT_LENGTH,
      },
    }, 200);
  }

  if (req.method !== 'PATCH') return adminJson({ error: '不支持的请求方法' }, 405);
  let parsedBody: unknown;
  try {
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > SHIELD_WORD_MAX_REQUEST_BYTES) {
      return adminJson({ error: `请求体不能超过 ${SHIELD_WORD_MAX_REQUEST_BYTES / 1024} KB` }, 413);
    }
    parsedBody = JSON.parse(rawBody) as unknown;
  } catch {
    return adminJson({ error: '请求体不是合法 JSON' }, 400);
  }
  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    return adminJson({ error: '请求体必须是 JSON 对象' }, 400);
  }
  const body = parsedBody as { rules?: unknown };
  const normalized = normalizeShieldWordRules(body.rules);
  if (!normalized.ok) return adminJson({ error: normalized.error }, 400);

  const previous = await getShieldWordSettings(auth.db);
  if (!previous.available) return adminJson({ error: '屏蔽词设置读取失败，未执行覆盖' }, 503);
  const changes = summarizeChanges(previous.rules, normalized.rules);
  const digest = (await sha256Hex(JSON.stringify(normalized.rules))).slice(0, 16);
  const settingsUpdate = prepareShieldWordSettingsUpdate(auth.db, auth.user.id, normalized.rules);
  const auditInsert = prepareAuthAuditLogInsert(auth.db, {
    businessUserId: auth.user.id,
    eventType: 'admin_shield_words_update',
    authSource: 'admin-panel',
    ip: getClientIp(req),
    userAgent: req.headers.get('user-agent'),
    resultCode: 'success',
    metadataJson: JSON.stringify({
      version: 1,
      beforeCount: previous.rules.length,
      afterCount: normalized.rules.length,
      ...changes,
      digest,
    }),
  });
  if (!auditInsert) return adminJson({ error: '屏蔽词设置审计参数无效，未执行覆盖' }, 500);
  await auth.db.batch([settingsUpdate.query, auditInsert.query] as const);
  installRuntimeShieldWordRules(normalized.rules, {
    revision: settingsUpdate.revision,
    available: true,
  });
  return adminJson({ success: true, rules: normalized.rules, revision: settingsUpdate.revision }, 200);
};
