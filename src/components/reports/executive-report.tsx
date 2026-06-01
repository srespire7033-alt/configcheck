/**
 * Executive Revenue Forensics Report — 5-page PDF.
 *
 * Page layout:
 *   1. Cover + headline $ + grade
 *   2. Executive summary (the page that gets read)
 *   3. Revenue Leakage detail (per-detector breakdown)
 *   4. Pricing Discipline + Attribution Map
 *   5. Recovery Roadmap + Methodology
 *
 * Pure rendering — no data fetching. Caller wires data via the
 * ExecutiveReportData prop. Uses @react-pdf/renderer's React component
 * model: Document → Page → View/Text/etc. The library compiles to
 * PDF in-memory, streams the bytes to the response.
 *
 * Style philosophy: clean, monospace-leaning, executive-friendly. No
 * gradients, no decorative graphics. Numbers and headings; everything
 * else is muted.
 */

import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

// ─────────────────────────────────────────────────────────────────────
// Data contract
// ─────────────────────────────────────────────────────────────────────

export interface ExecutiveReportData {
  org: {
    name: string;
    instance_url: string;
    product_type: string;
  };
  report_date: string;          // ISO
  period_months: number;
  // Revenue Leakage totals
  estimated_annual_leakage_usd: number;
  verified_leakage_usd: number;
  percent_of_revenue: number | null;
  // Per-detector breakdown
  detectors: Array<{
    id: string;
    label: string;
    finding_count: number;
    gap_usd: number;
    avg_recoverability: number;
  }>;
  // Attribution class breakdown
  attribution: Array<{
    class_letter: 'A' | 'B' | 'C' | 'D' | 'E';
    class_label: string;
    finding_count: number;
    gap_usd: number;
    pct_of_total: number;
  }>;
  // Top N findings
  top_findings: Array<{
    detector_id: string;
    title: string;
    gap_usd: number;
    recoverability: number;
  }>;
  // Pricing discipline
  pricing_discipline: {
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    avg_discount_pct: number;
    override_pct: number;
    threshold_pct: number;
    lines_scanned: number;
    top_offenders: Array<{ product_name: string; line_count: number; avg_discount_pct: number }>;
  };
  // Recovery roadmap — derived in the caller
  roadmap: Array<{
    week: string;
    action: string;
    detector_id: string;
    impact_usd: number;
  }>;
}

// ─────────────────────────────────────────────────────────────────────
// Styles — kept terse; @react-pdf/renderer uses StyleSheet.create
// (mirrors React Native API). Inheritance is shallow.
// ─────────────────────────────────────────────────────────────────────

