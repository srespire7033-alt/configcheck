import { LightningElement, wire, track } from 'lwc';
import { NavigationMixin, CurrentPageReference } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import getAllIssues from '@salesforce/apex/IssuesController.getAllIssues';
import bulkUpdateStatus from '@salesforce/apex/IssuesController.bulkUpdateStatus';

const SEVERITY_OPTIONS = ['Critical', 'Warning', 'Info'];
const STATUS_OPTIONS = ['Open', 'Acknowledged', 'Resolved'];
/** Phase 22q — initial preview rows before "View all" expands the list. */
const INITIAL_VISIBLE = 8;

export default class AllIssuesPanel extends NavigationMixin(LightningElement) {
  @track issues;
  @track error;
  @track loading = true;
  @track searchTerm = '';
  @track severityFilters = []; // empty = all
  @track statusFilters = [];   // empty = all
  @track selectedIds = new Set();
  @track openDetailId = null;
  @track saving = false;
  @track showAll = false;
  /** Phase 22w — scope all-issues list to the active Connected Org. */
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

  @wire(getAllIssues, {
    severityFilters: '$severityFilters',
    statusFilters: '$statusFilters',
    search: '$searchTerm',
    connectedOrgId: '$connectedOrgId',
  })
  wireData(result) {
    this.wiredResult = result;
    this.loading = false;
    if (result.data) {
      this.issues = result.data;
      // Drop selections that no longer match the current filter
      const keep = new Set(this.issues.map((i) => i.id));
      this.selectedIds = new Set(Array.from(this.selectedIds).filter((id) => keep.has(id)));
      this.error = undefined;
    } else if (result.error) {
      this.error = result.error.body?.message || result.error.message;
    }
  }

  get isLoading() { return this.loading; }
  get hasError() { return !this.loading && Boolean(this.error); }
  get hasIssues() { return !this.loading && !this.error && (this.issues?.length || 0) > 0; }
  get isEmpty() { return !this.loading && !this.error && (!this.issues || this.issues.length === 0); }

  get countLabel() {
    const n = this.issues?.length || 0;
    return n === 1 ? '1 issue' : `${n} issues`;
  }

  get allRows() {
    return (this.issues || []).map((i) => {
      const sev = (i.severity || '').toLowerCase();
      const status = (i.status || 'Open').toLowerCase().replace(/\s+/g, '-');
      return {
        ...i,
        sevChipClass: `op-aip__sev op-aip__sev--${sev}`,
        statusChipClass: `op-aip__status op-aip__status--${status}`,
        statusLabel: (i.status || 'Open').toUpperCase(),
        checked: this.selectedIds.has(i.id),
      };
    });
  }
  /** Phase 22q — show first N rows; toggle expands to the full list. */
  get rows() {
    return this.showAll ? this.allRows : this.allRows.slice(0, INITIAL_VISIBLE);
  }
  get isPaginated() {
    return this.allRows.length > INITIAL_VISIBLE;
  }
  get toggleLabel() {
    return this.showAll ? 'Show less' : `View all ${this.allRows.length} issues`;
  }
  toggleShowAll() { this.showAll = !this.showAll; }

  // ── Toolbar ──
  severityOptions = SEVERITY_OPTIONS.map((s) => ({ label: s, value: s }));
  statusOptions = STATUS_OPTIONS.map((s) => ({ label: s, value: s }));

  get sevPills() {
    return SEVERITY_OPTIONS.map((s) => ({
      label: s,
      value: s,
      pillClass: this.severityFilters.includes(s)
        ? `op-aip__pill op-aip__pill--active op-aip__pill--${s.toLowerCase()}`
        : 'op-aip__pill',
    }));
  }
  get statusPills() {
    return STATUS_OPTIONS.map((s) => ({
      label: s,
      value: s,
      pillClass: this.statusFilters.includes(s)
        ? 'op-aip__pill op-aip__pill--active op-aip__pill--status'
        : 'op-aip__pill',
    }));
  }

  handleSearch(event) { this.searchTerm = event.target.value; }
  toggleSev(event) {
    const v = event.currentTarget.dataset.value;
    const next = new Set(this.severityFilters);
    next.has(v) ? next.delete(v) : next.add(v);
    this.severityFilters = Array.from(next);
  }
  toggleStatus(event) {
    const v = event.currentTarget.dataset.value;
    const next = new Set(this.statusFilters);
    next.has(v) ? next.delete(v) : next.add(v);
    this.statusFilters = Array.from(next);
  }

  // ── Selection ──
  handleCheckRow(event) {
    const id = event.currentTarget.dataset.id;
    const next = new Set(this.selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    this.selectedIds = next;
  }
  handleCheckAll() {
    if (this.selectedCount === (this.issues?.length || 0)) {
      this.selectedIds = new Set();
    } else {
      this.selectedIds = new Set((this.issues || []).map((i) => i.id));
    }
  }
  get allChecked() {
    return this.hasIssues && this.selectedCount === this.issues.length;
  }
  get selectedCount() { return this.selectedIds.size; }
  get hasSelection() { return this.selectedCount > 0; }
  get selectedLabel() { return `${this.selectedCount} selected`; }

  // ── Bulk actions ──
  async bulkApply(status) {
    if (!this.hasSelection) return;
    this.saving = true;
    try {
      await bulkUpdateStatus({ findingIds: Array.from(this.selectedIds), status });
      this.dispatchEvent(new ShowToastEvent({
        title: 'Done',
        message: `${this.selectedCount} issue(s) → ${status}`,
        variant: 'success',
      }));
      this.selectedIds = new Set();
      await refreshApex(this.wiredResult);
    } catch (e) {
      this.dispatchEvent(new ShowToastEvent({
        title: 'Bulk update failed',
        message: e.body?.message || e.message || 'Unknown error',
        variant: 'error',
      }));
    } finally {
      this.saving = false;
    }
  }
  handleBulkAck() { return this.bulkApply('Acknowledged'); }
  handleBulkResolve() { return this.bulkApply('Resolved'); }
  handleBulkNotRelevant() { return this.bulkApply('Not Relevant'); }

  // ── Open detail ──
  handleRowTitle(event) {
    // Click on issue title → full detail PAGE (not modal)
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    this[NavigationMixin.Navigate]({
      type: 'standard__recordPage',
      attributes: { recordId: id, objectApiName: 'ForensicFinding__c', actionName: 'view' },
    });
  }
  handleView(event) {
    // "View →" link → MODAL
    event.stopPropagation();
    this.openDetailId = event.currentTarget.dataset.id;
  }
  handleCloseModal() { this.openDetailId = null; }
  async handleStatusChanged() { await refreshApex(this.wiredResult); }
  get isModalOpen() { return Boolean(this.openDetailId); }
}
