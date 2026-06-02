// Builds docs/OrgPrism-Feature-Inventory.xlsx — every feature shipped
// + deployment tracking + phased managed-package migration plan.
// Run: node scripts/build-feature-inventory.js
//
// Tabs:
//   1. Features  — main inventory (every feature shipped)
//   2. Summary   — counts + deployment progress per category + phase
//   3. Release Plan — phased rollout (v1.0 → v3.0 + Skip)
//   4. Migration Reality Check — honest SaaS-vs-Apex tradeoffs
//
// PHASE LEGEND
//   v1.0 (MVP)        — Smallest shippable AppExchange listing. ~6 weeks.
//   v1.5 (Coverage)   — Remaining detectors + bulk workflow. ~4 weeks.
//   v2.0 (Polish)     — Matrix + tabs + UX. ~4 weeks.
//   v2.5 (Hard stuff) — AI + PDF + email + scheduled. ~6 weeks.
//   Skip              — SaaS-only / doesn't make sense in-Salesforce.

const ExcelJS = require('exceljs');
const path = require('path');

function det(subcategory, feature, description, where, apex, phase, notes) {
  return [{ category: 'Detectors', subcategory, feature, description, where, apex, phase, notes }];
}

const features = [
  // ═════ ENGINE CORE ═════
  { category: 'Engine Core', subcategory: 'Schema', feature: 'ForensicScan custom object', description: 'Per-scan record: status, started_at, completed_at, totals', where: 'DB → SF custom object', apex: 'Easy', phase: 'v1.0', notes: 'Becomes ForensicScan__c with picklist Status + summary fields.' },
  { category: 'Engine Core', subcategory: 'Schema', feature: 'ForensicFinding custom object', description: 'Per-finding row: detector_id, gap_usd, status, hidden_at, consultant_note', where: 'DB → SF custom object', apex: 'Easy', phase: 'v1.0', notes: 'Becomes ForensicFinding__c. ~12 custom fields including evidence as Long Text Area.' },
  { category: 'Engine Core', subcategory: 'Schema', feature: 'AttributionTrace custom object', description: 'Root-cause trace: class, config, evidence, AI explanation', where: 'DB → SF custom object', apex: 'Medium', phase: 'v1.0', notes: 'AttributionTrace__c with junction to ForensicFinding__c.' },
  { category: 'Engine Core', subcategory: 'Schema', feature: 'RecoveryAction custom object', description: 'State machine: pending → approved → committed', where: 'DB → SF custom object', apex: 'Medium', phase: 'v1.0', notes: 'RecoveryAction__c + Apex trigger for state transitions.' },
  { category: 'Engine Core', subcategory: 'Schema', feature: 'CheckSuppression custom object', description: 'Per-org false-positive memory: future scans skip suppressed checks', where: 'DB → SF custom object', apex: 'Easy', phase: 'v1.5', notes: 'CheckSuppression__c keyed (org, check_id).' },
  { category: 'Engine Core', subcategory: 'Scan', feature: 'Background scan job + chaining', description: 'Long-running scan + chains forensic scan after config scan', where: 'src/lib/scans/run-scan-in-background.ts', apex: 'Medium', phase: 'v1.0', notes: 'Queueable + Batchable Apex chain. 5-min sync limit watch.' },
  { category: 'Engine Core', subcategory: 'Scan', feature: 'Scan dialog with forensics opt-in', description: 'UI to kick off a scan with deep-scan checkbox', where: 'src/components/scan/scan-dialog.tsx', apex: 'Easy', phase: 'v1.0', notes: 'LWC modal + toggle.' },
  { category: 'Engine Core', subcategory: 'AI', feature: 'Plain-English finding renderer (Gemini)', description: 'AI-generated explanation per finding, grounded in evidence', where: 'src/lib/forensics/renderer.ts', apex: 'Hard', phase: 'v2.5', notes: 'Apex Named Credential → Gemini. Governor limits cap throughput. Pre-compute via batch + cache.' },
  { category: 'Engine Core', subcategory: 'API', feature: 'Bulk API 2.0 client wrapper', description: 'Stream-friendly SF Bulk API 2.0 wrapper', where: 'src/lib/salesforce/bulk-client.ts', apex: 'Skip', phase: 'Skip', notes: 'In-package uses native SOQL — no Bulk wrapper needed.' },
  { category: 'Engine Core', subcategory: 'API', feature: 'jsforce + token refresh + retry', description: 'createRefreshableConnection wrapper with revoke-detection', where: 'src/lib/salesforce/client.ts', apex: 'Skip', phase: 'Skip', notes: 'N/A — Apex runs as the user.' },
  { category: 'Engine Core', subcategory: 'API', feature: 'Empty-error guard (revoked-token detection)', description: 'jsforce empty-message Error → actionable reconnect message', where: '4 API routes', apex: 'Skip', phase: 'Skip', notes: 'N/A in-package.' },

  // ═════ DETECTORS (20) ═════
  ...det('Renewals', 'REN-001 — Renewal Uplift Suppressed', 'Renewal Quote Lines where contractually entitled uplift not applied', 'src/lib/forensics/detectors/ren-001-renewal-uplift.ts', 'Easy', 'v1.0', 'Highest-$ detector. Phase 1 MVP.'),
  ...det('Renewals', 'REN-002 — Renewal Below Current List Price', 'Renewal NetPrice < current PricebookEntry list price', 'src/lib/forensics/detectors/ren-002-renewal-below-list.ts', 'Easy', 'v1.0', 'Common. Phase 1 MVP.'),
  ...det('Discounts', 'DSC-FOR-001 — Promo Discount Roll-off Failure', 'Promo discount past expiration still applied', 'src/lib/forensics/detectors/dsc-for-001-promo-rolloff.ts', 'Easy', 'v1.0', 'Common. Phase 1 MVP.'),
  ...det('Orders & Billing', 'ORD-FOR-001 — Order Activated, No Billing Schedule', 'Active Order missing billing schedule', 'src/lib/forensics/detectors/ord-for-001-order-no-billing.ts', 'Easy', 'v1.0', 'High-$ + governance. Phase 1 MVP.'),
  ...det('Quote Lines', 'QL-FOR-001 — Bundle Required Option at $0', 'Required bundle option zero-priced', 'src/lib/forensics/detectors/ql-for-001-bundle-zero-price.ts', 'Easy', 'v1.0', 'Common easy-fix. Phase 1 MVP.'),
  ...det('Pipeline', 'REN-003 — Quote Expired, No Renewal Action', 'Quote past expiration with no renewal Opp', 'src/lib/forensics/detectors/ren-003-quote-expired-no-renewal.ts', 'Easy', 'v1.5', 'Direct Apex port.'),
  ...det('Pipeline', 'REN-004 — Renewal Quote Stuck in Draft', 'Renewal Quote past contract end, still in Draft', 'src/lib/forensics/detectors/ren-004-renewal-quote-stuck-draft.ts', 'Easy', 'v1.5', 'Direct Apex port.'),
  ...det('Discounts', 'DSC-FOR-002 — Stacked Discounts Beyond Cap', 'Effective discount > 50% approved cap', 'src/lib/forensics/detectors/dsc-for-002-stacked-discounts.ts', 'Easy', 'v1.5', 'Direct Apex port.'),
  ...det('Governance', 'QL-FOR-002 — Approval Skipped', 'Discount above threshold without Approval record', 'src/lib/forensics/detectors/ql-for-002-approval-skipped.ts', 'Easy', 'v1.5', 'Direct Apex port.'),
  ...det('Orders & Billing', 'ORD-FOR-002 — Q↔O Variance (New Business)', 'Order total ≠ Quote total on new-business', 'src/lib/forensics/detectors/ord-for-002-quote-order-variance.ts', 'Easy', 'v1.5', 'Direct Apex port.'),
  ...det('Orders & Billing', 'ORD-FOR-003 — Q↔O Variance (Amendment)', 'Order total ≠ Quote total on amendments', 'src/lib/forensics/detectors/ord-for-003-quote-order-variance-amendment.ts', 'Easy', 'v1.5', 'Direct Apex port.'),
  ...det('Subscriptions', 'SUB-FOR-001 — Active Sub, No Quote', 'Active subscription with no originating Quote', 'src/lib/forensics/detectors/sub-for-001-orphan-subscription.ts', 'Easy', 'v1.5', 'Direct Apex port.'),
  ...det('Subscriptions', 'PROV-FOR-001 — Renewed Without Provisioning', 'Renewed sub with no provisioning Asset', 'src/lib/forensics/detectors/prov-for-001-renewed-no-provisioning.ts', 'Easy', 'v1.5', 'Direct Apex port.'),
  ...det('Subscriptions', 'PROV-FOR-002 — Active Sub, No Asset', 'Active sub with no matching Asset', 'src/lib/forensics/detectors/prov-for-002-sub-no-asset.ts', 'Easy', 'v1.5', 'Direct Apex port.'),
  ...det('Governance', 'OPP-FOR-001 — Closed-Won, No Quote', 'Closed-Won Opportunity with no Quote', 'src/lib/forensics/detectors/opp-for-001-closedwon-no-quote.ts', 'Easy', 'v1.5', 'Direct Apex port.'),
  ...det('Governance', 'CON-FOR-001 — Contract Active, All Subs Expired', 'Active Contract whose subscriptions have all expired', 'src/lib/forensics/detectors/con-for-001-contract-stale.ts', 'Easy', 'v1.5', 'Direct Apex port.'),
  ...det('Governance', 'AMD-FOR-001 — Amendment, No Effective Date', 'Amendment Quote missing SBQQ__StartDate__c', 'src/lib/forensics/detectors/amd-for-001-amendment-no-effective-date.ts', 'Easy', 'v1.5', 'Direct Apex port.'),
  ...det('Subscriptions', 'AST-FOR-001 — Asset Terminated, No Credit Memo', 'Terminated Asset + active sub + no credit memo', 'src/lib/forensics/detectors/ast-for-001-terminated-no-credit.ts', 'Medium', 'v2.5', 'Crosses into Billing module; needs Billing module access in Apex.'),
  ...det('Pricing Locks', 'CT-FOR-001 — Contracted Price Expired', 'Expired SBQQ__ContractedPrice__c still applied', 'src/lib/forensics/detectors/ct-for-001-expired-contracted-price.ts', 'Easy', 'v1.5', 'Direct Apex port.'),
  ...det('Pricing Locks', 'MDQ-FOR-001 — MDQ Segment Pricing Inconsistency', 'MDQ multi-year flat pricing (no YoY uplift)', 'src/lib/forensics/detectors/mdq-for-001-segment-pricing.ts', 'Easy', 'v1.5', 'Direct Apex port.'),

  // ═════ ATTRIBUTION TRACERS (5 classes) ═════
  { category: 'Attribution', subcategory: 'Tracers', feature: 'Class A — Process & System Disconnect', description: 'Orders without billing schedules, Opportunities without Quotes', where: 'src/lib/forensics/tracers/class-a-system-disconnect.ts', apex: 'Easy', phase: 'v1.0', notes: 'Phase 1 MVP — covers the most impactful root cause.' },
  { category: 'Attribution', subcategory: 'Tracers', feature: 'Class B — Manual Override', description: 'Manual price overrides bypassing CPQ pricing', where: 'src/lib/forensics/tracers/class-b-manual-override.ts', apex: 'Easy', phase: 'v1.0', notes: 'Phase 1 MVP.' },
  { category: 'Attribution', subcategory: 'Tracers', feature: 'Class C — Conflicting Automation', description: 'Flows / Triggers / Price Rules with conflicting actions', where: 'src/lib/forensics/tracers/class-c-conflicting-automation.ts', apex: 'Medium', phase: 'v1.5', notes: 'Tooling API access from Apex needs ApexClass/Flow describe perms.' },
  { category: 'Attribution', subcategory: 'Tracers', feature: 'Class D — Missing Governance', description: 'Missing approval records, governance gaps', where: 'src/lib/forensics/tracers/class-d-missing-governance.ts', apex: 'Easy', phase: 'v1.5', notes: 'Direct Apex port.' },
  { category: 'Attribution', subcategory: 'Tracers', feature: 'Class E — Poor Data Quality', description: 'Stale, malformed, or incomplete records', where: 'src/lib/forensics/tracers/class-e-data-quality.ts', apex: 'Easy', phase: 'v1.5', notes: 'Direct Apex port.' },

  // ═════ RECOVERY WORKFLOW ═════
  { category: 'Recovery', subcategory: 'Stage', feature: 'Stage single finding', description: 'POST /api/forensic-findings/[id]/stage', where: 'src/app/api/forensic-findings/[id]/stage/route.ts', apex: 'Easy', phase: 'v1.0', notes: '@AuraEnabled Apex.' },
  { category: 'Recovery', subcategory: 'Stage', feature: 'Bulk stage findings', description: 'POST /api/forensic-findings/bulk-stage', where: 'src/app/api/forensic-findings/bulk-stage/route.ts', apex: 'Easy', phase: 'v1.5', notes: '@AuraEnabled Apex batch.' },
  { category: 'Recovery', subcategory: 'Approve', feature: 'Approve recovery action', description: 'pending → approved transition', where: 'src/app/api/recovery-actions/[id]/route.ts', apex: 'Easy', phase: 'v1.0', notes: 'Picklist update + audit trail.' },
  { category: 'Recovery', subcategory: 'Approve', feature: 'Reject recovery action', description: 'pending → rejected; sets reason', where: 'src/app/api/recovery-actions/[id]/route.ts', apex: 'Easy', phase: 'v1.0', notes: 'Picklist update.' },
  { category: 'Recovery', subcategory: 'Commit', feature: 'Mark committed (consultant attestation)', description: 'After CSV upload, mark as committed', where: 'recovery-actions API', apex: 'Easy', phase: 'v1.0', notes: 'In-package: replaced with direct "Apply Fix" button → DML.' },
  { category: 'Recovery', subcategory: 'Commit', feature: 'Commit verification (re-query SF)', description: 'Re-query SF record to confirm fix landed', where: 'src/lib/forensics/commit-verifier.ts', apex: 'Easy', phase: 'v1.0', notes: 'Direct Apex port.' },
  { category: 'Recovery', subcategory: 'Commit', feature: 'Re-verify endpoint', description: 'Retry verification on previously-failed commits', where: 'src/app/api/recovery-actions/[id]/re-verify/route.ts', apex: 'Easy', phase: 'v1.0', notes: 'Direct Apex port.' },
  { category: 'Recovery', subcategory: 'Commit', feature: 'Re-stage (committed → pending)', description: 'Un-commit a verified-but-broken recovery', where: 'stage API', apex: 'Easy', phase: 'v1.0', notes: 'Direct Apex port.' },
  { category: 'Recovery', subcategory: 'CSV', feature: 'Recovery CSV (per-finding)', description: 'Data-Loader-ready CSV for one finding', where: 'src/app/api/forensic-findings/[id]/recovery-csv/route.ts', apex: 'Medium', phase: 'v1.0', notes: 'In-package: replace with direct DML; CSV becomes optional escape hatch.' },
  { category: 'Recovery', subcategory: 'CSV', feature: 'Recovery CSV (bulk)', description: 'Consolidated CSV for many approved actions', where: 'src/app/api/recovery-actions/bulk-csv/route.ts', apex: 'Medium', phase: 'v1.5', notes: 'Same — replace with direct DML, keep CSV as fallback.' },
  { category: 'Recovery', subcategory: 'UI', feature: 'Recovery queue page', description: 'Pending / Approved / Committed / Rejected tabs', where: 'src/app/orgs/[orgId]/forensics/recovery/page.tsx', apex: 'Medium', phase: 'v1.0', notes: 'LWC tabset + lightning-datatable.' },
  { category: 'Recovery', subcategory: 'UI', feature: 'Failed-verify expandable detail UI', description: 'Show expected vs actual when verification fails', where: 'recovery page', apex: 'Easy', phase: 'v1.0', notes: 'LWC accordion.' },
  { category: 'Recovery', subcategory: 'UI', feature: '"Auto-resolved (duplicate)" labeling', description: 'Detect duplicate recovery requests and mark them', where: 'recovery-actions/bulk API', apex: 'Easy', phase: 'v1.5', notes: 'Apex dedupe check.' },

  // ═════ DASHBOARD CARDS ═════
  { category: 'Dashboard', subcategory: 'Headline', feature: 'Revenue Leakage card (verified + estimated)', description: 'Headline $ leakage with verified-from-findings + estimated-from-formulas split', where: 'src/components/scan/revenue-leakage-card.tsx', apex: 'Medium', phase: 'v1.0', notes: 'LWC. Aggregation in Apex.' },
  { category: 'Dashboard', subcategory: 'Headline', feature: 'Score band header', description: '71/100 + critical/warnings/best-practices counts', where: 'src/app/orgs/[orgId]/page.tsx', apex: 'Easy', phase: 'v1.0', notes: 'LWC.' },
  { category: 'Dashboard', subcategory: 'Cards', feature: 'Revenue Leakage themed sub-cards (3-up grid)', description: 'Renewals / Discounting / Orders & Billing / Subscriptions / Pricing Locks', where: 'src/components/scan/revenue-leakage-card.tsx', apex: 'Medium', phase: 'v2.0', notes: 'LWC grid.' },
  { category: 'Dashboard', subcategory: 'Cards', feature: 'Governance Risk card', description: 'Process/audit findings without $ claim', where: 'src/components/scan/category-risk-card.tsx', apex: 'Medium', phase: 'v1.5', notes: 'LWC.' },
  { category: 'Dashboard', subcategory: 'Cards', feature: 'Pipeline Risk card', description: 'Prospective revenue at risk', where: 'src/components/scan/category-risk-card.tsx', apex: 'Medium', phase: 'v1.5', notes: 'LWC.' },
  { category: 'Dashboard', subcategory: 'Cards', feature: 'Pricing Discipline card', description: 'Avg discount, % manual overrides, threshold compliance', where: 'src/components/scan/pricing-discipline-card.tsx', apex: 'Medium', phase: 'v2.0', notes: 'LWC + Apex aggregator.' },
  { category: 'Dashboard', subcategory: 'Cards', feature: 'CPQ Complexity card (factors + benchmark line)', description: 'Counts of products/bundles/etc. with industry benchmark line', where: 'src/components/scan/complexity-card.tsx', apex: 'Medium', phase: 'v2.0', notes: 'LWC chart.' },
  { category: 'Dashboard', subcategory: 'Cards', feature: 'AI-Powered Analysis card', description: 'AI summary of top categories + critical counts', where: 'src/app/orgs/[orgId]/page.tsx (inline)', apex: 'Hard', phase: 'v2.5', notes: 'AI callout from Apex. Pre-compute via batch job.' },
  { category: 'Dashboard', subcategory: 'Cards', feature: 'Since Last Scan diff card', description: '"What changed this week" deltas', where: 'src/components/scan/since-last-scan-card.tsx', apex: 'Medium', phase: 'v2.0', notes: 'LWC + Apex diff.' },
  { category: 'Dashboard', subcategory: 'Cards', feature: 'Score Trend chart', description: 'Historical line chart with delta vs starting scan', where: 'src/components/scan/score-trend.tsx', apex: 'Medium', phase: 'v2.0', notes: 'LWC chart-js or lightning-chartjs.' },

  // ═════ $-IMPACT × EFFORT MATRIX ═════
  { category: 'Matrix', subcategory: 'Grid', feature: '$-Impact × Effort 3×3 matrix card', description: 'The competitive wedge — findings by $ × effort', where: 'src/components/scan/impact-effort-matrix.tsx', apex: 'Medium', phase: 'v2.0', notes: 'LWC with custom cell grid.' },
  { category: 'Matrix', subcategory: 'Drill', feature: 'Click-to-drill modal per cell', description: 'Click cell → modal lists findings in that bucket', where: 'src/components/scan/impact-effort-matrix.tsx', apex: 'Medium', phase: 'v2.0', notes: 'LWC modal.' },
  { category: 'Matrix', subcategory: 'Hours', feature: 'Effort-hours per cell estimate', description: 'SOW-ready time estimate', where: 'src/components/scan/impact-effort-matrix.tsx', apex: 'Easy', phase: 'v2.0', notes: 'Compute in Apex from DETECTOR_EFFORT map.' },
  { category: 'Matrix', subcategory: 'Hours', feature: 'Quick Wins highlight + Sparkles', description: 'Top-left cell as the pitch slide', where: 'src/components/scan/impact-effort-matrix.tsx', apex: 'Easy', phase: 'v2.0', notes: 'LWC styling.' },

  // ═════ REPORTS & EXPORTS ═════
  { category: 'Reports', subcategory: 'PDF', feature: 'Executive PDF report (5-page deliverable)', description: 'Branded PDF: leakage summary, top contributors, methodology, recovery checklist', where: 'src/lib/report/pdf-generator.tsx', apex: 'Hard', phase: 'v2.5', notes: 'Visualforce PDF rendering (15MB cap, layout-limited). Or external callout to a PDF service.' },
  { category: 'Reports', subcategory: 'Excel', feature: 'Excel issue export', description: 'XLSX dump of all issues', where: 'src/app/api/issues/export/route.ts', apex: 'Hard', phase: 'v2.5', notes: 'No Apex XLSX library; use CSV instead.' },
  { category: 'Reports', subcategory: 'Docs', feature: 'Documentation export', description: 'Markdown/HTML doc of findings + remediation steps', where: 'src/app/api/orgs/[orgId]/documentation/route.ts', apex: 'Medium', phase: 'v2.0', notes: 'Apex string templating.' },

  // ═════ FILTER & SEARCH ═════
  { category: 'Filter', subcategory: 'Findings', feature: 'Findings filter bar (search + effort + severity + hidden)', description: 'Reusable filter UI with URL persistence', where: 'src/components/scan/findings-filter.tsx', apex: 'Medium', phase: 'v1.5', notes: 'LWC.' },
  { category: 'Filter', subcategory: 'Issues', feature: 'Issues filter bar (search + severity + status)', description: 'Same shape for issues domain', where: 'src/components/scan/issues-filter.tsx', apex: 'Medium', phase: 'v1.5', notes: 'LWC.' },
  { category: 'Filter', subcategory: 'Misc', feature: 'URL persistence per scope', description: 'Filter state survives refresh + shareable links', where: 'findings-filter + issues-filter', apex: 'Hard', phase: 'v2.0', notes: 'Lightning URL handling more restrictive; c__params via NavigationMixin.' },
  { category: 'Filter', subcategory: 'Misc', feature: 'Filter scope coexistence (3 bars on page)', description: 'Revenue Leakage + Gov + Pipeline filter independence', where: 'paramScope arg', apex: 'Medium', phase: 'v2.0', notes: 'LWC equivalent achievable.' },

  // ═════ BULK ACTIONS ═════
  { category: 'Bulk', subcategory: 'UI', feature: 'BulkActionBar (configurable)', description: 'Reusable bar with primary/secondary/destructive variants', where: 'src/components/scan/bulk-action-bar.tsx', apex: 'Easy', phase: 'v1.5', notes: 'LWC.' },
  { category: 'Bulk', subcategory: 'UI', feature: '"Select all visible" affordance', description: 'One-click select all filtered rows', where: 'BulkActionBar', apex: 'Easy', phase: 'v1.5', notes: 'Lightning datatable built-in.' },
  { category: 'Bulk', subcategory: 'Stage', feature: 'Bulk stage findings (Revenue Leakage)', description: 'Multi-select + bulk stage on theme cards', where: 'revenue-leakage-card', apex: 'Easy', phase: 'v1.5', notes: 'Lightning datatable row-select.' },
  { category: 'Bulk', subcategory: 'Stage', feature: 'Bulk stage findings (Gov/Pipeline)', description: 'Same pattern on category cards', where: 'category-risk-card', apex: 'Easy', phase: 'v1.5', notes: 'Lightning datatable row-select.' },
  { category: 'Bulk', subcategory: 'Hide', feature: 'POST /bulk-hide + DELETE for unhide', description: 'Atomic batch hide/restore', where: 'src/app/api/forensic-findings/bulk-hide/route.ts', apex: 'Easy', phase: 'v1.5', notes: '@AuraEnabled Apex.' },
  { category: 'Bulk', subcategory: 'Issues', feature: 'Bulk acknowledge/resolve issues', description: 'Issues tab BulkActionBar with status transitions', where: 'src/components/scan/issues-bulk-section.tsx', apex: 'Easy', phase: 'v1.5', notes: 'Lightning datatable.' },
  { category: 'Bulk', subcategory: 'Issues', feature: 'POST /api/issues/bulk-update', description: 'Atomic batch issue update + suppression upsert', where: 'src/app/api/issues/bulk-update/route.ts', apex: 'Easy', phase: 'v1.5', notes: '@AuraEnabled Apex.' },

  // ═════ HIDE / RESTORE ═════
  { category: 'Hide', subcategory: 'API', feature: 'Hide single finding (POST)', description: 'Toggles hidden_at timestamp', where: 'src/app/api/forensic-findings/[id]/hide/route.ts', apex: 'Easy', phase: 'v1.5', notes: 'Apex method.' },
  { category: 'Hide', subcategory: 'API', feature: 'Restore hidden finding (DELETE)', description: 'Clears hidden_at', where: 'src/app/api/forensic-findings/[id]/hide/route.ts', apex: 'Easy', phase: 'v1.5', notes: 'Apex method.' },
  { category: 'Hide', subcategory: 'UI', feature: 'Show-hidden toggle in filter bar', description: 'Filter affordance to view dismissed findings', where: 'findings-filter', apex: 'Easy', phase: 'v1.5', notes: 'LWC.' },
  { category: 'Hide', subcategory: 'UI', feature: 'Optimistic locally-hidden update', description: 'Rows drop immediately, server roundtrip in background', where: 'revenue-leakage-card + category-risk-card', apex: 'Medium', phase: 'v1.5', notes: 'LWC reactivity via @track.' },

  // ═════ NOTES ═════
  { category: 'Notes', subcategory: 'DB', feature: 'consultant_note + updated_at columns', description: 'Free-text private note per finding', where: 'DB migration', apex: 'Easy', phase: 'v1.5', notes: 'Long Text Area on ForensicFinding__c.' },
  { category: 'Notes', subcategory: 'API', feature: 'PATCH /[id]/note endpoint', description: 'Save/clear note with whitespace coalescing', where: 'src/app/api/forensic-findings/[id]/note/route.ts', apex: 'Easy', phase: 'v1.5', notes: '@AuraEnabled Apex.' },
  { category: 'Notes', subcategory: 'UI', feature: 'Note editor on detail page', description: 'Collapsed when empty; explicit save', where: 'src/app/orgs/[orgId]/forensics/[findingId]/page.tsx', apex: 'Easy', phase: 'v1.5', notes: 'LWC textarea.' },
  { category: 'Notes', subcategory: 'UI', feature: 'Note popover (inline edit from row)', description: '360px floating panel anchored to row icon', where: 'src/components/scan/note-popover.tsx', apex: 'Medium', phase: 'v2.0', notes: 'LWC lightning-popup.' },
  { category: 'Notes', subcategory: 'UI', feature: 'Note indicator icon + tooltip preview', description: 'Amber 📝 on rows with notes; first 200 chars on hover', where: 'revenue-leakage-card + category-risk-card', apex: 'Easy', phase: 'v1.5', notes: 'LWC slds-icon + lightning-helptext.' },
  { category: 'Notes', subcategory: 'UI', feature: '"Add note" hover affordance', description: 'Empty-note rows get hover button to add', where: 'revenue-leakage-card', apex: 'Easy', phase: 'v2.0', notes: 'LWC.' },

  // ═════ ATTRIBUTION MAP ═════
  { category: 'Attribution Map', subcategory: 'Page', feature: 'Attribution Map page', description: 'Root config objects ranked by $ at risk', where: 'src/app/orgs/[orgId]/forensics/attribution-map/page.tsx', apex: 'Medium', phase: 'v2.0', notes: 'LWC datatable.' },
  { category: 'Attribution Map', subcategory: 'Page', feature: 'Class filter pills (A/B/C/D/E)', description: 'Filter the map by attribution class', where: 'attribution-map page', apex: 'Easy', phase: 'v2.0', notes: 'LWC.' },
  { category: 'Attribution Map', subcategory: 'Page', feature: 'Stage all from attribution map', description: 'One-click stage every finding under a root config', where: 'attribution-map page', apex: 'Easy', phase: 'v2.0', notes: 'Calls bulk-stage Apex.' },
  { category: 'Attribution Map', subcategory: 'Page', feature: 'Root config Setup deep-link', description: 'Each row deep-links to Salesforce Setup', where: 'attribution-map page', apex: 'Easy', phase: 'v1.5', notes: 'NavigationMixin native in Lightning.' },

  // ═════ TAB NAVIGATION ═════
  { category: 'Tabs', subcategory: 'Nav', feature: '6-tab horizontal nav', description: 'Summary / Revenue Leakage / Governance & Pipeline / Pricing Discipline / Issues / Plan', where: 'src/components/ui/dashboard-tabs.tsx', apex: 'Easy', phase: 'v2.0', notes: 'lightning-tabset native.' },
  { category: 'Tabs', subcategory: 'Nav', feature: 'Draggable tab reordering', description: 'dnd-kit drag-to-reorder', where: 'dashboard-tabs', apex: 'Hard', phase: 'v3.0+', notes: 'lightning-tabset doesn\'t support reorder. Custom LWC + drag lib needed.' },
  { category: 'Tabs', subcategory: 'Nav', feature: 'Tab order persistence (localStorage)', description: 'User\'s order survives across orgs', where: 'dashboard-tabs', apex: 'Medium', phase: 'v3.0+', notes: 'User Custom Setting.' },
  { category: 'Tabs', subcategory: 'Nav', feature: 'URL deep-link via ?tab=', description: 'Shareable links to a specific tab', where: 'dashboard-tabs', apex: 'Medium', phase: 'v2.0', notes: 'NavigationMixin generateUrl().' },

  // ═════ ISSUES TAB SURFACES ═════
  { category: 'Issues', subcategory: 'List', feature: 'Top Issues curated list (top 5)', description: 'Sorted by severity + impact, grouped to fold siblings', where: 'src/app/orgs/[orgId]/page.tsx (inline)', apex: 'Medium', phase: 'v1.5', notes: 'LWC + Apex aggregator.' },
  { category: 'Issues', subcategory: 'List', feature: 'CategoryBreakdown grid tiles', description: '5-col grid of categorized issue counts; click → modal', where: 'src/components/scan/category-breakdown.tsx', apex: 'Medium', phase: 'v2.0', notes: 'LWC tiles. Drag-to-reorder needs custom impl.' },
  { category: 'Issues', subcategory: 'Modal', feature: 'CategoryIssuesModal', description: 'Click tile → modal listing all issues in that category', where: 'inline', apex: 'Easy', phase: 'v1.5', notes: 'LWC modal.' },
  { category: 'Issues', subcategory: 'Modal', feature: 'IssueDetailModal', description: 'Click issue → modal with description + fix actions', where: 'src/components/issues/issue-detail-modal.tsx', apex: 'Easy', phase: 'v1.0', notes: 'LWC.' },
  { category: 'Issues', subcategory: 'Bulk', feature: 'Issues bulk section (flat list + checkboxes)', description: 'Below Top Issues — bulk-action surface', where: 'src/components/scan/issues-bulk-section.tsx', apex: 'Easy', phase: 'v1.5', notes: 'Lightning datatable.' },
  { category: 'Issues', subcategory: 'Suppress', feature: 'check_suppressions (false-positive memory)', description: 'Future scans skip the check for that org', where: 'DB + bulk-update side-effect', apex: 'Easy', phase: 'v1.5', notes: 'CheckSuppression__c.' },

  // ═════ FINDING DETAIL PAGE ═════
  { category: 'Finding Detail', subcategory: 'Page', feature: 'Finding detail page (full hero)', description: 'Gap headline + Affected Record + Attribution + Recovery', where: 'src/app/orgs/[orgId]/forensics/[findingId]/page.tsx', apex: 'Medium', phase: 'v1.0', notes: 'LWC full-page component.' },
  { category: 'Finding Detail', subcategory: 'Page', feature: 'Affected record deep-link', description: 'Button to navigate to the record in Lightning', where: 'finding detail page', apex: 'Easy', phase: 'v1.0', notes: 'NavigationMixin native.' },
  { category: 'Finding Detail', subcategory: 'Page', feature: 'Attribution trace panel', description: 'Class + Config + Reason + AI explanation + Suggested fix', where: 'finding detail page', apex: 'Medium', phase: 'v1.0', notes: 'LWC. AI fields populated by batch.' },
  { category: 'Finding Detail', subcategory: 'Page', feature: 'Evidence panel (collapsible JSON)', description: 'Deterministic facts the rules engine used', where: 'finding detail page', apex: 'Medium', phase: 'v1.5', notes: 'LWC code-block. Evidence stored as Long Text Area JSON.' },
  { category: 'Finding Detail', subcategory: 'Page', feature: 'Stage → Approve → Commit workflow buttons', description: 'State-aware buttons progressing the finding', where: 'finding detail page', apex: 'Medium', phase: 'v1.0', notes: 'LWC + Apex calls per transition.' },

  // ═════ UI / UX POLISH ═════
  { category: 'UX', subcategory: 'Type', feature: 'Plain-English label sweep', description: 'Delta → Change, Baseline → Starting scan, etc.', where: 'multiple files', apex: 'Easy', phase: 'v2.0', notes: 'Apply same vocab to LWC.' },
  { category: 'UX', subcategory: 'Type', feature: 'Typography hierarchy (bold card titles)', description: 'h2/h3 bumped to font-bold + larger sizes', where: 'multiple files', apex: 'Easy', phase: 'v2.0', notes: 'SLDS slds-text-heading_*.' },
  { category: 'UX', subcategory: 'Layout', feature: 'Wider org layout (1280 → 1536px)', description: 'max-w-screen-2xl', where: 'src/app/orgs/[orgId]/layout.tsx', apex: 'Easy', phase: 'v2.0', notes: 'SLDS slds-container_x-large.' },
  { category: 'UX', subcategory: 'Layout', feature: 'Boxed number badges (Gov/Pipeline)', description: 'Finding count + $ in styled badge box', where: 'category-risk-card', apex: 'Easy', phase: 'v2.0', notes: 'LWC styling.' },
  { category: 'UX', subcategory: 'Layout', feature: 'Industry benchmark line on Complexity factors', description: 'Small grey tick on each bar', where: 'complexity-card', apex: 'Easy', phase: 'v2.0', notes: 'LWC chart overlay.' },
  { category: 'UX', subcategory: 'Layout', feature: 'CPQ Complexity + AI Analysis side-by-side', description: '2-col layout pairing metric + narrative', where: 'org page', apex: 'Easy', phase: 'v2.0', notes: 'LWC grid.' },
  { category: 'UX', subcategory: 'Badges', feature: 'Effort badge per finding (Low/Med/High)', description: 'Color-coded chip on every row', where: 'multiple', apex: 'Easy', phase: 'v1.5', notes: 'LWC.' },
  { category: 'UX', subcategory: 'Errors', feature: 'Card error UI + actionable copy', description: 'Card-load failures show headline + reconnect hint', where: 'multiple scan components', apex: 'Easy', phase: 'v1.5', notes: 'LWC error templates.' },
  { category: 'UX', subcategory: 'Theme', feature: 'Dark mode support', description: 'Dark variants on every surface (Tailwind dark:)', where: 'multiple', apex: 'Medium', phase: 'v2.5', notes: 'Salesforce dark mode in Winter \'24+. SLDS supports.' },
  { category: 'UX', subcategory: 'Theme', feature: 'Mobile-responsive layouts', description: 'sm:/md:/lg: breakpoints on grids + nav', where: 'multiple', apex: 'Easy', phase: 'v2.0', notes: 'SLDS responsive utilities.' },
  { category: 'UX', subcategory: 'Layout', feature: 'Header width matched to content', description: 'AppHeader extends to max-w-screen-2xl', where: 'app-header', apex: 'Skip', phase: 'Skip', notes: 'N/A in-package.' },

  // ═════ FORENSIC DIFF / TIMELINE ═════
  { category: 'Forensic Diff', subcategory: 'API', feature: 'Forensic diff API', description: 'Compare two scans → added / resolved / worsened / improved', where: 'src/app/api/orgs/[orgId]/forensic-diff/route.ts', apex: 'Medium', phase: 'v2.0', notes: 'Apex aggregator.' },
  { category: 'Forensic Diff', subcategory: 'Page', feature: 'Forensic Diff full page', description: 'Detailed page showing every added/resolved/worsened finding', where: 'src/app/orgs/[orgId]/forensics/diff/page.tsx', apex: 'Medium', phase: 'v2.0', notes: 'LWC page.' },

  // ═════ AUTH / ONBOARDING / SETTINGS ═════
  { category: 'Auth / Onboarding', subcategory: 'Auth', feature: 'Salesforce OAuth + Connected App', description: 'Login with SF, refresh tokens, multi-org connection', where: 'src/app/api/salesforce/callback/route.ts', apex: 'Skip', phase: 'Skip', notes: 'N/A — managed package runs IN the user\'s org.' },
  { category: 'Auth / Onboarding', subcategory: 'Auth', feature: 'Email/password sign-up + login', description: 'Standard email auth via Supabase', where: 'src/app/auth/', apex: 'Skip', phase: 'Skip', notes: 'N/A — Salesforce handles identity in-package.' },
  { category: 'Auth / Onboarding', subcategory: 'Onboarding', feature: 'Onboarding wizard', description: 'New user role/company/product fit collection', where: 'src/app/onboarding/page.tsx', apex: 'Medium', phase: 'v2.5', notes: 'LWC wizard.' },
  { category: 'Auth / Onboarding', subcategory: 'Onboarding', feature: 'Onboarding checklist (dismissible)', description: 'In-app guide for first-time users', where: 'dashboard', apex: 'Medium', phase: 'v2.5', notes: 'LWC + persisted state.' },
  { category: 'Auth / Onboarding', subcategory: 'Settings', feature: 'Profile + avatar upload', description: 'Name, photo, job title, location, phone', where: 'src/app/settings/page.tsx', apex: 'Easy', phase: 'v2.0', notes: 'Salesforce User record + ContentVersion.' },
  { category: 'Auth / Onboarding', subcategory: 'Settings', feature: 'Notification settings', description: 'Email + in-app event preferences', where: 'settings page', apex: 'Easy', phase: 'v2.5', notes: 'Custom Setting per user.' },
  { category: 'Auth / Onboarding', subcategory: 'Settings', feature: 'Revenue assumptions (per user)', description: 'Annual revenue, currency, LTV multiplier inputs', where: 'settings page', apex: 'Easy', phase: 'v2.0', notes: 'Custom Setting.' },
  { category: 'Auth / Onboarding', subcategory: 'Settings', feature: 'Company branding (logo, color)', description: 'Used on PDF reports + dashboard chrome', where: 'settings page', apex: 'Easy', phase: 'v2.5', notes: 'Custom Setting + ContentVersion logo.' },
  { category: 'Auth / Onboarding', subcategory: 'Settings', feature: 'Dark mode toggle (persisted)', description: 'localStorage persisted theme', where: 'src/components/theme-provider.tsx', apex: 'Medium', phase: 'v2.5', notes: 'Salesforce dark mode is org-wide; user-level via SLDS theme.' },
  { category: 'Auth / Onboarding', subcategory: 'Org Mgmt', feature: 'Connect org (OAuth)', description: 'Link a Salesforce org to your account', where: 'org connection flow', apex: 'Skip', phase: 'Skip', notes: 'N/A in-package.' },
  { category: 'Auth / Onboarding', subcategory: 'Org Mgmt', feature: 'Org disconnect & reconnect', description: 'Soft-delete an org, reconnect with BYO ECA', where: 'org-card', apex: 'Skip', phase: 'Skip', notes: 'N/A in-package.' },
  { category: 'Auth / Onboarding', subcategory: 'Org Mgmt', feature: 'Force product type selector', description: 'Override auto-detect (CPQ / CPQ+Billing / ARM)', where: 'org page', apex: 'Easy', phase: 'v1.5', notes: 'LWC picklist.' },

  // ═════ TEAM / PORTFOLIO ═════
  { category: 'Team & Portfolio', subcategory: 'Team', feature: 'Multi-user workspaces', description: 'Owner/Admin/Viewer roles, per-member management', where: 'src/components/team/member-list.tsx', apex: 'Skip', phase: 'Skip', notes: 'Salesforce has its own user/role/permission model.' },
  { category: 'Team & Portfolio', subcategory: 'Team', feature: 'Team activity feed', description: 'Audit log of joins/scans/role changes', where: 'src/components/team/activity-feed.tsx', apex: 'Medium', phase: 'v2.5', notes: 'AuditTrail__c or use FieldHistory.' },
  { category: 'Team & Portfolio', subcategory: 'Team', feature: 'Team invitations (email + token)', description: 'Invite teammate via email with token acceptance', where: 'src/app/invite/[token]/page.tsx', apex: 'Skip', phase: 'Skip', notes: 'Salesforce user provisioning is separate.' },
  { category: 'Team & Portfolio', subcategory: 'Portfolio', feature: 'Multi-org dashboard (consultant portfolio)', description: 'See ALL connected orgs in one place — the consultant workflow', where: 'src/app/dashboard/page.tsx', apex: 'Skip', phase: 'Skip', notes: 'THE thing you lose with managed package. Managed package = single org per install.' },
  { category: 'Team & Portfolio', subcategory: 'Portfolio', feature: 'Portfolio runs (async multi-org scan)', description: 'Kick off N scans across orgs at once with progress polling', where: 'src/app/portfolio/runs/[id]/page.tsx', apex: 'Skip', phase: 'Skip', notes: 'N/A — single-org install model.' },
  { category: 'Team & Portfolio', subcategory: 'Portfolio', feature: 'Compare two orgs', description: 'Side-by-side comparison view', where: 'src/app/compare/page.tsx', apex: 'Skip', phase: 'Skip', notes: 'N/A in-package.' },
  { category: 'Team & Portfolio', subcategory: 'History', feature: 'Scan history page', description: 'Per-org timeline with sorting, score trends, compare-scans', where: 'src/app/orgs/[orgId]/history/page.tsx', apex: 'Medium', phase: 'v2.0', notes: 'LWC datatable.' },

  // ═════ ADMIN & OPS ═════
  { category: 'Admin & Ops', subcategory: 'Internal', feature: 'Admin dashboard', description: 'System-wide stats, user counts, recent activity', where: 'src/app/admin/page.tsx', apex: 'Skip', phase: 'Skip', notes: 'Internal SaaS admin — N/A.' },
  { category: 'Admin & Ops', subcategory: 'Internal', feature: 'Public status page', description: 'Health check dashboard, uptime', where: 'src/app/status/page.tsx', apex: 'Skip', phase: 'Skip', notes: 'N/A in-package.' },
  { category: 'Admin & Ops', subcategory: 'Internal', feature: 'Plan quotas (Free/Pro/Enterprise)', description: 'Scan / AI / PDF / org limits per plan', where: 'src/lib/quota.ts', apex: 'Skip', phase: 'Skip', notes: 'AppExchange license enforcement is different model.' },
  { category: 'Admin & Ops', subcategory: 'Internal', feature: 'Check trust scores', description: 'Per-check "% of users found helpful" aggregation', where: 'src/app/api/checks/trust-scores/route.ts', apex: 'Skip', phase: 'Skip', notes: 'Cross-org telemetry — N/A.' },
  { category: 'Admin & Ops', subcategory: 'Internal', feature: 'Weekly feedback digest cron', description: 'Admin email summarizing suppressed checks across platform', where: 'src/app/api/cron/feedback-digest/route.ts', apex: 'Skip', phase: 'Skip', notes: 'Cross-org telemetry — N/A.' },
  { category: 'Admin & Ops', subcategory: 'Public', feature: 'Changelog page', description: 'Public release notes', where: 'src/app/changelog/page.tsx', apex: 'Skip', phase: 'Skip', notes: 'AppExchange listing release notes is the equivalent.' },
  { category: 'Admin & Ops', subcategory: 'Public', feature: 'Industry benchmarks (dormant)', description: 'Percentile lookup infrastructure for revenue leakage comparisons', where: 'src/lib/analysis/benchmarks.ts', apex: 'Hard', phase: 'v3.0+', notes: 'Needs cross-org dataset — hard in single-org install.' },

  // ═════ INFRASTRUCTURE ═════
  { category: 'Infra', subcategory: 'Hosting', feature: 'Vercel Hobby tier deployment', description: 'Next.js hosting, 60s function limit', where: 'vercel.json', apex: 'Skip', phase: 'Skip', notes: 'N/A in-package.' },
  { category: 'Infra', subcategory: 'DB', feature: 'Supabase Postgres', description: 'Multi-tenant rows-per-user DB', where: 'src/lib/db/migrations/', apex: 'Skip', phase: 'Skip', notes: 'Replaced by Salesforce Custom Objects.' },
  { category: 'Infra', subcategory: 'Email', feature: 'Resend transactional email', description: 'Email service for scan-complete notifications', where: 'src/lib/email/resend.ts', apex: 'Medium', phase: 'v2.5', notes: 'Replace with Apex SingleEmailMessage. 5000/day limit.' },
  { category: 'Infra', subcategory: 'Email', feature: 'Scan-complete email notification', description: '"Your scan is done" auto-email', where: 'run-scan-in-background.ts', apex: 'Easy', phase: 'v2.5', notes: 'Apex SingleEmailMessage in scan handler.' },
  { category: 'Infra', subcategory: 'Email', feature: 'Scan schedule + cron runner', description: 'Recurring auto-scans', where: 'src/lib/scans/scheduled-scans.ts', apex: 'Easy', phase: 'v2.5', notes: 'Scheduled Apex native.' },
  { category: 'Infra', subcategory: 'Email', feature: 'Schedule modal + list UI', description: 'Configure recurring scan cadence', where: 'src/components/schedule/', apex: 'Medium', phase: 'v2.5', notes: 'LWC + Apex scheduler.' },
  { category: 'Infra', subcategory: 'Tests', feature: '1399 unit tests passing', description: 'Vitest suite — detectors, tracers, renderers, state machines, APIs', where: 'src/__tests__/', apex: 'Hard', phase: 'v1.0', notes: 'Apex tests need rewrite. ~50-100 Apex test classes for ≥75% coverage required by AppExchange security review.' },
  { category: 'Infra', subcategory: 'Diag', feature: 'Detector verification report script', description: 'Audits all 20 detectors against CPQ Ks demo data', where: 'scripts/verify-all-detectors.ts', apex: 'Skip', phase: 'Skip', notes: 'Dev tool — N/A in-package.' },
];

