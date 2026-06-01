import { NextRequest, NextResponse } from 'next/server';
import { createRefreshableConnection } from '@/lib/salesforce/client';
import { getAuthUser } from '@/lib/auth/get-user';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * GET /api/forensics/debug-ren001?orgId=xxx
 *
 * Throwaway diagnostic endpoint that runs the same queries REN-001 uses
 * and returns ALL intermediate results so we can see exactly why no
 * findings are matching. Returns:
 *   - all renewal QuoteLines (with key fields)
 *   - their associated Subscriptions (by both link and by Account+Product)
 *   - their associated Contracts + uplift rates
 *
 * Will be removed once REN-001 reliably finds the expected findings.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const orgId = request.nextUrl.searchParams.get('orgId');
  if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 });

  const { conn } = await createRefreshableConnection(orgId);

  const sinceIso = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString();

  // 1. Renewal QuoteLines
  const linesRes = await conn.query<{
    Id: string;
    Name: string;
    SBQQ__Quote__c: string;
    'SBQQ__Quote__r.SBQQ__Account__c': string | null;
    'SBQQ__Quote__r.SBQQ__Type__c': string;
    SBQQ__RenewedSubscription__c: string | null;
    SBQQ__Product__c: string;
    'SBQQ__Product__r.Name': string;
    SBQQ__NetPrice__c: string;
    SBQQ__Quantity__c: string;
    CreatedDate: string;
  }>(`
    SELECT
      Id, Name, SBQQ__Quote__c,
      SBQQ__Quote__r.SBQQ__Account__c,
      SBQQ__Quote__r.SBQQ__Type__c,
      SBQQ__RenewedSubscription__c,
      SBQQ__Product__c, SBQQ__Product__r.Name,
      SBQQ__NetPrice__c, SBQQ__Quantity__c, CreatedDate
    FROM SBQQ__QuoteLine__c
    WHERE SBQQ__Quote__r.SBQQ__Type__c = 'Renewal'
      AND CreatedDate >= ${sinceIso}
  `);

  // 2. All Subscriptions on the affected Account(s) for the affected Product(s)
  const accountIds = Array.from(new Set(
    linesRes.records
      .map((l) => l['SBQQ__Quote__r.SBQQ__Account__c'])
      .filter((id): id is string => !!id)
  ));
  const productIds = Array.from(new Set(linesRes.records.map((l) => l.SBQQ__Product__c).filter(Boolean)));

  let subsRes: { records: Array<Record<string, unknown>> } = { records: [] };
  if (accountIds.length > 0 && productIds.length > 0) {
    subsRes = await conn.query(`
      SELECT
        Id, Name, SBQQ__Account__c, SBQQ__Product__c,
        SBQQ__Contract__c, SBQQ__Contract__r.ContractNumber,
        SBQQ__Contract__r.SBQQ__RenewalUpliftRate__c,
        SBQQ__NetPrice__c, SBQQ__Quantity__c,
        SBQQ__SubscriptionEndDate__c
      FROM SBQQ__Subscription__c
      WHERE SBQQ__Account__c IN (${accountIds.map((id) => `'${id}'`).join(',')})
        AND SBQQ__Product__c IN (${productIds.map((id) => `'${id}'`).join(',')})
    `);
  }

  // 3. What's on the Contracts directly
  const contractIds = Array.from(new Set(
    subsRes.records
      .map((s) => s.SBQQ__Contract__c as string | undefined)
      .filter((id): id is string => !!id)
  ));
  let contractsRes: { records: Array<Record<string, unknown>> } = { records: [] };
  if (contractIds.length > 0) {
    contractsRes = await conn.query(`
      SELECT Id, ContractNumber, AccountId, SBQQ__RenewalUpliftRate__c
      FROM Contract
      WHERE Id IN (${contractIds.map((id) => `'${id}'`).join(',')})
    `);
  }

  // Per-line attempted match
  const lineMatches = linesRes.records.map((line) => {
    const acctId = line['SBQQ__Quote__r.SBQQ__Account__c'];
    const candidateSubs = (subsRes.records as Array<{ Id: string; SBQQ__Account__c: string; SBQQ__Product__c: string; SBQQ__NetPrice__c?: string; SBQQ__Contract__r?: { SBQQ__RenewalUpliftRate__c?: string | null } }>)
      .filter((s) => s.SBQQ__Account__c === acctId && s.SBQQ__Product__c === line.SBQQ__Product__c);
    const directLink = line.SBQQ__RenewedSubscription__c
      ? subsRes.records.find((s) => (s as { Id: string }).Id === line.SBQQ__RenewedSubscription__c)
      : null;
    return {
      line_id: line.Id,
      line_name: line.Name,
      net_price: line.SBQQ__NetPrice__c,
      quantity: line.SBQQ__Quantity__c,
      product: line['SBQQ__Product__r.Name'],
      account_id_on_quote: acctId,
      direct_link_to_sub: line.SBQQ__RenewedSubscription__c,
      direct_link_resolved: !!directLink,
      candidate_subs_by_acct_product: candidateSubs.length,
      candidate_subs_summary: candidateSubs.slice(0, 3).map((s) => ({
        id: s.Id,
        net_price: s.SBQQ__NetPrice__c,
        uplift_rate: s.SBQQ__Contract__r?.SBQQ__RenewalUpliftRate__c,
      })),
    };
  });

  return NextResponse.json({
    summary: {
      renewal_lines: linesRes.records.length,
      lines_with_renewed_subscription_set: linesRes.records.filter((l) => !!l.SBQQ__RenewedSubscription__c).length,
      unique_account_ids: accountIds.length,
      unique_product_ids: productIds.length,
      subscriptions_for_acct_product: subsRes.records.length,
      contracts_loaded: contractsRes.records.length,
    },
    accountIds,
    productIds,
    contracts: contractsRes.records,
    lineMatches,
  });
}
