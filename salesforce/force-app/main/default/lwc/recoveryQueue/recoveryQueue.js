import { LightningElement, wire, track } from 'lwc';
import { NavigationMixin, CurrentPageReference } from 'lightning/navigation';
import { refreshApex } from '@salesforce/apex';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getRecoveryQueue from '@salesforce/apex/DashboardController.getRecoveryQueue';
import bulkReverify from '@salesforce/apex/RecoveryActionService.bulkReverify';
import bulkApprove from '@salesforce/apex/RecoveryActionService.bulkApprove';
import bulkMarkCommitted from '@salesforce/apex/RecoveryActionService.bulkMarkCommitted';

const STATUS_CLASS = {
  Pending: 'op-rq__group--pending',
  Approved: 'op-rq__group--approved',
  Committed: 'op-rq__group--committed',
  Rejected: 'op-rq__group--rejected',
  Expired: 'op-rq__group--expired',
};

// Which bulk action applies to which source state. Drives selection
// checkboxes and the toolbar buttons.
const BULK_STATES = new Set(['Pending', 'Approved', 'Committed']);

/**
 * Recovery Queue — Plan tab. RecoveryAction__c records grouped by
 * approval status. Phase 14c adds multi-select + bulk approve / bulk
 * commit. Bulk commit triggers auto-verify (Phase 14a) so the
 * Committed badges populate in one round-trip.
 *
 * Selection lives in `selectedIds` (a Set), reset on each refresh.
 * The toolbar buttons surface counts per bulk-able status group.
 */
export default class RecoveryQueue extends NavigationMixin(LightningElement) {
  data;
  error;
  loading = true;
  wiredResult;
  @track reverifying = false;
  @track approving = false;
  @track committing = false;
  // Set<string> of selected action ids. Use a plain object for
  // reactivity (Sets don't trigger LWC re-render on add/delete).
  @track selectedIds = {};
  /** Phase 22w — scope recovery queue to the active Connected Org. */
  @track connectedOrgId = null;

  @wire(CurrentPageReference)
  wirePageRef(pageRef) {
    if (!pageRef) return;
    this.connectedOrgId = pageRef.state?.c__connectedOrgId
      || pageRef.state?.connectedOrgId || null;
  }

  @wire(getRecoveryQueue, { connectedOrgId: '$connectedOrgId' })
  wireData(result) {
    this.wiredResult = result;
    this.loading = false;
    if (result.data) {
      this.data = result.data;
      this.error = undefined;
      // Clear stale selections on refresh.
      this.selectedIds = {};
    } else if (result.error) {
      this.error = result.error.body?.message || result.error.message;
    }
  }

  // ── Bulk action helpers ──
  selectedIdsArray() {
    return Object.keys(this.selectedIds).filter((k) => this.selectedIds[k]);
  }

  selectedIdsForStatus(status) {
    if (!this.data?.groups) return [];
    const grp = this.data.groups.find((g) => g.status === status);
    if (!grp) return [];
    return grp.actions
      .filter((a) => this.selectedIds[a.id])
      .map((a) => a.id);
  }

  get committedActionIds() {
    if (!this.data?.groups) return [];
    const committed = this.data.groups.find((g) => g.status === 'Committed');
    return committed ? committed.actions.map((a) => a.id) : [];
  }

  get hasCommittedActions() { return this.committedActionIds.length > 0; }
  get pendingSelectedCount() { return this.selectedIdsForStatus('Pending').length; }
  get approvedSelectedCount() { return this.selectedIdsForStatus('Approved').length; }
  get committedSelectedCount() { return this.selectedIdsForStatus('Committed').length; }

  get hasPendingSelection() { return this.pendingSelectedCount > 0; }
  get hasApprovedSelection() { return this.approvedSelectedCount > 0; }
  get hasCommittedSelection() { return this.committedSelectedCount > 0; }

  get approveButtonLabel() {
    if (this.approving) return 'Approving…';
    const n = this.pendingSelectedCount;
    return `Approve ${n} selected`;
  }

  get commitButtonLabel() {
    if (this.committing) return 'Committing…';
    const n = this.approvedSelectedCount;
    return `Commit ${n} selected`;
  }

  get reverifyButtonLabel() {
    if (this.reverifying) return 'Re-verifying…';
    const sel = this.committedSelectedCount;
    if (sel > 0) return `Re-verify ${sel} selected`;
    const n = this.committedActionIds.length;
    return `Re-verify all ${n} committed`;
  }

  // ── Selection handlers ──
  handleSelectAction(event) {
    const id = event.target.dataset.id;
    if (!id) return;
    // Reassign the whole object so LWC sees the change.
    this.selectedIds = { ...this.selectedIds, [id]: event.target.checked };
  }

  handleSelectGroup(event) {
    const status = event.target.dataset.status;
    if (!this.data?.groups) return;
    const grp = this.data.groups.find((g) => g.status === status);
    if (!grp) return;
    const next = { ...this.selectedIds };
    grp.actions.forEach((a) => { next[a.id] = event.target.checked; });
    this.selectedIds = next;
  }

