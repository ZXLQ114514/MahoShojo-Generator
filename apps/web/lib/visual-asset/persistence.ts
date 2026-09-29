import type { CharacterCardPortraitAsset } from '@/types/visual-asset';

export const CHARACTER_PORTRAIT_ASSET_TYPE = 'character-portrait';

type PersistedVisualAsset = CharacterCardPortraitAsset & {
  type: typeof CHARACTER_PORTRAIT_ASSET_TYPE;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPortraitAsset = (value: unknown): value is CharacterCardPortraitAsset => {
  if (!isRecord(value) || typeof value.imageUrl !== 'string' || !value.imageUrl.trim()) return false;
  return value.source === 'generated' || value.source === 'uploaded';
};

export const readCharacterPortraitAsset = (data: unknown): CharacterCardPortraitAsset | null => {
  if (!isRecord(data)) return null;

  const visualAssets = Array.isArray(data.visualAssets) ? data.visualAssets : [];
  const persisted = visualAssets.find((asset) =>
    isRecord(asset) && asset.type === CHARACTER_PORTRAIT_ASSET_TYPE && isPortraitAsset(asset)
  );

  if (persisted && isPortraitAsset(persisted)) {
    return {
      imageUrl: persisted.imageUrl.trim(),
      source: persisted.source,
      ...(typeof persisted.note === 'string' && persisted.note.trim() ? { note: persisted.note.trim() } : {}),
    };
  }

  return null;
};

export const withCharacterPortraitAsset = <T>(
  data: T,
  asset: CharacterCardPortraitAsset | null | undefined,
): T => {
  if (!isRecord(data)) return data;

  const next = { ...data } as Record<string, unknown>;
  const visualAssets = Array.isArray(next.visualAssets) ? next.visualAssets : [];
  const retainedAssets = visualAssets.filter((item) =>
    !(isRecord(item) && item.type === CHARACTER_PORTRAIT_ASSET_TYPE)
  );

  if (asset && isPortraitAsset(asset)) {
    const persisted: PersistedVisualAsset = {
      type: CHARACTER_PORTRAIT_ASSET_TYPE,
      imageUrl: asset.imageUrl.trim(),
      source: asset.source,
      ...(asset.note?.trim() ? { note: asset.note.trim() } : {}),
    };
    next.visualAssets = [...retainedAssets, persisted];
  } else if (retainedAssets.length > 0) {
    next.visualAssets = retainedAssets;
  } else {
    delete next.visualAssets;
  }

  return next as T;
};
