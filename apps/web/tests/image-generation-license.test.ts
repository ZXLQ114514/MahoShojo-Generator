import { describe, expect, test } from 'vitest';

import {
  createImageGenerationLicenseKey,
  getImageGenerationLicenseKeyPrefix,
  hashImageGenerationLicenseKey,
  normalizeImageGenerationLicenseKey,
} from '@/lib/tachie/license';

describe('image generation license helpers', () => {
  test('生成随机许可密钥并只暴露前缀', async () => {
    const key = createImageGenerationLicenseKey();
    expect(key.startsWith('mgl_')).toBe(true);
    expect(key.length).toBeGreaterThan(20);
    expect(getImageGenerationLicenseKeyPrefix(key)).toBe(key.slice(0, 12));
    expect(normalizeImageGenerationLicenseKey(`  ${key} `)).toBe(key);
    expect(await hashImageGenerationLicenseKey(key)).toMatch(/^[a-f0-9]{64}$/);
  });

  test('相同许可密钥哈希稳定且空值拒绝', async () => {
    await expect(hashImageGenerationLicenseKey('  license-test  ')).resolves.toBe(
      await hashImageGenerationLicenseKey('license-test'),
    );
    await expect(hashImageGenerationLicenseKey('')).rejects.toThrow('不能为空');
  });
});