// ───────────────────────────────────────────────────────────────
// Build the workbook
// ───────────────────────────────────────────────────────────────
async function build() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'OrgPrism';
  wb.created = new Date('2026-06-02');

  buildFeaturesSheet(wb);
  buildSummarySheet(wb);
  buildReleasePlanSheet(wb);
  buildMigrationSheet(wb);

  // Write to a sibling path first so we don't fail if the user has the
  // primary file open in Excel. We then try to swap-in; if the primary
  // is locked, the v2 sits next to it for manual save-over.
  const primary = path.join('docs', 'OrgPrism-Feature-Inventory.xlsx');
  const fallback = path.join('docs', 'OrgPrism-Feature-Inventory-v2.xlsx');
  let out;
  try {
    await wb.xlsx.writeFile(primary);
    out = primary;
  } catch (e) {
    if ((e.code || '').includes('EBUSY')) {
      await wb.xlsx.writeFile(fallback);
      out = fallback;
      console.warn('Primary file locked (open in Excel?). Wrote to v2 path.');
    } else {
      throw e;
    }
  }
  console.log(`Wrote ${out}`);
  console.log(`  ${features.length} features across ${new Set(features.map((f) => f.category)).size} categories, ${new Set(features.map((f) => f.phase)).size} phases`);
}

