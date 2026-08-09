// lib/shield-word-filter.ts

import { pinyin } from 'pinyin-pro';
import {
  buildLatinTokenMappingForPinyinCheck,
  createWordsSearch,
  foldAsciiCase,
  foldFullwidthAscii,
  normalizeLatin,
  toSimplifiedChinese,
} from '@/lib/word-filter-utils';

/**
 * 说明：
 * - “屏蔽词”不会触发逮捕；只会在文本中被和谐（默认使用 ❀ 遮罩，或按配置替换为指定文本）。
 * - 屏蔽词词表使用 base64 编码，避免被直接扫描。
 * - 替换词不需要 base64，可明文存储。
 */

interface ShieldWordsConfig {
  mask: string;
  words: string[];
  replace?: Record<string, string>;
  encoding?: 'base64';
}

export type ShieldWordRule = {
  word: string;
  replacement: string | null;
};

export type ShieldWordFilter = (text: string) => ShieldWordFilterResult;

export interface ShieldWordFilterResult {
  hasShieldWords: boolean;
  detectedWords: string[];
  filteredText: string;
  originalText: string;
}

// 防止屏蔽，所以用 base64 编码并直接扔文件里
const shieldWordsConfig: ShieldWordsConfig = {
  // 使用非 Markdown 特殊字符作为遮罩，避免 `*` 触发强调/列表等解析
  mask: '❀',
  words: [
    // 默认使用 ❀ 遮罩
    // '5YWr5Lmd',
    '5Y+R5oOF',
    // '5a+E55Sf',
    '5a2Q5a6r',
    // '5rSX6ISR',
    '5Lmg6L+R5bmz',
    '5Lik5Lya',
    '5Lmz5oi/',
    '5LqM5Y2B5aSn',
    '5YWx5Lqn',
    '5ZGo5oGp5p2l',
    '5aSp5a6J6Zeo',
    '5bCP56m0',
    '5oG25aCV',
    '5p2O5YWL5by6',
    '6IOh6ZSm5rab',
    '5rGf5rO95rCR',
    '5rip5a625a6d',
    '5p2O6ZW/5pil',
    '5q+b5rO95Lic',
    '6YKT5bCP5bmz',
    '6ams5YWL5oCd',
    '56S+5Lya5Li75LmJ',
    '5Zu95rCR5YWa',
    '6IKb6Zeo',
    '6IO45Zu0',
    '5LiL5L2T',
    '56eB5aSE',
    '5ram5LmL',
    '572p5p2v',
    '5Liw6IW0',
    '5rer6Z2h',
    '5oCn5YWz57O7',
    '5oCn5rS75Yqo',
    '5oCn5Lqk',
    '6Imy5oOF',
    '5Y+X57K+',
    '55m95rWK',
    '6IKJ5qOS',
    '6Imy5Zu+',
    '5rap5Zu+',
    '5byx5pm6',
    '6IKJ56m0',
    '5b+r5oSf',
    '5aW2572p',
    '5qao5Y+W',
    'VlBO',
    '5Lmz5bCW',
    '6KO45L2T',
    '56eR5a2m5LiK572R',
    '5oyC5qKv5a2Q',
    'R0ZX',
    '5oCn5L61',
    // 使用指定词汇替换
    '5Lit5Zu9',
    '5Lit5Y2O5Lq65rCR5YWx5ZKM5Zu9',
    '5Lit5Y2O5rCR5Zu9',
    '5aW06Zq2',
    '5aiH5ZaY',
    '5biM54m55YuS',
    '5oCA5a2V',
    '5oCn5qyy',
    '6Imy5qyy',
    '5oOF5qyy',
    '5oiQ55i+',
    'TmF6aQ==',
    'SGl0bGVy',
    '6Ziz5YW3',
    '5aiH6Lqv',
    '5Lmx5Lqk',
    '576k5Lqk',
    '5rul5Lqk',
    '5Lqn5Lmz',
    '5Lqn5aW2',
    '6L+36I2v',
    '6LCD5pWZ',
    '6IKJ5qyy',
    '6IKJ5aOB',
    '5rOV44CL',
  ],
  replace: {
    // key 为 base64 编码的屏蔽词，value 为明文替换词
    '5Lit5Zu9': '【国度】',
    '5Lit5Y2O5Lq65rCR5YWx5ZKM5Zu9': '【东方国度】',
    '5Lit5Y2O5rCR5Zu9': '【旧日国度】',
    '5aSp5a6J6Zeo': '大城门',
    '5aW06Zq2': '随从',
    '5aiH5ZaY': '喘息',
    '5biM54m55YuS': '落榜美术生',
    '5oCA5a2V': '显怀',
    '5oCn5qyy': '欲望',
    '6Imy5qyy': '欲望',
    '5oOF5qyy': '情感',
    '6Ziz5YW3': '王钥',
    '5aiH6Lqv': '躯体',
    '5Lmx5Lqk': '乱斗',
    '576k5Lqk': '群战',
    '5rul5Lqk': '好战',
    '5Lqn5Lmz': '产出',
    '5Lqn5aW2': '产出',
    '6L+36I2v': '红茶',
    '6LCD5pWZ': '教育',
    '6IKJ5qyy': '食欲',
    '6IKJ5aOB': '铁壁',
    '5rOV44CL': '律》'
  },
  encoding: 'base64',
};

