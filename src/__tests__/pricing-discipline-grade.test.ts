/**
 * Pricing Discipline grade computation. The grade is the canonical
 * narrative anchor — auditors and consultants will lead with it —
 * so the boundaries need to be deterministic.
 */
import { describe, it, expect } from 'vitest';
import { computeGrade, gradeNarrative } from '@/lib/forensics/pricing-discipline-grade';

describe('computeGrade', () => {
  it('returns A when both metrics are well under threshold', () => {
    expect(computeGrade(10, 5)).toBe('A');
    expect(computeGrade(14.9, 9.9)).toBe('A');
  });

  it('returns B when slightly past A boundaries', () => {
    expect(computeGrade(15, 15)).toBe('B');
    expect(computeGrade(20, 18)).toBe('B');
  });

  it('returns C when discount creep starts', () => {
    expect(computeGrade(28, 22)).toBe('C');
    expect(computeGrade(34, 34)).toBe('C');
  });

  it('returns D when discipline weakens', () => {
    expect(computeGrade(40, 40)).toBe('D');
    expect(computeGrade(49, 49)).toBe('D');
  });

  it('returns F when either metric crosses 50%', () => {
    expect(computeGrade(50, 30)).toBe('F');
    expect(computeGrade(30, 50)).toBe('F');
    expect(computeGrade(80, 80)).toBe('F');
  });

  it('uses the WORSE of the two metrics — high discount alone drops the grade', () => {
    // Low override but high discount → still falls to a weaker grade
    expect(computeGrade(40, 5)).toBe('D');
    expect(computeGrade(60, 5)).toBe('F');
  });

  it('high override alone also drops the grade', () => {
    expect(computeGrade(5, 40)).toBe('D');
    expect(computeGrade(5, 55)).toBe('F');
  });
});

describe('gradeNarrative', () => {
  it('uses encouraging language for A and B', () => {
    expect(gradeNarrative('A', 10, 5)).toContain('strong');
    expect(gradeNarrative('B', 20, 15)).toContain('healthy');
  });

  it('flags issues for C and D', () => {
    expect(gradeNarrative('C', 30, 25).toLowerCase()).toContain('creep');
    expect(gradeNarrative('D', 45, 40).toLowerCase()).toContain('weakening');
  });

  it('flags F as a controls failure', () => {
    expect(gradeNarrative('F', 60, 60).toLowerCase()).toContain('not working');
  });

  it('embeds the actual percentage values', () => {
    const narrative = gradeNarrative('B', 18.5, 12.3);
    expect(narrative).toContain('18.5');
    expect(narrative).toContain('12.3');
  });
});
