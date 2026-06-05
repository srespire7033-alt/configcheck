import { LightningElement, wire, track } from 'lwc';
import { NavigationMixin, CurrentPageReference } from 'lightning/navigation';
import { refreshApex } from '@salesforce/apex';
import getLatestDiff from '@salesforce/apex/ForensicDiffController.getLatestDiff';

/**
 * "Since your last scan" — exact parity with the SaaS card.
 *
 * Header:
 *   icon + "Since your last scan" + "Jun 2 → Jun 2"
 *   right side: net delta $ with arrow + sub-label
 *     ("no net change" / "revenue leaking +X% more" / "recovered X%")
 *
 * 4 tiles: NEW (rose) / ESCALATED (amber) / RESOLVED (emerald) / IMPROVED (sky)
 * Each shows count + dollar value, dims when count = 0.
 *
 * Footer: "See full diff →" navigates to OrgPrism_ForensicDiff Lightning page.
 *
 * Hides itself entirely if fewer than 2 scans exist.
 */
export default class SinceLastScanCard extends NavigationMixin(LightningElement) {
  data;
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

  @wire(getLatestDiff, { connectedOrgId: '$connectedOrgId' })
  wireDiff(result) {
    this.wiredResult = result;
    this.loading = false;
    if (result.data !== undefined) {
      this.data = result.data;
      this.error = undefined;
    } else if (result.error) {
      this.error = result.error.body?.message || result.error.message;
    }
  }

  get shouldRender() {
    return !this.loading && !this.error && this.data;
  }

  get summary() {
    return this.data?.summary || {
      newCount: 0, newTotalUsd: 0, escalatedCount: 0, escalatedTotalUsd: 0,
      resolvedCount: 0, resolvedTotalUsd: 0, improvedCount: 0, improvedTotalUsd: 0,
    };
  }

  get gotWorse() { return (this.data?.netDeltaUsd || 0) > 0; }
  get noChange() { return Math.abs(this.data?.netDeltaUsd || 0) < 1; }
  get gotBetter() { return (this.data?.netDeltaUsd || 0) < 0; }

  get trendIcon() { return 'utility:trending'; }
  get iconWrapClass() {
    return this.gotWorse ? 'op-sls__icon-wrap op-sls__icon-wrap--bad'
                          : 'op-sls__icon-wrap op-sls__icon-wrap--good';
  }
  get iconColorClass() {
    if (this.gotBetter) return 'op-sls__icon op-sls__icon--down';
    return this.gotWorse ? 'op-sls__icon op-sls__icon--bad' : 'op-sls__icon op-sls__icon--good';
  }

  get fromDate() { return this.formatShort(this.data?.fromScan?.completedAt); }
  get toDate() { return this.formatShort(this.data?.toScan?.completedAt); }

  get netDeltaLabel() {
    const v = Math.abs(this.data?.netDeltaUsd || 0);
    const arrow = this.noChange ? '' : (this.gotWorse ? '↑ ' : '↓ ');
    return arrow + this.formatMoney(v);
  }
  get netDeltaClass() {
    if (this.noChange) return 'op-sls__delta op-sls__delta--neutral';
    return this.gotWorse ? 'op-sls__delta op-sls__delta--bad'
                          : 'op-sls__delta op-sls__delta--good';
  }
  get netDeltaSubLabel() {
    if (this.noChange) return 'no net change';
    const pct = Math.abs(this.data?.netDeltaPct || 0).toFixed(1);
    return this.gotWorse ? `revenue leaking +${pct}% more` : `recovered ${pct}%`;
  }

  get newTileClass() {
    const base = 'op-sls__tile op-sls__tile--rose';
    return this.summary.newCount === 0 ? `${base} op-sls__tile--dim` : base;
  }
  get escalatedTileClass() {
    const base = 'op-sls__tile op-sls__tile--amber';
    return this.summary.escalatedCount === 0 ? `${base} op-sls__tile--dim` : base;
  }
  get resolvedTileClass() {
    const base = 'op-sls__tile op-sls__tile--emerald';
    return this.summary.resolvedCount === 0 ? `${base} op-sls__tile--dim` : base;
  }
  get improvedTileClass() {
    const base = 'op-sls__tile op-sls__tile--sky';
    return this.summary.improvedCount === 0 ? `${base} op-sls__tile--dim` : base;
  }

  get newTotalFmt() { return this.formatMoney(this.summary.newTotalUsd); }
  get escalatedTotalFmt() { return this.formatMoney(this.summary.escalatedTotalUsd); }
  get resolvedTotalFmt() { return this.formatMoney(this.summary.resolvedTotalUsd); }
  get improvedTotalFmt() { return this.formatMoney(this.summary.improvedTotalUsd); }

  handleSeeFullDiff(event) {
    event.preventDefault();
    this[NavigationMixin.Navigate]({
      type: 'standard__navItemPage',
      attributes: { apiName: 'OrgPrism_ForensicDiff' },
    });
  }

  formatMoney(n) {
    const v = Number(n) || 0;
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
    if (v < 1) return '$0';
    return `$${Math.round(v).toLocaleString()}`;
  }
  formatShort(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
}
