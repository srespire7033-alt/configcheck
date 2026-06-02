/**
 * Verification report: for each of the 20 detectors, report whether
 * it ran on the most recent scan, how many findings it produced, and
 * a health verdict.
 *
 * Expected counts are based on the seed scripts:
 *   - seed-forensic-fixture.ts (REN-001/REN-002/DSC-FOR-001/QL-FOR-001/ORD-FOR-001)
 *   - seed-ord-variance-fixture.ts (ORD-FOR-002/ORD-FOR-003)
 *   - seed-pricing-discipline-fixture.ts (no detector findings — pricing card only)
 *   - seed-new-detectors-fixture.ts (OPP-FOR-001/CON-FOR-001/PROV-FOR-001/SUB-FOR-001/REN-003)
 *   - seed-slice-14-fixtures.ts (REN-004/AMD-FOR-001/AST-FOR-001/DSC-FOR-002/CT-FOR-001/MDQ-FOR-001/PROV-FOR-002/QL-FOR-002)
 *
 * Run: npx tsx scripts/verify-all-detectors.ts <orgUuid>
 */
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
(function loadEnv() {
  const envPath = resolve(process.cwd(), '.env.local');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
})();
import { createClient } from '@supabase/supabase-js';

interface ExpectedRow {
  detectorId: string;
  category: 'revenue_leakage' | 'governance' | 'pipeline';
  minExpected: number;
  notes?: string;
}

// Hand-curated expectations. Set minExpected = 0 for detectors that
// won't fire in CPQ Ks (object not installed, etc.) — they just need
// to not crash.
const EXPECTED: ExpectedRow[] = [
  { detectorId: 'REN-001', category: 'revenue_leakage', minExpected: 7, notes: '10 contracts × 7 leaky' },
  { detectorId: 'REN-002', category: 'revenue_leakage', minExpected: 5, notes: 'Pricebook bumped above quote' },
  { detectorId: 'REN-003', category: 'pipeline', minExpected: 3, notes: 'Quotes expired in 90d window with no renewal' },
  { detectorId: 'REN-004', category: 'pipeline', minExpected: 1, notes: '1 stuck renewal seeded' },
  { detectorId: 'DSC-FOR-001', category: 'revenue_leakage', minExpected: 5, notes: '~10 promo lines seeded' },
  { detectorId: 'DSC-FOR-002', category: 'revenue_leakage', minExpected: 2, notes: '2 lines @ 70% discount' },
  { detectorId: 'QL-FOR-001', category: 'revenue_leakage', minExpected: 1, notes: '~3 bundled lines flipped to false' },
  { detectorId: 'QL-FOR-002', category: 'governance', minExpected: 0, notes: 'SBQQ__Approval__c not in CPQ Ks — expected silent' },
  { detectorId: 'ORD-FOR-001', category: 'revenue_leakage', minExpected: 5, notes: '5 orphan orders' },
  { detectorId: 'ORD-FOR-002', category: 'revenue_leakage', minExpected: 3, notes: '3 Q↔O variance scenarios' },
  { detectorId: 'ORD-FOR-003', category: 'revenue_leakage', minExpected: 3, notes: '3 amendment variance scenarios' },
  { detectorId: 'SUB-FOR-001', category: 'revenue_leakage', minExpected: 1, notes: 'Inverted from existing Asset overlap' },
  { detectorId: 'PROV-FOR-001', category: 'revenue_leakage', minExpected: 3, notes: '3 Assets without subs' },
  { detectorId: 'PROV-FOR-002', category: 'revenue_leakage', minExpected: 2, notes: '2 subs without Asset' },
  { detectorId: 'AST-FOR-001', category: 'revenue_leakage', minExpected: 1, notes: '1 terminated Asset + active sub' },
  { detectorId: 'CT-FOR-001', category: 'revenue_leakage', minExpected: 1, notes: '1 expired ContractedPrice' },
  { detectorId: 'MDQ-FOR-001', category: 'revenue_leakage', minExpected: 1, notes: '1 multi-year flat-pricing scenario' },
  { detectorId: 'OPP-FOR-001', category: 'governance', minExpected: 3, notes: '3 Closed-Won without Quote' },
  { detectorId: 'CON-FOR-001', category: 'governance', minExpected: 1, notes: 'Contract A (no subs) + Contract B (expired subs)' },
  { detectorId: 'AMD-FOR-001', category: 'governance', minExpected: 1, notes: '1 amendment missing StartDate' },
];

