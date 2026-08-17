import { LightningElement, wire, track } from 'lwc';
import { NavigationMixin, CurrentPageReference } from 'lightning/navigation';
import { refreshApex } from '@salesforce/apex';
import getScoreHistory from '@salesforce/apex/DashboardController.getScoreHistory';

/**
 * Score Trend — matches the SaaS dashboard card exactly:
 *   - 4 KPI tiles: STARTING SCAN / LATEST / ISSUES CHANGE / CRITICAL CHANGE
 *   - "Since last scan" inline diff line
 *   - SVG line chart with points colored by role:
 *       Baseline (first) = teal, Best = green, Low = red, others = blue
 *   - "View History" button → navigates to the scan history Lightning page
 *
 * Self-hides when < 2 scans exist (no trend to draw).
 */
export default class ScoreTrendCard extends NavigationMixin(LightningElement) {
  points;
  error;
  loading = true;
  wiredResult;
  @track connectedOrgId = null;

  connectedCallback() { window.addEventListener('op:scan-completed', this.handleScanCompleted); }
  disconnectedCallback() { window.removeEventListener('op:scan-completed', this.handleScanCompleted); }
  handleScanCompleted = () => { if (this.wiredResult) refreshApex(this.wiredResult); };

  @wire(CurrentPageReference)
  wirePageRef(pageRef) {
    if (!pageRef) return;
    this.connectedOrgId = pageRef.state?.c__connectedOrgId || pageRef.state?.connectedOrgId || null;
  }

