import { describe, expect, test, vi } from 'vitest';

import { collectVisibleRecords } from '@/lib/arena/public-battle-report-pagination';

describe('public battle report pagination', () => {
  test('keeps scanning batches until the visible page is full', async () => {
    const fetchRows = vi.fn(async (_limit: number, offset: number) => {
      if (offset === 0) return ['skip-a', 'keep-1'];
      if (offset === 2) return ['skip-b', 'keep-2'];
      if (offset === 4) return ['keep-3'];
      return [];
    });
    const buildRecord = vi.fn(async (row: string) => (row.startsWith('keep-') ? { id: row } : null));

    const page = await collectVisibleRecords({
      limit: 2,
      offset: 0,
      batchLimit: 2,
      fetchRows,
      buildRecord,
    });

    expect(page.records).toEqual([{ id: 'keep-1' }, { id: 'keep-2' }]);
    expect(page.page).toEqual({ limit: 2, offset: 0, hasMore: true, nextOffset: 4 });
    expect(fetchRows).toHaveBeenNthCalledWith(1, 2, 0);
    expect(fetchRows).toHaveBeenNthCalledWith(2, 2, 2);
    expect(fetchRows).toHaveBeenNthCalledWith(3, 2, 4);
  });

  test('returns the last visible cursor when the source is exhausted', async () => {
    const fetchRows = vi.fn(async (_limit: number, offset: number) => {
      if (offset === 0) return ['keep-1'];
      return [];
    });
    const buildRecord = vi.fn(async (row: string) => (row.startsWith('keep-') ? { id: row } : null));

    const page = await collectVisibleRecords({
      limit: 2,
      offset: 0,
      batchLimit: 2,
      fetchRows,
      buildRecord,
    });

    expect(page.records).toEqual([{ id: 'keep-1' }]);
    expect(page.page).toEqual({ limit: 2, offset: 0, hasMore: false, nextOffset: 1 });
  });
});