// PHASE color map — used in both Features and Release Plan sheets.
const phaseColors = {
  'v1.0': 'FFDBEAFE',  // light blue — MVP
  'v1.5': 'FFD1FAE5',  // light green — Coverage
  'v2.0': 'FFFEF3C7',  // light amber — Polish
  'v2.5': 'FFFEE2E2',  // light red — Hard
  'v3.0+': 'FFF3E8FF', // light purple — Future
  'Skip': 'FFE5E7EB',  // light grey — Won't migrate
};
const apexColors = {
  Easy: 'FFD1FAE5',
  Medium: 'FFFEF3C7',
  Hard: 'FFFEE2E2',
  Skip: 'FFE5E7EB',
};

function buildFeaturesSheet(wb) {
  const ws = wb.addWorksheet('Features', {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }],
  });

  ws.columns = [
    { header: '#', key: 'id', width: 5 },
    { header: 'Category', key: 'category', width: 20 },
    { header: 'Sub', key: 'subcategory', width: 14 },
    { header: 'Feature', key: 'feature', width: 48 },
    { header: 'Description', key: 'description', width: 60 },
    { header: 'Where', key: 'where', width: 38 },
    { header: 'Shipped (SaaS)', key: 'shipped', width: 14 },
    { header: 'Phase', key: 'phase', width: 9 },
    { header: 'Apex Effort', key: 'apex', width: 12 },
    { header: 'Deployed (Package)', key: 'deployed', width: 18 },
    { header: 'Migration Notes', key: 'notes', width: 60 },
  ];

  const hdr = ws.getRow(1);
  hdr.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
  hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
  hdr.alignment = { vertical: 'middle', horizontal: 'left' };
  hdr.height = 22;

  features.forEach((f, i) => {
    const r = ws.addRow({
      id: i + 1,
      category: f.category,
      subcategory: f.subcategory,
      feature: f.feature,
      description: f.description,
      where: f.where,
      shipped: 'Yes',
      phase: f.phase,
      apex: f.apex,
      deployed: 'No',
      notes: f.notes,
    });

    r.alignment = { vertical: 'top', wrapText: true };

    // Phase column color
    const phaseCell = r.getCell('phase');
    if (phaseColors[f.phase]) {
      phaseCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: phaseColors[f.phase] } };
      phaseCell.font = { bold: true, name: 'Calibri' };
      phaseCell.alignment = { horizontal: 'center', vertical: 'middle' };
    }

    // Apex column color
    const apexCell = r.getCell('apex');
    if (apexColors[f.apex]) {
      apexCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: apexColors[f.apex] } };
      apexCell.font = { bold: true, name: 'Calibri' };
      apexCell.alignment = { horizontal: 'center', vertical: 'middle' };
    }

    // Shipped — always green
    const shipCell = r.getCell('shipped');
    shipCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
    shipCell.font = { bold: true, color: { argb: 'FF065F46' }, name: 'Calibri' };
    shipCell.alignment = { horizontal: 'center', vertical: 'middle' };

    // Deployed — dropdown
    const depCell = r.getCell('deployed');
    depCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
    depCell.font = { bold: true, color: { argb: 'FF991B1B' }, name: 'Calibri' };
    depCell.alignment = { horizontal: 'center', vertical: 'middle' };
    depCell.dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: ['"Yes,No,Partial"'],
      showErrorMessage: true,
      errorTitle: 'Invalid',
      error: 'Pick Yes / No / Partial',
    };
  });

  // Conditional formatting on Deployed column (column J).
  ws.addConditionalFormatting({
    ref: `J2:J${features.length + 1}`,
    rules: [
      {
        type: 'expression',
        formulae: ['$J2="Yes"'],
        priority: 1,
        style: {
          fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFD1FAE5' } },
          font: { bold: true, color: { argb: 'FF065F46' } },
        },
      },
      {
        type: 'expression',
        formulae: ['$J2="Partial"'],
        priority: 2,
        style: {
          fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFEF3C7' } },
          font: { bold: true, color: { argb: 'FF92400E' } },
        },
      },
    ],
  });

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: features.length + 1, column: 11 } };
}

