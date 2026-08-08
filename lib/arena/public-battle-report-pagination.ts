export type PublicBattleReportPage = {
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
};

export type CollectVisibleRecordsOptions<Row, Item> = {
  limit: number;
  offset: number;
  batchLimit?: number;
  fetchRows: (limit: number, offset: number) => Promise<Row[]>;
  buildRecord: (row: Row) => Promise<Item | null>;
};

export async function collectVisibleRecords<Row, Item>(
  options: CollectVisibleRecordsOptions<Row, Item>,
): Promise<{ records: Item[]; page: PublicBattleReportPage }> {
  const safeLimit = Math.max(1, Math.floor(options.limit));
  const safeOffset = Math.max(0, Math.floor(options.offset));
  const safeBatchLimit = Math.max(1, Math.min(50, Math.floor(options.batchLimit ?? 50)));
  const records: Item[] = [];
  let hasMore = false;
  let nextOffset: number | null = null;
  let rawOffset = safeOffset;

  while (true) {
    const rows = await options.fetchRows(safeBatchLimit, rawOffset);
    if (rows.length === 0) break;

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      const rawCursor = rawOffset + index + 1;
      const record = await options.buildRecord(row);
      if (!record) continue;

      if (records.length < safeLimit) {
        records.push(record);
        nextOffset = rawCursor;
        continue;
      }

      hasMore = true;
      break;
    }

    rawOffset += rows.length;
    if (hasMore || rows.length < safeBatchLimit) break;
  }

  return {
    records,
    page: {
      limit: safeLimit,
      offset: safeOffset,
      hasMore,
      nextOffset,
    },
  };
}
