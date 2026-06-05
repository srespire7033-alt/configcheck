import { LightningElement, api, wire, track } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import getIssueDetail from '@salesforce/apex/IssuesController.getIssueDetail';
import updateStatus from '@salesforce/apex/IssuesController.updateStatus';

/**
 * Issue Detail Modal — mirrors SaaS exactly:
 *   header: severity chip + detector code + status dropdown + ×
 *   key facts grid (4 cells)
 *   tabs: Issue Details / Fix & Remediation
 *   affected records list with filter + open-in-Salesforce link
 *   footer actions: Mark Fixed / False Positive / Not Relevant / Close
 *
 * Fires `closeissuemodal` when user closes.
 */
const STATUS_OPTIONS = [
  { label: 'Open',           value: 'Open' },
  { label: 'Acknowledged',   value: 'Acknowledged' },
  { label: 'Resolved',       value: 'Resolved' },
  { label: 'Ignored',        value: 'Ignored' },
  { label: 'False Positive', value: 'False Positive' },
  { label: 'Not Relevant',   value: 'Not Relevant' },
];

export default class IssueDetailModal extends NavigationMixin(LightningElement) {
  @api issueId;
  @track data;
  @track error;
  @track loading = true;
  @track activeTab = 'details'; // 'details' | 'fix'
  @track filterTerm = '';
  @track saving = false;
  wiredResult;

  statusOptions = STATUS_OPTIONS;

  @wire(getIssueDetail, { findingId: '$issueId' })
  wireData(result) {
    this.wiredResult = result;
    this.loading = false;
    if (result.data) {
      this.data = result.data;
      this.error = undefined;
    } else if (result.error) {
      this.error = result.error.body?.message || result.error.message;
    }
  }

  get isLoading() { return this.loading; }
  get hasError() { return !this.loading && Boolean(this.error); }
  get hasData() { return !this.loading && !this.error && this.data; }

  // ── Header ──
  get severityChipClass() {
    const sev = (this.data?.severity || '').toLowerCase();
    return `op-im__sev-chip op-im__sev-chip--${sev}`;
  }
  get severityLabel() { return (this.data?.severity || '').toLowerCase(); }
  get headerIconWrapClass() {
    const sev = (this.data?.severity || '').toLowerCase();
    return `op-im__head-icon-wrap op-im__head-icon-wrap--${sev}`;
  }
  get headerIconName() {
    const sev = this.data?.severity;
    if (sev === 'Critical') return 'utility:error';
    if (sev === 'Warning') return 'utility:warning';
    return 'utility:info';
  }
  get headerIconClass() {
    const sev = (this.data?.severity || '').toLowerCase();
    return `op-im__head-icon op-im__head-icon--${sev}`;
  }

  // ── Key facts ──
  get affectedLabel() {
    const n = this.data?.affectedRecords?.length || 0;
    return n === 1 ? '1 record' : `${n} records`;
  }
  get revenueLabel() {
    const v = Number(this.data?.gapUsd) || 0;
    if (v < 1) return '—';
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
    return `$${Math.round(v).toLocaleString()}`;
  }
  get severityFactClass() {
    const sev = (this.data?.severity || '').toLowerCase();
    return `op-im__fact-val op-im__fact-val--${sev}`;
  }

  // ── Tabs ──
  get isDetailsActive() { return this.activeTab === 'details'; }
  get isFixActive() { return this.activeTab === 'fix'; }
  get detailsTabClass() {
    return this.activeTab === 'details' ? 'op-im__tab op-im__tab--active' : 'op-im__tab';
  }
  get fixTabClass() {
    return this.activeTab === 'fix' ? 'op-im__tab op-im__tab--active' : 'op-im__tab';
  }
  handleTab(event) { this.activeTab = event.currentTarget.dataset.tab; }

  // ── Affected records ──
  get filteredAffected() {
    const list = this.data?.affectedRecords || [];
    if (!this.filterTerm) return list;
    const q = this.filterTerm.toLowerCase();
    return list.filter((r) => (r.name || '').toLowerCase().includes(q)
                            || (r.objectType || '').toLowerCase().includes(q));
  }
  get affectedCountLabel() {
    return `Affected Records (${this.data?.affectedRecords?.length || 0})`;
  }
  handleFilterInput(event) { this.filterTerm = event.target.value; }

  handleAffectedOpen(event) {
    const id = event.currentTarget.dataset.id;
    const type = event.currentTarget.dataset.type;
    if (!id) return;
    this[NavigationMixin.Navigate]({
      type: 'standard__recordPage',
      attributes: { recordId: id, objectApiName: type, actionName: 'view' },
    });
  }

  // ── Status updates ──
  async handleStatusChange(event) {
    await this.applyStatus(event.detail.value);
  }
  async applyStatus(newStatus) {
    if (!newStatus || newStatus === this.data?.status) return;
    this.saving = true;
    try {
      await updateStatus({ findingId: this.issueId, status: newStatus });
      this.dispatchEvent(new ShowToastEvent({
        title: 'Status updated',
        message: `Marked as ${newStatus}`,
        variant: 'success',
      }));
      this.dispatchEvent(new CustomEvent('statuschanged', {
        detail: { issueId: this.issueId, status: newStatus },
      }));
      await refreshApex(this.wiredResult);
    } catch (e) {
      this.dispatchEvent(new ShowToastEvent({
        title: 'Update failed',
        message: e.body?.message || e.message || 'Unknown error',
        variant: 'error',
      }));
    } finally {
      this.saving = false;
    }
  }
  handleMarkFixed() { return this.applyStatus('Resolved'); }
  handleFalsePositive() { return this.applyStatus('False Positive'); }
  handleNotRelevant() { return this.applyStatus('Not Relevant'); }

  // ── Close ──
  handleClose() { this.dispatchEvent(new CustomEvent('closeissuemodal')); }
  handleBackdrop(event) {
    if (event.target === event.currentTarget) this.handleClose();
  }

  // ── Accessibility: keyboard handling for modal ──
  connectedCallback() {
    this._keydownHandler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.handleClose();
      }
    };
    window.addEventListener('keydown', this._keydownHandler);
  }
  disconnectedCallback() {
    if (this._keydownHandler) window.removeEventListener('keydown', this._keydownHandler);
  }
  renderedCallback() {
    // Autofocus the close button on first render so screen-readers announce the dialog
    if (this._focused) return;
    const closeBtn = this.template.querySelector('.op-im__close');
    if (closeBtn) { closeBtn.focus(); this._focused = true; }
  }
}
