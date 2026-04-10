import React from 'react';
import { Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';
import type { DBScan, DBIssue } from '@/types';

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
  footer: { position: 'absolute', bottom: 20, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', fontSize: 8, color: '#9ca3af' },
  // Stats
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  statBox: { flex: 1, backgroundColor: '#f9fafb', borderRadius: 6, padding: 10, alignItems: 'center' },
  statNumber: { fontSize: 20, fontWeight: 700 },
  statLabel: { fontSize: 8, color: '#6b7280', marginTop: 2 },
});

const CATEGORY_LABELS: Record<string, string> = {
  price_rules: 'Price Rules',
  discount_schedules: 'Discount Schedules',
  products: 'Products & Bundles',
  product_rules: 'Product Rules',
  cpq_settings: 'CPQ Settings',
  subscriptions: 'Subscriptions',
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

interface ReportProps {
  scan: DBScan;
  issues: DBIssue[];
  orgName: string;
  companyName: string;
  brandColor: string;
}

export function CPQHealthReport({ scan, issues, orgName, companyName, brandColor }: ReportProps) {
  const scores = (scan.category_scores || {}) as unknown as Record<string, number>;
  const criticalIssues = issues.filter((i) => i.severity === 'critical');
  const warningIssues = issues.filter((i) => i.severity === 'warning');
  const infoIssues = issues.filter((i) => i.severity === 'info');
  const scanDate = scan.completed_at ? new Date(scan.completed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A';
  const overall = scan.overall_score || 0;

  return (
    <Document>
      {/* Cover Page */}
      <Page size="A4" style={styles.coverPage}>
        <View style={{ marginTop: 120 }}>
          <Text style={{ ...styles.coverTitle, color: brandColor }}>CPQ Health Check Report</Text>
          <Text style={styles.coverSubtitle}>Salesforce CPQ Configuration Audit</Text>
          <View style={{ height: 2, backgroundColor: brandColor, width: 60, marginBottom: 30 }} />
          <Text style={styles.coverOrgName}>{orgName}</Text>
          <Text style={styles.coverDate}>{scanDate}</Text>
          {companyName && (
            <Text style={styles.coverCompany}>Prepared by {companyName}</Text>
          )}
        </View>
        <View style={styles.footer}>
          <Text>Generated by ConfigCheck</Text>
          <Text>Page 1</Text>
        </View>
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

        {/* AI Summary */}
        {scan.summary && (
          <View style={{ ...styles.summaryBox, marginTop: 16 }}>
            <Text style={styles.summaryTitle}>AI Analysis</Text>
            <Text style={styles.summaryText}>{scan.summary}</Text>
          </View>
        )}

        <View style={styles.footer}>
          <Text>Generated by ConfigCheck</Text>
          <Text>Page 2</Text>
        </View>
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

        <View style={styles.footer}>
          <Text>Generated by ConfigCheck</Text>
          <Text>Page 3</Text>
        </View>
      </Page>
    </Document>
  );
}
