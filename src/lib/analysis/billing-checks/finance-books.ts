import type { BillingData, BillingHealthCheck, Issue, SFFinancePeriod } from '@/types';

export const financeBookChecks: BillingHealthCheck[] = [
  {
    id: 'FB-001',
    name: 'No Open Finance Period for Current Date',
    category: 'finance_books',
    severity: 'critical',
    description: 'Checks if any finance book has an open period covering the current date',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const today = new Date().toISOString().split('T')[0];

      for (const book of data.financeBooks) {
        if (!book.blng__Active__c) continue;

        const periods = book.blng__FinancePeriods__r?.records || [];
        const hasOpenCurrent = periods.some(p =>
          p.blng__PeriodStatus__c === 'Open' &&
          p.blng__PeriodStartDate__c &&
          p.blng__PeriodEndDate__c &&
          p.blng__PeriodStartDate__c <= today &&
          p.blng__PeriodEndDate__c >= today
        );

        if (!hasOpenCurrent && periods.length > 0) {
          issues.push({
            check_id: 'FB-001',
            category: 'finance_books',
            severity: 'critical',
            title: `No open finance period for current date in "${book.Name}"`,
            description: `Finance book "${book.Name}" has no open period covering today (${today}). Invoice posting and revenue recognition will be blocked.`,
            impact: 'All billing and revenue recognition processing will fail for this finance book until a period is opened.',
            recommendation: 'Open or create a finance period that covers the current date in this finance book.',
            affected_records: [{ id: book.Id, name: book.Name, type: 'blng__FinanceBook__c' }],
            revenue_impact: 50000,
            effort_hours: 0.5,
          });
        }
      }

      return issues;
    },
  },
  {
    id: 'FB-002',
    name: 'Gaps Between Finance Periods',
    category: 'finance_books',
    severity: 'critical',
    description: 'Finds gaps between consecutive finance periods in a finance book',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      // Group periods by finance book
      const bookPeriodsMap: Record<string, SFFinancePeriod[]> = {};
      for (const period of data.financePeriods) {
        if (!bookPeriodsMap[period.blng__FinanceBook__c]) {
          bookPeriodsMap[period.blng__FinanceBook__c] = [];
        }
        bookPeriodsMap[period.blng__FinanceBook__c].push(period);
      }

      for (const bookId of Object.keys(bookPeriodsMap)) {
        const periods = bookPeriodsMap[bookId];
        const sorted = periods
          .filter(p => p.blng__PeriodStartDate__c && p.blng__PeriodEndDate__c)
          .sort((a, b) => a.blng__PeriodStartDate__c!.localeCompare(b.blng__PeriodStartDate__c!));

        const gaps: string[] = [];
        for (let i = 1; i < sorted.length; i++) {
          const prevEnd = new Date(sorted[i - 1].blng__PeriodEndDate__c!);
          const currStart = new Date(sorted[i].blng__PeriodStartDate__c!);
          const diffDays = (currStart.getTime() - prevEnd.getTime()) / (1000 * 60 * 60 * 24);

          if (diffDays > 1) {
            gaps.push(`${sorted[i - 1].blng__PeriodEndDate__c} → ${sorted[i].blng__PeriodStartDate__c}`);
          }
        }

        if (gaps.length > 0) {
          const bookName = data.financeBooks.find(b => b.Id === bookId)?.Name || bookId;
          issues.push({
            check_id: 'FB-002',
            category: 'finance_books',
            severity: 'critical',
            title: `Finance period gaps in "${bookName}"`,
            description: `${gaps.length} gap(s) found between finance periods: ${gaps.slice(0, 3).join('; ')}${gaps.length > 3 ? ` and ${gaps.length - 3} more` : ''}.`,
            impact: 'Transactions falling in gap dates will fail to post, silently blocking revenue recognition.',
            recommendation: 'Create finance periods to fill the gaps. Ensure continuous period coverage.',
            affected_records: [{ id: bookId, name: bookName, type: 'blng__FinanceBook__c' }],
            revenue_impact: 25000,
            effort_hours: gaps.length * 0.25,
          });
        }
      }

      return issues;
    },
  },
  {
    id: 'FB-003',
    name: 'Overlapping Finance Periods',
    category: 'finance_books',
    severity: 'critical',
    description: 'Finds overlapping periods within the same finance book',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const bookPeriodsMap: Record<string, SFFinancePeriod[]> = {};
      for (const period of data.financePeriods) {
        if (!bookPeriodsMap[period.blng__FinanceBook__c]) {
          bookPeriodsMap[period.blng__FinanceBook__c] = [];
        }
        bookPeriodsMap[period.blng__FinanceBook__c].push(period);
      }

      for (const bookId of Object.keys(bookPeriodsMap)) {
        const periods = bookPeriodsMap[bookId];
        const sorted = periods
          .filter(p => p.blng__PeriodStartDate__c && p.blng__PeriodEndDate__c)
          .sort((a, b) => a.blng__PeriodStartDate__c!.localeCompare(b.blng__PeriodStartDate__c!));

        let hasOverlap = false;
        const overlapPeriods: typeof periods = [];

        for (let i = 1; i < sorted.length; i++) {
          const prevEnd = sorted[i - 1].blng__PeriodEndDate__c!;
          const currStart = sorted[i].blng__PeriodStartDate__c!;

          if (currStart < prevEnd) {
            hasOverlap = true;
            overlapPeriods.push(sorted[i - 1], sorted[i]);
          }
        }

        if (hasOverlap) {
          const bookName = data.financeBooks.find(b => b.Id === bookId)?.Name || bookId;
          const uniquePeriods = Array.from(new Map(overlapPeriods.map(p => [p.Id, p])).values());
          issues.push({
            check_id: 'FB-003',
            category: 'finance_books',
            severity: 'critical',
            title: `Overlapping finance periods in "${bookName}"`,
            description: `Overlapping finance periods detected in "${bookName}". Transactions may be double-posted.`,
            impact: 'Revenue and billing transactions could be posted to multiple periods, causing financial inaccuracies.',
            recommendation: 'Adjust period start/end dates to eliminate overlaps.',
            affected_records: uniquePeriods.slice(0, 20).map(p => ({
              id: p.Id,
              name: p.Name,
              type: 'blng__FinancePeriod__c',
            })),
            effort_hours: 1,
          });
        }
      }

      return issues;
    },
  },
  {
    id: 'FB-004',
    name: 'Finance Book Without Periods',
    category: 'finance_books',
    severity: 'critical',
    description: 'Finds active finance books with no periods defined',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      const booksWithPeriods = new Set(data.financePeriods.map(p => p.blng__FinanceBook__c));

      const booksWithoutPeriods = data.financeBooks.filter(
        b => b.blng__Active__c && !booksWithPeriods.has(b.Id)
      );

      if (booksWithoutPeriods.length > 0) {
        issues.push({
          check_id: 'FB-004',
          category: 'finance_books',
          severity: 'critical',
          title: 'Active finance books with no periods',
          description: `${booksWithoutPeriods.length} active finance book(s) have no finance periods defined. No transactions can be posted.`,
          impact: 'All billing and revenue recognition will fail for these books.',
          recommendation: 'Create finance periods (monthly or quarterly) for each active finance book.',
          affected_records: booksWithoutPeriods.map(b => ({
            id: b.Id,
            name: b.Name,
            type: 'blng__FinanceBook__c',
          })),
          revenue_impact: 100000,
          effort_hours: booksWithoutPeriods.length * 1,
        });
      }

      return issues;
    },
  },
  {
    id: 'FB-005',
    name: 'Prior Year Periods Still Open',
    category: 'finance_books',
    severity: 'warning',
    description: 'Finds finance periods from prior fiscal years that are still open',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const currentYear = new Date().getFullYear();

      const oldOpenPeriods = data.financePeriods.filter(p => {
        if (p.blng__PeriodStatus__c !== 'Open' || !p.blng__PeriodEndDate__c) return false;
        const periodYear = new Date(p.blng__PeriodEndDate__c).getFullYear();
        return periodYear < currentYear - 1; // More than 1 year old
      });

      if (oldOpenPeriods.length > 0) {
        issues.push({
          check_id: 'FB-005',
          category: 'finance_books',
          severity: 'warning',
          title: 'Old finance periods still open',
          description: `${oldOpenPeriods.length} finance period(s) from prior fiscal years remain open. These should typically be closed after year-end.`,
          impact: 'Transactions could accidentally be posted to prior year periods, affecting closed financial statements.',
          recommendation: 'Close prior year finance periods after completing year-end reconciliation.',
          affected_records: oldOpenPeriods.slice(0, 50).map(p => ({
            id: p.Id,
            name: p.Name,
            type: 'blng__FinancePeriod__c',
          })),
          effort_hours: oldOpenPeriods.length * 0.1,
        });
      }

      return issues;
    },
  },
  {
    id: 'FB-006',
    name: 'No Active Finance Book',
    category: 'finance_books',
    severity: 'critical',
    description: 'Checks if the org has at least one active finance book',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];

      if (data.financeBooks.length === 0) {
        issues.push({
          check_id: 'FB-006',
          category: 'finance_books',
          severity: 'critical',
          title: 'No finance books found',
          description: 'No finance books exist in this org. Finance books are required for billing and revenue recognition.',
          impact: 'Invoice posting and revenue recognition will not function without finance books.',
          recommendation: 'Create at least one active finance book with monthly or quarterly periods.',
          affected_records: [],
          revenue_impact: 100000,
          effort_hours: 2,
        });
      } else {
        const activeBooks = data.financeBooks.filter(b => b.blng__Active__c);
        if (activeBooks.length === 0) {
          issues.push({
            check_id: 'FB-006',
            category: 'finance_books',
            severity: 'critical',
            title: 'No active finance books',
            description: `All ${data.financeBooks.length} finance book(s) are inactive. At least one must be active.`,
            impact: 'Invoice posting and revenue recognition are completely blocked.',
            recommendation: 'Activate at least one finance book.',
            affected_records: data.financeBooks.map(b => ({
              id: b.Id,
              name: b.Name,
              type: 'blng__FinanceBook__c',
            })),
            effort_hours: 0.5,
          });
        }
      }

      return issues;
    },
  },
  {
    id: 'FB-007',
    name: 'Finance Periods Past End Date Still Open',
    category: 'finance_books',
    severity: 'info',
    description: 'Open finance periods that have ended — should be closed after reconciliation',
    run: async (data: BillingData): Promise<Issue[]> => {
      const issues: Issue[] = [];
      const todayStr = new Date().toISOString().split('T')[0];

      const expired = data.financePeriods.filter(p =>
        p.blng__PeriodStatus__c === 'Open' &&
        p.blng__PeriodEndDate__c &&
        p.blng__PeriodEndDate__c < todayStr
      );

      if (expired.length > 0) {
        issues.push({
          check_id: 'FB-007',
          category: 'finance_books',
          severity: 'info',
          title: `${expired.length} finance period(s) past end date still open`,
          description: `${expired.length} finance period(s) have ended but remain open. Closing completed periods is a best practice for financial hygiene.`,
          impact: 'Open past periods allow accidental backdated postings. Closing them protects financial data integrity.',
          recommendation: 'Review and close finance periods after reconciliation is complete.',
          affected_records: expired.slice(0, 20).map(p => ({
            id: p.Id,
            name: p.Name,
            type: 'blng__FinancePeriod__c',
          })),
          effort_hours: expired.length * 0.1,
        });
      }

      return issues;
    },
  },
];
