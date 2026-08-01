export type XemApiImageResult = {
  imageUrls: string[];
  taskId?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readNonEmptyString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const normalizeBase64Image = (value: string, mimeType: string): string => {
  if (/^data:image\//i.test(value)) return value;
  const safeMimeType = /^image\/[a-z0-9.+-]+$/i.test(mimeType) ? mimeType : 'image/png';
  return `data:${safeMimeType};base64,${value}`;
};

const readImageValue = (item: unknown): string => {
  if (!isRecord(item)) return '';

  const url = readNonEmptyString(item.url);
  if (url) return url;

  const base64 = readNonEmptyString(item.b64_json ?? item.b64Json);
  if (!base64) return '';

  const mimeType = readNonEmptyString(item.mime_type ?? item.mimeType);
  return normalizeBase64Image(base64, mimeType);
};

/**
 * 解析 OpenAI 兼容图片接口的常见响应，同时兼容供应商返回的 task_id。
 * 不记录或返回请求头、API Key 等敏感字段。
 */
export const parseXemApiImageResponse = (payload: unknown): XemApiImageResult => {
  if (!isRecord(payload)) return { imageUrls: [] };

  const data = Array.isArray(payload.data) ? payload.data : [];
  const imageUrls = data.map(readImageValue).filter(Boolean);
  const taskId = readNonEmptyString(payload.id ?? payload.task_id ?? payload.taskId);

  return {
    imageUrls: Array.from(new Set(imageUrls)),
    ...(taskId ? { taskId } : {}),
  };
};

export const isXemApiImageModel = (model: string): boolean =>
  model.trim().toLowerCase() === 'gpt-image-2';
