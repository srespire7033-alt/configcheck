import { LightningElement, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import getRecoveryQueue from '@salesforce/apex/DashboardController.getRecoveryQueue';

const STATUS_CLASS = {
  Pending: 'op-rq__group--pending',
  Approved: 'op-rq__group--approved',
  Committed: 'op-rq__group--committed',
  Rejected: 'op-rq__group--rejected',
  Expired: 'op-rq__group--expired',
};

/**
 * Recovery Queue — Plan tab. Shows RecoveryAction__c records grouped
 * by approval status, each group with the rolled-up projected $ and
 * a list of individual actions. Click an action to open the underlying
 * ForensicFinding__c record where consultants can approve / commit
 * via the existing findingDetail LWC.
 *
 * The state machine itself (Pending → Approved → Committed) lives in
 * RecoveryActionService. This queue is read-only — it just surfaces
 * what's in the pipeline.
 */
export default class RecoveryQueue extends NavigationMixin(LightningElement) {
  data;
  error;
  loading = true;

  @wire(getRecoveryQueue)
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
      actions: g.actions.map((a) => ({
        ...a,
        projectedFmt: this.formatMoney(a.projectedUsd),
        verifiedBadge: a.commitVerified === true ? '✓ verified' : a.commitVerified === false ? '⚠ failed' : '',
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
    const findingId = event.currentTarget.dataset.id;
    if (!findingId) return;
    this[NavigationMixin.Navigate]({
      type: 'standard__recordPage',
      attributes: { recordId: findingId, objectApiName: 'ForensicFinding__c', actionName: 'view' },
    });
  }
}
