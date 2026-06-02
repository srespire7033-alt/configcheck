import { LightningElement, wire, track } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getDashboardSummary from '@salesforce/apex/DashboardController.getDashboardSummary';
import getFindings from '@salesforce/apex/FindingsListController.getFindings';
import bulkHide from '@salesforce/apex/FindingsListController.bulkHide';
import bulkStage from '@salesforce/apex/RecoveryActionService.bulkStage';

/**
 * "All findings" view — flat filterable + sortable table with multi-
 * select bulk actions (Hide / Stage for recovery). This is the
 * native LWC equivalent of the SaaS Issues tab.
 *
 * Data flow:
 *   - Latest scan id from DashboardController.getDashboardSummary
 *   - Findings list from FindingsListController.getFindings(scanId)
 *   - Filter + sort applied client-side (works well up to 500
 *     findings per scan, matches the Apex LIMIT)
 *
 * Bulk actions:
 *   - Hide   → FindingsListController.bulkHide (existing Apex)
 *   - Stage  → RecoveryActionService.bulkStage (existing Apex)
 *
 * Re-uses primitives: dashboardCard, severityBadge.
 */
const SEVERITY_ORDER = { Critical: 0, Warning: 1, Info: 2 };

export default class IssuesPanel extends NavigationMixin(LightningElement) {
  wiredSummary;
  wiredFindings;
  scanId;
  rawFindings = [];
  loading = true;
  error;

  @track filter = { search: '', severity: 'all' };
  @track selectedIds = new Set();
  @track sortBy = 'gap';        // gap | severity | detector | title
  @track sortDir = 'desc';
  @track busy = false;

  @wire(getDashboardSummary)
  wireSummary(result) {
    this.wiredSummary = result;
    if (result.data?.latestScan?.Id) {
      this.scanId = result.data.latestScan.Id;
    }
  }

  @wire(getFindings, { scanId: '$scanId', includeHidden: false })
  wireFindingsData(result) {
    this.wiredFindings = result;
    this.loading = false;
    if (result.data) {
      this.rawFindings = result.data;
      this.error = undefined;
    } else if (result.error) {
      this.error = result.error.body?.message || result.error.message || 'Failed to load findings';
    }
  }

  // ─── filter + sort ───

  get filteredFindings() {
    if (!this.rawFindings) return [];
    const search = (this.filter.search || '').toLowerCase().trim();
    const sev = this.filter.severity;
    let out = this.rawFindings;
    if (sev && sev !== 'all') {
      out = out.filter((f) => (f.severity || '').toLowerCase() === sev);
    }
    if (search) {
      out = out.filter((f) =>
        (f.title || '').toLowerCase().includes(search) ||
        (f.detectorId || '').toLowerCase().includes(search)
      );
    }
    const dir = this.sortDir === 'asc' ? 1 : -1;
    const by = this.sortBy;
    out = [...out].sort((a, b) => {
      if (by === 'gap') return ((Number(a.gapUsd) || 0) - (Number(b.gapUsd) || 0)) * dir;
      if (by === 'severity') {
        return ((SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99)) * dir;
      }
      if (by === 'detector') return (a.detectorId || '').localeCompare(b.detectorId || '') * dir;
      if (by === 'title') return (a.title || '').localeCompare(b.title || '') * dir;
      return 0;
    });
    return out.map((f) => ({
      ...f,
      gapFmt: this.formatMoney(f.gapUsd),
      selected: this.selectedIds.has(f.id),
      rowClass: this.selectedIds.has(f.id) ? 'op-ip__row op-ip__row--selected' : 'op-ip__row',
    }));
  }

  get hasFindings() { return this.rawFindings?.length > 0; }
  get filteredCount() { return this.filteredFindings.length; }
  get totalCount() { return this.rawFindings?.length || 0; }
  get selectionCount() { return this.selectedIds.size; }
  get hasSelection() { return this.selectedIds.size > 0; }

  get severityOptions() {
    return [
      { label: 'All severities', value: 'all' },
      { label: 'Critical only', value: 'critical' },
      { label: 'Warning only', value: 'warning' },
      { label: 'Info only', value: 'info' },
    ];
  }

  get sortOptions() {
    return [
      { label: 'Highest $', value: 'gap' },
      { label: 'Severity', value: 'severity' },
      { label: 'Detector', value: 'detector' },
      { label: 'Title', value: 'title' },
    ];
  }

  formatMoney(n) {
    const v = Number(n) || 0;
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
    return `$${Math.round(v)}`;
  }

  // ─── interactions ───

  handleSearch(event) {
    this.filter = { ...this.filter, search: event.target.value };
  }
  handleSeverity(event) {
    this.filter = { ...this.filter, severity: event.detail.value };
  }
  handleSort(event) {
    this.sortBy = event.detail.value;
  }
  toggleSortDir() {
    this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
  }

  handleRowToggle(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    if (this.selectedIds.has(id)) this.selectedIds.delete(id);
    else this.selectedIds.add(id);
    // Force reactivity by replacing the Set reference.
    this.selectedIds = new Set(this.selectedIds);
  }

  handleSelectAll() {
    if (this.selectedIds.size === this.filteredFindings.length) {
      this.selectedIds = new Set();
    } else {
      this.selectedIds = new Set(this.filteredFindings.map((f) => f.id));
    }
  }

  handleClearSelection() {
    this.selectedIds = new Set();
  }

  handleRowClick(event) {
    // Click anywhere on the row (except checkbox) navigates.
    if (event.target.dataset.role === 'checkbox') return;
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    this[NavigationMixin.Navigate]({
      type: 'standard__recordPage',
      attributes: { recordId: id, objectApiName: 'ForensicFinding__c', actionName: 'view' },
    });
  }

  // ─── bulk actions ───

  async handleBulkHide() {
    if (!this.hasSelection) return;
    this.busy = true;
    try {
      const ids = Array.from(this.selectedIds);
      const count = await bulkHide({ findingIds: ids });
      this.toast(`Hidden ${count} finding${count === 1 ? '' : 's'}`, 'success');
      this.selectedIds = new Set();
      await refreshApex(this.wiredFindings);
    } catch (e) {
      this.toast(this.errMsg(e), 'error');
    } finally {
      this.busy = false;
    }
  }

  async handleBulkStage() {
    if (!this.hasSelection) return;
    this.busy = true;
    try {
      const ids = Array.from(this.selectedIds);
      const result = await bulkStage({ findingIds: ids });
      const created = result?.created || 0;
      const skipped = result?.skipped || 0;
      this.toast(`Staged ${created} for recovery${skipped ? ` (${skipped} already staged)` : ''}`, 'success');
      this.selectedIds = new Set();
      await refreshApex(this.wiredFindings);
    } catch (e) {
      this.toast(this.errMsg(e), 'error');
    } finally {
      this.busy = false;
    }
  }

  toast(message, variant) {
    this.dispatchEvent(new ShowToastEvent({ title: message, variant }));
  }
  errMsg(e) {
    return e?.body?.message || e?.message || 'Action failed';
  }
}
