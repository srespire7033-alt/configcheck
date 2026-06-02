import { LightningElement, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import getDashboardSummary from '@salesforce/apex/DashboardController.getDashboardSummary';

/**
 * The wedge play — Impact × Effort matrix. Plots each finding as a
 * bubble where:
 *   - Y axis: $ impact (gapUsd, log-scaled so big and small fit)
 *   - X axis: effort to recover (low / medium / high, derived from
 *             recoverabilityScore: high score → low effort)
 *   - bubble size: $ (proportional)
 *   - bubble color: severity tint
 *
 * Quadrants:
 *   - Top-left  (high $, low effort)  → "Quick wins"   ← act now
 *   - Top-right (high $, high effort) → "Big bets"     ← plan
 *   - Bottom-L  (low $, low effort)   → "Tidy-ups"     ← bulk fix
 *   - Bottom-R  (low $, high effort)  → "Defer"        ← skip for now
 *
 * Clicking a bubble navigates to that finding's detail page.
 */
const EFFORT_BUCKETS = [
  { key: 'low',    label: 'Low effort',    xPct: 18 },
  { key: 'medium', label: 'Medium effort', xPct: 50 },
  { key: 'high',   label: 'High effort',   xPct: 82 },
];

export default class ImpactEffortMatrix extends NavigationMixin(LightningElement) {
  data;
  error;
  loading = true;

  @wire(getDashboardSummary)
  wireData(result) {
    this.loading = false;
    if (result.data) {
      this.data = result.data;
      this.error = undefined;
    } else if (result.error) {
      this.error = result.error.body?.message || result.error.message || 'Failed to load matrix data';
      this.data = undefined;
    }
  }

  get isLoading() { return this.loading; }
  get hasError() { return Boolean(this.error); }
  get hasFindings() {
    return !this.loading && !this.error && this.data?.topFindings?.length > 0;
  }
  get isEmpty() {
    return !this.loading && !this.error && (!this.data?.topFindings || this.data.topFindings.length === 0);
  }

  /** Computed bubbles, each ready to render at an absolute position. */
  get bubbles() {
    if (!this.hasFindings) return [];
    const findings = this.data.topFindings;
    // Find max gap to scale bubble size + Y position.
    const maxGap = Math.max(...findings.map((f) => Number(f.gapUsd) || 0), 1);
    return findings.map((f, idx) => {
      const gap = Number(f.gapUsd) || 0;
      // Y: log-scaled so a $10K finding and a $1M finding both fit
      // on the plot. Empty 10% top/bottom margin.
      const yLog = Math.log10(gap + 1) / Math.log10(maxGap + 1);
      const yPct = 90 - yLog * 80;
      // Effort from recoverabilityScore (0..1). Higher score = lower
      // effort to recover.
      const rec = Number(f.recoverabilityScore) || 0.5;
      const effort = rec > 0.75 ? 'low' : rec > 0.45 ? 'medium' : 'high';
      const bucket = EFFORT_BUCKETS.find((b) => b.key === effort) || EFFORT_BUCKETS[1];
      // Bubble radius scales 8px..28px by gap proportion.
      const sizeScale = Math.sqrt(gap / maxGap);
      const radius = 8 + sizeScale * 20;
      const sevColor = this.severityColor(f.severity);
      // Small horizontal jitter so bubbles in the same bucket don't
      // stack exactly. Deterministic by index so re-renders are
      // stable.
      const jitter = ((idx * 37) % 11) - 5;
      const xPct = Math.max(6, Math.min(94, bucket.xPct + jitter));
      return {
        id: f.id,
        title: f.title,
        gap: gap,
        severity: f.severity,
        effort: bucket.label,
        style: `left: ${xPct}%; top: ${yPct}%; width: ${radius * 2}px; height: ${radius * 2}px; background: ${sevColor.bg}; border-color: ${sevColor.border};`,
        tooltip: `${f.title} · ${this.formatMoney(gap)} · ${bucket.label}`,
      };
    });
  }

  severityColor(sev) {
    const key = (sev || '').toLowerCase();
    if (key === 'critical') return { bg: 'rgba(239,68,68,0.55)', border: '#ef4444' };
    if (key === 'warning') return { bg: 'rgba(245,158,11,0.55)', border: '#f59e0b' };
    return { bg: 'rgba(156,163,175,0.55)', border: '#9ca3af' };
  }

  formatMoney(n) {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${Math.round(n)}`;
  }

  /** Quadrant summary chips — "X findings worth $YK in Quick Wins". */
  get quadrants() {
    if (!this.hasFindings) return [];
    const buckets = { quickWins: [], bigBets: [], tidyUps: [], defer: [] };
    const findings = this.data.topFindings;
    // Use $1K as the high/low impact split.
    for (const f of findings) {
      const gap = Number(f.gapUsd) || 0;
      const rec = Number(f.recoverabilityScore) || 0.5;
      const highImpact = gap > 1000;
      const lowEffort = rec > 0.6;
      if (highImpact && lowEffort) buckets.quickWins.push(f);
      else if (highImpact && !lowEffort) buckets.bigBets.push(f);
      else if (!highImpact && lowEffort) buckets.tidyUps.push(f);
      else buckets.defer.push(f);
    }
    const sum = (arr) => arr.reduce((s, f) => s + (Number(f.gapUsd) || 0), 0);
    return [
      { key: 'quickWins', label: 'Quick wins',    count: buckets.quickWins.length, total: this.formatMoney(sum(buckets.quickWins)), cls: 'op-quad op-quad--quick' },
      { key: 'bigBets',   label: 'Big bets',      count: buckets.bigBets.length,   total: this.formatMoney(sum(buckets.bigBets)),   cls: 'op-quad op-quad--big' },
      { key: 'tidyUps',   label: 'Tidy-ups',      count: buckets.tidyUps.length,   total: this.formatMoney(sum(buckets.tidyUps)),   cls: 'op-quad op-quad--tidy' },
      { key: 'defer',     label: 'Defer',         count: buckets.defer.length,     total: this.formatMoney(sum(buckets.defer)),     cls: 'op-quad op-quad--defer' },
    ];
  }

  handleBubbleClick(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    this[NavigationMixin.Navigate]({
      type: 'standard__recordPage',
      attributes: {
        recordId: id,
        objectApiName: 'ForensicFinding__c',
        actionName: 'view',
      },
    });
  }
}
