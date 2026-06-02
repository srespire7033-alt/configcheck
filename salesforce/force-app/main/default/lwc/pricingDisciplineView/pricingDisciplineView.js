import { LightningElement, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import getFindingsByCategory from '@salesforce/apex/DashboardController.getFindingsByCategory';

const DETECTOR_LABELS = {
  'REN-002':     'Renewal below current list',
  'DSC-FOR-001': 'Expired promo discount',
  'DSC-FOR-002': 'Stacked discounts past cap',
  'CT-FOR-001':  'Contracted price expired',
  'MDQ-FOR-001': 'MDQ segment pricing inconsistency',
};

/**
 * Pricing Discipline view — same accordion pattern as Revenue Leakage
 * but filtered to pricing-category detectors. Adds an "average
 * discount overage" KPI tile up top derived from the finding $.
 */
export default class PricingDisciplineView extends NavigationMixin(LightningElement) {
  data;
  error;
  loading = true;

  @wire(getFindingsByCategory, { category: 'pricing' })
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
  get hasData() { return !this.loading && !this.error && this.data?.findingCount > 0; }
  get isEmpty() { return !this.loading && !this.error && !this.data?.findingCount; }

  get totalFmt() { return this.formatMoney(this.data?.totalUsd); }
  get findingCount() { return this.data?.findingCount || 0; }

  get averageFmt() {
    if (!this.data?.findingCount) return '$0';
    const avg = (this.data.totalUsd || 0) / this.data.findingCount;
    return this.formatMoney(avg);
  }

  get detectorRows() {
    if (!this.data?.byDetector) return [];
    return this.data.byDetector.map((g) => ({
      detectorId: g.detectorId,
      label: DETECTOR_LABELS[g.detectorId] || g.detectorId,
      count: g.count,
      totalFmt: this.formatMoney(g.totalUsd),
    }));
  }

  formatMoney(n) {
    const v = Number(n) || 0;
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
    return `$${Math.round(v)}`;
  }

  handleViewAll() {
    this[NavigationMixin.Navigate]({
      type: 'standard__objectPage',
      attributes: { objectApiName: 'ForensicFinding__c', actionName: 'list' },
    });
  }
}
