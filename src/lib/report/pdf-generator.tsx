import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet, Font, Link } from '@react-pdf/renderer';
import type { DBScan, DBIssue } from '@/types';

// The "Powered by OrgPrism" footer link doubles as a referral channel.
// Every shared PDF is potentially a new customer touchpoint, so the URL
// carries UTM tags we can attribute in /admin/analytics.
//   utm_source=pdf            (this report)
//   utm_medium=audit_report   (the artifact type, distinguishes from email)
//   utm_campaign=branded vs unbranded report (set per-call below)
const ORGPRISM_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://orgprism.vercel.app';
function attributionUrl(campaign: 'branded' | 'unbranded'): string {
  return `${ORGPRISM_URL}/?utm_source=pdf&utm_medium=audit_report&utm_campaign=${campaign}`;
}

// Register a clean font
Font.register({
  family: 'Inter',
  fonts: [
    { src: 'https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfAZ9hjQ.ttf', fontWeight: 400 },
    { src: 'https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuI6fAZ9hjQ.ttf', fontWeight: 600 },
    { src: 'https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYAZ9hjQ.ttf', fontWeight: 700 },
  ],
});

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: 'Inter', fontSize: 10, color: '#1f2937' },
  // Cover
  coverPage: { padding: 40, fontFamily: 'Inter', display: 'flex', justifyContent: 'center' },
  coverTitle: { fontSize: 28, fontWeight: 700, marginBottom: 8 },
  coverSubtitle: { fontSize: 14, color: '#6b7280', marginBottom: 40 },
  coverOrgName: { fontSize: 18, fontWeight: 600, marginBottom: 4 },
  coverDate: { fontSize: 12, color: '#6b7280' },
  coverCompany: { fontSize: 12, color: '#6b7280', marginTop: 60 },
  // Score
  scoreSection: { flexDirection: 'row', marginBottom: 24 },
  scoreBox: { width: 120, height: 80, borderRadius: 8, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginRight: 20 },
  scoreNumber: { fontSize: 36, fontWeight: 700 },
  scoreLabel: { fontSize: 8, color: '#6b7280' },
  // Category bars
  categoryRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  categoryLabel: { width: 130, fontSize: 9 },
  categoryBarBg: { flex: 1, height: 8, backgroundColor: '#e5e7eb', borderRadius: 4 },
  categoryBar: { height: 8, borderRadius: 4 },
  categoryScore: { width: 40, textAlign: 'right', fontSize: 9, fontWeight: 600 },
  // Summary
  summaryBox: { backgroundColor: '#eff6ff', borderRadius: 6, padding: 12, marginBottom: 20 },
  summaryTitle: { fontSize: 11, fontWeight: 600, color: '#1e40af', marginBottom: 6 },
  summaryText: { fontSize: 9, lineHeight: 1.5, color: '#1e3a5f' },
  // Issues
  sectionTitle: { fontSize: 14, fontWeight: 700, marginBottom: 12, marginTop: 8 },
  issueCard: { marginBottom: 14, borderRadius: 6, borderWidth: 1, borderColor: '#e5e7eb', overflow: 'hidden' },
  issueCardHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  issueCardHeaderCritical: { backgroundColor: '#fef2f2' },
  issueCardHeaderWarning: { backgroundColor: '#fefce8' },
  issueCardHeaderInfo: { backgroundColor: '#eff6ff' },
  issueBadge: { fontSize: 7, fontWeight: 600, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, color: '#ffffff' },
  issueBadgeCritical: { backgroundColor: '#dc2626' },
  issueBadgeWarning: { backgroundColor: '#ca8a04' },
  issueBadgeInfo: { backgroundColor: '#2563eb' },
  issueTitle: { fontSize: 10, fontWeight: 700, flex: 1 },
  issueCardBody: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10 },
  issueDesc: { fontSize: 9, color: '#4b5563', lineHeight: 1.5, marginBottom: 8 },
  issueRecBox: { backgroundColor: '#f0fdf4', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 6, borderWidth: 1, borderColor: '#bbf7d0' },
  issueRecLabel: { fontSize: 7, fontWeight: 700, color: '#15803d', marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  issueRecText: { fontSize: 8.5, color: '#166534', lineHeight: 1.5 },
  // Footer
  footer: { position: 'absolute', bottom: 20, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', fontSize: 8, color: '#9ca3af' },
  footerLeft: { flexDirection: 'column', gap: 2 },
  footerAttribution: { fontSize: 7, color: '#cbd5e1', textDecoration: 'none' },
  // Stats
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  statBox: { flex: 1, backgroundColor: '#f9fafb', borderRadius: 6, padding: 10, alignItems: 'center' },
  statNumber: { fontSize: 20, fontWeight: 700 },
  statLabel: { fontSize: 8, color: '#6b7280', marginTop: 2 },
  // Revenue leakage block — sits below the score on page 2 because this
  // is the consultant-deliverable headline number. Amber tint (not red)
  // signals "money on the table" rather than "fire".
  leakBox: { backgroundColor: '#fef3c7', borderRadius: 8, padding: 14, marginTop: 16, borderWidth: 1, borderColor: '#fcd34d' },
  leakTitle: { fontSize: 10, fontWeight: 700, color: '#78350f', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  leakHeadline: { fontSize: 22, fontWeight: 700, color: '#92400e', marginBottom: 4 },
  leakSub: { fontSize: 9, color: '#a16207', marginBottom: 10 },
  leakConfChip: { fontSize: 7, fontWeight: 700, color: '#78350f', backgroundColor: '#fde68a', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3 },
  leakContribRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderTopWidth: 0.5, borderTopColor: '#fde68a' },
  leakContribCheck: { fontSize: 8, fontFamily: 'Inter', color: '#78350f', fontWeight: 600 },
  leakContribTitle: { fontSize: 8.5, color: '#451a03', flex: 1, marginLeft: 6 },
  leakContribImpact: { fontSize: 9, fontWeight: 700, color: '#92400e' },
  leakMethodFootnote: { fontSize: 7, color: '#a16207', marginTop: 8, fontStyle: 'italic' },
});

