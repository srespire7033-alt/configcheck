import { LightningElement, wire, track } from 'lwc';
import { CurrentPageReference } from 'lightning/navigation';
import { refreshApex } from '@salesforce/apex';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getDashboardSummary from '@salesforce/apex/DashboardController.getDashboardSummary';
import startScan from '@salesforce/apex/ForensicScanService.startScan';
import getFindingsCsv from '@salesforce/apex/ExportController.getFindingsCsv';
import getRecoveryActionsCsv from '@salesforce/apex/ExportController.getRecoveryActionsCsv';

/**
 * Hero block — single control panel for the dashboard.
 *
 * Left:    Score ring (99 / out of 100 — both inside the SVG)
 * Middle:  Adaptive title + caption + 3 severity tiles (clickable) +
 *          Resolution Progress bar.
 * Right:   Product type pills + refresh icon + Report dropdown +
 *          New Scan / +Forensics split + Schedule button.
 *
 * Cross-component messaging:
 *   - Severity tile click → window event `op:filter-severity` →
 *     issuesPanel listens + applies the filter.
 *   - Schedule button click → window event `op:open-schedule-modal`
 *     → scheduleManager listens + opens its existing modal.
 *
 * Forensics button is currently a synonym of New Scan — we don't
 * have a separate config-only scan engine yet. When we add one,
 * forensics becomes the "+heavy SOQL" mode while New Scan stays
 * lightweight. UI is already split for that future.
 */

const PRODUCT_LABELS = {
  'CPQ': 'CPQ',
  'CPQ+Billing': 'CPQ + Billing',
  'ARM': 'Revenue Cloud (ARM)',
};

const PRODUCT_TITLE_FRAGMENT = {
  'CPQ': 'CPQ',
  'CPQ+Billing': 'CPQ + Billing',
  'ARM': 'Revenue Cloud',
};

export default class HeroBlock extends NavigationMixin(LightningElement) {
  wiredResult;
  data;
  error;
  loading = true;
  selectedProductType;
  running = false;
  showReportMenu = false;
  /** { message, severity } — inline emerald banner above the hero
   *  card. Set when a scan finishes; cleared on dismiss or next scan. */
  scanCompleteBanner = null;
  /** Phase 8c — when set (via URL state c__connectedOrgId), the dashboard
   *  filters to the latest scan for that ConnectedOrg__c instead of the
   *  most recent global scan. Reactive via @wire CurrentPageReference. */
  @track connectedOrgId = null;

  @wire(CurrentPageReference)
  wirePageRef(pageRef) {
    if (!pageRef) return;
    const fromState = pageRef.state?.c__connectedOrgId || pageRef.state?.connectedOrgId;
    this.connectedOrgId = fromState || null;
  }

  @wire(getDashboardSummary, { connectedOrgId: '$connectedOrgId' })
  wireData(result) {
    this.wiredResult = result;
    this.loading = false;
    if (result.data) {
      this.data = result.data;
      this.error = undefined;
      if (!this.selectedProductType) {
        this.selectedProductType = result.data.packages?.recommendedProductType || 'CPQ';
      }
    } else if (result.error) {
      this.error = result.error.body?.message || result.error.message || 'Failed to load dashboard data';
    }
  }

  // ── State branches ──
  get isLoading() { return this.loading; }
  get hasError() { return Boolean(this.error); }

  // ── Score ring ──
  get score() { return this.data?.healthScore ?? 0; }
  get scoreStrokeOffset() {
    const C = 226;
    return C - (this.score / 100) * C;
  }
  get scoreColor() {
    const s = this.score;
    if (s >= 90) return '#10b981';
    if (s >= 70) return '#f59e0b';
    return '#ef4444';
  }

  // ── Title + caption ──
  get productTitle() {
    const t = this.data?.latestScan?.ProductType__c || this.selectedProductType || 'CPQ';
    return `Your ${PRODUCT_TITLE_FRAGMENT[t] || t} Health Score`;
  }

