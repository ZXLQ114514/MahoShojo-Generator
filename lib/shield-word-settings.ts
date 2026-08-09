import { foldAsciiCase, foldFullwidthAscii, toSimplifiedChinese } from '@/lib/word-filter-utils';
import { createShieldWordFilter, type ShieldWordRule } from '@/lib/shield-word-filter';

export const SHIELD_WORD_SETTINGS_VERSION = 1;
export const SHIELD_WORD_MAX_RULES = 300;
export const SHIELD_WORD_MAX_LENGTH = 80;
export const SHIELD_WORD_MAX_REPLACEMENT_LENGTH = 120;
export const SHIELD_WORD_MAX_JSON_BYTES = 64 * 1024;
export const SHIELD_WORD_MAX_REQUEST_BYTES = 96 * 1024;

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export type ShieldWordSettingsValidation =
  | { ok: true; rules: ShieldWordRule[] }
  | { ok: false; error: string };

export const getShieldWordRuleKey = (word: string): string =>
  foldAsciiCase(foldFullwidthAscii(toSimplifiedChinese(word))).trim();

const characterLength = (value: string): number => Array.from(value).length;

export const normalizeShieldWordRules = (value: unknown): ShieldWordSettingsValidation => {
  if (!Array.isArray(value)) return { ok: false, error: '屏蔽词规则必须是数组' };
  if (value.length > SHIELD_WORD_MAX_RULES) {
    return { ok: false, error: `自定义屏蔽词最多 ${SHIELD_WORD_MAX_RULES} 条` };
  }

  const seen = new Set<string>();
  const rules: ShieldWordRule[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, error: `第 ${index + 1} 条屏蔽词规则格式不正确` };
    }
    const candidate = item as { word?: unknown; replacement?: unknown };
    const word = typeof candidate.word === 'string' ? candidate.word.trim() : '';
    if (!word) return { ok: false, error: `第 ${index + 1} 条屏蔽词不能为空` };
    if (characterLength(word) > SHIELD_WORD_MAX_LENGTH) {
      return { ok: false, error: `第 ${index + 1} 条屏蔽词不能超过 ${SHIELD_WORD_MAX_LENGTH} 个字符` };
    }
    if (CONTROL_CHARACTER_PATTERN.test(word)) {
      return { ok: false, error: `第 ${index + 1} 条屏蔽词不能包含控制字符` };
    }

    let replacement: string | null = null;
    if (candidate.replacement !== null && candidate.replacement !== undefined) {
      if (typeof candidate.replacement !== 'string') {
        return { ok: false, error: `第 ${index + 1} 条替换文本格式不正确` };
      }
      const normalizedReplacement = candidate.replacement.trim();
      if (!normalizedReplacement) {
        return { ok: false, error: `第 ${index + 1} 条替换文本不能为空，如需遮罩请选择遮罩方式` };
      }
      if (characterLength(normalizedReplacement) > SHIELD_WORD_MAX_REPLACEMENT_LENGTH) {
        return { ok: false, error: `第 ${index + 1} 条替换文本不能超过 ${SHIELD_WORD_MAX_REPLACEMENT_LENGTH} 个字符` };
      }
      if (CONTROL_CHARACTER_PATTERN.test(normalizedReplacement)) {
        return { ok: false, error: `第 ${index + 1} 条替换文本不能包含控制字符` };
      }
      replacement = normalizedReplacement;
    }

    const key = getShieldWordRuleKey(word);
    if (!key) return { ok: false, error: `第 ${index + 1} 条屏蔽词规范化后为空` };
    if (seen.has(key)) return { ok: false, error: `第 ${index + 1} 条屏蔽词与其他规则重复` };
    seen.add(key);
    rules.push({ word, replacement });
  }

  const serializedBytes = new TextEncoder().encode(JSON.stringify({
    version: SHIELD_WORD_SETTINGS_VERSION,
    rules,
  })).byteLength;
  if (serializedBytes > SHIELD_WORD_MAX_JSON_BYTES) {
    return { ok: false, error: `屏蔽词配置不能超过 ${SHIELD_WORD_MAX_JSON_BYTES / 1024} KB` };
  }

  if (rules.some((rule) => rule.replacement !== null)) {
    const filter = createShieldWordFilter(rules);
    for (let index = 0; index < rules.length; index += 1) {
      const replacement = rules[index]?.replacement;
      if (replacement !== null && replacement !== undefined && filter(replacement).hasShieldWords) {
        return { ok: false, error: `第 ${index + 1} 条替换文本不能包含屏蔽词` };
      }
    }
  }

  return { ok: true, rules };
};