const CATEGORY_LABELS: Record<string, string> = {
  price_rules: 'Price Rules',
  discount_schedules: 'Discount Schedules',
  products: 'Products & Bundles',
  product_rules: 'Product Rules',
  cpq_settings: 'CPQ Settings',
  subscriptions: 'Subscriptions',
  twin_fields: 'Twin Fields',
  contracted_prices: 'Contracted Prices',
  quote_lines: 'Quote Lines',
  summary_variables: 'Summary Variables',
  approval_rules: 'Approval Rules',
  quote_calculator_plugin: 'QCP (Custom Scripts)',
  quote_templates: 'Quote Templates',
  configuration_attributes: 'Config Attributes',
  guided_selling: 'Guided Selling',
  advanced_pricing: 'Advanced Pricing',
  performance: 'Performance',
  impact_analysis: 'Impact Analysis',
};

function getBarColor(score: number) {
  if (score >= 80) return '#16a34a';
  if (score >= 60) return '#ca8a04';
  return '#dc2626';
}

function getScoreBorder(score: number) {
  if (score >= 80) return '#bbf7d0';
  if (score >= 60) return '#fef08a';
  return '#fecaca';
}

// Shape we expect on scan.metadata.revenue_leakage when the leakage
// engine ran during the scan. Matches RevenueLeakageData on the dashboard
// side. Optional throughout so older scans without leakage data still
// render the report unchanged.
interface PdfLeakage {
  estimated_annual_leakage: number;
  percent_of_revenue: number | null;
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  top_contributors: Array<{ check_id: string; title: string; impact: number; methodology: string }>;
  audit?: {
    baseline_source: string;
    baseline_sample_size: number;
    industry_used: string;
  };
}

