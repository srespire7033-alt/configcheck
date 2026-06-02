import { LightningElement, track, wire } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { NavigationMixin } from 'lightning/navigation';

import getLatestScan from '@salesforce/apex/FindingsListController.getLatestScan';
import getFindings from '@salesforce/apex/FindingsListController.getFindings';
import hideFinding from '@salesforce/apex/FindingsListController.hideFinding';
import bulkHide from '@salesforce/apex/FindingsListController.bulkHide';
import bulkStage from '@salesforce/apex/RecoveryActionService.bulkStage';

const SEVERITY_COLOR = {
  Critical: 'red',
  Warning: 'orange',
  Info: 'blue',
};

const ROW_ACTIONS = [
  { label: 'View detail', name: 'view' },
  { label: 'Stage for recovery', name: 'stage' },
  { label: 'Hide finding', name: 'hide' },
];

export default class FindingsList extends NavigationMixin(LightningElement) {
  @track scan = null;
  @track findings = [];
  @track selectedRowIds = [];
  @track searchTerm = '';
  @track severityFilter = '';
  @track showHidden = false;
  @track busy = false;

  // Wire pattern keeps the table live as findings update.
  wiredScan;
  wiredFindings;

  columns = [
    {
      label: 'Detector',
      fieldName: 'detectorId',
      type: 'text',
      initialWidth: 120,
      cellAttributes: { class: { fieldName: 'detectorCss' } },
    },
    { label: 'Title', fieldName: 'title', type: 'text', wrapText: true },
    {
      label: 'Severity',
      fieldName: 'severity',
      type: 'text',
      initialWidth: 100,
      cellAttributes: {
        class: { fieldName: 'severityCss' },
      },
    },
    {
      label: 'Gap',
      fieldName: 'gapUsd',
      type: 'currency',
      initialWidth: 130,
      cellAttributes: { alignment: 'right' },
      typeAttributes: { currencyDisplayAs: 'symbol' },
    },
    {
      label: 'Detected',
      fieldName: 'detectedAt',
      type: 'date',
      initialWidth: 120,
      typeAttributes: { year: 'numeric', month: 'short', day: 'numeric' },
    },
    {
      label: 'Note',
      fieldName: 'noteIndicator',
      type: 'text',
      initialWidth: 60,
      cellAttributes: { alignment: 'center', iconName: { fieldName: 'noteIcon' } },
    },
    {
      type: 'action',
      typeAttributes: { rowActions: ROW_ACTIONS },
    },
  ];

  @wire(getLatestScan)
  wireLatestScan(result) {
    this.wiredScan = result;
    if (result.data) {
      this.scan = result.data;
    }
  }

  @wire(getFindings, { scanId: '$scanId', includeHidden: '$showHidden' })
  wireFindings(result) {
    this.wiredFindings = result;
    if (result.data) {
      // Enrich each row with display-derived fields.
      this.findings = result.data.map((f) => ({
        ...f,
        noteIcon: f.consultantNote ? 'utility:note' : null,
        noteIndicator: f.consultantNote ? '📝' : '',
        severityCss: `slds-text-color_${SEVERITY_COLOR[f.severity] || 'default'}`,
      }));
    }
  }

  get scanId() {
    return this.scan ? this.scan.Id : null;
  }

  get findingCount() {
    return this.scan?.FindingCount__c || 0;
  }

  get formattedLeakage() {
    const n = this.scan?.TotalLeakageUsd__c || 0;
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${Math.round(n)}`;
  }

  get visibleFindings() {
    const term = this.searchTerm.trim().toLowerCase();
    return this.findings.filter((f) => {
      if (this.severityFilter && f.severity !== this.severityFilter) return false;
      if (term) {
        const hay = `${f.title || ''} ${f.detectorId || ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }

  get isEmpty() {
    return !this.busy && this.visibleFindings.length === 0;
  }

  get hasSelection() {
    return this.selectedRowIds.length > 0;
  }

  get selectedCount() {
    return this.selectedRowIds.length;
  }

  get allVariant() { return this.severityFilter === '' ? 'brand' : 'neutral'; }
  get criticalVariant() { return this.severityFilter === 'Critical' ? 'brand' : 'neutral'; }
  get warningVariant() { return this.severityFilter === 'Warning' ? 'brand' : 'neutral'; }

  handleSearch(event) {
    this.searchTerm = event.target.value;
  }

  handleSeverityFilter(event) {
    this.severityFilter = event.currentTarget.dataset.severity;
  }

  handleShowHiddenToggle(event) {
    this.showHidden = event.target.checked;
  }

  handleRowSelection(event) {
    this.selectedRowIds = event.detail.selectedRows.map((r) => r.id);
  }

  async handleRowAction(event) {
    const action = event.detail.action.name;
    const row = event.detail.row;

    if (action === 'view') {
      this[NavigationMixin.Navigate]({
        type: 'standard__recordPage',
        attributes: { recordId: row.id, objectApiName: 'ForensicFinding__c', actionName: 'view' },
      });
    } else if (action === 'stage') {
      await this.stageFindings([row.id]);
    } else if (action === 'hide') {
      await this.hideSingle(row.id);
    }
  }

  async handleBulkStage() {
    await this.stageFindings(this.selectedRowIds);
  }

  async handleBulkHide() {
    this.busy = true;
    try {
      const count = await bulkHide({ findingIds: this.selectedRowIds });
      this.toast('Hidden', `${count} finding(s) hidden`, 'success');
      this.selectedRowIds = [];
      await refreshApex(this.wiredFindings);
    } catch (e) {
      this.toast('Hide failed', this.errMessage(e), 'error');
    } finally {
      this.busy = false;
    }
  }

  async stageFindings(ids) {
    this.busy = true;
    try {
      const summary = await bulkStage({ findingIds: ids });
      this.toast(
        'Recovery staged',
        `${summary.staged} new, ${summary.alreadyStaged} already staged, ${summary.reset} restaged`,
        'success'
      );
      this.selectedRowIds = [];
    } catch (e) {
      this.toast('Stage failed', this.errMessage(e), 'error');
    } finally {
      this.busy = false;
    }
  }

  async hideSingle(findingId) {
    this.busy = true;
    try {
      await hideFinding({ findingId });
      await refreshApex(this.wiredFindings);
      this.toast('Hidden', 'Finding hidden', 'success');
    } catch (e) {
      this.toast('Hide failed', this.errMessage(e), 'error');
    } finally {
      this.busy = false;
    }
  }

  toast(title, message, variant) {
    this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
  }

  errMessage(e) {
    return e?.body?.message || e?.message || 'Unknown error';
  }
}
