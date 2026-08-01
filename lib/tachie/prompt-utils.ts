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
