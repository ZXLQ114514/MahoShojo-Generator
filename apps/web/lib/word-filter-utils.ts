export * from '@mahoshojo/hosted-runtime/node-runtime/word-filter-utils';

// 用户版补充：仅折叠 ASCII 大写，确保转换前后的 UTF-16 索引保持一致。
// hosted-runtime 基础版未导出该函数，屏蔽词在线维护（shield-word-settings）依赖它。
export const foldAsciiCase = (text: string): string => {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    out += code >= 0x41 && code <= 0x5a
      ? String.fromCharCode(code + 0x20)
      : text[i];
  }
  return out;
};