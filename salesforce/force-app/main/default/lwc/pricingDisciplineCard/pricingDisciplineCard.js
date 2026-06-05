import { LightningElement, wire, track } from 'lwc';
import { CurrentPageReference } from 'lightning/navigation';
import getDiscipline from '@salesforce/apex/PricingDisciplineController.getDiscipline';
import getCategoryByKey from '@salesforce/apex/CategoryDisplayController.getByKey';

const GRADE_THEME = {
  A: { chip: 'op-pd__grade op-pd__grade--a' },
  B: { chip: 'op-pd__grade op-pd__grade--b' },
  C: { chip: 'op-pd__grade op-pd__grade--c' },
  D: { chip: 'op-pd__grade op-pd__grade--d' },
  F: { chip: 'op-pd__grade op-pd__grade--f' },
};

export default class PricingDisciplineCard extends LightningElement {
  @track data;
  @track error;
  @track loading = true;
  @track expanded = false;
  @track categoryMeta;  // Phase 20d — Category__mdt-backed title/subtitle
  /** Phase 22u — scope discipline metrics to the active Connected Org so
   *  CPQ and ARM dashboards stop showing identical host-org numbers. */
  @track connectedOrgId = null;

  @wire(CurrentPageReference)
  wirePageRef(pageRef) {
    if (!pageRef) return;
    this.connectedOrgId = pageRef.state?.c__connectedOrgId
      || pageRef.state?.connectedOrgId
      || null;
  }

  @wire(getCategoryByKey, { categoryKey: 'pricing' })
  wireCategoryMeta({ data }) {
    if (data) this.categoryMeta = data;
  }

  get cardTitle() {
    return this.categoryMeta?.title || 'Pricing Discipline';
  }

  // Phase 22u — imperative call instead of @wire because the multi-arg
  // overload is non-cacheable (callouts). Re-fetches on connectedOrgId
  // change + on op:scan-completed.
  connectedCallback() {
    window.addEventListener('op:scan-completed', this.handleScanCompleted);
  }
  disconnectedCallback() {
    window.removeEventListener('op:scan-completed', this.handleScanCompleted);
  }
  handleScanCompleted = () => { this.fetchDiscipline(); };

  renderedCallback() {
    if (this._lastFetchedOrgId !== this.connectedOrgId) {
      this._lastFetchedOrgId = this.connectedOrgId;
      this.fetchDiscipline();
    }
  }

  fetchDiscipline() {
    this.loading = true;
    getDiscipline({ connectedOrgId: this.connectedOrgId })
      .then((result) => {
        this.data = result;
        this.error = undefined;
      })
      .catch((err) => {
        this.error = err?.body?.message || err?.message || 'Unknown error';
      })
      .finally(() => { this.loading = false; });
  }

  get isLoading() { return this.loading; }
  get hasError() { return !this.loading && Boolean(this.error); }
  get hasData() { return !this.loading && !this.error && this.data; }
  get isNoCpq() { return this.hasData && !this.data.cpqInstalled; }
  get isNoLines() { return this.hasData && this.data.cpqInstalled && this.data.quoteLineCount === 0; }
  get hasMetrics() { return this.hasData && this.data.cpqInstalled && this.data.quoteLineCount > 0; }

  get subtitleLabel() {
    if (!this.hasData) return '';
    if (!this.data.cpqInstalled) return 'Salesforce CPQ not installed — pricing-health signals unavailable.';
    const n = this.data.quoteLineCount;
    return `Org-level pricing-health signals across ${n} quote line${n === 1 ? '' : 's'} (last 12 months).`;
  }

  get gradeChipClass() {
    const g = this.data?.grade || 'A';
    return GRADE_THEME[g]?.chip || GRADE_THEME.A.chip;
  }
  get gradeLetter() { return this.data?.grade || 'A'; }

  // ── Metrics ──
  get avgDiscountFmt() { return `${(this.data?.avgDiscount || 0).toFixed(1)}%`; }
  get medianDiscountFmt() { return `Median: ${(this.data?.medianDiscount || 0).toFixed(1)}%`; }
  get maxAllowedFmt() { return `Max allowed discount: ${(this.data?.maxAllowedDiscount || 25).toFixed(0)}%`; }
  get beyondLimitLabel() {
    const d = this.data;
    if (!d) return '';
    return `${(d.beyondLimitPct || 0).toFixed(1)}% of lines discounted beyond the limit (${d.beyondLimitCount || 0} lines)`;
  }

  get overrideFmt() { return `${(this.data?.overridePct || 0).toFixed(1)}%`; }
  get overrideLineLabel() {
    const d = this.data;
    if (!d) return '';
    return `${d.overrideCount || 0} lines with prices typed in manually (CPQ's calculation bypassed)`;
  }
  get overrideRiskLabel() {
    if (!this.data) return '';
    return `${this.data.overrideRiskLabel} — ${this.data.overrideRiskCopy}`;
  }
  get overrideRiskClass() {
    const r = (this.data?.overrideRiskLabel || 'Low').toLowerCase();
    return `op-pd__metric-risk op-pd__metric-risk--${r}`;
  }

  // ── Top offenders ──
  get hasOffenders() {
    return (this.data?.topDiscountOffenders?.length || 0) > 0
      || (this.data?.topOverrideOffenders?.length || 0) > 0;
  }
  get discountOffenders() {
    return (this.data?.topDiscountOffenders || []).map((o) => ({
      ...o,
      avgFmt: `${(o.avgDiscount || 0).toFixed(1)}%`,
      lineLabel: `${o.lineCount} line${o.lineCount === 1 ? '' : 's'}`,
    }));
  }
  get overrideOffenders() {
    return (this.data?.topOverrideOffenders || []).map((o) => ({
      ...o,
      countLabel: `${o.overrideCount} override${o.overrideCount === 1 ? '' : 's'}`,
      lineLabel: `${o.lineCount} line${o.lineCount === 1 ? '' : 's'}`,
    }));
  }
  get hasDiscountOffenders() { return this.discountOffenders.length > 0; }
  get hasOverrideOffenders() { return this.overrideOffenders.length > 0; }

  get expandIcon() { return this.expanded ? 'utility:chevrondown' : 'utility:chevronright'; }
  get expandLabel() { return this.expanded ? 'Hide top offenders' : 'Show top offenders'; }

  toggleExpand() { this.expanded = !this.expanded; }
}