function formatMoneyShort(amount: number, currency: string): string {
  if (amount >= 1_000_000) return `${currency} ${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `${currency} ${(amount / 1_000).toFixed(0)}K`;
  return `${currency} ${amount.toLocaleString()}`;
}

interface ReportProps {
  scan: DBScan;
  issues: DBIssue[];
  orgName: string;
  companyName: string;
  brandColor: string;
  logoUrl?: string | null;
  remediationPlan?: string | null;
  leakage?: PdfLeakage | null;
  currency?: string;
}

export function CPQHealthReport({ scan, issues, orgName, companyName, brandColor, logoUrl, remediationPlan, leakage, currency = 'USD' }: ReportProps) {
  const scores = (scan.category_scores || {}) as unknown as Record<string, number>;
  const criticalIssues = issues.filter((i) => i.severity === 'critical');
  const warningIssues = issues.filter((i) => i.severity === 'warning');
  const infoIssues = issues.filter((i) => i.severity === 'info');
  const scanDate = scan.completed_at ? new Date(scan.completed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A';
  const overall = scan.overall_score || 0;

  // Footer attribution: small "Powered by orgprism.app" link beneath the
  // branded line. Renders the same shape on every page so the footer
  // doesn't jump around. When white-labeled (companyName set), the
  // attribution stays small and unobtrusive — consultants sharing the
  // report with their clients see their own brand on top with a single
  // discreet line below. When unbranded, "Generated by OrgPrism" is the
  // top line and the attribution is the URL.
  const utmHref = attributionUrl(companyName ? 'branded' : 'unbranded');
  const FooterRow = ({ pageLabel }: { pageLabel: string }) => (
    <View style={styles.footer}>
      <View style={styles.footerLeft}>
        <Text>{companyName || 'Generated by OrgPrism'}</Text>
        <Link src={utmHref} style={styles.footerAttribution}>
          Powered by orgprism.app
        </Link>
      </View>
      <Text>{pageLabel}</Text>
    </View>
  );

  return (
    <Document>
      {/* Cover Page */}
      <Page size="A4" style={styles.coverPage}>
        {logoUrl && (
          <View style={{ position: 'absolute', top: 40, right: 40 }}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image src={logoUrl} style={{ width: 100, height: 50, objectFit: 'contain' }} />
          </View>
        )}
        <View style={{ marginTop: 120 }}>
          <Text style={{ ...styles.coverTitle, color: brandColor }}>CPQ Health Check Report</Text>
          <Text style={styles.coverSubtitle}>Salesforce Revenue Cloud Configuration Audit</Text>
          <View style={{ height: 2, backgroundColor: brandColor, width: 60, marginBottom: 30 }} />
          <Text style={styles.coverOrgName}>{orgName}</Text>
          <Text style={styles.coverDate}>{scanDate}</Text>
          {companyName && (
            <Text style={styles.coverCompany}>Prepared by {companyName}</Text>
          )}
        </View>
        <FooterRow pageLabel="Page 1" />
      </Page>

      {/* Results Page */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.sectionTitle}>Health Score Overview</Text>

        {/* Score + Stats */}
        <View style={styles.scoreSection}>
          <View style={{ ...styles.scoreBox, borderColor: getScoreBorder(overall) }}>
            <Text style={{ ...styles.scoreNumber, color: getBarColor(overall) }}>{overall}</Text>
            <Text style={styles.scoreLabel}>/100</Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Text style={{ ...styles.statNumber, color: '#dc2626' }}>{scan.critical_count}</Text>
                <Text style={styles.statLabel}>Critical</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={{ ...styles.statNumber, color: '#ca8a04' }}>{scan.warning_count}</Text>
                <Text style={styles.statLabel}>Warnings</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={{ ...styles.statNumber, color: '#2563eb' }}>{scan.info_count}</Text>
                <Text style={styles.statLabel}>Info</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Category Breakdown */}
        <Text style={{ fontSize: 11, fontWeight: 600, marginBottom: 8 }}>Category Breakdown</Text>
        {Object.entries(scores)
          .sort(([, a], [, b]) => a - b)
          .map(([cat, score]) => (
            <View key={cat} style={styles.categoryRow}>
              <Text style={styles.categoryLabel}>{CATEGORY_LABELS[cat] || cat}</Text>
              <View style={styles.categoryBarBg}>
                <View style={{ ...styles.categoryBar, width: `${score}%`, backgroundColor: getBarColor(score) }} />
              </View>
              <Text style={styles.categoryScore}>{score}/100</Text>
            </View>
          ))}

        {/* Revenue Leakage block — the consultant-deliverable headline.
            Renders only when the scan produced a leakage estimate. Sits
            above the AI summary so it's the first $ number a CFO sees. */}
        {leakage && leakage.estimated_annual_leakage > 0 && (
          <View style={styles.leakBox} wrap={false}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <Text style={styles.leakTitle}>Estimated Annual Revenue Leakage</Text>
              <Text style={styles.leakConfChip}>
                {leakage.confidence === 'high' ? 'HIGH CONFIDENCE' :
                 leakage.confidence === 'medium' ? 'MEDIUM CONFIDENCE' :
                 leakage.confidence === 'low' ? 'LOW CONFIDENCE' : 'ESTIMATE'}
              </Text>
            </View>
            <Text style={styles.leakHeadline}>
              {formatMoneyShort(leakage.estimated_annual_leakage, currency)} / year
            </Text>
            {leakage.percent_of_revenue !== null && (
              <Text style={styles.leakSub}>
                {leakage.percent_of_revenue.toFixed(1)}% of annual revenue
                {leakage.audit ? ` · ${leakage.audit.baseline_sample_size.toLocaleString()} records analyzed · ${leakage.audit.industry_used} profile` : ''}
              </Text>
            )}
            {leakage.top_contributors.length > 0 && (
              <View style={{ marginTop: 6 }}>
                <Text style={{ fontSize: 8, fontWeight: 700, color: '#78350f', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Biggest Revenue Leaks — Top {Math.min(5, leakage.top_contributors.length)} by $ Impact
                </Text>
                {leakage.top_contributors.slice(0, 5).map((c, i) => (
                  <View key={c.check_id + i} style={styles.leakContribRow}>
                    <Text style={styles.leakContribCheck}>{c.check_id}</Text>
                    <Text style={styles.leakContribTitle}>{c.title}</Text>
                    <Text style={styles.leakContribImpact}>{formatMoneyShort(c.impact, currency)}</Text>
                  </View>
                ))}
              </View>
            )}
            <Text style={styles.leakMethodFootnote}>
              Forward-looking annualized estimate based on real org data. Each formula includes a recoverability factor to avoid over-promising. Some leakage is structurally non-recoverable.
            </Text>
          </View>
        )}

        {/* AI Summary */}
        {scan.summary && (
          <View style={{ ...styles.summaryBox, marginTop: 16 }}>
            <Text style={styles.summaryTitle}>AI Analysis</Text>
            <Text style={styles.summaryText}>{scan.summary}</Text>
          </View>
        )}

        <FooterRow pageLabel="Page 2" />
      </Page>

      {/* Issues Pages */}
      <Page size="A4" style={styles.page}>
        {criticalIssues.length > 0 && (
          <>
            <Text style={{ ...styles.sectionTitle, color: '#dc2626' }}>
              Critical Issues ({criticalIssues.length})
            </Text>
            {criticalIssues.map((issue) => (
              <View key={issue.id} style={styles.issueCard} wrap={false}>
                <View style={{ ...styles.issueCardHeader, ...styles.issueCardHeaderCritical }}>
                  <Text style={{ ...styles.issueBadge, ...styles.issueBadgeCritical }}>{issue.check_id}</Text>
                  <Text style={styles.issueTitle}>{issue.title}</Text>
                </View>
                <View style={styles.issueCardBody}>
                  <Text style={styles.issueDesc}>{issue.description}</Text>
                  <View style={styles.issueRecBox}>
                    <Text style={styles.issueRecLabel}>Recommendation</Text>
                    <Text style={styles.issueRecText}>{issue.recommendation}</Text>
                  </View>
                </View>
              </View>
            ))}
          </>
        )}

        {warningIssues.length > 0 && (
          <>
            <Text style={{ ...styles.sectionTitle, color: '#ca8a04' }}>
              Warnings ({warningIssues.length})
            </Text>
            {warningIssues.map((issue) => (
              <View key={issue.id} style={styles.issueCard} wrap={false}>
                <View style={{ ...styles.issueCardHeader, ...styles.issueCardHeaderWarning }}>
                  <Text style={{ ...styles.issueBadge, ...styles.issueBadgeWarning }}>{issue.check_id}</Text>
                  <Text style={styles.issueTitle}>{issue.title}</Text>
                </View>
                <View style={styles.issueCardBody}>
                  <Text style={styles.issueDesc}>{issue.description}</Text>
                  <View style={styles.issueRecBox}>
                    <Text style={styles.issueRecLabel}>Recommendation</Text>
                    <Text style={styles.issueRecText}>{issue.recommendation}</Text>
                  </View>
                </View>
              </View>
            ))}
          </>
        )}

        {infoIssues.length > 0 && (
          <>
            <Text style={{ ...styles.sectionTitle, color: '#2563eb' }}>
              Best Practice Suggestions ({infoIssues.length})
            </Text>
            {infoIssues.map((issue) => (
              <View key={issue.id} style={styles.issueCard} wrap={false}>
                <View style={{ ...styles.issueCardHeader, ...styles.issueCardHeaderInfo }}>
                  <Text style={{ ...styles.issueBadge, ...styles.issueBadgeInfo }}>{issue.check_id}</Text>
                  <Text style={styles.issueTitle}>{issue.title}</Text>
                </View>
                <View style={styles.issueCardBody}>
                  <Text style={styles.issueDesc}>{issue.description}</Text>
                </View>
              </View>
            ))}
          </>
        )}

        <FooterRow pageLabel="Page 3" />
      </Page>

      {/* Remediation Plan Page (if AI plan exists) */}
      {remediationPlan && (
        <Page size="A4" style={styles.page}>
          <Text style={{ ...styles.sectionTitle, color: brandColor }}>AI Remediation Plan</Text>
          <View style={styles.summaryBox}>
            <Text style={styles.summaryTitle}>Prioritized Action Items</Text>
            <Text style={styles.summaryText}>{remediationPlan}</Text>
          </View>
          <FooterRow pageLabel="Page 4" />
        </Page>
      )}
    </Document>
  );
}
