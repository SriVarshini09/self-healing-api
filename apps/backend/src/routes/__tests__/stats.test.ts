import { describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/prisma.js', () => ({ prisma: {} }));
const { emptyBuckets, fillBuckets } = await import('../stats.js');

describe('overview day buckets', () => {
  it('creates one zero-filled UTC day per day in range, inclusive', () => {
    const buckets = emptyBuckets(new Date('2026-10-01T15:00:00Z'), new Date('2026-10-03T00:00:00Z'));
    expect(buckets.map(bucket => bucket.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(buckets.every(bucket => bucket.events === 0 && bucket.outcomesFailed === 0)).toBe(true);
  });

  it('adds database day counts (bigint) to the matching day and ignores out-of-range rows', () => {
    const buckets = emptyBuckets(new Date('2026-10-01T00:00:00Z'), new Date('2026-10-02T00:00:00Z'));
    fillBuckets(buckets, [
      { day: new Date('2026-10-02T00:00:00Z'), count: 5n },
      { day: new Date('2026-09-20T00:00:00Z'), count: 9n },
    ], 'outcomesFailed');
    expect(buckets.map(bucket => bucket.outcomesFailed)).toEqual([0, 5]);
  });
});
