import { applyShieldWords } from '@/lib/shield-word-filter';
import { stripAllStreamMetaComments } from '@/lib/arena/stream-meta';

export const CHARACTER_REPORT_FINAL_RESULT_MAX_CHARS = 1200;

export type CharacterReportOutputParseInput = {
  outputPreview?: string | null;
  outputChars?: number | null;
  generationMode?: string | null;
  outputHasSensitiveWords?: boolean | null;
  outputHasShieldWords?: boolean | null;
};

const normalizeText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return null;
  let safe = normalized;
  try {
    safe = applyShieldWords(normalized).filteredText.trim();
  } catch {
    // 过滤器不可用时不返回原始正文，避免绕过内容安全边界。
    return null;
  }
  if (!safe) return null;
  return safe.length > CHARACTER_REPORT_FINAL_RESULT_MAX_CHARS
    ? `${safe.slice(0, CHARACTER_REPORT_FINAL_RESULT_MAX_CHARS)}…`
    : safe;
};

const isTruncatedPreview = (preview: string, outputChars?: number | null): boolean => {
  if (preview.includes('……')) return true;
  if (typeof outputChars === 'number' && Number.isFinite(outputChars) && outputChars > preview.length) return true;
  return false;
};

const readOfficialConclusion = (value: unknown, depth = 0): string | null => {
  if (depth > 4 || !value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const officialReport = record.officialReport;
  if (officialReport && typeof officialReport === 'object') {
    const conclusion = normalizeText((officialReport as Record<string, unknown>).conclusion);
    if (conclusion) return conclusion;
  }

  for (const child of Object.values(record)) {
    const nested = readOfficialConclusion(child, depth + 1);
    if (nested) return nested;
  }
  return null;
};

const parseJsonFinalResult = (preview: string): string | null => {
  try {
    return readOfficialConclusion(JSON.parse(preview));
  } catch {
    return null;
  }
};

const HEADING_PATTERN = /^#{1,6}\s*(?:最终结果|最终结论|结论|结果)\s*(?::|：)?\s*(.*)$/i;
const NEXT_HEADING_PATTERN = /^#{1,6}\s+\S+/;

const parseMarkdownFinalResult = (preview: string): string | null => {
  const lines = preview.split('\n');
  const headingIndex = lines.findIndex((line) => HEADING_PATTERN.test(line.trim()));
  if (headingIndex < 0) return null;

  const headingMatch = lines[headingIndex]!.trim().match(HEADING_PATTERN);
  const content: string[] = [];
  if (headingMatch?.[1]) content.push(headingMatch[1]);

  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (NEXT_HEADING_PATTERN.test(line)) break;
    content.push(line);
  }

  return normalizeText(content.join('\n'));
};

/**
 * 从 D1 中保存的完整战报预览提取官方最终结果。
 * 截断或格式不完整的预览不会猜测内容，交给调用方按“暂无最终结果”处理。
 */
export const extractCharacterReportFinalResult = (
  input: CharacterReportOutputParseInput,
): string | null => {
  if (input.outputHasSensitiveWords === true || input.outputHasShieldWords === true) return null;
  const rawPreview = typeof input.outputPreview === 'string' ? input.outputPreview : '';
  // outputChars 记录原始正文长度；在 trim 之前比较才能避免完整流式正文的首尾换行被误判为截断。
  if (!rawPreview || isTruncatedPreview(rawPreview, input.outputChars)) return null;
  // 流式战报可能在正文末尾追加系统元数据注释；它不是最终结果内容，
  // 也不应作为不可信正文送入客户端或 AI。使用项目统一解析器而不是正则，
  // 以兼容历史 marker、松散格式和未闭合注释。
  const preview = stripAllStreamMetaComments(rawPreview).trim();
  if (!preview) return null;

  const looksLikeJson = /^\s*[\[{]/.test(preview);
  if (looksLikeJson) return parseJsonFinalResult(preview);

  // 流式记录以 Markdown 保存；历史记录即使缺少 generationMode，也按 Markdown 兼容解析。
  return parseMarkdownFinalResult(preview);
};

export const parseCharacterReportFinalResult = extractCharacterReportFinalResult;