const base64Decode = (str: string): string => {
  try {
    if (typeof atob === 'function') {
      const binaryString = atob(str);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return new TextDecoder('utf-8').decode(bytes);
    }

    const BufferCtor = (globalThis as any).Buffer as
      | { from: (input: string, encoding: string) => { toString: (encoding: string) => string } }
      | undefined;
    if (BufferCtor?.from) {
      return BufferCtor.from(str, 'base64').toString('utf8');
    }
  } catch (error) {
    console.error('Base64解码失败:', error);
  }
  return '';
};

const buildReplaceMap = (config: ShieldWordsConfig): Map<string, string> => {
  const map = new Map<string, string>();
  if (!config.replace) return map;

  const entries = Object.entries(config.replace);
  for (const [encodedWord, replacement] of entries) {
    const decodedWord = config.encoding === 'base64' ? base64Decode(encodedWord) : encodedWord;
    if (!decodedWord) continue;
    map.set(decodedWord, replacement);
  }
  return map;
};

let decodedWordsCache: string[] | null = null;
let replaceMapCache: Map<string, string> | null = null;
let simplifiedKeywordCache: string[] | null = null;
let simplifiedReplaceMapCache: Map<string, string> | null = null;
let wordsSearchCache: ReturnType<typeof createWordsSearch> | null = null;
let pinyinSearchCache: ReturnType<typeof createWordsSearch> | null = null;
let pinyinToSourceCache: Map<string, string> | null = null;

const getDecodedWords = (): string[] => {
  if (decodedWordsCache) return decodedWordsCache;
  if (shieldWordsConfig.encoding === 'base64') {
    decodedWordsCache = shieldWordsConfig.words.map((word) => base64Decode(word)).filter(Boolean);
  } else {
    decodedWordsCache = [...shieldWordsConfig.words];
  }
  return decodedWordsCache;
};

export const getBuiltInShieldWordCount = (): number => getDecodedWords().length;

const getReplaceMap = (): Map<string, string> => {
  if (replaceMapCache) return replaceMapCache;
  replaceMapCache = buildReplaceMap(shieldWordsConfig);
  return replaceMapCache;
};

const getSimplifiedKeywordCache = (): string[] => {
  if (simplifiedKeywordCache) return simplifiedKeywordCache;
  simplifiedKeywordCache = getDecodedWords()
    .map((w) => foldAsciiCase(foldFullwidthAscii(toSimplifiedChinese(w))))
    .filter((w) => typeof w === 'string' && w.trim().length > 0);
  return simplifiedKeywordCache;
};

const getSimplifiedReplaceMap = (): Map<string, string> => {
  if (simplifiedReplaceMapCache) return simplifiedReplaceMapCache;
  const rawReplaceMap = getReplaceMap();
  const map = new Map<string, string>();
  for (const [word, replacement] of rawReplaceMap.entries()) {
    map.set(foldAsciiCase(foldFullwidthAscii(toSimplifiedChinese(word))), replacement);
  }
  simplifiedReplaceMapCache = map;
  return simplifiedReplaceMapCache;
};

const getWordsSearch = (): ReturnType<typeof createWordsSearch> => {
  if (wordsSearchCache) return wordsSearchCache;
  wordsSearchCache = createWordsSearch(getSimplifiedKeywordCache());
  return wordsSearchCache;
};

