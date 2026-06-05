import { LightningElement, wire, track } from 'lwc';
import { NavigationMixin, CurrentPageReference } from 'lightning/navigation';
import getScanTrend from '@salesforce/apex/DashboardController.getScanTrend';

/**
 * $ Trend sparkline — shows recoverable leakage across the last 10
 * forensic scans. Where the SaaS shows "Health Score 72 → 78 → 84"
 * across config scans, Salesforce shows "$310K → $250K → $180K"
 * across forensic scans — i.e. recovery progress in dollars.
 *
 * Plot is a small inline SVG sparkline (no charting library) so the
 * component stays light and Lightning-Locker-safe. Hover shows the
 * scan name + amount; click navigates to that scan's record page.
 */
export default class DollarTrendCard extends NavigationMixin(LightningElement) {
  points;
  error;
  loading = true;
  @track connectedOrgId = null;

  @wire(CurrentPageReference)
  wirePageRef(pageRef) {
    if (!pageRef) return;
    this.connectedOrgId = pageRef.state?.c__connectedOrgId || pageRef.state?.connectedOrgId || null;
  }

  @wire(getScanTrend, { maxPoints: 10, connectedOrgId: '$connectedOrgId' })
  wireData(result) {
    this.loading = false;
    if (result.data) {
      this.points = result.data;
      this.error = undefined;
    } else if (result.error) {
      this.error = result.error.body?.message || result.error.message || 'Failed to load trend';
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

  get latestValue() {
    if (!this.points?.length) return 0;
    return Number(this.points[this.points.length - 1].totalUsd) || 0;
  }
  get previousValue() {
    if (!this.points || this.points.length < 2) return 0;
    return Number(this.points[this.points.length - 2].totalUsd) || 0;
  }
  get delta() {
    return this.latestValue - this.previousValue;
  }
  get deltaPct() {
    if (!this.previousValue) return 0;
    return Math.round((this.delta / this.previousValue) * 100);
  }
  get deltaClass() {
    if (this.delta < 0) return 'op-trend__delta op-trend__delta--down';
    if (this.delta > 0) return 'op-trend__delta op-trend__delta--up';
    return 'op-trend__delta';
  }
  get deltaLabel() {
    const sign = this.delta < 0 ? '↓' : this.delta > 0 ? '↑' : '→';
    return `${sign} ${this.formatMoney(Math.abs(this.delta))} (${this.deltaPct}%) vs prior scan`;
  }

  /** Computed SVG polyline points for the sparkline. */
  get sparkline() {
    if (!this.hasEnoughData) return { polyline: '', dots: [], width: 320, height: 80 };
    const width = 320;
    const height = 80;
    const padX = 8;
    const padY = 10;
    const values = this.points.map((p) => Number(p.totalUsd) || 0);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(1, max - min);
    const n = values.length;
    const step = (width - padX * 2) / Math.max(1, n - 1);
    const dots = values.map((v, i) => {
      const x = padX + step * i;
      const y = padY + (1 - (v - min) / range) * (height - padY * 2);
      return {
        cx: x,
        cy: y,
        scanId: this.points[i].id,
        title: `${this.points[i].name} · ${this.formatMoney(v)}`,
      };
    });
    const polyline = dots.map((d) => `${d.cx},${d.cy}`).join(' ');
    return { polyline, dots, width, height };
  }

  formatMoney(n) {
    const v = Number(n) || 0;
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
    return `$${Math.round(v)}`;
  }

  handleDotClick(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    this[NavigationMixin.Navigate]({
      type: 'standard__recordPage',
      attributes: { recordId: id, objectApiName: 'ForensicScan__c', actionName: 'view' },
    });
  }
}