  // Phase 22o-2 — explicit, always-visible product-type badge.
  // The H2 title contains the type in text, but the user reported it
  // wasn't visually distinct enough to tell CPQ / CPQ+Billing / ARM
  // apart at a glance. The badge is a coloured chip that sits next to
  // the title so the type is unambiguous regardless of how many
  // product types are configured (the product pills only render on
  // multi-type orgs).
  get productType() {
    return this.data?.latestScan?.ProductType__c || this.selectedProductType || 'CPQ';
  }
  get productBadgeLabel() {
    return PRODUCT_LABELS[this.productType] || this.productType;
  }
  get productBadgeClass() {
    // Map to a color theme per product type for instant recognition.
    const tone = this.productType === 'ARM' ? 'arm'
               : this.productType === 'CPQ+Billing' ? 'billing'
               : 'cpq';
    return `op-hero__badge op-hero__badge--${tone}`;
  }
  get caption() {
    if (!this.data?.latestScan) {
      return this.data?.orgName ? `${this.data.orgName} · No scans yet` : 'No scans yet';
    }
    const parts = [];
    const when = this.data.latestScan.CompletedAt__c || this.data.latestScan.StartedAt__c;
    if (when) parts.push(`Last scan: ${this.timeAgo(when)}`);
    const total = (this.data.criticalCount || 0) + (this.data.warningCount || 0) + (this.data.infoCount || 0);
    parts.push(`${total} ${total === 1 ? 'issue' : 'issues'} found`);
    if (this.data.orgName) {
      parts.push(`${this.data.orgName}${this.data.isSandbox === false ? ' (Production)' : this.data.isSandbox === true ? ' (Sandbox)' : ''}`);
    }
    return parts.join(' • ');
  }

  // ── Severity tiles ──
  get criticalCount() { return this.data?.criticalCount || 0; }
  get warningCount() { return this.data?.warningCount || 0; }
  get bestPracticeCount() { return this.data?.infoCount || 0; }

  // ── Resolution progress ──
  get totalIssues() {
    return (this.data?.criticalCount || 0) + (this.data?.warningCount || 0) + (this.data?.infoCount || 0);
  }
  get resolvedCount() { return this.data?.resolvedCount || 0; }
  get resolutionLabel() { return `${this.resolvedCount}/${this.totalIssues} fixed`; }
  get progressBarStyle() {
    const pct = this.totalIssues === 0 ? 0 : (this.resolvedCount / this.totalIssues) * 100;
    return `width: ${pct}%;`;
  }

  // ── Product pills + refresh ──
  get productPills() {
    const available = this.data?.packages?.availableProductTypes || ['CPQ'];
    return available.map((id) => ({
      id,
      label: PRODUCT_LABELS[id] || id,
      cls: id === this.selectedProductType ? 'op-hero__pill op-hero__pill--active' : 'op-hero__pill',
    }));
  }
  get showProductPills() {
    return (this.data?.packages?.availableProductTypes?.length || 0) > 1;
  }

  // ── Button labels ──
  get scanButtonLabel() { return this.running ? 'Scanning…' : 'New Scan'; }

  // ─────────────────────────────────────────────────────────────
  // Handlers
  // ─────────────────────────────────────────────────────────────

  handleProductPick(event) {
    if (this.running) return;
    this.selectedProductType = event.currentTarget.dataset.id;
  }

  // Phase 22p — handleRefresh/op-hero__refresh removed. Auto-refresh
  // via the op:scan-completed event covers every scenario the manual
  // button did, and the button was confusing alongside the existing
  // New Scan / +Forensics split.

  async handleNewScan() {
    if (this.running) return;
    this.running = true;
    this.scanCompleteBanner = null;
    try {
      await startScan({ productType: this.selectedProductType });
      // Refresh the wire so all dependent metrics (score, severity
      // counts, $ totals) recompute against the new scan.
      await refreshApex(this.wiredResult);
      // Tell every other dashboard card a new scan landed so they
      // refresh their wired data too. Fire three times across ~1.5s to
      // defeat any cacheable=true server-side cache lag — Salesforce
      // sometimes returns the stale wire result if you ask too soon
      // after the DML commits. Subscribers de-dupe via refreshApex's
      // own throttling.
      const fire = () => window.dispatchEvent(new CustomEvent('op:scan-completed'));
      fire();
      setTimeout(fire, 500);
      setTimeout(fire, 1500);
      // Now read the refreshed totals and build the inline banner.
      // No navigation — the consultant stays on the dashboard so they
      // can see the new numbers land in context, exactly like the
      // SaaS web behavior.
      const sum = this.data;
      const findings = sum?.findingCount || 0;
      const usd = sum?.totalVerifiedUsd || 0;
      const usdFmt = usd > 0
        ? `USD ${Number(usd).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} verified`
        : 'no leakage detected';
      this.scanCompleteBanner = {
        severity: 'success',
        title: `Forensic scan complete — ${findings} finding${findings === 1 ? '' : 's'} (${usdFmt})`,
        subtitle: findings > 0
          ? 'Verified gaps appear in the Revenue Leakage card below. Click any finding to see the attribution drill-down.'
          : 'No revenue leakage detected in this scan.',
      };
    } catch (e) {
      this.scanCompleteBanner = {
        severity: 'error',
        title: 'Scan failed',
        subtitle: e?.body?.message || e?.message || 'Unknown error',
      };
    } finally {
      this.running = false;
    }
  }