  // ── Bulk action handlers ──
  async handleApproveSelected() {
    await this.runBulk(
      bulkApprove,
      this.selectedIdsForStatus('Pending'),
      'approving',
      'Approved',
      (r) => `${r.transitioned} approved` +
        (r.skipped ? ` · ${r.skipped} skipped` : '') +
        (r.failed ? ` · ${r.failed} failed` : ''),
    );
  }

  async handleCommitSelected() {
    await this.runBulk(
      bulkMarkCommitted,
      this.selectedIdsForStatus('Approved'),
      'committing',
      'Committed',
      (r) => {
        const verdicts = r.verdicts || [];
        const verified = verdicts.filter((v) => v.status === 'verified').length;
        const regressed = verdicts.filter((v) => v.status === 'regressed').length;
        const manual = verdicts.filter((v) => v.status === 'manual').length;
        return (
          `${r.transitioned} committed` +
          (verified ? ` · ${verified} verified` : '') +
          (regressed ? ` · ${regressed} regressed` : '') +
          (manual ? ` · ${manual} need manual verify` : '')
        );
      },
    );
  }

  async handleReverifyAll() {
    // If anything in Committed is selected, re-verify only the
    // selection; otherwise fall back to all committed actions.
    const ids = this.hasCommittedSelection
      ? this.selectedIdsForStatus('Committed')
      : this.committedActionIds;
    if (!ids.length || this.reverifying) return;
    this.reverifying = true;
    try {
      const result = await bulkReverify({ actionIds: ids });
      const { stillResolved = 0, regressed = 0, skipped = 0, reverified = 0 } = result;
      const variant = regressed > 0 ? 'warning' : 'success';
      this.dispatchEvent(new ShowToastEvent({
        title: `Re-verified ${reverified} action${reverified === 1 ? '' : 's'}`,
        message:
          `${stillResolved} still resolved · ${regressed} regressed` +
          (skipped > 0 ? ` · ${skipped} need manual verification` : ''),
        variant,
        mode: 'sticky',
      }));
      if (this.wiredResult) refreshApex(this.wiredResult);
    } catch (err) {
      this.toastError('Re-verify failed', err);
    } finally {
      this.reverifying = false;
    }
  }

  async runBulk(fn, actionIds, busyFlag, verbDone, summarizer) {
    if (!actionIds.length || this[busyFlag]) return;
    this[busyFlag] = true;
    try {
      const result = await fn({ actionIds });
      const variant = (result.failed || 0) > 0 ? 'warning' : 'success';
      this.dispatchEvent(new ShowToastEvent({
        title: verbDone,
        message: summarizer(result),
        variant,
        mode: 'sticky',
      }));
      if (this.wiredResult) refreshApex(this.wiredResult);
    } catch (err) {
      this.toastError('Bulk action failed', err);
    } finally {
      this[busyFlag] = false;
    }
  }

  toastError(title, err) {
    this.dispatchEvent(new ShowToastEvent({
      title,
      message: err.body?.message || err.message || 'Unknown error',
      variant: 'error',
    }));
  }

  // ── Render helpers ──
  get isLoading() { return this.loading; }
  get hasError() { return Boolean(this.error); }
  get hasData() { return !this.loading && !this.error && this.data?.totalCount > 0; }
  get isEmpty() { return !this.loading && !this.error && !this.data?.totalCount; }

  get totalProjectedFmt() { return this.formatMoney(this.data?.totalProjectedUsd); }
  get totalCount() { return this.data?.totalCount || 0; }

  get groups() {
    if (!this.data?.groups) return [];
    return this.data.groups.map((g) => ({
      status: g.status,
      count: g.count,
      countLabel: g.count === 1 ? '1 action' : `${g.count} actions`,
      projectedFmt: this.formatMoney(g.projectedUsd),
      groupClass: `op-rq__group ${STATUS_CLASS[g.status] || ''}`,
      selectable: BULK_STATES.has(g.status),
      actions: g.actions.map((a) => ({
        ...a,
        projectedFmt: this.formatMoney(a.projectedUsd),
        verifiedBadge: a.commitVerified === true ? '✓ verified' : a.commitVerified === false ? '⚠ failed' : '',
        // Phase 15a — show verification detail inline when failed.
        // Auto-expand on regressions so the consultant sees what
        // broke without an extra click.
        showVerifyDetail: a.commitVerified === false
          && (a.verificationMessage || a.expectedValue || a.actualValue),
        verifyExpectedLine:
          a.expectedValue || a.actualValue
            ? `Expected: ${a.expectedValue || '—'} · Actual: ${a.actualValue || '—'}`
            : '',
        selected: Boolean(this.selectedIds[a.id]),
      })),
    }));
  }

  formatMoney(n) {
    const v = Number(n) || 0;
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
    return `$${Math.round(v)}`;
  }

  handleActionClick(event) {
    // Don't navigate when the click landed on the checkbox itself.
    if (event.target?.type === 'checkbox') return;
    const findingId = event.currentTarget.dataset.id;
    if (!findingId) return;
    this[NavigationMixin.Navigate]({
      type: 'standard__recordPage',
      attributes: { recordId: findingId, objectApiName: 'ForensicFinding__c', actionName: 'view' },
    });
  }
}
