import { describe, expect, it } from 'vitest';

import {
  CHARACTER_PORTRAIT_ASSET_TYPE,
  readCharacterPortraitAsset,
  withCharacterPortraitAsset,
} from '@/lib/visual-asset/persistence';

describe('character portrait persistence', () => {
  it('writes the portrait into visualAssets without removing other assets', () => {
    const data = {
      name: '角色',
      visualAssets: [{ type: 'reference', imageUrl: 'data:image/png;base64,other' }],
    };
    const result = withCharacterPortraitAsset(data, {
      imageUrl: 'data:image/webp;base64,portrait',
      source: 'uploaded',
      note: '用户自行上传',
    });

    expect(result).not.toBe(data);
    expect(result.name).toBe('角色');
    expect(result.visualAssets).toEqual([
      { type: 'reference', imageUrl: 'data:image/png;base64,other' },
      {
        type: CHARACTER_PORTRAIT_ASSET_TYPE,
        imageUrl: 'data:image/webp;base64,portrait',
        source: 'uploaded',
        note: '用户自行上传',
      },
    ]);
    expect(readCharacterPortraitAsset(result)).toEqual({
      imageUrl: 'data:image/webp;base64,portrait',
      source: 'uploaded',
      note: '用户自行上传',
    });
  });

  it('replaces or removes only the persisted portrait', () => {
    const data = withCharacterPortraitAsset({
      visualAssets: [
        { type: 'reference', imageUrl: 'https://example.test/reference.png' },
        { type: CHARACTER_PORTRAIT_ASSET_TYPE, imageUrl: 'data:image/png;base64,old', source: 'generated' },
      ],
    }, {
      imageUrl: 'data:image/webp;base64,new',
      source: 'generated',
    });

    expect(readCharacterPortraitAsset(data)?.imageUrl).toBe('data:image/webp;base64,new');
    const removed = withCharacterPortraitAsset(data, null);
    expect(removed.visualAssets).toEqual([{ type: 'reference', imageUrl: 'https://example.test/reference.png' }]);
  });

  it('ignores malformed portrait entries', () => {
    expect(readCharacterPortraitAsset({
      visualAssets: [{ type: CHARACTER_PORTRAIT_ASSET_TYPE, source: 'uploaded' }],
    })).toBeNull();
  });
});
