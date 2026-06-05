import { LightningElement, wire, track } from 'lwc';
import { CurrentPageReference } from 'lightning/navigation';
import getComplexity from '@salesforce/apex/OrgComplexityController.getComplexity';

const RATING_THEME = {
  Low:        { dotClass: 'op-cx__chip op-cx__chip--low',   scoreClass: 'op-cx__score op-cx__score--low' },
  Moderate:   { dotClass: 'op-cx__chip op-cx__chip--mod',   scoreClass: 'op-cx__score op-cx__score--mod' },
  High:       { dotClass: 'op-cx__chip op-cx__chip--high',  scoreClass: 'op-cx__score op-cx__score--high' },
  'Very High':{ dotClass: 'op-cx__chip op-cx__chip--vhigh', scoreClass: 'op-cx__score op-cx__score--vhigh' },
};

export default class ComplexityCard extends LightningElement {
  data;
  error;
  loading = true;
  @track expanded = true;
  /** Phase 22t — scope to the active Connected Org. Same pattern as
   *  heroBlock / categoryPerformanceGrid / aiRemediationPlan. Without
   *  this, the card always shows host-org (techtorch) counts no
   *  matter which Connected Org dashboard you're on. */
  @track connectedOrgId = null;

  @wire(CurrentPageReference)
  wirePageRef(pageRef) {
    if (!pageRef) return;
    this.connectedOrgId = pageRef.state?.c__connectedOrgId
      || pageRef.state?.connectedOrgId
      || null;
  }

  @wire(getComplexity, { connectedOrgId: '$connectedOrgId' })
  wireData(result) {
    this.loading = false;
    if (result.data) {
      this.data = result.data;
      this.error = undefined;
    } else if (result.error) {
      this.error = result.error.body?.message || result.error.message;
    }
  }

  get isLoading() { return this.loading; }
  get hasError() { return !this.loading && Boolean(this.error); }
  get hasData() { return !this.loading && !this.error && this.data; }

  get totalScore() { return this.data?.totalScore ?? 0; }
  get rating() { return this.data?.rating ?? 'Low'; }
  get description() { return this.data?.description ?? ''; }

  get theme() { return RATING_THEME[this.rating] || RATING_THEME.Low; }
  get chipClass() { return this.theme.dotClass; }
  get scoreClass() { return this.theme.scoreClass; }

  /** Gauge percentage — cap at 150 for visual fill. */
  get gaugeWidth() {
    return `width: ${Math.min((this.totalScore / 150) * 100, 100)}%;`;
  }

  /**
   * Visible factors with computed bar geometry.
   * userBarPct = min(contribution / 20, 1) × 100
   * benchmarkPct = min((benchmark / count) × userBarPct, 100) when benchmark exists & count > 0
   */
  get visibleFactors() {
    if (!this.data?.factors) return [];
    const factors = this.data.factors.filter((f) => f.count > 0)
                                     .slice()
                                     .sort((a, b) => b.contribution - a.contribution);
    return factors.map((f) => {
      const userBarPct = Math.min((f.contribution / 20) * 100, 100);
      let benchmarkPct = null;
      if (f.benchmark > 0 && f.count > 0) {
        benchmarkPct = Math.min((f.benchmark / f.count) * userBarPct, 100);
      }
      const aboveBenchmark = f.benchmark != null && f.count > f.benchmark;
      return {
        ...f,
        userBarStyle: `width: ${userBarPct}%;`,
        benchmarkStyle: benchmarkPct !== null ? `left: ${benchmarkPct}%;` : '',
        hasBenchmark: benchmarkPct !== null,
        contributionClass: aboveBenchmark
          ? 'op-cx__factor-delta op-cx__factor-delta--above'
          : 'op-cx__factor-delta',
        contributionLabel: `+${f.contribution}`,
      };
    });
  }

  get hasFactors() { return this.visibleFactors.length > 0; }
  get isExpanded() { return this.expanded; }
  get toggleLabel() { return this.expanded ? 'Hide breakdown' : 'Show breakdown'; }
  get toggleIconName() { return this.expanded ? 'utility:chevronup' : 'utility:chevrondown'; }

  toggleBreakdown() { this.expanded = !this.expanded; }
}
