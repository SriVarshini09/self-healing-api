/** A whole number from a query value, clamped to [min, max]; the fallback when missing or not a number. */
export function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const number = Math.trunc(Number(value));
  if (value === undefined || value === null || value === '' || !Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

/** ?page= and ?pageSize= for list endpoints: page >= 1, pageSize 1..100 (default 20). */
export function pageParams(query: Record<string, unknown>): { page: number; pageSize: number } {
  return {
    page: clampInt(query.page, 1, 1, 1_000_000),
    pageSize: clampInt(query.pageSize, 20, 1, 100),
  };
}
