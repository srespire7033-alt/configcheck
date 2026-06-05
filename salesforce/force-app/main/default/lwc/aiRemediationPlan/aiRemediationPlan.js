import { LightningElement, wire, track } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getPlan from '@salesforce/apex/RemediationPlanController.getPlan';

export default class AiRemediationPlan extends LightningElement {
  @track data;
  @track error;
  @track loading = true;
  @track regenerating = false;
  wiredResult;

  connectedCallback() { window.addEventListener('op:scan-completed', this.handleScanCompleted); }
  disconnectedCallback() { window.removeEventListener('op:scan-completed', this.handleScanCompleted); }
  handleScanCompleted = () => { if (this.wiredResult) refreshApex(this.wiredResult); };

  @wire(getPlan)
  wireData(result) {
    this.wiredResult = result;
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
  get isEmpty() { return this.hasData && (this.data.phases?.length || 0) === 0; }
  get hasContent() { return this.hasData && (this.data.phases?.length || 0) > 0; }

  // ── Header lines ──
  get scoreLine() { return `Current Score: ${this.data?.currentScore ?? 100}/100`; }
  get totalLeakageLine() {
    return `Estimated Total Annual Leakage Across These Issues: ${this.formatMoney(this.data?.totalAnnualLeakage)}`;
  }

  get phaseRows() {
    return (this.data?.phases || []).map((p) => ({
      ...p,
      heading: `Phase ${p.phaseNum} — ${p.title}`,
      subHeading: p.timeRange,
      totalRecoveredLabel: `Total Estimated Annual Recovery for Phase ${p.phaseNum}: ${this.formatMoney(p.totalRecovered)}`,
      stepRows: (p.steps || []).map((s) => ({
        ...s,
        timeLabel: this.formatHours(s.estHours),
        recoveredLabel: `${this.formatMoney(s.recoveredUsd)}/yr`,
        findingLabel: s.findingCount === 1 ? '1 finding' : `${s.findingCount} findings`,
      })),
    }));
  }

  // ── Regenerate (refresh + toast) ──
  async handleRegenerate() {
    if (this.regenerating) return;
    this.regenerating = true;
    try {
      await refreshApex(this.wiredResult);
      this.dispatchEvent(new ShowToastEvent({
        title: 'Plan regenerated',
        message: 'Latest scan data used to refresh the 3-phase fix plan.',
        variant: 'success',
      }));
    } catch (e) {
      this.dispatchEvent(new ShowToastEvent({
        title: 'Regenerate failed',
        message: e.body?.message || e.message || 'Unknown error',
        variant: 'error',
      }));
    } finally {
      this.regenerating = false;
    }
  }

  // ── Utilities ──
  formatMoney(n) {
    const v = Number(n) || 0;
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
    if (v < 1) return '$0';
    return `$${Math.round(v).toLocaleString()}`;
  }
  formatHours(h) {
    const v = Number(h) || 0;
    if (v < 1) return `${Math.round(v * 60)} min`;
    if (v < 10) return `${v.toFixed(1)}h`;
    if (v < 80) return `${Math.round(v)}h`;
    return `${Math.round(v / 8)} days`;
  }
}