function buildSummarySheet(wb) {
  const ws = wb.addWorksheet('Summary');
  ws.columns = [
    { header: 'Category', key: 'category', width: 24 },
    { header: 'Features', key: 'total', width: 11 },
    { header: 'Deployed', key: 'deployed', width: 12 },
    { header: '% Deployed', key: 'pct', width: 13 },
    { header: 'v1.0', key: 'v10', width: 8 },
    { header: 'v1.5', key: 'v15', width: 8 },
    { header: 'v2.0', key: 'v20', width: 8 },
    { header: 'v2.5', key: 'v25', width: 8 },
    { header: 'v3.0+', key: 'v30', width: 9 },
    { header: 'Skip', key: 'skip', width: 8 },
  ];

  const hdr = ws.getRow(1);
  hdr.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
  hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
  hdr.alignment = { vertical: 'middle' };
  hdr.height = 22;

  const categories = Array.from(new Set(features.map((f) => f.category)));
  categories.forEach((cat, i) => {
    const rowNum = i + 2;
    const row = ws.addRow({
      category: cat,
      total: { formula: `COUNTIF(Features!B:B,"${cat}")` },
      deployed: { formula: `COUNTIFS(Features!B:B,"${cat}",Features!J:J,"Yes")` },
      pct: { formula: `IFERROR(C${rowNum}/B${rowNum},0)` },
      v10: { formula: `COUNTIFS(Features!B:B,"${cat}",Features!H:H,"v1.0")` },
      v15: { formula: `COUNTIFS(Features!B:B,"${cat}",Features!H:H,"v1.5")` },
      v20: { formula: `COUNTIFS(Features!B:B,"${cat}",Features!H:H,"v2.0")` },
      v25: { formula: `COUNTIFS(Features!B:B,"${cat}",Features!H:H,"v2.5")` },
      v30: { formula: `COUNTIFS(Features!B:B,"${cat}",Features!H:H,"v3.0+")` },
      skip: { formula: `COUNTIFS(Features!B:B,"${cat}",Features!H:H,"Skip")` },
    });
    row.getCell('pct').numFmt = '0.0%';
    row.alignment = { vertical: 'middle' };
  });

  // Totals row
  const totalRow = ws.addRow({
    category: 'TOTAL',
    total: { formula: `SUM(B2:B${categories.length + 1})` },
    deployed: { formula: `SUM(C2:C${categories.length + 1})` },
    pct: { formula: `IFERROR(C${categories.length + 2}/B${categories.length + 2},0)` },
    v10: { formula: `SUM(E2:E${categories.length + 1})` },
    v15: { formula: `SUM(F2:F${categories.length + 1})` },
    v20: { formula: `SUM(G2:G${categories.length + 1})` },
    v25: { formula: `SUM(H2:H${categories.length + 1})` },
    v30: { formula: `SUM(I2:I${categories.length + 1})` },
    skip: { formula: `SUM(J2:J${categories.length + 1})` },
  });
  totalRow.font = { bold: true, name: 'Calibri' };
  totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
  totalRow.getCell('pct').numFmt = '0.0%';
}

