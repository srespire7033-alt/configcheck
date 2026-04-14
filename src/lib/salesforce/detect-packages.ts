import { Connection } from 'jsforce';

/**
 * Wrap a promise-like with a timeout.
 */
function withTimeout<T>(promiseLike: PromiseLike<T>, ms: number, label = 'Operation'): Promise<T> {
  return Promise.race([
    Promise.resolve(promiseLike),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

/**
 * Check if a Salesforce object exists by attempting to describe it.
 */
async function objectExists(conn: Connection, objectName: string): Promise<boolean> {
  try {
    await withTimeout(conn.describe(objectName), 10000, `Describe ${objectName}`);
    return true;
  } catch {
    return false;
  }
}

export interface DetectedPackages {
  cpq: boolean;
  billing: boolean;
  arm: boolean;
}

/**
 * Detect which Salesforce packages are installed in the org.
 * Checks for key objects from each package:
 * - CPQ: SBQQ__Quote__c (Salesforce CPQ managed package)
 * - Billing: blng__BillingRule__c (Salesforce Billing managed package)
 * - ARM: BillingSchedule (Revenue Cloud standard object, API v55+)
 */
export async function detectInstalledPackages(conn: Connection): Promise<DetectedPackages> {
  console.log('[PACKAGES] Detecting installed packages...');

  const [cpq, billing, arm] = await Promise.all([
    objectExists(conn, 'SBQQ__Quote__c'),
    objectExists(conn, 'blng__BillingRule__c'),
    objectExists(conn, 'BillingSchedule'),
  ]);

  console.log(`[PACKAGES] Detected: CPQ=${cpq}, Billing=${billing}, ARM=${arm}`);

  return { cpq, billing, arm };
}

/**
 * Convert detected packages to an array of string identifiers for DB storage.
 * e.g., ['cpq', 'billing'] or ['arm']
 */
export function packageDetectionToArray(detected: DetectedPackages): string[] {
  const packages: string[] = [];
  if (detected.cpq) packages.push('cpq');
  if (detected.billing) packages.push('billing');
  if (detected.arm) packages.push('arm');
  return packages;
}

/**
 * Determine which scan product types are available based on installed packages.
 * Returns the list of ProductType values the user can choose from.
 */
export function getAvailableScanTypes(installedPackages: string[]): Array<{ value: string; label: string }> {
  const types: Array<{ value: string; label: string }> = [];

  const hasCPQ = installedPackages.includes('cpq');
  const hasBilling = installedPackages.includes('billing');
  const hasARM = installedPackages.includes('arm');

  if (hasCPQ && !hasBilling) {
    types.push({ value: 'cpq', label: 'CPQ' });
  }
  if (hasCPQ && hasBilling) {
    types.push({ value: 'cpq', label: 'CPQ' });
    types.push({ value: 'cpq_billing', label: 'CPQ + Billing' });
  }
  if (hasARM) {
    types.push({ value: 'arm', label: 'ARM' });
  }

  // Fallback: if nothing detected, still allow CPQ scan (package fields might be restricted)
  if (types.length === 0) {
    types.push({ value: 'cpq', label: 'CPQ' });
  }

  return types;
}
