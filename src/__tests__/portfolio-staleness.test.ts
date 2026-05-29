import { describe, it, expect } from 'vitest';
import { classifyStaleness, orgsNeedingScan, DEFAULT_STALENESS_DAYS } from '@/lib/portfolio/staleness';

const NOW = new Date('2026-05-29T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000).toISOString();
const daysAgo = (d: number) => hoursAgo(d * 24);

describe('classifyStaleness', () => {
  it('classifies a scan within threshold as fresh', () => {
    const out = classifyStaleness(
      [{ org_id: 'a', last_scan_at: hoursAgo(6) }],
      DEFAULT_STALENESS_DAYS,
      NOW
    );
    expect(out[0].bucket).toBe('fresh');
  });

  it('classifies a scan older than threshold as stale', () => {
    const out = classifyStaleness(
      [{ org_id: 'a', last_scan_at: daysAgo(14) }],
      DEFAULT_STALENESS_DAYS,
      NOW
    );
    expect(out[0].bucket).toBe('stale');
    expect(out[0].age_days).toBe(14);
  });

  it('classifies a scan exactly at the threshold boundary as fresh', () => {
    // 7 days exactly = fresh (inclusive boundary)
    const out = classifyStaleness(
      [{ org_id: 'a', last_scan_at: daysAgo(DEFAULT_STALENESS_DAYS) }],
      DEFAULT_STALENESS_DAYS,
      NOW
    );
    expect(out[0].bucket).toBe('fresh');
  });

  it('classifies orgs that have never been scanned as never', () => {
    const out = classifyStaleness([{ org_id: 'a', last_scan_at: null }], 7, NOW);
    expect(out[0].bucket).toBe('never');
    expect(out[0].age_days).toBeNull();
  });

  it('treats a future timestamp (clock skew) as fresh', () => {
    const future = new Date(NOW.getTime() + 60_000).toISOString();
    const out = classifyStaleness([{ org_id: 'a', last_scan_at: future }], 7, NOW);
    expect(out[0].bucket).toBe('fresh');
    expect(out[0].age_days).toBe(0);
  });

  it('respects a caller-specified threshold', () => {
    const scan = daysAgo(10);
    expect(classifyStaleness([{ org_id: 'a', last_scan_at: scan }], 7, NOW)[0].bucket).toBe('stale');
    expect(classifyStaleness([{ org_id: 'a', last_scan_at: scan }], 30, NOW)[0].bucket).toBe('fresh');
  });
});

describe('orgsNeedingScan', () => {
  it('selects stale and never, excludes fresh', () => {
    const v = classifyStaleness(
      [
        { org_id: 'a', last_scan_at: hoursAgo(2) },
        { org_id: 'b', last_scan_at: daysAgo(30) },
        { org_id: 'c', last_scan_at: null },
      ],
      DEFAULT_STALENESS_DAYS,
      NOW
    );
    expect(orgsNeedingScan(v).sort()).toEqual(['b', 'c']);
  });
});
