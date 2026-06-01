/**
 * Pricing Discipline grade computation. Lives in lib/ so route files
 * stay clean (Next.js complains when API routes export non-route
 * names — only GET/POST/etc are allowed). Same logic as before,
 * just relocated.
 */

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export function computeGrade(avgDiscount: number, overridePct: number): Grade {
  if (avgDiscount < 15 && overridePct < 10) return 'A';
  if (avgDiscount < 25 && overridePct < 20) return 'B';
  if (avgDiscount < 35 && overridePct < 35) return 'C';
  if (avgDiscount < 50 && overridePct < 50) return 'D';
  return 'F';
}

export function gradeNarrative(grade: Grade, avgDiscount: number, overridePct: number): string {
  switch (grade) {
    case 'A':
      return `Pricing discipline is strong — avg discount ${avgDiscount.toFixed(1)}%, manual overrides on just ${overridePct.toFixed(1)}% of lines.`;
    case 'B':
      return `Pricing discipline is healthy. Avg discount ${avgDiscount.toFixed(1)}%; ${overridePct.toFixed(1)}% of lines carry a manual override.`;
    case 'C':
      return `Discount creep starting. Avg ${avgDiscount.toFixed(1)}% discount and ${overridePct.toFixed(1)}% override rate suggest approval rules may need tightening.`;
    case 'D':
      return `Discount discipline is weakening — ${avgDiscount.toFixed(1)}% avg discount, ${overridePct.toFixed(1)}% override rate. Reps are leaving negotiating room on the table.`;
    case 'F':
      return `Pricing controls are not working. Avg discount ${avgDiscount.toFixed(1)}% with ${overridePct.toFixed(1)}% of lines manually overridden. Approval routing requires immediate review.`;
  }
}
