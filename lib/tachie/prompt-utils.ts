const APPEARANCE_LABELS: Record<string, string> = {
  hairColor: '发色',
  hairStyle: '发型',
  eyeColor: '瞳色',
  skinTone: '肤色',
  wearing: '服装',
  outfit: '服装',
  accessories: '配饰',
  colorScheme: '配色',
  overallLook: '整体气质',
  appearance: '外观',
  materialAndSkin: '材质与皮肤',
  featuresAndAppendages: '特征与附肢',
  bodyType: '体型',
  height: '身高',
  age: '年龄',
  gender: '性别',
  weapon: '武器',
  weapons: '武器',
  costume: '服装',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeValue = (value: unknown): string => {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(normalizeValue).filter(Boolean).join('、');
  if (isRecord(value)) return Object.values(value).map(normalizeValue).filter(Boolean).join('、');
  return '';
};

const PORTRAIT_PROMPT_MAX_DESCRIPTION_CHARS = 420;

const normalizePromptText = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
};

const truncatePromptText = (value: string, maxChars: number): string => {
  const chars = Array.from(value);
  return chars.length > maxChars ? `${chars.slice(0, maxChars).join('')}…` : value;
};

export type CharacterPortraitPromptInput = {
  appearance?: unknown;
  description?: unknown;
  characterType?: 'magical-girl' | 'canshou' | 'general';
};

/**
 * 统一构造角色立绘提示词。
 * 角色卡正文只能作为外观参考，不能让模型把它当成海报/角色档案的版式指令。
 */
export const buildCharacterPortraitPrompt = ({
  appearance,
  description,
  characterType = 'general',
}: CharacterPortraitPromptInput): string => {
  const appearanceText = formatImagePromptAppearance(appearance);
  const descriptionText = truncatePromptText(normalizePromptText(description), PORTRAIT_PROMPT_MAX_DESCRIPTION_CHARS);
  const subject = characterType === 'magical-girl'
    ? '二次元魔法少女角色'
    : characterType === 'canshou'
      ? '二次元奇幻生物角色'
      : '二次元角色';

  return [
    `主体：${subject}`,
    appearanceText ? `外观参考：${appearanceText}` : '',
    descriptionText ? `外观与气质参考：${descriptionText}` : '',
    '构图：单人，完整身体，从头到脚，角色居中，清晰展示服装和外观，纯角色插画，干净简单背景。',
    '硬性禁止：角色档案，人物设定表，海报，信息图，UI，分栏，边框，标题，姓名，说明文字，字幕，数字，字母，Logo，水印，小头像，角色卡，漫画分格。',
    '输出：只生成一张没有任何可读文字的插画画面。',
  ].filter(Boolean).join('\n');
};

/** 将角色外观对象转换为图片模型更容易理解的自然语言。 */
export const formatImagePromptAppearance = (value: unknown): string => {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
  if (!isRecord(value)) return '';

  return Object.entries(value)
    .map(([key, rawValue]) => {
      const normalized = normalizeValue(rawValue);
      if (!normalized) return '';
      const label = APPEARANCE_LABELS[key] || key;
      return `${label}为${normalized}`;
    })
    .filter(Boolean)
    .join('，');
};
