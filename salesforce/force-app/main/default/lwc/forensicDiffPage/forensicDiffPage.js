import { LightningElement, wire, track } from 'lwc';
import { NavigationMixin, CurrentPageReference } from 'lightning/navigation';
import getLatestDiff from '@salesforce/apex/ForensicDiffController.getLatestDiff';

/**
 * "What's changed" — full forensic diff page.
 * Matches the SaaS /forensics/diff page exactly:
 *   - Back link
 *   - Title + subtitle
 *   - NET CHANGE card (big delta + from/to totals + timestamps)
 *   - 4 sections (New / Escalated / Resolved / Improved) with rows or "None."
 */
export default class ForensicDiffPage extends NavigationMixin(LightningElement) {
  data;
  error;
  loading = true;
  @track connectedOrgId = null;

  @wire(CurrentPageReference)
  wirePageRef(pageRef) {
    if (!pageRef) return;
    this.connectedOrgId = pageRef.state?.c__connectedOrgId || pageRef.state?.connectedOrgId || null;
  }

  @wire(getLatestDiff, { connectedOrgId: '$connectedOrgId' })
  wireDiff(result) {
    this.loading = false;
    if (result.data !== undefined) {
      this.data = result.data;
      if (!result.data) this.error = 'Only one forensic scan exists — need at least two to compare.';
    } else if (result.error) {
      this.error = result.error.body?.message || result.error.message;
    }
  }

  get isLoading() { return this.loading; }
  get hasError() { return !this.loading && Boolean(this.error); }
  get hasData() { return !this.loading && !this.error && this.data; }

  // ── Net Change header card ──
  get netDeltaUsd() { return this.data?.netDeltaUsd || 0; }
  get netDeltaLabel() {
    const v = Math.abs(this.netDeltaUsd);
    const arrow = this.netDeltaUsd > 0 ? '↑ ' : this.netDeltaUsd < 0 ? '↓ ' : '';
    return arrow + this.fmt(v);
  }
  get netDeltaClass() {
    if (this.netDeltaUsd > 1) return 'op-wc__net-delta op-wc__net-delta--bad';
    if (this.netDeltaUsd < -1) return 'op-wc__net-delta op-wc__net-delta--good';
    return 'op-wc__net-delta';
  }
  get fromToLabel() {
    const from = this.data?.fromTotalUsd || 0;
    const to = this.data?.toTotalUsd || 0;
    const pct = this.data?.netDeltaPct || 0;
    const pctStr = from > 0 ? ` (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)` : '';
    return `From ${this.fmt(from)} → To ${this.fmt(to)}${pctStr}`;
  }
  get fromTimestamp() { return this.formatFull(this.data?.fromScan?.completedAt); }
  get toTimestamp() { return this.formatFull(this.data?.toScan?.completedAt); }

  // ── Sections (computed enriched rows) ──
  get newSection() {
    return {
      title: 'New findings',
      sub: 'Appeared in this scan; were not present last time.',
      iconName: 'utility:sparkle',
      iconClass: 'op-wc__sec-icon op-wc__sec-icon--rose',
      borderClass: 'op-wc__section op-wc__section--rose',
      count: this.data?.summary?.newCount || 0,
      sumLabel: this.fmt(this.data?.summary?.newTotalUsd || 0),
      rows: (this.data?.newFindings || []).map((f) => ({
        ...f,
        primary: this.fmt(f.gapUsd),
        primaryClass: 'op-wc__row-primary op-wc__row-primary--rose',
        secondary: null,
      })),
    };
  }
  get escalatedSection() {
    return {
      title: 'Escalated',
      sub: 'Same record, gap got bigger.',
      iconName: 'utility:trending',
      iconClass: 'op-wc__sec-icon op-wc__sec-icon--amber',
      borderClass: 'op-wc__section op-wc__section--amber',
      count: this.data?.summary?.escalatedCount || 0,
      sumLabel: `+${this.fmt(this.data?.summary?.escalatedTotalUsd || 0)}`,
      rows: (this.data?.escalated || []).map((f) => ({
        ...f,
        primary: `+${this.fmt(f.deltaUsd)}`,
        primaryClass: 'op-wc__row-primary op-wc__row-primary--amber',
        secondary: `${this.fmt(f.prevGapUsd)} → ${this.fmt(f.gapUsd)}`,
      })),
    };
  }
  get resolvedSection() {
    return {
      title: 'Resolved',
      sub: 'Were findings last scan; gone this scan. Good work.',
      iconName: 'utility:check',
      iconClass: 'op-wc__sec-icon op-wc__sec-icon--emerald',
      borderClass: 'op-wc__section op-wc__section--emerald',
      count: this.data?.summary?.resolvedCount || 0,
      sumLabel: this.fmt(this.data?.summary?.resolvedTotalUsd || 0),
      rows: (this.data?.resolved || []).map((f) => ({
        ...f,
        primary: this.fmt(f.gapUsd),
        primaryClass: 'op-wc__row-primary op-wc__row-primary--emerald',
        secondary: null,
      })),
    };
  }
  get improvedSection() {
    return {
      title: 'Improved',
      sub: 'Same record, gap got smaller. Partial recovery.',
      iconName: 'utility:trending',
      iconClass: 'op-wc__sec-icon op-wc__sec-icon--sky op-wc__sec-icon--down',
      borderClass: 'op-wc__section op-wc__section--sky',
      count: this.data?.summary?.improvedCount || 0,
      sumLabel: `-${this.fmt(this.data?.summary?.improvedTotalUsd || 0)}`,
      rows: (this.data?.improved || []).map((f) => ({
        ...f,
        primary: this.fmt(f.deltaUsd), // deltaUsd is negative
        primaryClass: 'op-wc__row-primary op-wc__row-primary--sky',
        secondary: `${this.fmt(f.prevGapUsd)} → ${this.fmt(f.gapUsd)}`,
      })),
    };
  }

  get sections() {
    const all = [this.newSection, this.escalatedSection, this.resolvedSection, this.improvedSection];
    return all.map((s) => ({ ...s, isEmpty: s.count === 0 }));
  }

  // ── Actions ──
  handleBack(event) {
    event.preventDefault();
    this[NavigationMixin.Navigate]({
      type: 'standard__navItemPage',
      attributes: { apiName: 'OrgPrism_Dashboard' },
    });
  }
  handleRowClick(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    this[NavigationMixin.Navigate]({
      type: 'standard__recordPage',
      attributes: { recordId: id, objectApiName: 'ForensicFinding__c', actionName: 'view' },
    });
  }

  // ── Utilities ──
  fmt(n) {
    const v = Number(n) || 0;
    const abs = Math.abs(v);
    const sign = v < 0 ? '-' : '';
    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
    if (abs < 1) return '$0';
    return `${sign}$${Math.round(abs).toLocaleString()}`;
  }
  formatFull(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString();
  }
}
