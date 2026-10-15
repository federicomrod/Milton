export function sortBatchesNewestFirst<
  T extends { created_at?: string; id: string },
>(batches: T[]): T[] {
  return [...batches].sort((a, b) => {
    const byDate = (b.created_at ?? "").localeCompare(a.created_at ?? "");
    if (byDate !== 0) return byDate;
    return b.id.localeCompare(a.id);
  });
}
