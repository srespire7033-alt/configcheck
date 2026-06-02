import { LightningElement, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import getSinceLastScan from '@salesforce/apex/DashboardController.getSinceLastScan';

/**
 * "Since last scan" diff card. Compares the latest completed scan to
 * the one before it: $ delta, new findings, resolved findings.
 *
 * Self-hides when there's no prior scan (first-scan users see
 * nothing instead of an empty card). Used on the Summary tab below
 * the hero block.
 */
export default class SinceLastScanCard extends NavigationMixin(LightningElement) {
  data;
  error;
  loading = true;

  @wire(getSinceLastScan)
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
  get hasError() { return Boolean(this.error); }
  /** When there's no prior scan, the entire card hides. */
  get shouldRender() {
    return !this.loading && !this.error && this.data?.hasPrior;
  }

  get deltaFmt() {
    const d = Number(this.data?.delta) || 0;
    if (d === 0) return 'unchanged';
    const sign = d < 0 ? '↓ recovered ' : '↑ added ';
    return `${sign}${this.formatMoney(Math.abs(d))}`;
  }
  get deltaClass() {
    const d = Number(this.data?.delta) || 0;
    if (d < 0) return 'op-sls__delta op-sls__delta--good';
    if (d > 0) return 'op-sls__delta op-sls__delta--bad';
    return 'op-sls__delta';
  }

  get latestFmt() { return this.formatMoney(this.data?.latestTotal); }
  get priorFmt() { return this.formatMoney(this.data?.priorTotal); }
  get addedCount() { return this.data?.addedCount || 0; }
  get resolvedCount() { return this.data?.resolvedCount || 0; }

  get hasNewFindings() { return (this.data?.newFindings?.length || 0) > 0; }
  get hasResolved() { return (this.data?.resolvedTitles?.length || 0) > 0; }

  get newFindings() {
    if (!this.data?.newFindings) return [];
    return this.data.newFindings.map((f) => ({
      ...f,
      gapFmt: this.formatMoney(f.gapUsd),
    }));
  }
  get resolvedTitles() {
    return this.data?.resolvedTitles || [];
  }

  formatMoney(n) {
    const v = Number(n) || 0;
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
    return `$${Math.round(v)}`;
  }

  handleNewClick(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    this[NavigationMixin.Navigate]({
      type: 'standard__recordPage',
      attributes: { recordId: id, objectApiName: 'ForensicFinding__c', actionName: 'view' },
    });
  }
}