function buildReleasePlanSheet(wb) {
  const ws = wb.addWorksheet('Release Plan');
  ws.columns = [
    { header: 'Release', key: 'release', width: 12 },
    { header: 'Name', key: 'name', width: 24 },
    { header: 'Approx Effort', key: 'effort', width: 14 },
    { header: 'What ships', key: 'ships', width: 80 },
    { header: 'What CUSTOMER gets', key: 'customer', width: 70 },
    { header: 'Critical to ship?', key: 'critical', width: 16 },
  ];

  const hdr = ws.getRow(1);
  hdr.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Calibri', size: 11 };
  hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
  hdr.alignment = { vertical: 'middle' };
  hdr.height = 22;

  const releases = [
    {
      release: 'v1.0',
      name: 'MVP',
      effort: '~6 weeks',
      ships: '5 custom objects (ForensicScan / ForensicFinding / AttributionTrace / RecoveryAction / CheckSuppression) • 5 highest-$ detectors (REN-001, REN-002, DSC-FOR-001, ORD-FOR-001, QL-FOR-001) • Class A + B attribution • Finding detail page • Stage → Approve → Mark Committed workflow • Commit verification • Score band header • Revenue Leakage card (basic) • Recovery queue • 1399 unit tests rewritten as Apex',
      customer: 'Click "Run Scan" inside Salesforce. See total leakage in $. Drill into top findings. Approve fixes. Apply them via in-org button (no Data Loader detour needed). Verify the fix landed.',
      critical: 'MUST SHIP',
    },
    {
      release: 'v1.5',
      name: 'Coverage',
      effort: '~4 weeks',
      ships: 'Remaining 15 detectors • Class C, D, E tracers • Filter bar (search + effort + severity + hidden) • Hide / restore • Bulk select + bulk-stage + bulk-hide • Notes (DB + editor + indicator) • Issues bulk acknowledge/resolve • check_suppressions • Top Issues curated list • Effort badge per row • Card error UI',
      customer: 'Full detector coverage. Power-user workflow: search, filter, multi-select, bulk approve. Notes per finding for engagement context. Mark known false-positives so future scans skip them.',
      critical: 'STRONGLY RECOMMEND',
    },
    {
      release: 'v2.0',
      name: 'Polish',
      effort: '~4 weeks',
      ships: '$-Impact × Effort matrix card • Click-to-drill modal • 6-tab navigation • URL deep-links • Theme card grouping • Pricing Discipline + CPQ Complexity cards • Score Trend + Since Last Scan diff • Attribution Map page • Note popover (inline edit) • Scan history page • Plain-English label sweep • Typography hierarchy • Mobile responsive',
      customer: 'Sales-ready dashboard. "What to fix first" matrix becomes the pitch slide. Org history trend visible. Consultant can demo full audit-to-recovery on a screenshare.',
      critical: 'RECOMMENDED',
    },
    {
      release: 'v2.5',
      name: 'Hard Stuff',
      effort: '~6 weeks',
      ships: 'AI explanations (batch via Apex callout to Gemini) • Executive PDF report (Visualforce) • Email notifications (Apex SingleEmail) • Scheduled scans (Scheduled Apex) • Onboarding wizard • Profile + revenue assumptions • Dark mode (SLDS) • AST-FOR-001 + Asset/Billing detector • Team activity audit trail',
      customer: 'Production-grade. AI explains what every finding means. Scans run on a schedule. PDF report for the client meeting. Customer onboarding becomes hands-off.',
      critical: 'NICE TO HAVE',
    },
    {
      release: 'v3.0+',
      name: 'Future',
      effort: 'TBD',
      ships: 'Draggable tab reorder • Industry benchmarks (cross-org dataset) • Whatever doesn\'t fit above',
      customer: 'Polish + delight features.',
      critical: 'OPTIONAL',
    },
    {
      release: 'Skip',
      name: 'Won\'t Migrate',
      effort: 'N/A',
      ships: 'Multi-org portfolio dashboard • Compare-two-orgs view • Team invitations + workspaces • Admin dashboard • Public status page • Plan quotas (Free/Pro/Enterprise) • Trust scores + feedback digest • OAuth + Connected App • Vercel hosting • Supabase DB • Email/password auth • Header width tuning • Empty-error guards',
      customer: 'These are SaaS-only or cross-org features. The managed-package install model is single-org-per-install — these don\'t translate.',
      critical: 'DO NOT MIGRATE',
    },
  ];

  releases.forEach((r) => {
    const row = ws.addRow(r);
    row.alignment = { wrapText: true, vertical: 'top' };
    row.height = 180;

    // Color the release cell by phase
    const releaseCell = row.getCell('release');
    if (phaseColors[r.release]) {
      releaseCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: phaseColors[r.release] } };
    }
    releaseCell.font = { bold: true, size: 13, name: 'Calibri' };
    releaseCell.alignment = { horizontal: 'center', vertical: 'middle' };

    row.getCell('name').font = { bold: true, name: 'Calibri', size: 11 };
    row.getCell('effort').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    row.getCell('effort').font = { bold: true, name: 'Calibri' };

    // Color the critical cell
    const critCell = row.getCell('critical');
    const critColors = {
      'MUST SHIP': 'FFFEE2E2',
      'STRONGLY RECOMMEND': 'FFFEF3C7',
      'RECOMMENDED': 'FFD1FAE5',
      'NICE TO HAVE': 'FFDBEAFE',
      'OPTIONAL': 'FFF3E8FF',
      'DO NOT MIGRATE': 'FFE5E7EB',
    };
    if (critColors[r.critical]) {
      critCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: critColors[r.critical] } };
      critCell.font = { bold: true, name: 'Calibri' };
      critCell.alignment = { horizontal: 'center', vertical: 'middle' };
    }
  });

  // Add a TIMELINE row below
  ws.addRow([]);
  const timelineHeader = ws.addRow(['CUMULATIVE TIMELINE']);
  timelineHeader.font = { bold: true, size: 13, name: 'Calibri' };
  timelineHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
  ws.mergeCells(`A${timelineHeader.number}:F${timelineHeader.number}`);

  const cumulative = [
    ['After v1.0', 'Week 6', 'AppExchange-listable MVP. Can demo end-to-end audit-to-recovery flow on a Salesforce-native dashboard. Top 5 detectors cover ~70% of \$-impact in a typical org.'],
    ['After v1.5', 'Week 10', 'Full detector coverage. Consultants can run real audits and capture engagement notes. Bulk workflows make 50-finding reviews tractable.'],
    ['After v2.0', 'Week 14', 'Production-ready dashboard. Matrix + tabs + trend make this a real Hubbl competitor. Visual parity achieved.'],
    ['After v2.5', 'Week 20', 'AI + PDF + scheduled-scan parity with SaaS version. Last gap: multi-org portfolio (which is structurally incompatible with managed-package model).'],
  ];
  cumulative.forEach((c) => {
    const r = ws.addRow([c[0], c[1], '', c[2]]);
    r.alignment = { wrapText: true, vertical: 'middle' };
    r.getCell(1).font = { bold: true, name: 'Calibri' };
    r.height = 50;
    ws.mergeCells(`D${r.number}:F${r.number}`);
  });
}