const getPinyinSearch = (): { search: ReturnType<typeof createWordsSearch> | null; pinyinToSource: Map<string, string> } => {
  if (pinyinSearchCache && pinyinToSourceCache) {
    return { search: pinyinSearchCache, pinyinToSource: pinyinToSourceCache };
  }

  const pinyinToSource = new Map<string, string>();
  const pinyinKeywords: string[] = [];
  for (const word of getDecodedWords()) {
    const simplified = toSimplifiedChinese(word);
    const hanCharCount = Array.from(simplified).filter((ch) => /[\u4e00-\u9fa5]/.test(ch)).length;
    if (hanCharCount < 2) continue;

    let py = '';
    try {
      const arr = pinyin(simplified, { toneType: 'none', type: 'array' }) as unknown as string[];
      py = Array.isArray(arr) ? arr.join('') : String(arr ?? '');
    } catch {
      py = '';
    }
    const normalized = normalizeLatin(py);
    if (!normalized) continue;
    pinyinKeywords.push(normalized);
    const prev = pinyinToSource.get(normalized);
    if (!prev || prev.length < word.length) {
      pinyinToSource.set(normalized, word);
    }
  }

  const uniq = Array.from(new Set(pinyinKeywords));
  pinyinSearchCache = uniq.length > 0 ? createWordsSearch(uniq) : null;
  pinyinToSourceCache = pinyinToSource;
  return { search: pinyinSearchCache, pinyinToSource };
};

const applyCompiledShieldWords = (
  text: string,
  input: {
    maskChar: string;
    wordsSearch: ReturnType<typeof createWordsSearch>;
    replaceMap: Map<string, string>;
    pinyinSearch: ReturnType<typeof createWordsSearch> | null;
    pinyinToSource: Map<string, string>;
  },
): ShieldWordFilterResult => {
  const { maskChar, wordsSearch: search, replaceMap, pinyinSearch, pinyinToSource } = input;

  const simplifiedLower = foldAsciiCase(foldFullwidthAscii(toSimplifiedChinese(text)));

  const detectedWords: string[] = [];
  const replacements: Array<{ start: number; endInclusive: number; replacement: string }> = [];

  const exactMatches = search.FindAll(simplifiedLower) as any[];
  for (const m of exactMatches) {
    const start = Number(m?.Start);
    const endInclusive = Number(m?.End);
    const keyword = String(m?.Keyword ?? '');
    if (!Number.isFinite(start) || !Number.isFinite(endInclusive) || !keyword) continue;
    if (start < 0 || endInclusive < start) continue;

    const originalSlice = text.slice(start, endInclusive + 1);
    if (originalSlice && !detectedWords.includes(originalSlice)) detectedWords.push(originalSlice);

    const mappedReplacement = replaceMap.get(keyword);
    if (typeof mappedReplacement === 'string') {
      replacements.push({ start, endInclusive, replacement: mappedReplacement });
    } else {
      const maskLen = Math.max(1, Array.from(originalSlice).length);
      replacements.push({ start, endInclusive, replacement: maskChar.repeat(maskLen) });
    }
  }

  // 额外：纯拼音绕过（仅对拉丁字母/数字做抽取）。
  if (pinyinSearch) {
    const { normalized, indexMap, isTokenStart, isTokenEnd } = buildLatinTokenMappingForPinyinCheck(text);
    if (normalized) {
      const matches = pinyinSearch.FindAll(normalized) as any[];
      for (const m of matches) {
        const startN = Number(m?.Start);
        const endN = Number(m?.End);
        const keywordPinyin = String(m?.Keyword ?? '');
        if (!Number.isFinite(startN) || !Number.isFinite(endN) || !keywordPinyin) continue;
        if (startN < 0 || endN < startN) continue;
        if (endN >= indexMap.length) continue;
        // 只接受“整 token 命中”（可跨 token），避免长英文/驼峰标识符里子串误报
        if (!isTokenStart[startN] || !isTokenEnd[endN]) continue;

        const start = indexMap[startN];
        const endInclusive = indexMap[endN];
        const source = pinyinToSource.get(keywordPinyin) ?? keywordPinyin;
        const originalSlice = text.slice(start, endInclusive + 1);
        if (source && !detectedWords.includes(`${source}(拼音)`)) detectedWords.push(`${source}(拼音)`);
        const normalizedSource = foldAsciiCase(foldFullwidthAscii(toSimplifiedChinese(source)));
        const mappedReplacement = replaceMap.get(normalizedSource);
        const replacement = typeof mappedReplacement === 'string'
          ? mappedReplacement
          : maskChar.repeat(Math.max(1, Array.from(originalSlice).length));
        replacements.push({ start, endInclusive, replacement });
      }
    }
  }

  // 同一区间可能同时命中短词、长词和拼音规则。包含关系保留最长命中；
  // 部分交叠则遮罩完整并集，避免丢弃后续命中的尾部。
  const selected: typeof replacements = [];
  for (const candidate of replacements.sort((left, right) =>
    left.start - right.start || right.endInclusive - left.endInclusive)) {
    const previous = selected.at(-1);
    if (!previous || candidate.start > previous.endInclusive) {
      selected.push(candidate);
      continue;
    }
    if (candidate.endInclusive <= previous.endInclusive) continue;
    previous.endInclusive = candidate.endInclusive;
    const originalSlice = text.slice(previous.start, previous.endInclusive + 1);
    previous.replacement = maskChar.repeat(Math.max(1, Array.from(originalSlice).length));
  }

  // 从后往前替换，避免索引偏移。
  const sorted = selected.sort((a, b) => b.start - a.start || b.endInclusive - a.endInclusive);
  let filteredText = text;
  for (const r of sorted) {
    filteredText = `${filteredText.slice(0, r.start)}${r.replacement}${filteredText.slice(r.endInclusive + 1)}`;
  }

  return {
    hasShieldWords: detectedWords.length > 0,
    detectedWords,
    filteredText,
    originalText: text,
  };
};

