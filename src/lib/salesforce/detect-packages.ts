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
 * Detect which Salesforce revenue products are available in the org.
 *
 * NOTE on terminology: this function is named "detectInstalledPackages" for
 * historical reasons, but only CPQ and Billing are actually managed packages.
 * ARM (Advanced Revenue Management / Revenue Cloud / RLM) is NOT a managed
 * package — it's part of the core Salesforce platform, gated by license/feature
 * flag. We detect it by probing for standard objects that only exist when
 * Revenue Cloud features are enabled on the org.
 *
 * Detection probes:
 * - CPQ:     SBQQ__Quote__c          — Salesforce CPQ managed package
 * - Billing: blng__BillingRule__c    — Salesforce Billing managed package
 * - ARM:     ANY of three Revenue Cloud standard objects:
 *              ProductSellingModel       (modern RLM core)
 *              PriceAdjustmentSchedule   (RLM pricing engine)
 *              BillingSchedule           (Revenue Cloud billing)
 *            Different ARM rollouts expose different subsets of these
 *            objects, so requiring all of them produced false negatives
 *            on legitimate ARM orgs. We treat any one as a positive
 *            signal.
 */
export async function detectInstalledPackages(conn: Connection): Promise<DetectedPackages> {
  console.log('[PACKAGES] Detecting installed revenue products...');

  const [
    cpq,
    billing,
    hasProductSellingModel,
    hasPriceAdjustmentSchedule,
    hasBillingSchedule,
  ] = await Promise.all([
    objectExists(conn, 'SBQQ__Quote__c'),
    objectExists(conn, 'blng__BillingRule__c'),
    objectExists(conn, 'ProductSellingModel'),
    objectExists(conn, 'PriceAdjustmentSchedule'),
    objectExists(conn, 'BillingSchedule'),
  ]);

  // Any one of the three standard Revenue Cloud objects is enough to flag
  // ARM. Each indicates Revenue Cloud licensing/features are enabled.
  const arm =
    hasProductSellingModel || hasPriceAdjustmentSchedule || hasBillingSchedule;

  console.log(
    `[PACKAGES] Detected: CPQ=${cpq}, Billing=${billing}, ARM=${arm} ` +
    `(ProductSellingModel=${hasProductSellingModel}, ` +
    `PriceAdjustmentSchedule=${hasPriceAdjustmentSchedule}, ` +
    `BillingSchedule=${hasBillingSchedule})`
  );

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
