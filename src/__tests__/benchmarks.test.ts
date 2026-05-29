import { describe, it, expect } from 'vitest';
import { leakagePercentile } from '@/lib/analysis/benchmarks';

describe('leakagePercentile', () => {
  const dist = { p25: 100_000, median: 250_000, p75: 600_000, p90: 1_200_000 };

  it('returns 25 when value is at or below p25', () => {
    expect(leakagePercentile(50_000, dist)).toBe(25);
    expect(leakagePercentile(100_000, dist)).toBe(25);
  });

  it('interpolates between p25 and median', () => {
    const p = leakagePercentile(175_000, dist); // halfway
    expect(p).toBeGreaterThan(25);
    expect(p).toBeLessThan(50);
  });

  it('returns ~50 at the median', () => {
    expect(leakagePercentile(250_000, dist)).toBe(50);
  });

  it('returns ~75 at p75', () => {
    expect(leakagePercentile(600_000, dist)).toBe(75);
  });

  it('returns ~90 at p90', () => {
    expect(leakagePercentile(1_200_000, dist)).toBe(90);
  });

  it('caps at 95 beyond p90', () => {
    expect(leakagePercentile(10_000_000, dist)).toBe(95);
  });

  it('handles zero-span gracefully (degenerate distribution)', () => {
    const flat = { p25: 100, median: 100, p75: 100, p90: 100 };
    expect(leakagePercentile(100, flat)).toBe(25);
    expect(leakagePercentile(200, flat)).toBe(95);
  });
});
