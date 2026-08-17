import { LightningElement, wire, track } from 'lwc';
import { NavigationMixin, CurrentPageReference } from 'lightning/navigation';
import getScoreHistory from '@salesforce/apex/DashboardController.getScoreHistory';

/**
 * Full Scan History page — equivalent of the SaaS /history view.
 * Includes:
 *   - Score Trend chart (larger version, all 20 scans)
 *   - 3 summary tiles: Score / Issue Trend / Best Score
 *   - All Scans table (sortable by date desc, with severity chips)
 *
 * Category Performance grid + Issue Breakdown Over Time stacked bar
 * are deferred — they need per-category scoring infrastructure we
 * haven't built yet.
 */
export default class ScanHistoryPage extends NavigationMixin(LightningElement) {
  points;
  error;
  loading = true;
  @track connectedOrgId = null;

  @wire(CurrentPageReference)
  wirePageRef(pageRef) {
    if (!pageRef) return;
    this.connectedOrgId = pageRef.state?.c__connectedOrgId || pageRef.state?.connectedOrgId || null;
  }

  @wire(getScoreHistory, { maxPoints: 50, connectedOrgId: '$connectedOrgId' })
  wireData(result) {
    this.loading = false;
    if (result.data) {
      this.points = result.data;
      this.error = undefined;
    } else if (result.error) {
      this.error = result.error.body?.message || result.error.message;
    }
  }

  get isLoading() { return this.loading; }
  get hasError() { return Boolean(this.error); }
  get hasData() { return !this.loading && !this.error && this.points?.length > 0; }
  get isEmpty() { return !this.loading && !this.error && (!this.points || this.points.length === 0); }

  get scanCount() { return this.points?.length || 0; }
  get scanCountLabel() { return `${this.scanCount} scan${this.scanCount === 1 ? '' : 's'} tracked`; }

  // ── Tile data ──
  get latestPoint() { return this.points?.[this.points.length - 1]; }
  get latestScore() { return this.latestPoint?.healthScore ?? 0; }

  get bestPoint() {
    if (!this.points?.length) return null;
    return [...this.points].sort((a, b) => b.healthScore - a.healthScore)[0];
  }
  get bestScore() { return this.bestPoint?.healthScore ?? 0; }
  get bestScoreDate() {
    return this.bestPoint?.completedAt ? this.formatShortDate(this.bestPoint.completedAt) : '';
  }

  get totalIssues() {
    const p = this.latestPoint;
    return (p?.criticalCount || 0) + (p?.warningCount || 0) + (p?.infoCount || 0);
  }
  get criticalCount() { return this.latestPoint?.criticalCount || 0; }
  get warningCount() { return this.latestPoint?.warningCount || 0; }
  get infoCount() { return this.latestPoint?.infoCount || 0; }

  get scoreTrendChip() {
    if (!this.points || this.points.length < 2) return 'No data';
    const prev = this.points[this.points.length - 2].healthScore;
    const curr = this.latestScore;
    if (curr === prev) return '— No change';
    return curr > prev ? `↑ +${curr - prev}` : `↓ ${curr - prev}`;
  }

  get issueTrendChip() {
    if (!this.points || this.points.length < 2) return 'No data';
    const prev = this.points[this.points.length - 2];
    const prevTotal = (prev.criticalCount || 0) + (prev.warningCount || 0) + (prev.infoCount || 0);
    const currTotal = this.totalIssues;
    if (currTotal === prevTotal) return '— No change';
    return currTotal > prevTotal ? `↑ +${currTotal - prevTotal}` : `↓ ${currTotal - prevTotal}`;
  }

  // ── Chart (reuse scoreTrendCard layout, larger) ──
  get chart() {
    if (!this.points || this.points.length < 2) return { polyline: '', dots: [], xLabels: [] };
    const width = 1200;
    const height = 300;
    const padX = 40;
    const padY = 30;
    const values = this.points.map((p) => Number(p.healthScore) || 0);
    const min = 0, max = 100, range = 100;
    const n = values.length;
    const step = (width - padX * 2) / Math.max(1, n - 1);
    const dots = values.map((v, i) => {
      const x = padX + step * i;
      const y = padY + (1 - (v - min) / range) * (height - padY * 2);
      return {
        cx: x, cy: y,
        scanId: this.points[i].id,
        title: `${this.formatShortDate(this.points[i].completedAt)} · ${v}/100`,
      };
    });
    const polyline = dots.map((d) => `${d.cx},${d.cy}`).join(' ');
    const xLabels = dots.map((d, i) => {
      const show = n <= 10 || i % Math.ceil(n / 10) === 0 || i === n - 1;
      return show ? { x: d.cx, label: this.formatShortDate(this.points[i].completedAt) } : null;
    }).filter(Boolean);
    return { polyline, dots, xLabels };
  }

  // ── Table rows (newest first) ──
  get tableRows() {
    if (!this.points) return [];
    // Display newest first, opposite of chart ordering.
    return [...this.points].reverse().map((p) => ({
      id: p.id,
      name: p.name,
      dateLabel: this.formatLongDate(p.completedAt),
      timeAgo: this.timeAgo(p.completedAt),
      score: p.healthScore,
      scoreBadgeClass: this.scoreBadgeClass(p.healthScore),
      critical: p.criticalCount || 0,
      warning: p.warningCount || 0,
      info: p.infoCount || 0,
      duration: p.durationMs ? `${(p.durationMs / 1000).toFixed(0)}s` : '—',
      productType: this.productLabel(p.productType),
      statusBadgeClass: this.statusBadgeClass(p.status),
      status: p.status === 'Partial' ? 'Partial' : 'Completed',
    }));
  }

  scoreBadgeClass(score) {
    if (score >= 90) return 'op-sh__score-badge op-sh__score-badge--good';
    if (score >= 70) return 'op-sh__score-badge op-sh__score-badge--warn';
    return 'op-sh__score-badge op-sh__score-badge--bad';
  }
  statusBadgeClass(status) {
    return status === 'Partial'
      ? 'op-sh__status op-sh__status--warn'
      : 'op-sh__status op-sh__status--ok';
  }
  productLabel(t) {
    return { 'CPQ': 'CPQ', 'CPQ+Billing': 'CPQ + Billing', 'ARM': 'ARM' }[t] || t;
  }

  // ── Navigation ──
  handleRowClick(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    this[NavigationMixin.Navigate]({
      type: 'standard__recordPage',
      attributes: { recordId: id, objectApiName: 'ForensicScan__c', actionName: 'view' },
    });
  }

  handleRowClickKey(e) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      this.handleRowClick(e);
    }
  }

  // ── Date helpers ──
  formatShortDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  formatLongDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  }
  timeAgo(iso) {
    if (!iso) return '';
    const diff = Math.max(0, Date.now() - new Date(iso).getTime());
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  }
}
