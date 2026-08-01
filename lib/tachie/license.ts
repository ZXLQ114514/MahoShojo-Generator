import { getSecureRandomValues } from '@/lib/crypto';
import { sha256Hex } from '@/lib/pvp/crypto';

const LICENSE_RANDOM_BYTES = 24;
const LICENSE_PREFIX_LENGTH = 12;

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

export const normalizeImageGenerationLicenseKey = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export const createImageGenerationLicenseKey = (): string => {
  const bytes = new Uint8Array(LICENSE_RANDOM_BYTES);
  getSecureRandomValues(bytes);
  return `mgl_${toBase64Url(bytes)}`;
};

export const getImageGenerationLicenseKeyPrefix = (value: string): string =>
  normalizeImageGenerationLicenseKey(value).slice(0, LICENSE_PREFIX_LENGTH);

export const hashImageGenerationLicenseKey = async (value: string): Promise<string> => {
  const normalized = normalizeImageGenerationLicenseKey(value);
  if (!normalized) throw new Error('图片生成许可密钥不能为空');
  return sha256Hex(normalized);
};
