import { LightningElement, wire, track } from 'lwc';
import { CurrentPageReference } from 'lightning/navigation';
import { refreshApex } from '@salesforce/apex';
import getTopIssueGroups from '@salesforce/apex/IssuesController.getTopIssueGroups';

/**
 * Top Issues to Address — top 5 grouped issue rows.
 *   Each row groups same-category findings; "N RELATED" chip when relatedCount > 1.
 *   Click anywhere → expands to show sub-rows by distinct title.
 *   "View →" link on a sub-row opens the issueDetailModal.
 *   Row title (not link) — clicking title opens the full issueDetailPage.
 */
export default class IssuesPanel extends LightningElement {
  @track groups;
  @track error;
  @track loading = true;
  @track expandedKey = null;
  @track openDetailId = null; // for modal
  /** Phase 22w — scope top-issues rollup to the active Connected Org. */
  @track connectedOrgId = null;
  wiredResult;

  @wire(CurrentPageReference)
  wirePageRef(pageRef) {
    if (!pageRef) return;
    this.connectedOrgId = pageRef.state?.c__connectedOrgId
      || pageRef.state?.connectedOrgId || null;
  }

  connectedCallback() { window.addEventListener('op:scan-completed', this.handleScanCompleted); }
  disconnectedCallback() { window.removeEventListener('op:scan-completed', this.handleScanCompleted); }
  handleScanCompleted = () => { if (this.wiredResult) refreshApex(this.wiredResult); };

  @wire(getTopIssueGroups, { maxGroups: 5, connectedOrgId: '$connectedOrgId' })
  wireData(result) {
    this.wiredResult = result;
    this.loading = false;
    if (result.data) {
      this.groups = result.data;
      this.error = undefined;
    } else if (result.error) {
      this.error = result.error.body?.message || result.error.message;
    }
  }

  get isLoading() { return this.loading; }
  get hasError() { return !this.loading && Boolean(this.error); }
  get hasGroups() { return !this.loading && !this.error && (this.groups?.length || 0) > 0; }
  get isEmpty() { return !this.loading && !this.error && (!this.groups || this.groups.length === 0); }

  get rows() {
    return (this.groups || []).map((g, idx) => {
      const isExpanded = this.expandedKey === g.groupKey;
      const sev = (g.severity || '').toLowerCase();
      const isMulti = (g.relatedCount || 0) > 1;
      const gap = Number(g.totalGapUsd) || 0;
      const hasGap = gap > 0;
      return {
        ...g,
        rowNumber: idx + 1,
        isExpanded,
        isMulti,
        hasGap,
        gapLabel: hasGap ? this.formatMoney(gap) + ' at risk' : '',
        borderClass: `op-tip__row op-tip__row--${sev}`,
        severityChipClass: `op-tip__sev op-tip__sev--${sev}`,
        chevronIcon: isExpanded ? 'utility:chevrondown' : 'utility:chevronright',
        affectedLabel: g.totalAffected === 1
          ? '1 unique affected'
          : `${g.totalAffected} unique affected`,
        relatedLabel: `${g.relatedCount} RELATED`,
        headlineWithCount: isMulti
          ? `${g.headlineTitle} (${g.relatedCount} related findings)`
          : g.headlineTitle,
      };
    });
  }

  // Phase 24y-A — money formatting shared by Top Issues cards.
  formatMoney(n) {
    const v = Number(n) || 0;
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`;
    return `$${Math.round(v).toLocaleString()}`;
  }

  toggleExpand(event) {
    const key = event.currentTarget.dataset.key;
    this.expandedKey = (this.expandedKey === key) ? null : key;
  }
  handleMemberClick(event) {
    event.stopPropagation();
    const id = event.currentTarget.dataset.id;
    this.openDetailId = id;
  }
  handleHeadlineClick(event) {
    event.stopPropagation();
    const id = event.currentTarget.dataset.id;
    this.openDetailId = id;
  }
  handleCloseModal() { this.openDetailId = null; }
  async handleStatusChanged() { await refreshApex(this.wiredResult); }

  get isModalOpen() { return Boolean(this.openDetailId); }
}