export const createShieldWordFilter = (customRules: readonly ShieldWordRule[] = []): ShieldWordFilter => {
  if (customRules.length === 0) {
    return (text: string): ShieldWordFilterResult => {
      const pinyinRules = getPinyinSearch();
      return applyCompiledShieldWords(text, {
        maskChar: shieldWordsConfig.mask || '❀',
        wordsSearch: getWordsSearch(),
        replaceMap: getSimplifiedReplaceMap(),
        pinyinSearch: pinyinRules.search,
        pinyinToSource: pinyinRules.pinyinToSource,
      });
    };
  }

  const words = [...getDecodedWords()];
  const replaceMap = new Map(getSimplifiedReplaceMap());

  for (const rule of customRules) {
    const word = typeof rule?.word === 'string' ? rule.word.trim() : '';
    if (!word) continue;
    words.push(word);
    const normalizedWord = foldAsciiCase(foldFullwidthAscii(toSimplifiedChinese(word)));
    if (typeof rule.replacement === 'string' && rule.replacement.length > 0) {
      replaceMap.set(normalizedWord, rule.replacement);
    } else {
      // 自定义遮罩规则可以覆盖内置替换文本，但不会删除内置命中能力。
      replaceMap.delete(normalizedWord);
    }
  }

  const simplifiedWords = Array.from(new Set(words
    .map((word) => foldAsciiCase(foldFullwidthAscii(toSimplifiedChinese(word))))
    .filter((word) => word.trim().length > 0)));
  const wordsSearch = createWordsSearch(simplifiedWords);

  const pinyinToSource = new Map<string, string>();
  const pinyinKeywords: string[] = [];
  for (const word of words) {
    const simplified = toSimplifiedChinese(word);
    const hanCharCount = Array.from(simplified).filter((character) => /[\u4e00-\u9fa5]/.test(character)).length;
    if (hanCharCount < 2) continue;
    let normalized = '';
    try {
      const values = pinyin(simplified, { toneType: 'none', type: 'array' }) as unknown as string[];
      normalized = normalizeLatin(Array.isArray(values) ? values.join('') : String(values ?? ''));
    } catch {
      normalized = '';
    }
    if (!normalized) continue;
    pinyinKeywords.push(normalized);
    const previous = pinyinToSource.get(normalized);
    if (!previous || previous.length < word.length) pinyinToSource.set(normalized, word);
  }
  const uniquePinyinKeywords = Array.from(new Set(pinyinKeywords));
  const pinyinSearch = uniquePinyinKeywords.length > 0 ? createWordsSearch(uniquePinyinKeywords) : null;

  return (text: string): ShieldWordFilterResult => applyCompiledShieldWords(text, {
    maskChar: shieldWordsConfig.mask || '❀',
    wordsSearch,
    replaceMap,
    pinyinSearch,
    pinyinToSource,
  });
};

const builtInShieldWordFilter = createShieldWordFilter();

let runtimeShieldWordFilter = builtInShieldWordFilter;

export const setRuntimeShieldWordRules = (rules: readonly ShieldWordRule[]): void => {
  runtimeShieldWordFilter = rules.length > 0 ? createShieldWordFilter(rules) : builtInShieldWordFilter;
};

export const applyShieldWords = (text: string): ShieldWordFilterResult => runtimeShieldWordFilter(text);
