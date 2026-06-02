import { LightningElement, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import getFindingsByCategory from '@salesforce/apex/DashboardController.getFindingsByCategory';

const DETECTOR_LABELS = {
  'REN-001':     'Renewal uplift suppressed',
  'REN-002':     'Renewal below current list',
  'QL-FOR-001':  'Bundle option at $0',
  'ORD-FOR-001': 'Order activated, no billing',
  'SUB-FOR-001': 'Subscription pricing miss',
  'PROV-FOR-001':'Provisioning mismatch',
  'AST-FOR-001': 'Asset terminated mid-contract',
};

/**
 * Revenue Leakage view — accordion grouped by detector. Each row
 * collapses by default and expands to show the underlying findings.
 * Mirrors the SaaS RevenueLeakageCard pattern of grouping ~50+
 * findings into ~5-10 detector rows so the list doesn't overwhelm.
 */
export default class RevenueLeakageView extends NavigationMixin(LightningElement) {
  data;
  error;
  loading = true;
  expanded = new Set();

  @wire(getFindingsByCategory, { category: 'revenue_leakage' })
  wireData(result) {
    this.loading = false;
    if (result.data) {
      this.data = result.data;
      this.error = undefined;
    } else if (result.error) {
      this.error = result.error.body?.message || result.error.message || 'Failed to load findings';
    }
  }

  get isLoading() { return this.loading; }
  get hasError() { return Boolean(this.error); }
  get hasData() {
    return !this.loading && !this.error && this.data?.findingCount > 0;
  }
  get isEmpty() {
    return !this.loading && !this.error && !this.data?.findingCount;
  }

  get totalLabel() {
    const n = Number(this.data?.totalUsd) || 0;
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${Math.round(n)}`;
  }

  get findingCount() { return this.data?.findingCount || 0; }

  get detectorRows() {
    if (!this.data?.byDetector) return [];
    return this.data.byDetector.map((g) => {
      const isOpen = this.expanded.has(g.detectorId);
      return {
        detectorId: g.detectorId,
        label: DETECTOR_LABELS[g.detectorId] || g.detectorId,
        count: g.count,
        totalFmt: this.formatMoney(g.totalUsd),
        findings: g.findings.map((f) => ({
          ...f,
          gapFmt: this.formatMoney(f.gapUsd),
          sevClass: this.severityClass(f.severity),
        })),
        rowClass: isOpen ? 'op-rl__row op-rl__row--open' : 'op-rl__row',
        chevronClass: isOpen ? 'op-rl__chevron op-rl__chevron--open' : 'op-rl__chevron',
        isOpen,
      };
    });
  }

  formatMoney(n) {
    const v = Number(n) || 0;
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
    return `$${Math.round(v)}`;
  }

  severityClass(sev) {
    const k = (sev || '').toLowerCase();
    if (k === 'critical') return 'op-rl__sev op-rl__sev--critical';
    if (k === 'warning') return 'op-rl__sev op-rl__sev--warning';
    return 'op-rl__sev op-rl__sev--info';
  }

  handleToggle(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    if (this.expanded.has(id)) this.expanded.delete(id);
    else this.expanded.add(id);
    // Re-trigger reactivity by creating a new Set reference.
    this.expanded = new Set(this.expanded);
  }

  handleFindingClick(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    this[NavigationMixin.Navigate]({
      type: 'standard__recordPage',
      attributes: { recordId: id, objectApiName: 'ForensicFinding__c', actionName: 'view' },
    });
  }
}