const COLORS = {
  ink: '#0F172A',          // slate-900
  body: '#1F2937',         // gray-800
  muted: '#6B7280',        // gray-500
  faint: '#E5E7EB',        // gray-200
  brand: '#4F46E5',        // indigo-600
  good: '#059669',         // emerald-600
  warn: '#D97706',         // amber-600
  bad: '#DC2626',          // red-600
  panel: '#F8FAFC',        // slate-50
};

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, color: COLORS.body, fontFamily: 'Helvetica' },
  // Headers / hierarchy
  brandHeader: { fontSize: 9, color: COLORS.brand, fontFamily: 'Helvetica-Bold', letterSpacing: 1.5 },
  h1: { fontSize: 24, fontFamily: 'Helvetica-Bold', color: COLORS.ink, marginBottom: 4 },
  h2: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: COLORS.ink, marginTop: 16, marginBottom: 8 },
  h3: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: COLORS.ink, marginTop: 12, marginBottom: 4 },
  // Body
  p: { marginBottom: 6, lineHeight: 1.5 },
  muted: { color: COLORS.muted, fontSize: 9 },
  small: { fontSize: 9 },
  // Cover page
  coverWrapper: { flexGrow: 1, justifyContent: 'space-between' },
  headlineFigure: { fontSize: 56, fontFamily: 'Helvetica-Bold', color: COLORS.brand, marginVertical: 12 },
  // Tables
  tableRow: { flexDirection: 'row', paddingVertical: 4, borderBottom: `1pt solid ${COLORS.faint}` },
  tableHeader: { flexDirection: 'row', paddingVertical: 4, borderBottom: `1pt solid ${COLORS.muted}`, fontFamily: 'Helvetica-Bold', color: COLORS.muted, fontSize: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  tableCell: { fontSize: 9 },
  // Stats
  statBlock: { borderLeft: `3pt solid ${COLORS.brand}`, paddingLeft: 10, marginVertical: 8 },
  statLabel: { fontSize: 8, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 1 },
  statValue: { fontSize: 20, fontFamily: 'Helvetica-Bold', color: COLORS.ink },
  // Grade badge
  gradeBadge: { padding: 8, borderRadius: 4, fontFamily: 'Helvetica-Bold', textAlign: 'center' },
  // Footer
  footer: { position: 'absolute', bottom: 20, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', fontSize: 8, color: COLORS.muted, paddingTop: 6, borderTop: `1pt solid ${COLORS.faint}` },
});

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtMoneyExact(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function gradeColor(g: 'A' | 'B' | 'C' | 'D' | 'F'): string {
  return { A: COLORS.good, B: '#2563EB', C: COLORS.warn, D: '#EA580C', F: COLORS.bad }[g];
}

function ReportFooter({ pageNum, totalPages }: { pageNum: number; totalPages: number }) {
  return (
    <View style={styles.footer} fixed>
      <Text>OrgPrism Revenue Forensics</Text>
      <Text>Confidential — for client review only</Text>
      <Text>{pageNum} / {totalPages}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Main document
// ─────────────────────────────────────────────────────────────────────

export function ExecutiveReport({ data }: { data: ExecutiveReportData }) {
  const totalPages = 5;
  return (
    <Document title={`Revenue Forensics — ${data.org.name}`} author="OrgPrism">
      {/* ──────────── PAGE 1 — COVER ──────────── */}
      <Page size="LETTER" style={styles.page}>
        <View style={styles.coverWrapper}>
          <View>
            <Text style={styles.brandHeader}>ORGPRISM REVENUE FORENSICS</Text>
            <Text style={[styles.muted, { marginTop: 4 }]}>Executive Audit Report</Text>
          </View>

          <View>
            <Text style={[styles.muted, { textTransform: 'uppercase', letterSpacing: 1, fontSize: 9 }]}>
              Total Revenue Leakage (annualized)
            </Text>
            <Text style={styles.headlineFigure}>{fmtMoney(data.estimated_annual_leakage_usd)}</Text>
            <View style={{ flexDirection: 'row', gap: 24, marginTop: 8 }}>
              <View>
                <Text style={[styles.muted, { fontSize: 9 }]}>✓ Verified</Text>
                <Text style={{ fontSize: 14, fontFamily: 'Helvetica-Bold', color: COLORS.good }}>
                  {fmtMoney(data.verified_leakage_usd)}
                </Text>
              </View>
              <View>
                <Text style={[styles.muted, { fontSize: 9 }]}>~ Estimated</Text>
                <Text style={{ fontSize: 14, fontFamily: 'Helvetica-Bold', color: COLORS.warn }}>
                  {fmtMoney(data.estimated_annual_leakage_usd - data.verified_leakage_usd)}
                </Text>
              </View>
              {data.percent_of_revenue !== null && (
                <View>
                  <Text style={[styles.muted, { fontSize: 9 }]}>% of annual revenue</Text>
                  <Text style={{ fontSize: 14, fontFamily: 'Helvetica-Bold', color: COLORS.ink }}>
                    {data.percent_of_revenue.toFixed(1)}%
                  </Text>
                </View>
              )}
            </View>

            <View style={[styles.statBlock, { marginTop: 24, borderLeftColor: gradeColor(data.pricing_discipline.grade) }]}>
              <Text style={styles.statLabel}>Pricing Discipline Grade</Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12 }}>
                <Text style={[styles.statValue, { color: gradeColor(data.pricing_discipline.grade), fontSize: 32 }]}>
                  {data.pricing_discipline.grade}
                </Text>
                <Text style={styles.muted}>
                  Avg discount {data.pricing_discipline.avg_discount_pct.toFixed(1)}% • Manual override {data.pricing_discipline.override_pct.toFixed(1)}%
                </Text>
              </View>
            </View>
          </View>

          <View>
            <View style={{ borderTop: `1pt solid ${COLORS.faint}`, paddingTop: 12 }}>
              <Text style={styles.muted}>Engagement</Text>
              <Text style={{ fontSize: 14, fontFamily: 'Helvetica-Bold', color: COLORS.ink }}>{data.org.name}</Text>
              <Text style={[styles.muted, { marginTop: 8 }]}>Salesforce org</Text>
              <Text style={styles.small}>{data.org.instance_url}</Text>
              <Text style={[styles.muted, { marginTop: 8 }]}>Product type</Text>
              <Text style={styles.small}>{data.org.product_type.toUpperCase()}</Text>
              <Text style={[styles.muted, { marginTop: 8 }]}>Period covered</Text>
              <Text style={styles.small}>Last {data.period_months} months — through {fmtDate(data.report_date)}</Text>
            </View>
          </View>
        </View>
        <ReportFooter pageNum={1} totalPages={totalPages} />
      </Page>

      {/* ──────────── PAGE 2 — EXECUTIVE SUMMARY ──────────── */}
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.brandHeader}>EXECUTIVE SUMMARY</Text>
        <Text style={styles.h1}>The story behind {fmtMoney(data.estimated_annual_leakage_usd)}</Text>

        <Text style={styles.h3}>Where revenue is leaking</Text>
        <Text style={styles.p}>
          {data.attribution.length > 0
            ? `Across ${data.top_findings.length}+ findings, the dominant root cause is ${data.attribution[0].class_label.toLowerCase()} (Class ${data.attribution[0].class_letter}) — accounting for ${data.attribution[0].pct_of_total.toFixed(0)}% of verified leakage. The top three detectors by impact are listed below.`
            : 'No forensic findings have been verified yet. Run a forensic scan to populate this section.'}
        </Text>

        <Text style={styles.h3}>Top detectors by verified $</Text>
        {data.detectors.slice(0, 5).map((d) => {
          const widthPct = data.detectors[0]
            ? Math.max(1, (d.gap_usd / data.detectors[0].gap_usd) * 100)
            : 0;
          return (
            <View key={d.id} style={{ marginVertical: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold' }}>{d.id} — {d.label}</Text>
                <Text style={{ fontSize: 9 }}>{fmtMoneyExact(d.gap_usd)} ({d.finding_count})</Text>
              </View>
              <View style={{ marginTop: 2, height: 5, backgroundColor: COLORS.faint, borderRadius: 2 }}>
                <View style={{ width: `${widthPct}%`, height: 5, backgroundColor: COLORS.brand, borderRadius: 2 }} />
              </View>
            </View>
          );
        })}

        <Text style={styles.h3}>What it would take to recover it</Text>
        <Text style={styles.p}>
          The forensic engine projected a recoverability multiplier per finding based on workflow viability. The
          recovery roadmap on page 5 sequences fixes by impact and dependency — most leaks are
          patchable via Data Loader within days of approval. Class A (system disconnect) and Class B
          (manual override) account for the bulk of the recoverable $.
        </Text>

        <Text style={styles.h3}>The cost of doing nothing</Text>
        <Text style={styles.p}>
          At the current annualized leakage rate of {fmtMoney(data.estimated_annual_leakage_usd)}, the organization
          loses approximately {fmtMoney(data.estimated_annual_leakage_usd / 12)} per month
          ({fmtMoney(data.estimated_annual_leakage_usd / 52)} per week). Every billing cycle the variance
          compounds and the patch window narrows — once a quote-line variance hits an invoice, recovery
          requires a Credit/Debit Memo rather than a CSV patch.
        </Text>

        <ReportFooter pageNum={2} totalPages={totalPages} />
      </Page>

      {/* ──────────── PAGE 3 — REVENUE LEAKAGE DETAIL ──────────── */}
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.brandHeader}>REVENUE LEAKAGE BY DETECTOR</Text>
        <Text style={styles.h1}>What was flagged, by check</Text>
        <Text style={styles.muted}>
          {data.detectors.length} forensic detectors ran; {data.detectors.filter((d) => d.finding_count > 0).length} returned findings.
          Each row represents one detector and aggregates across all records that detector flagged.
        </Text>

        <View style={[styles.tableHeader, { marginTop: 16 }]}>
          <Text style={{ width: '14%' }}>Check ID</Text>
          <Text style={{ width: '44%' }}>Detector</Text>
          <Text style={{ width: '12%', textAlign: 'right' }}>Findings</Text>
          <Text style={{ width: '16%', textAlign: 'right' }}>Verified $</Text>
          <Text style={{ width: '14%', textAlign: 'right' }}>Recoverability</Text>
        </View>
        {data.detectors.map((d) => (
          <View style={styles.tableRow} key={d.id}>
            <Text style={[styles.tableCell, { width: '14%', fontFamily: 'Helvetica-Bold' }]}>{d.id}</Text>
            <Text style={[styles.tableCell, { width: '44%' }]}>{d.label}</Text>
            <Text style={[styles.tableCell, { width: '12%', textAlign: 'right' }]}>{d.finding_count}</Text>
            <Text style={[styles.tableCell, { width: '16%', textAlign: 'right', fontFamily: 'Helvetica-Bold' }]}>
              {fmtMoneyExact(d.gap_usd)}
            </Text>
            <Text style={[styles.tableCell, { width: '14%', textAlign: 'right' }]}>
              {(d.avg_recoverability * 100).toFixed(0)}%
            </Text>
          </View>
        ))}

        <Text style={styles.h3}>Top 10 individual findings by $</Text>
        <View style={styles.tableHeader}>
          <Text style={{ width: '14%' }}>Check ID</Text>
          <Text style={{ width: '64%' }}>Finding</Text>
          <Text style={{ width: '12%', textAlign: 'right' }}>Gap $</Text>
          <Text style={{ width: '10%', textAlign: 'right' }}>Recov.</Text>
        </View>
        {data.top_findings.slice(0, 10).map((f, i) => (
          <View style={styles.tableRow} key={i}>
            <Text style={[styles.tableCell, { width: '14%', fontFamily: 'Helvetica-Bold', fontSize: 8 }]}>{f.detector_id}</Text>
            <Text style={[styles.tableCell, { width: '64%', fontSize: 8 }]}>{f.title}</Text>
            <Text style={[styles.tableCell, { width: '12%', textAlign: 'right', fontSize: 8 }]}>{fmtMoneyExact(f.gap_usd)}</Text>
            <Text style={[styles.tableCell, { width: '10%', textAlign: 'right', fontSize: 8 }]}>
              {(f.recoverability * 100).toFixed(0)}%
            </Text>
          </View>
        ))}

        <ReportFooter pageNum={3} totalPages={totalPages} />
      </Page>

      {/* ──────────── PAGE 4 — ATTRIBUTION + PRICING DISCIPLINE ──────────── */}
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.brandHeader}>WHY IT'S HAPPENING</Text>
        <Text style={styles.h1}>Attribution + Pricing Discipline</Text>

        <Text style={styles.h2}>Root cause attribution</Text>
        <Text style={styles.muted}>
          Every finding routes through a 5-class attribution model. The $ leaking through each class
          indicates which kind of fix delivers the most recovery per hour.
        </Text>
        <View style={[styles.tableHeader, { marginTop: 8 }]}>
          <Text style={{ width: '10%' }}>Class</Text>
          <Text style={{ width: '50%' }}>Root cause family</Text>
          <Text style={{ width: '14%', textAlign: 'right' }}>Findings</Text>
          <Text style={{ width: '14%', textAlign: 'right' }}>$ at stake</Text>
          <Text style={{ width: '12%', textAlign: 'right' }}>% of total</Text>
        </View>
        {data.attribution.map((a) => (
          <View style={styles.tableRow} key={a.class_letter}>
            <Text style={[styles.tableCell, { width: '10%', fontFamily: 'Helvetica-Bold' }]}>{a.class_letter}</Text>
            <Text style={[styles.tableCell, { width: '50%' }]}>{a.class_label}</Text>
            <Text style={[styles.tableCell, { width: '14%', textAlign: 'right' }]}>{a.finding_count}</Text>
            <Text style={[styles.tableCell, { width: '14%', textAlign: 'right' }]}>{fmtMoneyExact(a.gap_usd)}</Text>
            <Text style={[styles.tableCell, { width: '12%', textAlign: 'right', fontFamily: 'Helvetica-Bold' }]}>
              {a.pct_of_total.toFixed(1)}%
            </Text>
          </View>
        ))}

        <Text style={styles.h2}>Pricing discipline scorecard</Text>
        <View style={{ flexDirection: 'row', gap: 16, marginVertical: 12 }}>
          <View style={[styles.statBlock, { flex: 1, borderLeftColor: gradeColor(data.pricing_discipline.grade) }]}>
            <Text style={styles.statLabel}>Grade</Text>
            <Text style={[styles.statValue, { color: gradeColor(data.pricing_discipline.grade), fontSize: 28 }]}>
              {data.pricing_discipline.grade}
            </Text>
          </View>
          <View style={[styles.statBlock, { flex: 1 }]}>
            <Text style={styles.statLabel}>Avg discount</Text>
            <Text style={styles.statValue}>{data.pricing_discipline.avg_discount_pct.toFixed(1)}%</Text>
            <Text style={styles.muted}>Threshold {data.pricing_discipline.threshold_pct}%</Text>
          </View>
          <View style={[styles.statBlock, { flex: 1 }]}>
            <Text style={styles.statLabel}>Manual override %</Text>
            <Text style={styles.statValue}>{data.pricing_discipline.override_pct.toFixed(1)}%</Text>
            <Text style={styles.muted}>Of {data.pricing_discipline.lines_scanned.toLocaleString()} lines</Text>
          </View>
        </View>

        <Text style={styles.h3}>Top discounting products</Text>
        <View style={styles.tableHeader}>
          <Text style={{ width: '50%' }}>Product</Text>
          <Text style={{ width: '20%', textAlign: 'right' }}>Lines</Text>
          <Text style={{ width: '30%', textAlign: 'right' }}>Avg discount</Text>
        </View>
        {data.pricing_discipline.top_offenders.map((o, i) => (
          <View style={styles.tableRow} key={i}>
            <Text style={[styles.tableCell, { width: '50%' }]}>{o.product_name}</Text>
            <Text style={[styles.tableCell, { width: '20%', textAlign: 'right' }]}>{o.line_count}</Text>
            <Text style={[styles.tableCell, { width: '30%', textAlign: 'right', fontFamily: 'Helvetica-Bold' }]}>
              {o.avg_discount_pct.toFixed(1)}%
            </Text>
          </View>
        ))}

        <ReportFooter pageNum={4} totalPages={totalPages} />
      </Page>

      {/* ──────────── PAGE 5 — RECOVERY ROADMAP ──────────── */}
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.brandHeader}>RECOVERY ROADMAP</Text>
        <Text style={styles.h1}>What to fix, in what order</Text>
        <Text style={styles.muted}>
          Sequenced by $-per-hour: highest recoverable impact first, then dependencies. Each row maps
          to a forensic detector with an existing CSV-driven recovery flow.
        </Text>

        <View style={[styles.tableHeader, { marginTop: 16 }]}>
          <Text style={{ width: '12%' }}>When</Text>
          <Text style={{ width: '14%' }}>Detector</Text>
          <Text style={{ width: '54%' }}>Action</Text>
          <Text style={{ width: '20%', textAlign: 'right' }}>Recoverable</Text>
        </View>
        {data.roadmap.map((r, i) => (
          <View style={styles.tableRow} key={i}>
            <Text style={[styles.tableCell, { width: '12%', fontFamily: 'Helvetica-Bold' }]}>{r.week}</Text>
            <Text style={[styles.tableCell, { width: '14%' }]}>{r.detector_id}</Text>
            <Text style={[styles.tableCell, { width: '54%' }]}>{r.action}</Text>
            <Text style={[styles.tableCell, { width: '20%', textAlign: 'right', fontFamily: 'Helvetica-Bold', color: COLORS.good }]}>
              {fmtMoneyExact(r.impact_usd)}
            </Text>
          </View>
        ))}

        <Text style={styles.h2}>Methodology</Text>
        <Text style={styles.p}>
          OrgPrism's forensic engine reconciles entitled revenue (what the contract specified) against
          realized revenue (what was actually quoted/billed) for every record in the configured window.
          The Verified column reports gaps confirmed against live Salesforce records. The Estimated
          column extrapolates from configuration heuristics where transactional data is partial.
        </Text>

        <Text style={styles.h3}>Data sources</Text>
        <Text style={styles.p}>
          • Contracts, Subscriptions, Quotes, QuoteLines (CPQ){'\n'}
          • Orders, OrderItems, Pricebook2, PricebookEntry (Order Management){'\n'}
          • Billing Schedules, Invoices (Salesforce Billing — when installed){'\n'}
          • Price Rules, Approval Rules, Discount Schedules (CPQ configuration){'\n'}
          • Flows, Apex Triggers (Setup metadata){'\n'}
        </Text>

        <Text style={styles.h3}>Confidence and scope</Text>
        <Text style={styles.p}>
          Per-record forensic detectors carry a recoverability score (0.0–1.0) based on workflow
          viability and audit-trail evidence. Findings with recoverability {`>`}0.8 are high-confidence patches
          eligible for the standard Data Loader recovery flow. Findings below 0.5 typically require
          manual review (post-invoice variances, ambiguous pricing intent, missing pricebook entries).
        </Text>

        <Text style={[styles.muted, { marginTop: 16, fontSize: 8 }]}>
          Report generated {fmtDate(data.report_date)} • Period: last {data.period_months} months •
          OrgPrism formula version 1.0 • Confidential — for client review only
        </Text>

        <ReportFooter pageNum={5} totalPages={totalPages} />
      </Page>
    </Document>
  );
}
