import { LightningElement, wire, track } from 'lwc';
import { CurrentPageReference } from 'lightning/navigation';
import { refreshApex } from '@salesforce/apex';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getTopIssueGroups from '@salesforce/apex/IssuesController.getTopIssueGroups';
import bulkStage from '@salesforce/apex/RecoveryActionService.bulkStage';
import markGroupNotApplicable from '@salesforce/apex/IssuesController.markGroupNotApplicable';

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
  /** Phase 24y-D — which group's button is mid-action (disables siblings). */
  @track busyKey = null;
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
      // Phase 24y-B — trend chip. Priority: new > resolved > steady.
      // Skipped entirely on the first scan (no prior to compare against).
      const newCount = Number(g.newCount) || 0;
      const resolvedCount = Number(g.resolvedCount) || 0;
      let trendLabel = '';
      let trendClass = '';
      if (g.isFirstScan) {
        trendLabel = 'first scan';
        trendClass = 'op-tip__trend op-tip__trend--neutral';
      } else if (newCount > 0) {
        trendLabel = `↑ +${newCount} new`;
        trendClass = 'op-tip__trend op-tip__trend--up';
      } else if (resolvedCount > 0) {
        trendLabel = `↓ ${resolvedCount} fixed`;
        trendClass = 'op-tip__trend op-tip__trend--down';
      } else {
        trendLabel = '→ no change';
        trendClass = 'op-tip__trend op-tip__trend--neutral';
      }
      const findingCount = (g.findingIds || []).length;
      const canStage = findingCount > 0 && !this.busyKey;
      const canMarkNA = !!g.leadDetectorId && !!this.connectedOrgId && !this.busyKey;
      return {
        ...g,
        trendLabel,
        trendClass,
        canStage,
        canMarkNA,
        stageLabel: `Stage all ${findingCount} fixes`,
        markNALabel: g.leadDetectorId ? `Mark ${g.leadDetectorId} not applicable` : 'Mark not applicable',
        isBusy: this.busyKey === g.groupKey,
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

  // ── Phase 24y-D — inline bulk actions on Top Issues cards ──
  async handleStageAll(e) {
    e.stopPropagation();
    const key = e.currentTarget.dataset.key;
    const g = (this.groups || []).find(x => x.groupKey === key);
    if (!g || !g.findingIds || g.findingIds.length === 0) return;
    this.busyKey = key;
    try {
      const result = await bulkStage({ findingIds: g.findingIds });
      const staged = result?.created ?? 0;
      const skipped = result?.skipped ?? 0;
      this.dispatchEvent(new ShowToastEvent({
        title: `${staged} fix${staged === 1 ? '' : 'es'} staged`,
        message: skipped > 0 ? `${skipped} skipped (already staged or auto-resolved)` : 'See Recovery Queue to approve and commit.',
        variant: staged > 0 ? 'success' : 'info',
      }));
      if (this.wiredResult) await refreshApex(this.wiredResult);
    } catch (err) {
      this.dispatchEvent(new ShowToastEvent({
        title: 'Stage failed',
        message: err?.body?.message || err?.message || String(err),
        variant: 'error',
      }));
    } finally {
      this.busyKey = null;
    }
  }

  async handleMarkNA(e) {
    e.stopPropagation();
    const key = e.currentTarget.dataset.key;
    const g = (this.groups || []).find(x => x.groupKey === key);
    if (!g || !g.leadDetectorId || !this.connectedOrgId) return;
    const reason = window.prompt(
      `Mark ${g.leadDetectorId} as Not Applicable for this org? Future scans will skip it.\n\nReason (optional, for audit):`,
      ''
    );
    if (reason === null) return; // user cancelled
    this.busyKey = key;
    try {
      await markGroupNotApplicable({
        connectedOrgId: this.connectedOrgId,
        detectorId: g.leadDetectorId,
        reason: reason || 'Marked from Top Issues card',
      });
      this.dispatchEvent(new ShowToastEvent({
        title: `${g.leadDetectorId} marked Not Applicable`,
        message: 'Next scan will skip this detector for this org. Change in Setup → Custom Metadata Types → Detector Override.',
        variant: 'success',
      }));
      if (this.wiredResult) await refreshApex(this.wiredResult);
    } catch (err) {
      this.dispatchEvent(new ShowToastEvent({
        title: 'Mark Not Applicable failed',
        message: err?.body?.message || err?.message || String(err),
        variant: 'error',
      }));
    } finally {
      this.busyKey = null;
    }
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
