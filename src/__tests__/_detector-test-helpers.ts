/**
 * Shared mock-connection harness for detector unit tests.
 *
 * Each detector test passes in a state object describing which records
 * exist in the mock Salesforce org. The mockConn responds to SOQL by
 * matching the query against known patterns and returning the
 * appropriate state slice.
 *
 * This keeps each test file small — they just declare the records they
 * care about and the expected output.
 */

import { vi } from 'vitest';
import type { Connection } from 'jsforce';
import type { DetectorContext } from '@/lib/forensics/types';

/**
 * The mock can recognise common SOQL shapes by substring matching.
 * Each detector test fills in the slices it needs; everything else
 * defaults to empty.
 */
export interface MockOrgState {
  // Field-existence probes — let detectors handle missing-field cases.
  // Default: pretend every probed field exists.
  describeMissingFields?: Set<string>; // 'SBQQ__Bundled__c', 'SBQQ__PartialPeriod__c', etc.
  describeMissingObjects?: Set<string>; // 'Asset', 'blng__BillingSchedule__c', etc.
  // Generic table data. Key = SObject name, value = rows that the
  // mock returns when a SOQL query mentions FROM <key>.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tables?: Record<string, Array<Record<string, any>>>;
  // Override behavior for specific query patterns.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queryOverrides?: Array<(soql: string) => { records: any[] } | null>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickTableFromSoql(soql: string, tables: Record<string, any[]>): any[] | null {
  // Match `FROM <SObjectName>` (skip past WHERE, etc.)
  const m = soql.match(/FROM\s+([A-Za-z0-9_]+)/i);
  if (!m) return null;
  const table = m[1];
  return tables[table] ?? null;
}

/**
 * Filter rows by simple equality / IN clauses in the SOQL.
 * Just enough to make tests deterministic — doesn't try to be a
 * full SOQL evaluator.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilters(rows: any[], soql: string): any[] {
  let out = rows;
  // status IN ('Activated', 'Approved') style
  const inMatch = soql.match(/Status\s+IN\s*\(([^)]+)\)/i);
  if (inMatch) {
    const values = inMatch[1].split(',').map((v) => v.replace(/['"]/g, '').trim());
    out = out.filter((r) => values.includes(String(r.Status)));
  }
  // ID lookups via IN ('id1', 'id2', ...)
  // (Most tests provide narrow data so we leave this loose.)
  return out;
}

export function buildMockConn(state: MockOrgState): Connection {
  const describe = vi.fn().mockImplementation(async (objName: string) => {
    if (state.describeMissingObjects?.has(objName)) {
      throw new Error(`Object ${objName} not in org`);
    }
    return {
      fields: state.describeMissingFields
        ? [{ name: 'placeholder' }] // populate with placeholder; tests use the negative case via Set
        : [
            { name: 'SBQQ__Bundled__c' },
            { name: 'SBQQ__PartialPeriod__c' },
            { name: 'SBQQ__SegmentIndex__c' },
            { name: 'SBQQ__ExpirationDate__c' },
            { name: 'SBQQ__ProrateMultiplier__c' },
            { name: 'CurrencyIsoCode' },
            { name: 'SBQQ__ContractedPrice__c' },
            { name: 'blng__BillableUnitPrice__c' },
          ],
    };
  });

  const query = vi.fn().mockImplementation(async (soql: string) => {
    // Try overrides first
    for (const fn of state.queryOverrides ?? []) {
      const out = fn(soql);
      if (out) return out;
    }
    if (!state.tables) return { records: [] };
    const t = pickTableFromSoql(soql, state.tables);
    if (!t) return { records: [] };
    return { records: applyFilters(t, soql) };
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { describe, query } as any as Connection;
}

export function makeCtx(conn: Connection, currency = 'USD'): DetectorContext {
  return {
    conn,
    organizationId: 'org-test',
    defaultCurrencyIsoCode: currency,
    snapshots: new Map(),
  };
}
