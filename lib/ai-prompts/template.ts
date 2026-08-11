/**
 * Prompt templates deliberately use a tiny, data-only language. Keeping the
 * renderer here (instead of using interpolation/eval) makes administrator
 * supplied text safe to store and deterministic to render on Workers.
 */

export type PromptSlot = {
  name: string;
  label?: string;
  description?: string;
  required?: boolean;
  example?: string;
};

export type PromptTemplateIssueCode =
  | 'empty'
  | 'malformed'
  | 'unknown-slot'
  | 'missing-required-slot'
  | 'invalid-slot-value';

export class PromptTemplateError extends Error {
  readonly code: PromptTemplateIssueCode;
  readonly slot?: string;

  constructor(code: PromptTemplateIssueCode, message: string, slot?: string) {
    super(message);
    this.name = 'PromptTemplateError';
    this.code = code;
    this.slot = slot;
  }
}

const SLOT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const SLOT_TOKEN_PATTERN = /\{\{\s*([A-Za-z][A-Za-z0-9_.-]*)\s*\}\}/g;

const normalizeSlotNames = (slots: readonly (string | PromptSlot)[] | undefined): Set<string> => {
  const result = new Set<string>();
  for (const slot of slots ?? []) {
    const name = typeof slot === 'string' ? slot : slot?.name;
    if (typeof name === 'string' && SLOT_NAME_PATTERN.test(name)) result.add(name);
  }
  return result;
};

const requiredSlotNames = (slots: readonly (string | PromptSlot)[] | undefined): Set<string> => {
  const result = new Set<string>();
  for (const slot of slots ?? []) {
    if (typeof slot !== 'object' || slot === null || slot.required !== true) continue;
    if (SLOT_NAME_PATTERN.test(slot.name)) result.add(slot.name);
  }
  return result;
};

/** Return unique slot names in source order. */
export const extractPromptSlots = (template: string): string[] => {
  if (typeof template !== 'string' || !template) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const match of template.matchAll(SLOT_TOKEN_PATTERN)) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
};

/** Validate a template against a catalog definition before storing it. */
export const validatePromptTemplate = (params: {
  template: unknown;
  slots?: readonly (string | PromptSlot)[];
  requiredSlots?: readonly string[];
  allowEmpty?: boolean;
}): { ok: true; slots: string[] } | { ok: false; error: PromptTemplateError } => {
  if (typeof params.template !== 'string') {
    return { ok: false, error: new PromptTemplateError('invalid-slot-value', '提示词正文必须是字符串') };
  }
  const template = params.template;
  if (!template.trim() && params.allowEmpty !== true) {
    return { ok: false, error: new PromptTemplateError('empty', '提示词正文不能为空') };
  }

  // A token parser alone would silently accept malformed opening braces.
  // Consecutive closing braces are common in nested JSON protocol examples,
  // so only a leftover opening token is unambiguously a broken placeholder.
  const withoutTokens = template.replace(SLOT_TOKEN_PATTERN, '');
  if (withoutTokens.includes('{{')) {
    return { ok: false, error: new PromptTemplateError('malformed', '提示词包含未闭合或非法的占位符') };
  }

  const allowed = normalizeSlotNames(params.slots);
  const names = extractPromptSlots(template);
  for (const name of names) {
    if (!allowed.has(name)) {
      return { ok: false, error: new PromptTemplateError('unknown-slot', `不允许的提示词占位符：{{${name}}}`, name) };
    }
  }

  const required = new Set(params.requiredSlots ?? []);
  for (const name of requiredSlotNames(params.slots)) required.add(name);
  for (const name of required) {
    if (!SLOT_NAME_PATTERN.test(name) || !names.includes(name)) {
      return { ok: false, error: new PromptTemplateError('missing-required-slot', `缺少关键提示词占位符：{{${name}}}`, name) };
    }
  }

  return { ok: true, slots: names };
};

export type PromptVariables = Readonly<Record<string, unknown>>;

/** Render a validated template; inserted values are never parsed recursively. */
export const renderPromptTemplate = (params: {
  template: string;
  variables?: PromptVariables;
  slots?: readonly (string | PromptSlot)[];
  requiredSlots?: readonly string[];
}): string => {
  const validation = validatePromptTemplate({
    template: params.template,
    slots: params.slots,
    requiredSlots: params.requiredSlots,
  });
  if (!validation.ok) throw validation.error;

  const values = params.variables ?? {};
  const required = new Set(params.requiredSlots ?? []);
  for (const slot of params.slots ?? []) {
    if (typeof slot === 'object' && slot !== null && slot.required === true) required.add(slot.name);
  }

  return params.template.replace(SLOT_TOKEN_PATTERN, (_token, name: string) => {
    const value = values[name];
    if (value === undefined || value === null) {
      if (required.has(name)) throw new PromptTemplateError('missing-required-slot', `未提供关键提示词变量：${name}`, name);
      return '';
    }
    if (typeof value !== 'string') throw new PromptTemplateError('invalid-slot-value', `提示词变量 ${name} 必须是字符串`, name);
    return value;
  });
};

export const promptByteLength = (value: string): number => new TextEncoder().encode(value).byteLength;