function buildMigrationSheet(wb) {
  const ws = wb.addWorksheet('Migration Reality Check');
  ws.columns = [
    { header: 'Topic', key: 'topic', width: 32 },
    { header: 'What it means for OrgPrism → Managed Package', key: 'detail', width: 100 },
  ];

  const hdr = ws.getRow(1);
  hdr.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
  hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
  hdr.alignment = { vertical: 'middle' };
  hdr.height = 22;

  const rows = [
    { topic: 'Current architecture', detail: 'Next.js 14 + Supabase Postgres + Vercel + jsforce + Gemini AI + Resend email + @react-pdf/renderer. ZERO Salesforce metadata exists today. The repo has no Apex classes, no LWC, no custom objects, no Flows.' },
    { topic: 'What "managed package" requires', detail: 'Apex code, Lightning Web Components, Custom Objects + Fields, Validation Rules, Flows, Permission Sets, Static Resources. All packaged into a 1GP or 2GP managed package, distributed via AppExchange.' },
    { topic: 'Honest effort estimate', detail: 'Full rewrite (v1.0 + v1.5 + v2.0): ~14 weeks for one Salesforce dev. Add v2.5 for ~20 weeks. The Release Plan tab breaks down what ships per release.' },
    { topic: 'What gets LOST in the migration', detail: '(1) Multi-org portfolio dashboard — consultants lose their cross-org view. Each install only sees its own org. (2) AI explanations limited by Apex governor + callout limits. (3) Cross-engagement notes — each consultant must re-log notes per install. (4) PDF reports degraded (Visualforce is limited vs React-PDF). (5) Custom auth flow.' },
    { topic: 'What gets EASIER', detail: '(1) Customer data never leaves their org — easier security review. (2) AppExchange = real discovery channel. (3) Salesforce admins prefer in-org tools. (4) Setup deep-links work natively. (5) Lightning datatable is excellent for selection + filtering. (6) No Data Loader detour — direct DML can apply fixes.' },
    { topic: 'Hubbl\'s actual architecture', detail: 'Hubbl is NOT a managed package. It is a SaaS web app at app.hubbl.com that reads metadata via OAuth. They distribute via AppExchange listing only. Same model as Salto, Provar, GearsetCM. Mention this so the founder calibrates expectations.' },
    { topic: 'Required for AppExchange listing', detail: 'Security Review (multi-week back-and-forth with Salesforce). Apex test coverage ≥75%. SOC2-equivalent documentation. Pen-test report. Costs ~\$5-10K for partner setup + listing fees.' },
    { topic: 'The trap to avoid', detail: 'Don\'t conflate "we should be on AppExchange" with "we should be Apex-native." These are independent decisions. You can be on AppExchange WITHOUT being Apex-native (most SaaS vendors do this for years before going managed).' },
    { topic: 'Excel checkbox legend', detail: 'In the Features tab, "Deployed (Package)" column has a Yes/No/Partial dropdown. Mark Yes once a feature is re-implemented in the managed package. Conditional formatting turns the cell green on Yes, amber on Partial. The Summary tab shows progress per category. The Release Plan tab shows what should ship in which version.' },
    { topic: 'Apex Effort legend', detail: 'Easy = direct SOQL/data port. Medium = needs Custom Object + Apex glue. Hard = AI/PDF/cross-org dependency that fights Apex constraints. Skip = SaaS-only feature with no in-Salesforce equivalent (auth, hosting, multi-tenant DB, etc.). Skip rows total ~25 features that will NEVER migrate by design.' },
    { topic: 'Phase legend', detail: 'v1.0 = MVP (~6w), v1.5 = Coverage (~4w), v2.0 = Polish (~4w), v2.5 = Hard Stuff (~6w), v3.0+ = Future, Skip = Won\'t migrate. The Release Plan tab has full per-version detail.' },
  ];

  rows.forEach((r) => {
    const row = ws.addRow({ topic: r.topic, detail: r.detail });
    row.alignment = { wrapText: true, vertical: 'top' };
    row.getCell('topic').font = { bold: true, name: 'Calibri' };
    row.height = 70;
  });
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