  dismissBanner() {
    this.scanCompleteBanner = null;
  }

  get bannerClass() {
    if (!this.scanCompleteBanner) return '';
    const sev = this.scanCompleteBanner.severity;
    return `op-hero__banner op-hero__banner--${sev}`;
  }
  get bannerIcon() {
    return this.scanCompleteBanner?.severity === 'error'
      ? 'utility:error'
      : 'utility:success';
  }

  // Forensics is currently a synonym for New Scan — same heavy
  // analysis. When we split config vs forensic scans, the +Forensics
  // path adds the deep $-analysis pass to the lighter config scan.
  handleForensics() { this.handleNewScan(); }

  /** Phase 22o — Clickable severity tile opens the issues modal locally.
   *  Replaces the legacy op:filter-severity window event which depended
   *  on issuesPanel being present on the same FlexiPage to scroll into
   *  (often it wasn't, and the click silently no-op'd). The modal lets
   *  users drill into Critical / Warning / Info findings from anywhere
   *  the hero renders. The legacy event is still dispatched so existing
   *  issuesPanel subscribers still filter — additive, not replacement. */
  @track showSeverityModal = false;
  @track selectedSeverity = null;

  handleTileClick(event) {
    const sev = event.currentTarget.dataset.severity;
    if (!sev) return;
    this.selectedSeverity = sev;
    this.showSeverityModal = true;
    try {
      window.dispatchEvent(new CustomEvent('op:filter-severity', { detail: { severity: sev } }));
    } catch (_) { /* sandboxed window; the modal carries the experience */ }
  }

  handleCloseSeverityModal() {
    this.showSeverityModal = false;
    this.selectedSeverity = null;
  }

  // ── Report dropdown ──
  toggleReportMenu() {
    this.showReportMenu = !this.showReportMenu;
  }
  handlePdf() {
    this.showReportMenu = false;
    const url = '/apex/ExecutiveReport';
    window.open(url, '_blank', 'noopener');
  }
  async handleFindingsCsv() {
    this.showReportMenu = false;
    try {
      const csv = await getFindingsCsv();
      this.downloadCsv(csv || '', `orgprism-findings-${this.stamp()}.csv`);
    } catch (e) {
      this.toast(this.errMsg(e), 'error');
    }
  }
  async handleRecoveryCsv() {
    this.showReportMenu = false;
    try {
      const csv = await getRecoveryActionsCsv();
      this.downloadCsv(csv || '', `orgprism-recovery-${this.stamp()}.csv`);
    } catch (e) {
      this.toast(this.errMsg(e), 'error');
    }
  }
  downloadCsv(content, filename) {
    if (!content) { this.toast('Nothing to export yet', 'info'); return; }
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  stamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  // ── Schedule button → tells scheduleManager to open its modal ──
  handleSchedule() {
    try {
      window.dispatchEvent(new CustomEvent('op:open-schedule-modal'));
    } catch (e) {
      this[NavigationMixin.Navigate]({
        type: 'standard__objectPage',
        attributes: { objectApiName: 'ScanSchedule__c', actionName: 'list' },
      });
    }
  }

  // ── Utilities ──
  timeAgo(iso) {
    const diff = Math.max(0, Date.now() - new Date(iso).getTime());
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return d < 7 ? `${d}d ago` : new Date(iso).toLocaleDateString();
  }
  toast(msg, variant) {
    this.dispatchEvent(new ShowToastEvent({ title: msg, variant }));
  }
  errMsg(e) {
    return e?.body?.message || e?.message || 'Export failed';
  }
}