  @wire(getScoreHistory, { maxPoints: 20, connectedOrgId: '$connectedOrgId' })
  wireData(result) {
    this.wiredResult = result;
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
  get hasEnoughData() {
    return !this.loading && !this.error && this.points && this.points.length >= 2;
  }
  get isEmpty() {
    return !this.loading && !this.error && (!this.points || this.points.length < 2);
  }

  // ── KPI tiles ──

  get startingPoint() { return this.points?.[0]; }
  get latestPoint() { return this.points?.[this.points.length - 1]; }

  get startingScore() { return this.startingPoint?.healthScore ?? 0; }
  get latestScore() { return this.latestPoint?.healthScore ?? 0; }
  get startingDate() { return this.formatShortDate(this.startingPoint?.completedAt); }
  get latestDate() { return this.formatShortDate(this.latestPoint?.completedAt); }

  get scoreDelta() { return this.latestScore - this.startingScore; }
  get scoreDeltaLabel() {
    const d = this.scoreDelta;
    if (d === 0) return '→ same as start';
    const arrow = d < 0 ? '↓' : '↑';
    return `${arrow} ${d > 0 ? '+' : ''}${d} vs start`;
  }
  get scoreDeltaClass() {
    if (this.scoreDelta > 0) return 'op-tr__delta op-tr__delta--good';
    if (this.scoreDelta < 0) return 'op-tr__delta op-tr__delta--bad';
    return 'op-tr__delta';
  }

  get startIssues() {
    const p = this.startingPoint;
    return (p?.criticalCount || 0) + (p?.warningCount || 0) + (p?.infoCount || 0);
  }
  get latestIssues() {
    const p = this.latestPoint;
    return (p?.criticalCount || 0) + (p?.warningCount || 0) + (p?.infoCount || 0);
  }
  get issuesDelta() { return this.latestIssues - this.startIssues; }
  get issuesDeltaLabel() {
    const d = this.issuesDelta;
    if (d > 0) return `+${d}`;
    if (d < 0) return `${d}`;
    return '0';
  }
  get issuesDeltaClass() {
    // More issues = worse (red). Fewer = better (green).
    if (this.issuesDelta > 0) return 'op-tr__metric op-tr__metric--bad';
    if (this.issuesDelta < 0) return 'op-tr__metric op-tr__metric--good';
    return 'op-tr__metric';
  }
  get issuesTransition() {
    return `${this.startIssues} → ${this.latestIssues}`;
  }

  get critDelta() {
    return (this.latestPoint?.criticalCount || 0) - (this.startingPoint?.criticalCount || 0);
  }
  get critDeltaLabel() {
    const d = this.critDelta;
    if (d > 0) return `+${d}`;
    if (d < 0) return `${d}`;
    return '0';
  }
  get critDeltaClass() {
    if (this.critDelta > 0) return 'op-tr__metric op-tr__metric--bad';
    if (this.critDelta < 0) return 'op-tr__metric op-tr__metric--good';
    return 'op-tr__metric';
  }
  get critTransition() {
    return `${this.startingPoint?.criticalCount || 0} → ${this.latestPoint?.criticalCount || 0}`;
  }

  // ── Since-last-scan strip ──
  get sinceLastScanLabel() {
    if (!this.points || this.points.length < 2) return '';
    const prev = this.points[this.points.length - 2];
    const curr = this.latestPoint;
    const scoreDelta = (curr?.healthScore || 0) - (prev?.healthScore || 0);
    const prevTotal = (prev?.criticalCount||0) + (prev?.warningCount||0) + (prev?.infoCount||0);
    const currTotal = (curr?.criticalCount||0) + (curr?.warningCount||0) + (curr?.infoCount||0);
    const issueDelta = currTotal - prevTotal;

    const scoreText = scoreDelta === 0 ? 'No score change'
      : scoreDelta > 0 ? `Score +${scoreDelta}` : `Score ${scoreDelta}`;
    const issueText = issueDelta === 0 ? 'same issue count'
      : issueDelta > 0 ? `+${issueDelta} new issues` : `${-issueDelta} fewer issues`;
    return `Since last scan (${this.latestDate}): ${scoreText} → ${issueText}`;
  }

  // ── Phase 22g — Per-category breakdown for the latest scan ──
  get categoryPills() {
    const cs = this.latestPoint?.categoryScores;
    if (!cs) return [];
    const entries = Object.keys(cs).map((k) => ({
      key: k,
      label: this.formatCategoryLabel(k),
      score: cs[k],
    }));
    // Sort ascending — worst category first, where the eye lands.
    entries.sort((a, b) => a.score - b.score);
    return entries.map((e) => {
      const tone = e.score < 50 ? 'bad' : e.score < 80 ? 'warn' : 'good';
      return {
        ...e,
        cls: `op-tr__cat-pill op-tr__cat-pill--${tone}`,
        title: `${e.label}: ${e.score}/100`,
      };
    });
  }
  get hasCategoryBreakdown() {
    return this.categoryPills.length > 0;
  }
  formatCategoryLabel(key) {
    if (!key) return 'Uncategorized';
    if (key === '__uncategorized__') return 'Uncategorized';
    return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // ── Chart (SVG sparkline) ──
  get chart() {
    if (!this.hasEnoughData) return { polyline: '', dots: [], width: 800, height: 220 };
    const width = 800;
    const height = 220;
    const padX = 30;
    const padY = 25;
    const values = this.points.map((p) => Number(p.healthScore) || 0);
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 100);
    const range = Math.max(1, max - min);
    const n = values.length;
    const step = (width - padX * 2) / Math.max(1, n - 1);
    const bestIdx = values.indexOf(Math.max(...values));
    const worstIdx = values.indexOf(Math.min(...values));
    const dots = values.map((v, i) => {
      const x = padX + step * i;
      const y = padY + (1 - (v - min) / range) * (height - padY * 2);
      let cls = 'op-tr__dot';
      if (i === 0) cls += ' op-tr__dot--baseline';
      else if (i === bestIdx) cls += ' op-tr__dot--best';
      else if (i === worstIdx) cls += ' op-tr__dot--low';
      return {
        cx: x,
        cy: y,
        scanId: this.points[i].id,
        title: `${this.formatShortDate(this.points[i].completedAt)} · ${v}/100 · ${this.points[i].findingCount} issues`,
        cls,
      };
    });
    const polyline = dots.map((d) => `${d.cx},${d.cy}`).join(' ');
    const xLabels = dots.map((d, i) => {
      // Show every Nth label to avoid crowding.
      const show = n <= 8 || i % Math.ceil(n / 8) === 0 || i === n - 1;
      return show ? { x: d.cx, label: this.formatShortDate(this.points[i].completedAt) } : null;
    }).filter(Boolean);
    // Vertical gridlines: at every X dot position
    const vlines = dots.map((d) => ({ x: d.cx, y1: padY, y2: height - padY }));
    return { polyline, dots, width, height, xLabels, vlines };
  }

  // ── Actions ──
  handleDotClick(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    this[NavigationMixin.Navigate]({
      type: 'standard__recordPage',
      attributes: { recordId: id, objectApiName: 'ForensicScan__c', actionName: 'view' },
    });
  }

  handleDotClickKey(e) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      this.handleDotClick(e);
    }
  }

  handleViewHistory() {
    // Navigate to the OrgPrism Scan History FlexiPage. Lightning App
    // Page navigation uses pageName, not recordPage.
    this[NavigationMixin.Navigate]({
      type: 'standard__navItemPage',
      attributes: { apiName: 'OrgPrism_ScanHistory' },
    });
  }

  // ── Utilities ──
  formatShortDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
}
