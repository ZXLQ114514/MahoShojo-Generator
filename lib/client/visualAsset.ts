import { isAllowedExternalMediaUrl } from '@/lib/markdown/externalMedia';

const isSpecialImageUrl = (value: string): boolean => /^data:|^blob:|^about:blank$/i.test(value);
const MAX_PERSISTED_PORTRAIT_BYTES = 220 * 1024;
const MAX_PERSISTED_PORTRAIT_DIMENSION = 1400;

const estimateDataUrlBytes = (value: string): number => {
  const commaIndex = value.indexOf(',');
  if (commaIndex < 0) return value.length;
  const payload = value.slice(commaIndex + 1);
  return Math.ceil((payload.length * 3) / 4);
};

export const resolveProxyImageUrl = (value: string): string => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || isSpecialImageUrl(raw)) return raw;

  if (!/^https?:\/\//i.test(raw) && !raw.startsWith('//')) {
    return raw;
  }

  const normalized = raw.startsWith('//') ? `https:${raw}` : raw;
  if (!isAllowedExternalMediaUrl(normalized, 'image')) {
    return raw;
  }

  return `/api/media-proxy?url=${encodeURIComponent(normalized)}`;
};

export const readImageFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('仅支持上传图片文件。'));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) {
        reject(new Error('读取图片失败，请重试。'));
        return;
      }

      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, MAX_PERSISTED_PORTRAIT_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('图片处理失败，请更换图片后重试。'));
          return;
        }
        context.drawImage(image, 0, 0, width, height);

        for (const quality of [0.82, 0.7, 0.58, 0.46, 0.34]) {
          const compressed = canvas.toDataURL('image/webp', quality);
          if (compressed.startsWith('data:image/webp') && estimateDataUrlBytes(compressed) <= MAX_PERSISTED_PORTRAIT_BYTES) {
            resolve(compressed);
            return;
          }
        }

        if (estimateDataUrlBytes(result) <= MAX_PERSISTED_PORTRAIT_BYTES) {
          resolve(result);
          return;
        }
        reject(new Error('图片压缩后仍超过 220KB，请选择尺寸更小或更简单的图片。'));
      };
      image.onerror = () => reject(new Error('图片解析失败，请选择有效的图片文件。'));
      image.src = result;
    };
    reader.onerror = () => {
      reject(new Error('读取图片失败，请重试。'));
    };
    reader.readAsDataURL(file);
  });