async function main() {
  const orgId = process.argv[2];
  if (!orgId) {
    console.error('Usage: npx tsx scripts/verify-all-detectors.ts <orgUuid>');
    process.exit(1);
  }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  // Latest completed/partial scan
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: scans } = (await supabase
    .from('forensic_scans')
    .select('id, status, completed_at, finding_count, detectors_completed, detectors_failed, metadata')
    .eq('organization_id', orgId)
    .in('status', ['completed', 'partial'])
    .order('completed_at', { ascending: false })
    .limit(1)) as any;
  const scan = (scans ?? [])[0];
  if (!scan) {
    console.error('No completed scans for this org');
    process.exit(1);
  }
  console.log(`Latest scan: ${scan.id}`);
  console.log(`  Status: ${scan.status}`);
  console.log(`  Completed: ${scan.completed_at}`);
  console.log(`  Total findings: ${scan.finding_count}`);
  console.log('');

  const completedSet = new Set<string>((scan.detectors_completed ?? []) as string[]);
  const failedSet = new Set<string>((scan.detectors_failed ?? []) as string[]);
  const errorByDetector = ((scan.metadata ?? {}).detector_errors ?? {}) as Record<string, string>;

  // Per-detector finding counts in THIS scan
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: findings } = (await supabase
    .from('forensic_findings')
    .select('detector_id, gap_usd')
    .eq('forensic_scan_id', scan.id)) as any;
  const countByDetector = new Map<string, { count: number; gap: number }>();
  for (const f of findings ?? []) {
    let agg = countByDetector.get(f.detector_id);
    if (!agg) {
      agg = { count: 0, gap: 0 };
      countByDetector.set(f.detector_id, agg);
    }
    agg.count += 1;
    agg.gap += Number(f.gap_usd ?? 0);
  }

  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('Detector verification report');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('ID            CAT     STATUS   COUNT  EXP   GAP $       VERDICT');
  console.log('───────────────────────────────────────────────────────────────────────');

  let okCount = 0;
  let warnCount = 0;
  let brokenCount = 0;
  const issues: Array<{ id: string; issue: string }> = [];

  for (const exp of EXPECTED) {
    const counts = countByDetector.get(exp.detectorId) ?? { count: 0, gap: 0 };
    const status = failedSet.has(exp.detectorId) ? 'FAIL' : completedSet.has(exp.detectorId) ? 'OK' : 'SKIP';
    let verdict: string;
    if (status === 'FAIL') {
      verdict = '❌ broken';
      brokenCount += 1;
      issues.push({ id: exp.detectorId, issue: errorByDetector[exp.detectorId]?.slice(0, 200) ?? 'unknown' });
    } else if (status === 'SKIP') {
      verdict = '⚠ did-not-run';
      brokenCount += 1;
      issues.push({ id: exp.detectorId, issue: 'detector not registered or filtered out' });
    } else if (counts.count >= exp.minExpected) {
      verdict = '✅';
      okCount += 1;
    } else if (counts.count > 0) {
      verdict = '⚠ low';
      warnCount += 1;
      issues.push({ id: exp.detectorId, issue: `got ${counts.count}, expected ≥${exp.minExpected}` });
    } else if (exp.minExpected === 0) {
      verdict = '✅ silent (expected)';
      okCount += 1;
    } else {
      verdict = '⚠ zero';
      warnCount += 1;
      issues.push({ id: exp.detectorId, issue: `got 0, expected ≥${exp.minExpected}` });
    }
    const gap = counts.gap > 0 ? `$${Math.round(counts.gap).toLocaleString()}` : '—';
    console.log(
      `${exp.detectorId.padEnd(14)}${exp.category.slice(0, 5).padEnd(8)}${status.padEnd(9)}${counts.count.toString().padStart(3)}    ${exp.minExpected.toString().padStart(3)}   ${gap.padStart(10)}  ${verdict}`
    );
  }

  console.log('───────────────────────────────────────────────────────────────────────');
  console.log(`Summary: ${okCount} OK · ${warnCount} warning · ${brokenCount} broken (of ${EXPECTED.length} detectors)`);

  if (issues.length > 0) {
    console.log('\nIssues to address:');
    for (const i of issues) {
      console.log(`  ${i.id.padEnd(14)} ${i.issue}`);
    }
  } else {
    console.log('\nNo issues. Every detector running as expected.');
  }
}
main().catch((e) => console.error(e instanceof Error ? e.message : e));
